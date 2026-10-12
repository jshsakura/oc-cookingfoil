/**
 * GET /api/shop/info
 *
 * What this server can do, so a client can tell an older server from a newer
 * one by asking instead of guessing from missing fields. Each feature names a
 * field or endpoint the client may rely on once the name is listed; a server
 * that answers 404 here predates the list and offers none of the optional ones.
 */
import fs from "fs";
import pkg from "../package.js";
import { CLIENT_NRO } from "./client-update.js";
import * as shopCache from "../meta/shop-cache.js";
import * as contentMeta from "../meta/content-meta.js";
import { devicePairing, dropboxAppKey, retroDir } from "../helpers/envs.js";
import * as retroCatalog from "../retro/catalog.js";
import * as users from "../security/users.js";
import { retroEnabled } from "./retro.js";
import { savesEnabled } from "./saves.js";

export const API_VERSION = 1;

const FEATURES = [
  "sections-etag",        // /api/shop/sections answers If-None-Match with 304
  "title-detail",         // /api/title/:id with description, screenshots, categories
  "title-price",          // detail.price { regular, discount, country } when the eShop knows it
  "title-videos",         // detail.videos
  "title-rating-content", // detail.ratingContent, the reasons behind detail.rating
  "item-rank",            // sections item.rank and item.players
  "item-categories",      // sections item.categories and item.languages
  "item-version-name",    // update item.version_name ("1.4.1")
  "item-install-size",    // item.install_size, the unpacked size (NSP/NSZ only)
  "item-required-firmware", // item.required_firmware ("16.0.0") and DLC item.required_app_version
  "item-latest-version",  // base item.latest_version and item.dlc_total, from the eShop
  "title-updates",        // detail.latestVersion, detail.updates [{ version, date }], detail.dlcTotal
  "item-price",           // base item.price_regular, price_discount, price_discount_ends, price_country
  "item-score",           // base item.score, score_count, score_source, score_label (+ score_labels map)
  "genre-keys",           // categories are English keys; sections.genres maps them per language
  "featured",             // sections.featured [{ id, title, banner_url?, title_ids }]
  "image-sizes",
  "user-patches",
  "item-icons",           // base item.icons { ko?, en?, ja?, zh? } and ?lang= on icon/banner; detail iconUrl/bannerUrl follow ?lang=
  "item-names",           // base item.names { ko?, en?, ja?, zh? }; detail.names, and ?lang= picks detail.description         // /api/patches, /api/patches/:id/download (ustar), detail.patches, item.patches          // icon accepts ?size=sm|md|lg (160|256|512 square); banner, screenshot ?size=sm (256) and md|lg (512)
];

/** Retro is offered only while there is at least one ROM to play (the client hides its menu otherwise). */
async function hasRetroGames() {
  if (!retroEnabled()) return false;
  try {
    return (await retroCatalog.current(retroDir)).games.length > 0;
  } catch {
    return false;
  }
}

export default async function shopInfoRoute(_req, res) {
  const retro = await hasRetroGames();
  const stats = shopCache.stats();
  res.header("Cache-Control", "private, max-age=60");
  res.json({
    name: "CookingFoil",
    version: pkg.version,
    apiVersion: API_VERSION,
    // dropbox-sync: /api/dropbox speaks oc-save-keeper's bridge protocol (sign-in only; saves go straight to Dropbox).
    // device-logins: signed-in users issue per-console IDs and passwords at /pair.
    features: [
      ...FEATURES,
      ...(devicePairing ? ["device-pairing"] : []),
      ...(users.hasUsers() ? ["device-logins"] : []),
      ...(dropboxAppKey ? ["dropbox-sync"] : []),
      // retro: /api/retro serves retro games, bezels and the RetroArch base pack; only while it holds a ROM.
      ...(retro ? ["retro"] : []),
      // shop-saves: /api/saves hands out save files to restore on the console.
      ...(savesEnabled() ? ["shop-saves"] : []),
      // client-update: /api/client/latest names the CookingFoil client build to update to.
      ...(fs.existsSync(CLIENT_NRO) ? ["client-update"] : []),
    ],
    files: stats.files,
    contentMeta: contentMeta.progress(),
  });
}
