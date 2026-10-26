/**
 * GET /api/library/info
 *
 * What this server can do, so a client can tell an older server from a newer
 * one by asking instead of guessing from missing fields. Each feature names a
 * field or endpoint the client may rely on once the name is listed; a server
 * that answers 404 here predates the list and offers none of the optional ones.
 *
 * `download.maxConnections` is how many connections one console may open for
 * one download (parallel Range requests): the admin's setting, 4 by default.
 * The same number rides on list and download responses as
 * X-CookingFoil-Max-Connections. It is a hint; the server does not enforce it.
 *
 * `admin-edit` is listed only to a console the admin made an admin device (on
 * the devices tab): it may then read and change item settings through
 * /api/admin/items (routes/admin-items.js). The answer is per console, hence
 * Cache-Control: private.
 *
 * Whether the server has prod.keys is never listed: the admin hands them in on
 * the admin page's settings tab (routes/admin/keys-api.js), not from a console.
 *
 * Plugins add to this (withPlugins below): download options (file-variants, variants.keys, console.wants)
 * and whatever a plugin's libraryInfo hook names. A plugin that needs the server's keys and says how far they
 * reach tells any signed-in client that the server has keys and how new they are, never a key.
 *
 * `server_id` is this installation's UUID (security/server-id.js): the same on
 * every address the server answers on, so a client merging several servers
 * sees two addresses of one server as one.
 */
import fs from "fs";
import pkg from "../app-info.js";
import { CLIENT_NRO, clientBuildStatus } from "./client-update.js";
import * as libraryCache from "../meta/library-cache.js";
import * as contentMeta from "../meta/content-meta.js";
import { devicePairing, downloadMaxConnections, enrollPerHour, retroDir } from "../helpers/envs.js";
import * as integrations from "../security/integrations.js";
import * as retroCatalog from "../retro/catalog.js";
import { retroEnabled } from "./retro.js";
import { savesCatalog, savesEnabled } from "./saves.js";
import * as userPatches from "../meta/user-patches.js";
import { homebrewEnabled } from "./homebrew.js";
import { adminDeviceOf } from "../security/device-admin.js";
import { serverId } from "../security/server-id.js";
import { requestLang } from "../meta/langs.js";
import debug from "../debug.js";
import { clientLanguages } from "../meta/client-strings.js";

export const API_VERSION = 1;

const FEATURES = [
  "sections-etag",        // /api/library/sections answers If-None-Match with 304
  "title-detail",         // /api/title/:id with description, screenshots, categories
  "title-videos",         // detail.videos
  "title-rating-content", // detail.ratingContent, the reasons behind detail.rating
  "item-rank",            // sections item.rank and item.players
  "item-categories",      // sections item.categories and item.languages
  "item-version-name",    // update item.version_name ("1.4.1")
  "item-install-size",    // item.install_size, the unpacked size (NSP/NSZ only)
  "item-integrity",       // item.integrity "modified" | "damaged" from the file check; absent when it passed or was not checked. Informational only
  "item-integrity-detail", // item.integrity_detail { reason, certain, present? }; detail.integrity[] adds label and help { title, body } in the reader's language
  "item-signed",          // item.signed { nca?, ticket? } true | false, only what the file check knows; detail.signed[] adds help { title, body } when one is false
  "item-required-firmware", // item.required_firmware ("16.0.0") and DLC item.required_app_version
  "item-key-generation",  // item.key_generation (master key generation, 0-based) and item.key_firmware ("21.0.0"); detail.keyGeneration, detail.keyFirmware
  "item-latest-version",  // base item.latest_version and item.dlc_total, from the eShop
  "title-updates",        // detail.latestVersion, detail.updates [{ version, date }], detail.dlcTotal
  "item-score",           // base item.score, score_count, score_source, score_label (+ score_labels map)
  "retro-filters",        // /api/retro/systems/:id/filters, every filter one console list takes
  "card-labels",          // base item.labels (keys, or [key, value]) and sections.labels; retro games and lists the same
  "genre-keys",           // categories are English keys; sections.genres maps them per language
  "featured",             // sections.featured [{ id, title, banner_url?, title_ids }]
  "image-sizes",
  "item-icons",           // base item.icons { ko?, en?, ja?, zh? } and ?lang= on icon/banner; detail iconUrl/bannerUrl follow ?lang=
  "download-connections", // info.download.maxConnections and X-CookingFoil-Max-Connections on lists and downloads
  "active-downloads", // X-CookingFoil-Active-Downloads: consoles downloading now, the caller included
  "server-id",            // info.server_id, fixed per installation
  "client-strings",       // GET /api/client/strings?lang=, and info.client_strings.languages [{ code, name, base }]
  "item-names",           // base item.names { ko?, en?, ja?, zh? }; detail.names, and ?lang= picks detail.description         // /api/patches, /api/patches/:id/download (ustar), detail.patches, item.patches          // icon accepts ?size=sm|md|lg (160|256|512 square); banner, screenshot ?size=sm (256) and md|lg (512)
];

// Every feature name the core can announce, on or off: a plugin may not announce one.
const CORE_FEATURES = new Set([
  ...FEATURES, "session-token", "pair-password-only", "device-pairing", "device-rebind", "enroll", "dropbox-sync",
  "retro", "retro-index", "library-saves", "shop-saves", "saves-by-game", "user-patches", "homebrew", "homebrew-folders", "homebrew-titles",
  "admin-edit", "client-update", "file-variants", "console-facts",
]);

/** Retro is offered only while there is at least one ROM to play (the client hides its menu otherwise). */
async function hasRetroGames() {
  if (!retroEnabled()) return false;
  try {
    return (await retroCatalog.current(retroDir)).games.length > 0;
  } catch {
    return false;
  }
}

/**
 * What the plugins that are on add to library info, laid over `info` in place:
 *   features "file-variants"     some plugin offers download options (POST /api/library/variants)
 *   variants { keys }            the query keys of every plugin's options, on or off: a client takes them off a URL to tell two of one file apart
 *   features "console-facts", console { wants }   the items a console is asked to send in X-CookingFoil-Console
 *   plugin features and info keys (the libraryInfo hook): a name core or an earlier plugin already has is dropped, with a log line
 * Plugins failing or being absent add nothing: library info is the same as without them.
 */
export async function withPlugins(info, lang, variantsOf = async () => (await import("../plugins/instance.js")).pluginVariants()) {
  let facts;
  let extras = { features: [], info: {} };
  try {
    const variants = await variantsOf();
    facts = variants.libraryInfoFacts();
    extras = await variants.libraryInfoExtras(lang);
  } catch (err) {
    debug.error("library info: plugins skipped: %s", err.message);
    return;
  }
  const add = (feature) => { if (!info.features.includes(feature)) info.features.push(feature); };
  if (facts.active) add("file-variants");
  if (facts.keys.length) info.variants = { keys: facts.keys };
  if (facts.wants.length) {
    add("console-facts");
    info.console = { wants: facts.wants };
  }
  for (const feature of extras.features) {
    if (CORE_FEATURES.has(feature)) debug.log("library info: a plugin tried to announce %s, which is the core's; dropped", feature);
    else add(feature);
  }
  for (const [key, value] of Object.entries(extras.info)) {
    if (key in info) debug.log("library info: a plugin tried to set %s, which is already taken; dropped", key);
    else info[key] = value;
  }
}

export default async function libraryInfoRoute(req, res) {
  const retro = await hasRetroGames();
  // Saves and patches show on the console only once there is one to hand out; an empty folder is not a feature.
  const saves = savesEnabled() && (await savesCatalog().list().catch(() => [])).length > 0;
  const patches = (await userPatches.list()).length > 0;
  const stats = libraryCache.stats();
  const adminDevice = Boolean(adminDeviceOf(req));
  res.header("Cache-Control", "private, max-age=60");
  const info = {
    name: "CookingFoil",
    version: pkg.version,
    apiVersion: API_VERSION,
    server_id: serverId(),
    // dropbox-sync: /api/dropbox speaks oc-save-keeper's bridge protocol (sign-in only; saves go straight to Dropbox).
    // device-rebind: POST /api/pair/rebind moves a console to a new device key.
    // session-token: GET /api/session trades the access key for a token the console sends instead.
    // pair-password-only: an ID and password count only on /api/pair/*, once, to approve a console;
    // everywhere else a Basic header authenticates nothing, so the client may forget it once approved.
    features: [
      ...FEATURES,
      "session-token",
      "pair-password-only",
      // enroll: POST /api/pair/enroll spends a downloaded client's enrollment token.
      ...(devicePairing ? ["device-pairing", "device-rebind", "enroll"] : []),
      ...(integrations.get("dropbox").appKey ? ["dropbox-sync"] : []),
      // retro: /api/retro serves retro games, bezels and the RetroArch base pack; only while it holds a ROM.
      // retro-index: GET /api/retro/index lists every game unsorted and light, for a client merging servers.
      ...(retro ? ["retro", "retro-index"] : []),
      // library-saves: /api/saves hands out save files to restore on the console.
      // shop-saves is the same feature under its old name, kept for a client release that checks for it.
      ...(saves ? ["library-saves", "shop-saves"] : []),
      // saves-by-game: /api/saves?view=games lists games with counts; ?game=<key> one game's saves.
      ...(saves ? ["saves-by-game"] : []),
      // user-patches: /api/patches, /api/patches/:id/download (ustar), detail.patches, item.patches; while one is listed.
      ...(patches ? ["user-patches"] : []),
      // homebrew: /api/homebrew lists .nro apps to keep in sdmc:/switch/<app>/.
      // homebrew-titles: GET /api/homebrew?with=titles also lists .nsp apps (install_type "title") to install like a game.
      ...(homebrewEnabled() ? ["homebrew", "homebrew-folders", "homebrew-titles"] : []),
      // admin-edit: this console is an admin device; /api/admin/items/:kind/:id/fields reads and changes item settings.
      ...(adminDevice ? ["admin-edit"] : []),
      // client-update: /api/client/latest names the CookingFoil client build to update to.
      ...(fs.existsSync(CLIENT_NRO) || clientBuildStatus().published ? ["client-update"] : []),
    ],
    // How many connections one console may open per download (a hint, not enforced; admin setting).
    download: { maxConnections: downloadMaxConnections },
    // How many different consoles one account's downloaded clients may enroll in any hour (admin setting).
    ...(devicePairing ? { enroll: { perHour: enrollPerHour } } : {}),
    files: stats.files,
    contentMeta: contentMeta.progress(),
    client_strings: { languages: clientLanguages() },
  };
  await withPlugins(info, requestLang(req));
  res.json(info);
}
