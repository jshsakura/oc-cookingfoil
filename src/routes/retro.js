/**
 * Retro games for RetroArch on the console. Off (404) until the retro folder
 * (COOK_RETRO_DIR, default <data dir>/retro) exists.
 *
 *   GET /api/retro/systems                       { retroarch: "installed" | "missing", systems: [{ id, name, names, defaultCore, coreName, romCount,
 *                                                iconUrl, iconMonoUrl, core: { id, state: "ready" | "core-missing" } }] }
 *                                                only consoles with at least one listed game; the others never appear
 *   GET /api/retro/systems/:id/icon[?style=mono][&v=] the console's icon (from <retro dir>/system-icons/{color,mono}/<folder>.png,
 *                                                <folder> being the system's server folder, else <id>.png);
 *                                                iconUrl / iconMonoUrl are null when there is none
 *   GET /api/retro/games?system=&q=&sort=name|added|size|rating&page=&pageSize=
 *                       &minRating=0-100&bezel=1&minSize=&maxSize=  (bytes; bezel=1 keeps games with their own bezel;
 *                       total counts what the filters left)
 *                       &variants=all                every file, as before versions were grouped (old clients, admin)
 *                                                { total, page, pageSize, games: [G…] }  (search= is q's old name)
 *                                                no-store and no ETag while rom_hash is still being worked out after a scan
 *   GET /api/retro/index?page=&pageSize=         { version, total, page, pageSize, games: [I…] }: every version of every listed
 *                                                game, ordered by id, 500 a page (the most), gzipped when asked, ETag/304.
 *                                                version (16 hex) names the whole list: a page with another one means the
 *                                                list changed while paging, so start over (src/retro/list-index.js).
 *   GET /api/retro/index?since=<version>         { version, since, changed: [I…], removed: [id…] }: only what changed since
 *                                                a version this server still remembers; else { version, reset: true },
 *                                                and the client pages again. since = version gives empty lists.
 *       I = { id ("<system>-<10 hex>", so the system is the part before the last "-"), group? (the same 10 hex for
 *             versions of one game; absent for a game with one version), representative?: true (the version a
 *             group shows), name, names?, original?, variant?, region?, edition?, rom_hash?,
 *             rom_size? (left out when it equals size; null for a made-up .m3u), size, addedAt (s), rating?,
 *             ratingCount?, ownBezel?: true, icon? (the v of /api/retro/games/:id/icon?v=), verified?: true,
 *             votes? { up, down } (only when any), achievements? (how many) }
 *             A missing field is its default. Same for every console: no my_vote, no download URL.
 *   GET /api/retro/home?limit=20                 { systems: [{ id, name, names, iconUrl, iconMonoUrl, defaultCore, romCount, games: [G…] }] }
 *                                                the best-rated games of every console that has any
 *   GET /api/retro/themes?rows=6&limit=12      { themes: [{ id, name, games: [G…] }] } the home's rows (retro/menu.js), dealt
 *                                                anew on every request and drawn in this order: at most `rows` (6, the most), no
 *                                                game twice, none under 8. Ids are kinds and keys joined by ":" ([a-z0-9-]+):
 *                                                recent, arcade:all, arcade:decade:1990, arcade:genre:<style>, players:2,
 *                                                players:4, coop, coop:beat-em-up, versus, genre:<slug>, decade:1990,
 *                                                decade:1990:genre:<slug>, classic, good, hidden, maker:<slug>, series:<slug>,
 *                                                korean, achievements, family
 *   GET /api/retro/systems/:id/facets            { system, total, genres?: [{ key, name, count }], players?: [{ value, count }]
 *                                                (at least that many), decades?: [{ value, count }], regions?: [{ value, count }],
 *                                                korean?: count, achievements?: count }; values no game has are left out
 *   G.shortcutName                                the HOME menu name of its shortcut (the forwarder's NACP name):
 *                                                the display name, then " · " and what tells it from the game's
 *                                                other versions (한글 v2, 정발, 일본…) when there is more than one
 *   GET /api/retro/systems/:id/filters           { groups: [{ key, en, ko, ja, zh, pick, options: [{ key, …, count, params }] }], sorts }
 *                                                every filter its list can take (retro/filters.js); ETag
 *   /api/retro/games filters by facts too: genre=<key>[,<key>] (genres and play styles), decade=1990[,…],
 *                                                region=kr[,…] (any of them), players=<at least>, korean=1, achievements=1;
 *                                                G carries genres?, players?, year?
 *   GET /api/retro/games/:id                     G with variants: [V…] and representative (the group's listed id),
 *                                                and when known (src/retro/meta/): description (in the request's
 *                                                language, else English), publisher, developer, releaseDate (YYYYMMDD,
 *                                                YYYY0000 for a year alone), numberOfPlayers, genres (labels in the
 *                                                request's language) and screenshots (at most 8 URLs with ?v=);
 *                                                an unknown one is left out. Versions of one game share them.
 *   GET /api/retro/games/:id/achievements      its RetroAchievements list and the player's progress (retro-achievements.js)
 *   GET /api/retro/games/:id/screenshot/:n?v=    one of those screenshots (1-8), cached for a year with its ?v=
 *
 * Versions of one game (src/retro/variants.js: an arcade parent and its
 * clones, or one title's patches and releases) are one group. Lists show each
 * group's representative once, with `group` and `variants` (how many files
 * the group holds); a search that finds any version shows the representative.
 * Arcade groups whose representative can't run (its parent or BIOS zip is
 * missing) are left out; ?variants=all lists them. romCount counts what the
 * lists show. Every id still resolves, listed or not, so installs and
 * forwarders made from another version keep working.
 *   V = { id, name, variant?, edition?, region?, size, file, rom_hash, rom_size, representative: bool, bezel: { kind }, missing?: [set] }
 *   GET /api/retro/games/:id/rom                 the game file (Range works)
 *   GET /api/retro/games/:id/icon?size=sm|md     square box art for tiles, 160 or 256 px WebP (default md);
 *                                                drawn ahead of time, cached for a year with the ?v= of iconUrl
 *   GET /api/retro/games/:id/boxart?v=&size=sm|md the box art as WebP, whole; with ?size= fitted within 160 or
 *                                                256 px, its shape kept and never enlarged
 * Every client gets WebP whatever its Accept. Left as they are: the bezel
 * (bezel.png goes onto the SD card for RetroArch's overlay, which reads PNG and
 * needs its transparency), the console icons (small PNGs whose transparency the
 * client tints) and the screenshots (sent as they were saved).
 *
 * Every image URL in a list (iconUrl, boxartUrl, a console's iconUrl and
 * iconMonoUrl) ends in ?v=<12 hex> of the file it serves. That v gets
 * `public, max-age=31536000, immutable`; no v or another one `private, no-cache`
 * (revalidated by its ETag), so a replaced picture never sticks.
 *   GET /api/retro/games/:id/bezel.png | overlay.cfg | game.cfg
 *   GET /api/retro/games/:id/bundle              tar of everything below, SD-root paths
 *   GET /api/retro/base-pack/manifest[?cores=ondemand]  { version, bundleUrl, bundleSize, files: [{ path, size, sha256, url, once?, core?, onDemand? }] }
 *                                                without cores=ondemand (or X-Retro-Cores: ondemand) every file, exactly as
 *                                                before; with it every core is listed too, its .nro and .info carry core,
 *                                                the .nro onDemand: true (not in the bundle; fetched by its url when a game
 *                                                needs it)
 *   GET /api/retro/base-pack/core/<core>         { core, files: [{ path, size, sha256, url, core }] } one core's .nro and .info
 *   GET /api/retro/base-pack/file/<sd path>      one pack file (Range works)
 *   GET /api/retro/base-pack/bundle[?cores=ondemand] the manifest's files as one tar, SD-root paths (also at /base-pack);
 *                                                X-Retro-Once lists the files to skip when already on the card
 *
 * G = { id, name, names?, region?, original?, rating?, ratingCount?, file, system, core, size, rom_hash, rom_size, addedAt, iconUrl, boxartUrl, romUrl, bundleUrl,
 *       group, variants (a count in lists, the V list in a game's own reply),
 *       bezel: { kind, hasBezel, generic?, credit?: { name, url, text }, imageUrl, overlayCfgUrl, gameCfgUrl },
 *         kind: "game" (made for this game), "system" (the console's default), "none".
 *         New kinds may be added later; hasBezel and generic stay for older clients.
 *       forwarderUrl, forwarderTitleId, forwarderSize, install: { rom, extras, bezelPng, overlayCfg, gameCfg } }
 *
 * size counts a game's extras too (a .cue's tracks); rom_size is its own file
 * alone, null for a made-up .m3u. rom_hash names the ROM's content across
 * servers: the 32-hex MD5 RetroArch sends to RetroAchievements (src/retro/rom-hash.js),
 * of the ROM data without a copier header, an N64 ROM in big-endian order, the
 * largest entry of a zip; of an arcade set, its name only. The same dump gives the
 * same value under any file name or zip. null until the background pass has read
 * the file, and always for discs, the DS, .7z, a bare file over 64 MB and
 * anything unreadable.
 *
 * Every download URL (romUrl, bundleUrl, the bezel's imageUrl, overlayCfgUrl
 * and gameCfgUrl, forwarderUrl, the pack's bundleUrl and each file's url) is on
 * the direct address when a signed-in client asked for it and a direct address
 * is set (security/download-links.js); artwork never is.
 *
 * Bundle and pack paths are relative to the SD root: roms/<system>/…,
 * retroarch/overlays/GameBezels/<System>/…, retroarch/config/<Core>/…,
 * switch/retroarch_switch.nro. A file marked `once` is only written when the
 * card doesn't have it yet (retroarch.cfg holds the player's own settings).
 *
 * GET /api/retro/games/:id/forwarder.nsp is the game's HOME-menu shortcut
 * (src/retro/forwarder.js): it starts the game's core with install.rom. The
 * forwarder fields are null when the server can't build one (no prod.keys or
 * hacBrewPack); forwarderSize is null until the NSP has been built.
 */
import fs from "fs";
import path from "path";
import express from "express";
import crypto from "crypto";
import zlib from "zlib";
import { promisify } from "util";
import debug from "../debug.js";
import { retroDir, dataDir } from "../helpers/envs.js";
import { keysDir } from "../security/prod-keys.js";
import { pick, requestLang } from "../meta/langs.js";
import * as catalog from "../retro/catalog.js";
import * as retroNames from "../retro/names.js";
import { sdPaths, overlayCfg, gameCfg, retargetOverride } from "../retro/bezel-config.js";
import { bezelCredit } from "../retro/credits.js";
import { tagsOf, withoutTags } from "../retro/sd-names.js";
import { editionOf } from "../retro/edition.js";
import { regionOf } from "../retro/arcade.js";
import { buildManifest, coreFiles, listPack, HashCache, manifestView, wantsOnDemand } from "../retro/base-pack.js";
import { appDb } from "../db/database.js";
import { hashStore } from "../db/stores.js";
import { sendTar, tarEntries } from "../helpers/tar-stream.js";
import { archiveSize } from "../helpers/ustar.js";
import { artKey, BOXART_SIZES, ensureBoxart, ensureSquare, ensureSquareWebp, prewarm, squarePath, SQUARE_SIZES } from "../retro/square-art.js";
import { fileVersion } from "../retro/file-version.js";
import { IMMUTABLE } from "../meta/image-cache.js";
import { listFilter } from "../retro/list-filter.js";
import { groupVisible, representative } from "../retro/variants.js";
import * as variantPicks from "../retro/variant-picks.js";
import * as itemVerified from "../meta/item-verified.js";
import * as itemVotes from "../meta/item-votes.js";
import { optimizeBoxarts } from "../retro/art/sync.js";
import { directUrl, forRequest } from "../security/download-links.js";
import * as retroMeta from "../retro/meta/sync.js";
import * as retroAchievements from "../retro/achievements/sync.js";
import * as romHashes from "../retro/rom-hash.js";
import { createIndexCache, delta } from "../retro/list-index.js";
import { pickEncoding } from "../helpers/json-compression.js";
import { achievementSummary, mountAchievements } from "./retro-achievements.js";
import { RETRO_LABELS, retroLabels } from "../meta/card-labels.js";
import { packDirOf, packStatus } from "../retro/pack-status.js";
import { autoCores } from "../retro/auto-cores.js";
import { filtersOf } from "../retro/filters.js";
import { retroDetailFields, retroShotFile, metaOwner } from "../retro/meta/detail.js";
import { videosOf } from "../meta/igdb-videos.js";
import * as metaStore from "../retro/meta/store.js";
import * as metaEdits from "../retro/meta/edits.js";
import { metaKey } from "../retro/meta/build.js";
import { factsOf, facetsOf, factsFilter, genreSlug } from "../retro/themes.js";
import { menuRows, pickMenu, rowIcon, MENU_GAMES } from "../retro/menu.js";
import { displayName, ensureForwarder, forwarderPath, forwarderSpec, forwardersAvailable, shortcutName } from "../retro/forwarder.js";
import { versionLabels } from "../retro/shortcut-name.js";

const ID_RE = /^[a-z0-9_-]{1,24}-[0-9a-f]{10}$/;
const PAGE_MAX = 200;
const MANIFEST_STALE_MS = 60_000;
const FIRST_HASH_WAIT_MS = 3000;
const byName = (a, b) => a.name.localeCompare(b.name);
const SORTS = {
  name: byName,
  // Rated games first, best first; the unrated after them by name.
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0) || byName(a, b),
  added: (a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name),
  size: (a, b) => b.size - a.size || a.name.localeCompare(b.name),
};

export const retroEnabled = () => fs.existsSync(retroDir);

// RetroArch itself: <retro dir>/retroarch/ (or base-pack/, the earlier name).
const artDir = path.join(dataDir, "retro-art");
const forwarderDir = path.join(dataDir, "retro-forwarders");
const packDir = () => packDirOf(retroDir);
let hashCache = null;
let manifest = null; // { version, files, sources, builtAt }
let building = null;

function rebuildManifest() {
  if (building) return building;
  hashCache ??= new HashCache(hashStore(appDb(), "retro"));
  building = buildManifest(packDir(), hashCache)
    .then((m) => (manifest = { ...m, builtAt: Date.now() }))
    .finally(() => (building = null));
  return building;
}

/** The manifest; stale ones refresh in the background, the first waits a little then reports pending. */
async function currentManifest() {
  if (manifest && Date.now() - manifest.builtAt <= MANIFEST_STALE_MS) return manifest;
  const running = rebuildManifest().catch((err) => {
    debug.error("retro: base pack manifest failed: %s", err.message);
    return null;
  });
  if (manifest) return manifest;
  const timeout = new Promise((resolve) => setTimeout(resolve, FIRST_HASH_WAIT_MS, "pending"));
  const result = await Promise.race([running, timeout]);
  return result === "pending" ? null : result;
}

/**
 * One core's .nro and .info in the base pack, each with its url ([] when the pack has no such core),
 * or null while the pack is still being read.
 */
export async function baseCoreFiles(core) {
  const m = await currentManifest();
  if (!m) return null;
  return coreFiles(m, String(core)).map((f) => ({ ...f, url: `/api/retro/base-pack/file/${enc(f.path)}` }));
}

/** Whether a manifest was read from exactly this listing (same paths, sizes, times, inodes). Pure. */
export function manifestMatches(m, files) {
  if (!m?.version || !m.sources || m.sources.size !== files.length) return false;
  return files.every((f) => {
    const s = m.sources.get(f.path);
    return s && s.abs === f.abs && s.size === f.size && s.mtimeMs === f.mtimeMs && s.ino === f.ino;
  });
}

/**
 * A console's icon file: system-icons/<style>/<folder>.png, else <id>.png (icons
 * are filed by the short id while the folder is RetroArch's long name), else
 * null, which the lists send as a null iconUrl. Only names from the system
 * table reach the disk.
 */
export function systemIcon(dir, id, system, style) {
  if (!system?.folder) return null;
  const names = [...new Set([system.folder, id])];
  return names.map((n) => path.join(dir, "system-icons", style, `${n}.png`)).find((f) => fs.existsSync(f)) ?? null;
}

/** iconUrl and iconMonoUrl of a console, each with its file's ?v= (null without the file). */
function systemIconUrls(id, system) {
  const color = systemIcon(retroDir, id, system, "color");
  const mono = systemIcon(retroDir, id, system, "mono");
  return {
    iconUrl: color ? `/api/retro/systems/${id}/icon?v=${fileVersion(color)}` : null,
    iconMonoUrl: mono ? `/api/retro/systems/${id}/icon?style=mono&v=${fileVersion(mono)}` : null,
  };
}

/** Text for matching: NFC, lower case, no spaces. Pure. */
const folded = (s) => String(s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, "");
/** A game matches on its name in any language, its original title or its file name (sf2.zip). */
const gameMatches = (g, needle) => [g.name, g.original, g.file, ...Object.values(g.names ?? {}), ...Object.values(retroNames.get(g.id) ?? {})].some((s) => s && folded(s).includes(needle));

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

/** What the forwarder module needs to know about a game. */
/** What tells `g` from the other versions of its game on the HOME menu, or null (retro/shortcut-name.js). */
function versionLabelOf(cat, g) {
  const group = cat ? groupOf(cat, g) : null;
  if (!group || group.members.length < 2) return null;
  return versionLabels(group.members.map((m) => {
    const parts = titleOf(m, "ko");
    // "(USA)", "(Japan) (Rev 1)": what the HOME name drops, read when the [tags] say nothing.
    const rest = m.name.slice(displayName(m.name).length).trim();
    return { id: m.id, parts: { ...parts, region: parts.region ?? regionOf(rest), variant: parts.variant || rest } };
  })).get(g.id) ?? null;
}

function forwarderGame(g, system, cat = null) {
  return {
    id: g.id,
    // A name the admin gave wins over the file's, as in the list; a ScummVM game,
    // named by its id, has its folder's title.json next. (Arcade names stay as
    // they were: changing them would build every arcade shortcut again.)
    name: retroNames.get(g.id)?.ko || retroNames.get(g.id)?.en || (g.system === "scummvm" && (g.names?.ko || g.names?.en)) || g.name,
    core: g.core,
    romSdPath: sdPaths(g, system).rom,
    artKey: artKey(g),
    publisher: `RetroArch · ${system.names?.ko ?? system.name ?? g.system}`,
    icon: squarePath(artDir, g, "md"),
    versionLabel: versionLabelOf(cat, g),
  };
}

/**
 * Builds a game's shortcut again after its cover or name changed on the web,
 * from the square of that moment (same title ID). Never throws.
 */
export async function rebuildRetroShortcut(gameId) {
  if (!forwardersAvailable(keysDir())) return null;
  try {
    const state = await catalog.current(retroDir);
    const g = state.byId.get(gameId);
    const system = g && state.systems[g.system];
    if (!system) return null;
    await ensureSquare(artDir, g, "md").catch(() => null);
    const built = await ensureForwarder(forwarderDir, forwarderGame(g, system, state), keysDir());
    if (built) debug.log("retro: shortcut for %s built again", gameId);
    return built;
  } catch (err) {
    debug.error("retro: shortcut for %s: %s", gameId, err.message);
    return null;
  }
}

/** forwarderUrl, forwarderTitleId and forwarderSize (null until the NSP is built). */
function forwarderFields(g, system, base, link, cat) {
  const game = forwarderGame(g, system, cat);
  const shortcut = { shortcutName: shortcutName(game) };
  const spec = forwardersAvailable(keysDir()) ? forwarderSpec(game) : null;
  if (!spec) return { forwarderUrl: null, forwarderTitleId: null, forwarderSize: null, ...shortcut };
  let size = null;
  try {
    size = fs.statSync(forwarderPath(forwarderDir, g.id, spec)).size;
  } catch {
    // not built yet; the first download builds it
  }
  return { forwarderUrl: directUrl(`${base}/forwarder.nsp`, link), forwarderTitleId: spec.titleId, forwarderSize: size, ...shortcut };
}

/** Each group's representative, the admin's pick first; the groups whose representative can't run are left out. */
export function listedGames(cat) {
  const out = [];
  for (const group of cat.groups?.values() ?? []) {
    const rep = representative(group, variantPicks.get(group.id));
    if (groupVisible(rep)) out.push(rep);
  }
  return out;
}

const groupOf = (cat, g) => cat.groups?.get(g.group) ?? { id: g.group ?? g.id, members: [g] };

/** A game, then its group's representative, then its other versions: whose details it shows. */
const metaCandidates = (g, rep, group) => [...new Set([g, rep, ...group.members])];

/** The meta key a game's details are read from (its versions share it), so an edit lands where it shows. */
export function retroMetaKey(cat, g) {
  const group = groupOf(cat, g);
  return metaOwner(metaCandidates(g, representative(group, variantPicks.get(group.id)), group))?.key ?? metaKey(g);
}

/**
 * The IGDB trailers of a game by its id ([{ id, name }], its versions share
 * them as they share the detail), or null for no such game. For the web's
 * admin view only (routes/videos.js); /api/retro/* never carries them.
 */
export async function retroVideos(id) {
  if (!ID_RE.test(id) || !retroEnabled()) return null;
  const cat = await catalog.current(retroDir);
  const game = cat?.byId.get(id);
  if (!game) return null;
  const group = groupOf(cat, game);
  return videosOf(metaOwner(metaCandidates(game, representative(group, variantPicks.get(group.id)), group))?.record?.videos) ?? [];
}

// A game's facts (retro/themes.js) for every game of a catalog, made again when the
// catalog, the collected metadata or the achievement matches change, or after FACTS_TTL_MS.
const FACTS_TTL_MS = 10 * 60 * 1000;
let factsMemo = null;
// Every row the home could show, made once per facts; each request only deals from it.
let menuMemo = null;
const MENU_ROWS = 6;

function menuPool(cat) {
  const facts = factsById(cat);
  if (menuMemo?.facts !== facts) {
    const list = listedGames(cat).map((g) => facts.get(g.id)).filter(Boolean);
    menuMemo = { facts, rows: menuRows(list, Date.now()) };
  }
  return menuMemo.rows;
}

/** The facts of `g`: its metadata (its versions share it), Korean when any version is, its region and achievements. */
function gameFacts(cat, g) {
  const group = groupOf(cat, g);
  const candidates = metaCandidates(g, representative(group, variantPicks.get(group.id)), group);
  return factsOf(g, {
    record: metaOwner(candidates)?.record ?? null,
    korean: group.members.some((m) => titleOf(m, "en").edition?.korean),
    region: titleOf(g, "en").region ?? null,
    achievements: Boolean(achievementSummary(candidates).achievements),
    // An arcade set and its clones are one game; elsewhere the English title says so across consoles.
    work: g.set ? `arcade:${g.cloneOf ?? g.set}` : folded(titleOf(g, "en").name),
  });
}

/** id → facts for the games of `cat` (every version, so variants=all filters too). */
function factsById(cat) {
  const now = Date.now();
  const fresh = factsMemo?.cat === cat && factsMemo.meta === metaStore.all() && factsMemo.edits === metaEdits.version;
  if (fresh && now - factsMemo.at < FACTS_TTL_MS) return factsMemo.map;
  const map = new Map(cat.games.map((g) => [g.id, gameFacts(cat, g)]));
  factsMemo = { cat, meta: metaStore.all(), edits: metaEdits.version, at: now, map };
  return map;
}

/** "game", "system" or "none": which bezel a game installs with. Pure. */
export const bezelKind = (g) => (!g.bezel ? "none" : g.bezel.generic ? "system" : "game");

/** rom_hash and rom_size: what tells one ROM from another across servers. */
const romFields = (g) => ({ rom_hash: romHashes.known(g), rom_size: g.abs ? g.fileSize ?? null : null });

/** One version of a game, as a game's own reply lists them. */
function publicVariant(g, rep, lang) {
  const p = publicGame(g, null, lang, { lean: true });
  return {
    id: g.id,
    name: p.name,
    ...(p.variant ? { variant: p.variant } : {}),
    ...(p.edition ? { edition: p.edition } : {}),
    ...(p.region ? { region: p.region } : {}),
    size: g.size,
    file: g.file,
    ...romFields(g),
    representative: g === rep,
    bezel: { kind: bezelKind(g) },
    ...(g.missing?.length ? { missing: g.missing } : {}),
  };
}

/** A URL field, on the direct address when `link` is set. */
const withDirect = (name, url, link) => ({ [name]: directUrl(url, link) });

/** The bezel fields of a game, with their direct twins. */
function bezelFields(g, paths, base, link, lang) {
  if (!g.bezel) return { kind: "none", hasBezel: false };
  return {
    kind: bezelKind(g),
    hasBezel: true,
    generic: g.bezel.generic,
    // Who made it: { name, url, text } with the text in the request's language.
    credit: bezelCredit(lang),
    ...withDirect("imageUrl", `${base}/bezel.png`, link),
    ...withDirect("overlayCfgUrl", `${base}/overlay.cfg`, link),
    ...(paths.gameCfg ? withDirect("gameCfgUrl", `${base}/game.cfg`, link) : { gameCfgUrl: null }),
  };
}

/** The facts a list tile shows, the unknown ones left out. Pure. */
const tileFacts = (f) => (f ? { ...(f.genres.length ? { genres: f.genres.map(genreSlug) } : {}), ...(f.players ? { players: f.players } : {}), ...(f.year ? { year: f.year } : {}) } : {});

// `link` (download-links.js forRequest) puts the download URLs on the direct address.
// `voter` (item-votes.js voterOf) gives my_vote; without one it is null.
/** How a game is titled in `lang`: name, names, original, and its tags as variant, edition and region. */
function titleOf(g, lang) {
  const variant = tagsOf(g.name);
  // A name the admin gave wins, language by language, over the file's and the arcade table's.
  const own = retroNames.get(g.id);
  const names = own ? { ...(g.names ?? { en: withoutTags(g.name) }), ...own } : g.names;
  // A named game is shown in the page's language, with the English title as its original.
  const localized = names ? pick(names, lang) : null;
  const original = names ? (localized !== names.en ? names.en : null) : g.original;
  // The tags as flags: Korean or not, release or patch, patch version.
  const edition = g.edition ?? editionOf(variant);
  const region = g.region ?? (edition ? "kr" : regionOf(variant));
  return { name: localized ?? withoutTags(g.name), names, original, variant, edition, region };
}

function publicGame(g, systems, lang = "en", { lean = false, cat = null, link = null, voter = null } = {}) {
  const { name, names, original, variant, edition, region } = titleOf(g, lang);
  if (lean) return { name, variant, edition, region };
  const system = systems[g.system];
  const paths = sdPaths(g, system);
  const base = `/api/retro/games/${g.id}`;
  const group = cat ? groupOf(cat, g) : null;
  const ra = group ? achievementSummary(metaCandidates(g, representative(group, variantPicks.get(group.id)), group)) : {};
  const tile = cat ? tileFacts(factsById(cat).get(g.id)) : {};
  const labels = retroLabels({ achievements: ra.achievements, korean: edition?.korean, year: tile.year, players: tile.players });
  return {
    id: g.id,
    // Patch and version tags ("[J-K v20230715 font.galmuri]") move to `variant`.
    name,
    ...(variant ? { variant } : {}),
    ...(original ? { original } : {}),
    // Arcade sets: the title in each language ({ en, ko, ja?, zh? }) and the
    // region of the version as a code for a flag: kr, jp, us, eu, asia, br, world.
    ...(names ? { names } : {}),
    ...(region ? { region } : {}),
    ...(edition ? { edition } : {}),
    ...(g.rating !== undefined ? { rating: g.rating } : {}),
    ...(g.ratingCount ? { ratingCount: g.ratingCount } : {}),
    // Tried on a console by the admin (a 검수됨 badge): verified, verified_at (ISO) or null.
    ...itemVerified.fields("retro", g.id),
    // 잘 돼요 / 안 돼요: votes { up, down } and my_vote ("up" | "down" | null).
    ...itemVotes.fields("retro", g.id, voter),
    ...(group ? { group: group.id, variants: group.members.length } : {}),
    // Lists mark the games with achievements; matchedBy says whether this ROM earns them.
    ...ra,
    // From the collected metadata, for the tile and the filters: genre keys, players, release year.
    ...tile,
    ...(labels.length ? { labels } : {}),
    file: g.file,
    system: g.system,
    core: g.core,
    size: g.size,
    ...romFields(g),
    addedAt: g.addedAt,
    iconUrl: g.icon ? `${base}/icon?v=${artKey(g)}` : null,
    boxartUrl: g.icon ? `${base}/boxart?v=${artKey(g)}` : null,
    ...withDirect("romUrl", `${base}/rom`, link),
    ...withDirect("bundleUrl", `${base}/bundle`, link),
    bezel: bezelFields(g, paths, base, link, lang),
    ...forwarderFields(g, system, base, link, cat),
    install: {
      rom: paths.rom,
      extras: g.extras.map((x) => paths.extra(x.rel)),
      ...(g.bezel ? { bezelPng: paths.bezelPng, overlayCfg: paths.overlayCfg, gameCfg: paths.gameCfg } : {}),
    },
  };
}

/**
 * Every version of every listed game for /index: the keys a client merging
 * servers matches on and what a list card draws, nothing more. A field at its
 * default is left out, and so is what the id already says (its system). No
 * my_vote and no download URL, so the list is the same for every console.
 */
function indexGames(cat, lang) {
  const out = [];
  for (const rep of listedGames(cat)) {
    const group = groupOf(cat, rep);
    const shared = group.members.length > 1;
    const ra = achievementSummary(metaCandidates(rep, rep, group)).achievements;
    for (const g of group.members) {
      const { name, names, original, variant, edition, region } = titleOf(g, lang);
      const { rom_hash: romHash, rom_size: romSize } = romFields(g);
      const votes = itemVotes.tally("retro", g.id);
      out.push({
        id: g.id,
        // Only versions of one game carry their group, as the part after "<system>~".
        ...(shared ? { group: group.id.slice(group.id.indexOf("~") + 1) } : {}),
        ...(shared && g === rep ? { representative: true } : {}),
        name,
        ...(names ? { names } : {}),
        ...(original ? { original } : {}),
        ...(variant ? { variant } : {}),
        ...(region ? { region } : {}),
        ...(edition ? { edition } : {}),
        ...(romHash ? { rom_hash: romHash } : {}),
        ...(romSize !== null && romSize !== g.size ? { rom_size: romSize } : {}),
        size: g.size,
        addedAt: g.addedAt,
        ...(g.rating !== undefined ? { rating: g.rating } : {}),
        ...(g.ratingCount ? { ratingCount: g.ratingCount } : {}),
        ...(bezelKind(g) === "game" ? { ownBezel: true } : {}),
        ...(g.icon ? { icon: artKey(g) } : {}),
        ...(itemVerified.fields("retro", g.id).verified ? { verified: true } : {}),
        ...(votes.up || votes.down ? { votes } : {}),
        ...(ra ? { achievements: ra.count } : {}),
      });
    }
  }
  return out;
}

const INDEX_PAGE_MAX = 500;
const ENCODE_MIN = 1024;
const brotliAsync = promisify(zlib.brotliCompress);
const gzipAsync = promisify(zlib.gzip);
// Made once per version and kept, so the best ratio is worth its time.
const ENCODERS = {
  br: (body) => brotliAsync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }),
  gzip: (body) => gzipAsync(body, { level: 9 }),
};
// Built at most once per 3 s per language and at once after a rescan; votes,
// checks and hashes that land between show up after it.
const retroIndex = createIndexCache(indexGames);

/** A JSON body with its ETag, and its gzip once asked for. */
const jsonReply = (body) => ({ body, etag: `"${crypto.createHash("sha1").update(body).digest("hex")}"`, encoded: {} });

/** One page of the index; the full-size pages within the list are kept per version. */
function indexPage(entry, page, pageSize) {
  const { games, version } = entry.snap;
  const keep = pageSize === INDEX_PAGE_MAX && (page - 1) * pageSize < Math.max(1, games.length);
  const kept = keep ? entry.pages.get(page) : null;
  if (kept) return kept;
  const made = jsonReply(JSON.stringify({ version, total: games.length, page, pageSize, games: games.slice((page - 1) * pageSize, page * pageSize) }));
  if (keep) entry.pages.set(page, made);
  return made;
}

/** What changed since `since`, or reset when that version is gone or too much changed to send at once. */
function indexDelta(entry, lang, since) {
  const { version } = entry.snap;
  const older = retroIndex.hashesOf(lang, since);
  const changes = older ? delta(older, entry.snap) : null;
  if (!changes || changes.changed.length > INDEX_PAGE_MAX) return jsonReply(JSON.stringify({ version, reset: true }));
  return jsonReply(JSON.stringify({ version, since, changed: changes.changed, removed: changes.removed }));
}

/** Every file of one game's bundle, SD-relative. */
function bundleFiles(g, system) {
  const paths = sdPaths(g, system);
  const fileEntry = (sd, abs, size, mtimeMs) => ({ path: sd, abs, size, mtime: mtimeMs / 1000 });
  // A generated file carries the game file's time, never the clock's: the bytes,
  // and so the ETag a resumed download checks against, stay the same between requests.
  const stable = Math.floor((g.mtimeMs ?? 0) / 1000);
  const made = (sd, text) => {
    const data = Buffer.from(text);
    return { path: sd, data, size: data.length, mtime: stable };
  };
  // A .cue or .m3u is written out naming the files' new SD names; the rest is copied.
  const rom = g.sd?.romText !== undefined ? made(paths.rom, g.sd.romText) : fileEntry(paths.rom, g.abs, fs.statSync(g.abs).size, g.mtimeMs);
  const files = [rom, ...g.extras.map((x) => {
    const text = g.sd?.extras.get(x.rel)?.text;
    return text !== undefined ? made(paths.extra(x.rel), text) : fileEntry(paths.extra(x.rel), x.abs, x.size, x.mtimeMs);
  })];
  if (!g.bezel) return files;
  const disk = (abs) => fs.statSync(abs);
  files.push(fileEntry(paths.bezelPng, g.bezel.png, disk(g.bezel.png).size, disk(g.bezel.png).mtimeMs));
  // Made up rather than copied: The Bezel Project's own .cfg names the image by its old name.
  files.push(made(paths.overlayCfg, overlayCfg(g)));
  if (paths.gameCfg) {
    files.push(made(paths.gameCfg, g.bezel.override ? retargetOverride(fs.readFileSync(g.bezel.override, "utf8"), g, system) : gameCfg(g, system)));
  }
  return files;
}

/** Sends a file; `immutable` when the request's ?v= names exactly these bytes, else revalidated every time. */
function sendFile(res, abs, type, immutable = false) {
  res.set("Cache-Control", immutable ? IMMUTABLE : "private, no-cache");
  if (type) res.type(type);
  res.sendFile(abs, { dotfiles: "allow", acceptRanges: true });
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default function retroRouter() {
  // The first console after a restart shouldn't wait for the pack to be read.
  if (retroEnabled()) rebuildManifest().catch((err) => debug.error("retro: base pack manifest failed: %s", err.message));
  const router = express.Router();

  // Draw square tiles ahead of time after every scan, starting with one at boot.
  // Forwarders are built only when one is downloaded, from the square of that moment.
  catalog.onScan((state) => prewarm(artDir, state.games).catch((err) => debug.error("retro: square art: %s", err.message)));
  // Content hashes (rom_hash) of the new and changed files, one at a time.
  catalog.onScan((state) => romHashes.queue(state.games));
  // A console with games and no core gets the official one (retroAutoCores); one job for what a scan finds.
  catalog.onScan((state) => {
    if (state.dir === retroDir) autoCores().then((a) => a.check(state)).catch((err) => debug.error("retro: official core check: %s", err.message));
  });
  if (retroEnabled()) setImmediate(() => catalog.current(retroDir).catch((err) => debug.error("retro: first catalog scan failed: %s", err.message)));
  // Box art saved before covers were shrunk on the way in: shrink it once, then
  // rescan so the tiles are redrawn from the small copies.
  if (retroEnabled()) setImmediate(() => optimizeBoxarts(retroDir)
    .then((r) => {
      if (!r.optimized) return;
      debug.log("retro: shrank %d box art files, %d MB → %d MB", r.optimized, Math.round(r.before / 1048576), Math.round(r.after / 1048576));
      return catalog.scan(retroDir);
    })
    .catch((err) => debug.error("retro: shrinking box art: %s", err.message)));

  // Details (description, publisher, screenshots …) collected in the background; requests only read them.
  retroMeta.start({ current: () => catalog.current(retroDir), enabled: retroEnabled });
  // Which RetroAchievements game each ROM is, once the admin has saved a key.
  retroAchievements.start({ current: () => catalog.current(retroDir), enabled: retroEnabled });

  router.use((req, res, next) => (retroEnabled() ? next() : res.status(404).json({ error: "retro games are not set up on this server" })));
  const gameAchievements = mountAchievements(router, {
    games: async (req) => {
      const cat = await catalog.current(retroDir);
      const lang = requestLang(req);
      return listedGames(cat).map((g) => ({
        candidates: metaCandidates(g, g, groupOf(cat, g)),
        shown: () => ({ id: g.id, name: publicGame(g, null, lang, { lean: true }).name, system: g.system, iconUrl: g.icon ? `/api/retro/games/${g.id}/icon?v=${artKey(g)}` : null }),
      }));
    },
  });

  router.get("/systems", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    res.set({ "Cache-Control": "private, max-age=0, must-revalidate", Vary: "Accept-Language" });
    // Whether this server can run them: RetroArch itself and each console's core files.
    const pack = packStatus(packDir(), cat.games, cat.systems);
    const ready = new Map(pack.systems.map((p) => [p.id, p.state]));
    res.json({
      retroarch: pack.retroarch,
      systems: catalog.visibleSystems(cat, listedGames(cat)).map((s) => ({
        ...s,
        ...systemIconUrls(s.id, cat.systems[s.id]),
        core: { id: s.defaultCore, state: ready.get(s.id) ?? "ready" },
      })),
    });
  }));

  router.get("/home", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const bySystem = new Map();
    const listed = listedGames(cat);
    const link = forRequest(req);
    const voter = itemVotes.voterOf(req);
    for (const g of listed) bySystem.set(g.system, [...(bySystem.get(g.system) ?? []), g]);
    res.set({ "Cache-Control": "private, max-age=0, must-revalidate", Vary: "Accept-Language" });
    res.json({
      labels: RETRO_LABELS,
      systems: catalog.visibleSystems(cat, listed)
        .map((s) => ({
          ...s,
          ...systemIconUrls(s.id, cat.systems[s.id]),
          games: [...(bySystem.get(s.id) ?? [])].sort(SORTS.rating).slice(0, limit).map((g) => publicGame(g, cat.systems, requestLang(req), { cat, link, voter })),
        })),
    });
  }));

  // The values one system's list can be filtered by, with counts; a value no game has is left out.
  router.get("/systems/:system/facets", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const id = req.params.system;
    const facts = factsById(cat);
    const list = listedGames(cat).filter((g) => g.system === id).map((g) => facts.get(g.id));
    if (!list.length) return res.status(404).json({ error: "no such system" });
    res.set({ "Cache-Control": "private, max-age=0, must-revalidate", Vary: "Accept-Language" });
    res.json({ system: id, total: list.length, ...facetsOf(list, requestLang(req)) });
  }));

  // Every filter that console's list can take, worded in four languages, so the client keeps no list of its own.
  router.get("/systems/:system/filters", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const id = req.params.system;
    const games = listedGames(cat).filter((g) => g.system === id);
    if (!games.length) return res.status(404).json({ error: "no such system" });
    const facts = factsById(cat);
    const body = JSON.stringify(filtersOf(games, (gid) => facts.get(gid)));
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=0, must-revalidate",
      ETag: `"${crypto.createHash("sha1").update(body).digest("base64url")}"`,
    });
    if (req.fresh) return res.status(304).end();
    res.send(body);
  }));

  // Rows across systems for the day ("무슨 게임하지?"): genres and other themes in turns, no game twice.
  router.get("/themes", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const lang = requestLang(req);
    const per = Math.min(MENU_GAMES, Math.max(1, Number.parseInt(req.query.limit, 10) || MENU_GAMES));
    const count = Math.min(MENU_ROWS, Math.max(1, Number.parseInt(req.query.rows, 10) || MENU_ROWS));
    const rows = pickMenu(menuPool(cat), { seed: crypto.randomInt(2 ** 32 - 1), count });
    const byId = new Map(cat.games.map((g) => [g.id, g]));
    const link = forRequest(req);
    const voter = itemVotes.voterOf(req);
    res.set({ "Cache-Control": "no-store", Vary: "Accept-Language" });
    res.json({
      labels: RETRO_LABELS,
      themes: rows.map((r) => ({
        id: r.id,
        name: r.name(lang),
        icon: rowIcon(r.id),
        games: r.games.slice(0, per).map((f) => publicGame(byId.get(f.id), cat.systems, lang, { cat, link, voter })),
      })),
    });
  }));

  router.get("/systems/:system/icon", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const id = req.params.system;
    // A console without games is invisible here too.
    const shown = Object.hasOwn(cat.systems, id) && cat.games.some((g) => g.system === id);
    const file = shown ? systemIcon(retroDir, id, cat.systems[id], req.query.style === "mono" ? "mono" : "color") : null;
    if (!file) return res.status(404).json({ error: "no icon" });
    sendFile(res, file, "png", req.query.v && req.query.v === fileVersion(file));
  }));

  router.get("/games", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const system = typeof req.query.system === "string" ? req.query.system : "";
    const raw = typeof req.query.q === "string" ? req.query.q : typeof req.query.search === "string" ? req.query.search : "";
    const search = folded(raw);
    const sort = SORTS[req.query.sort] ?? SORTS.name;
    const pageSize = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 50));
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const keep = listFilter(req.query);
    const byFacts = factsFilter(req.query);
    const facts = byFacts ? factsById(cat) : null;
    const all = req.query.variants === "all";
    // A search that finds any version of a game shows the game's representative.
    const found = (g) => !search || (all ? gameMatches(g, search) : groupOf(cat, g).members.some((m) => gameMatches(m, search)));
    const matches = (all ? cat.games : listedGames(cat))
      .filter((g) => (!system || g.system === system) && found(g) && keep(g) && (!byFacts || byFacts(facts.get(g.id))))
      .sort(sort);
    const link = forRequest(req);
    const voter = itemVotes.voterOf(req);
    const body = {
      labels: RETRO_LABELS,
      total: matches.length,
      page,
      pageSize,
      games: matches.slice((page - 1) * pageSize, page * pageSize).map((g) => publicGame(g, cat.systems, requestLang(req), { cat, link, voter })),
    };
    res.set("Vary", "Accept-Language");
    // While rom_hash is still being worked out the list is partial: never cached,
    // and no ETag (end() skips Express's own), so a console asks again for the full one.
    if (romHashes.pending()) return res.set("Cache-Control", "no-store").type("json").end(JSON.stringify(body));
    res.set("Cache-Control", "private, max-age=0, must-revalidate").json(body);
  }));

  router.get("/index", wrap(async (req, res) => {
    const lang = requestLang(req);
    const entry = retroIndex.get(await catalog.current(retroDir), lang);
    const since = typeof req.query.since === "string" ? req.query.since : "";
    const pageSize = Math.min(INDEX_PAGE_MAX, Math.max(1, Number.parseInt(req.query.pageSize, 10) || INDEX_PAGE_MAX));
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const out = since ? indexDelta(entry, lang, since) : indexPage(entry, page, pageSize);
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=0, must-revalidate",
      Vary: "Accept-Language, Accept-Encoding",
      ETag: out.etag,
    });
    if (req.fresh) return res.status(304).end();
    // A small change list goes as it is; compressing would only add to it. Brotli when the client takes it.
    const encoding = out.body.length < ENCODE_MIN ? null : pickEncoding(req.headers["accept-encoding"]);
    if (!encoding) return res.send(out.body);
    out.encoded[encoding] ??= ENCODERS[encoding](out.body);
    res.set("Content-Encoding", encoding).send(await out.encoded[encoding]);
  }));

  // Everything below names one game; an unknown or malformed id is a 404.
  router.param("id", (req, res, next, id) => {
    (ID_RE.test(id) ? catalog.current(retroDir) : Promise.resolve(null))
      .then((cat) => {
        const game = cat?.byId.get(id);
        if (!game) return res.status(404).json({ error: "no such game" });
        req.retro = { game, system: cat.systems[game.system], systems: cat.systems, cat };
        next();
      })
      .catch(next);
  });

  router.get("/games/:id", (req, res) => {
    const { game, systems, cat } = req.retro;
    const lang = requestLang(req);
    const group = groupOf(cat, game);
    const rep = representative(group, variantPicks.get(group.id));
    res.vary("Accept-Language").json({
      ...publicGame(game, systems, lang, { cat, link: forRequest(req), voter: itemVotes.voterOf(req) }),
      ...retroDetailFields({ dir: retroDir, systems, candidates: metaCandidates(game, rep, group), base: `/api/retro/games/${game.id}`, lang }),
      representative: rep.id,
      variants: group.members.map((m) => publicVariant(m, rep, lang)),
    });
  });
  router.get("/games/:id/achievements", gameAchievements((req) => {
    const { game, cat } = req.retro;
    const group = groupOf(cat, game);
    return metaCandidates(game, representative(group, variantPicks.get(group.id)), group);
  }));
  router.get("/games/:id/rom", (req, res) => {
    const { game, system } = req.retro;
    res.attachment(path.posix.basename(sdPaths(game, system).rom));
    if (game.sd?.romText !== undefined) return res.type("text/plain").send(game.sd.romText);
    sendFile(res, game.abs);
  });
  router.get("/games/:id/icon", wrap(async (req, res) => {
    const size = Object.hasOwn(SQUARE_SIZES, req.query.size) ? req.query.size : "md";
    const square = await ensureSquareWebp(artDir, req.retro.game, size);
    if (!square) return res.status(404).json({ error: "no icon" });
    // ?v= names one version of the cover, so that URL never changes underneath a cache.
    const versioned = req.query.v && req.query.v === artKey(req.retro.game);
    res.set("Cache-Control", versioned ? IMMUTABLE : "private, no-cache");
    res.type("webp");
    res.sendFile(square, { dotfiles: "allow" });
  }));
  router.get("/games/:id/boxart", wrap(async (req, res) => {
    const { game } = req.retro;
    if (!game.icon) return res.status(404).json({ error: "no box art" });
    const versioned = Boolean(req.query.v) && req.query.v === artKey(game);
    const file = await ensureBoxart(artDir, game, Object.hasOwn(BOXART_SIZES, req.query.size) ? req.query.size : "full");
    sendFile(res, file, "webp", versioned);
  }));
  router.get("/games/:id/screenshot/:n", (req, res) => {
    const { game, systems, cat } = req.retro;
    const n = /^[1-8]$/.test(req.params.n) ? Number(req.params.n) : null;
    const group = groupOf(cat, game);
    const file = n && retroShotFile({ dir: retroDir, systems, candidates: metaCandidates(game, representative(group, variantPicks.get(group.id)), group), n });
    if (!file) return res.status(404).json({ error: "no screenshot" });
    sendFile(res, file, null, Boolean(req.query.v) && req.query.v === fileVersion(file));
  });
  router.get("/games/:id/bezel.png", (req, res) => (req.retro.game.bezel ? sendFile(res, req.retro.game.bezel.png, "png") : res.status(404).json({ error: "no bezel" })));
  router.get("/games/:id/overlay.cfg", (req, res) => {
    const { game } = req.retro;
    if (!game.bezel) return res.status(404).json({ error: "no bezel" });
    res.type("text/plain").send(overlayCfg(game));
  });
  router.get("/games/:id/game.cfg", (req, res) => {
    const { game, system } = req.retro;
    if (!game.bezel || !system.coreName) return res.status(404).json({ error: "no bezel" });
    res.type("text/plain").send(game.bezel.override ? retargetOverride(fs.readFileSync(game.bezel.override, "utf8"), game, system) : gameCfg(game, system));
  });
  router.get("/games/:id/bundle", (req, res) => {
    const { game, system } = req.retro;
    sendTar(res, bundleFiles(game, system), { filename: `${game.id}.tar`, label: "retro" });
  });
  router.get("/games/:id/forwarder.nsp", wrap(async (req, res) => {
    if (!forwardersAvailable(keysDir())) return res.status(404).json({ error: "forwarders are not available on this server" });
    const { game, system } = req.retro;
    await ensureSquare(artDir, game, "md").catch(() => null);
    const built = await ensureForwarder(forwarderDir, forwarderGame(game, system, req.retro.cat), keysDir());
    if (!built) return res.status(404).json({ error: "this game can't have a forwarder" });
    res.attachment(`${built.spec.name}.nsp`);
    res.set("X-Forwarder-Title-Id", built.spec.titleId);
    sendFile(res, built.path, "application/octet-stream");
  }));

  router.get("/base-pack/manifest", wrap(async (req, res) => {
    const m = await currentManifest();
    if (!m) {
      res.set({ "Retry-After": "30", "Cache-Control": "no-store" });
      return res.status(503).json({ error: "the base pack is still being read", retryAfter: 30 });
    }
    const link = forRequest(req);
    const onDemand = wantsOnDemand(req);
    const view = manifestView(m, { onDemand });
    res.set({ "Cache-Control": "private, max-age=0, must-revalidate", Vary: "Accept-Language, X-Retro-Cores" });
    // The direct variant has other URLs, so it has its own ETag (the same for every console).
    res.set("ETag", `"${view.version}${link ? "-direct" : ""}"`);
    if (req.fresh) return res.status(304).end();
    res.json({
      version: view.version,
      ...withDirect("bundleUrl", `/api/retro/base-pack/bundle${onDemand ? "?cores=ondemand" : ""}`, link),
      bundleSize: archiveSize(tarEntries(view.files.filter((f) => !f.onDemand))),
      files: view.files.map((f) => ({ ...f, ...withDirect("url", `/api/retro/base-pack/file/${enc(f.path)}`, link) })),
    });
  }));

  // One core's files (.nro and .info) for a console that takes cores on demand.
  router.get("/base-pack/core/:core", wrap(async (req, res) => {
    const core = String(req.params.core);
    const files = await baseCoreFiles(core);
    if (!files) {
      res.set({ "Retry-After": "30", "Cache-Control": "no-store" });
      return res.status(503).json({ error: "the base pack is still being read", retryAfter: 30 });
    }
    if (!files.length) return res.status(404).json({ error: "no such core in the base pack" });
    const link = forRequest(req);
    res.set({ "Cache-Control": "private, max-age=0, must-revalidate" });
    res.json({ core, files: files.map((f) => ({ ...f, ...withDirect("url", f.url, link) })) });
  }));

  router.get("/base-pack/file/*", wrap(async (req, res) => {
    const sd = req.params[0];
    // Only paths the pack lists: a request never becomes a path on disk by itself.
    const listed = (manifest?.sources ?? new Map((await listPack(packDir())).map((f) => [f.path, f]))).get(sd);
    if (!listed || !fs.existsSync(listed.abs)) return res.status(404).json({ error: "not in the base pack" });
    res.attachment(path.basename(sd));
    sendFile(res, listed.abs);
  }));

  // One request for the whole pack: thousands of per-file GETs run into the rate limit.
  router.get(["/base-pack", "/base-pack/bundle"], wrap(async (req, res) => {
    const listed = await listPack(packDir());
    if (!listed.length) return res.status(404).json({ error: "the base pack is empty" });
    // The manifest's version names these bytes only when it was read from this very
    // listing; otherwise the ETag comes from the listing itself and the manifest catches up.
    const snapshot = manifest;
    const matches = manifestMatches(snapshot, listed);
    if (!matches) rebuildManifest().catch((err) => debug.error("retro: base pack manifest failed: %s", err.message));
    // The same files the manifest sends this console, without the cores it takes on demand.
    const onDemand = wantsOnDemand(req);
    const view = manifestView({ version: snapshot?.version, files: listed.map((f) => ({ path: f.path, sha256: "" })) }, { onDemand });
    const keep = new Set(view.files.filter((f) => !f.onDemand).map((f) => f.path));
    const files = listed.filter((f) => keep.has(f.path));
    const etag = matches ? manifestView(snapshot, { onDemand }).version : undefined;
    // A tar can't say "only if missing", so name those files for the client to skip.
    res.set("X-Retro-Once", files.filter((f) => f.once).map((f) => f.path).join(","));
    sendTar(res, files.map((f) => ({ path: f.path, abs: f.abs, size: f.size, mtime: f.mtimeMs / 1000 })), {
      filename: "retroarch-base-pack.tar",
      etag,
      fixedTimes: matches,
      label: "retro",
    });
  }));

  return router;
}
