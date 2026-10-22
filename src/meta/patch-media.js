/**
 * Pictures for each user patch, laid out as a game's (meta/item-media.js): its own
 * icon (else its game's), a banner behind its header and screenshots, uploaded
 * from the web page by an admin or put in the patch folder by hand.
 *
 *   <patch folder>/metadata/icon.webp …      the files (meta/art-sidecar.js)
 *   ${COOK_DATA_DIR}/patches/media/<id>/…    kept originals for cutting again
 *   ${COOK_DATA_DIR}/patches/media.json      { <id>: { icon?, banner?, shots? } }
 */
import path from "path";
import { dataDir } from "../helpers/envs.js";
import { createMediaStore } from "./item-media.js";
import { folderOf } from "./user-patches.js";

// A game's patch "<TITLEID>-<12 hex>", a homebrew app's patch "hb-<12 hex>-<12 hex>" (routes/patches.js).
export const PATCH_ID_RE = /^([0-9A-F]{16}|hb-[0-9a-f]{12})-[0-9a-f]{12}$/;

export default createMediaStore({
  dir: path.join(dataDir, "patches", "media"),
  file: path.join(dataDir, "patches", "media.json"),
  idRe: PATCH_ID_RE,
  urlBase: (id) => `/api/patches/${id}`,
  label: "patch media",
  homeOf: folderOf,
});
