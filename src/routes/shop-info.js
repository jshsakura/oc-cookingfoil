/**
 * GET /api/shop/info
 *
 * What this server can do, so a client can tell an older server from a newer
 * one by asking instead of guessing from missing fields. Each feature names a
 * field or endpoint the client may rely on once the name is listed; a server
 * that answers 404 here predates the list and offers none of the optional ones.
 */
import pkg from "../package.js";
import * as shopCache from "../meta/shop-cache.js";
import * as contentMeta from "../meta/content-meta.js";
import { devicePairing } from "../helpers/envs.js";

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
  "user-patches",         // /api/patches, /api/patches/:id/download (ustar), detail.patches, item.patches          // icon, banner, screenshot accept ?size=sm (256) and ?size=md (512)
];

export default function shopInfoRoute(_req, res) {
  const stats = shopCache.stats();
  res.header("Cache-Control", "private, max-age=60");
  res.json({
    name: "CookingFoil",
    version: pkg.version,
    apiVersion: API_VERSION,
    features: devicePairing ? [...FEATURES, "device-pairing"] : FEATURES,
    files: stats.files,
    contentMeta: contentMeta.progress(),
  });
}
