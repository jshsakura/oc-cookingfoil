/**
 * GET /api/shop/sections   (alias: /api/remote/sections)
 *
 * Native sections response for CyberFoil v1.4.5+. The client's remote menu
 * probes `/api/remote/sections` then `/api/shop/sections` FIRST and only falls
 * back to the flat legacy index (served at `/`, `/shop.tfl`) when both 404.
 * On that legacy fallback CyberFoil can only recover metadata by scraping the
 * `[TITLEID][vVER]`-stamped `name` string — so titles render with degraded
 * info. Serving this endpoint puts the client on its first-class path, where
 * it reads clean `name` + first-class `title_id`/`app_version`/`app_type`/
 * `icon_url` fields and shows full info (and grid icons) as designed.
 *
 * Schema (remoteInstall.cpp::ParseRemoteSectionsBody):
 *   { sections: [ { id, title, items: [ { url, name, size, title_id,
 *     app_id, app_version, app_type, release_date, icon_url } ] } ] }
 *
 * URLs: composeSections() emits RELATIVE urls; we run the SAME origin rewrite
 * the legacy `/shop.tfl` path uses (helpers/origin.js) so on-device curl —
 * which resolves neither a host-relative `/api/shop/icon/...` nor a `../foo`
 * download — receives absolute URLs. Falsy origin keeps the relative form
 * (correct for same-origin browser fetches).
 */
import * as shopCache from "../meta/shop-cache.js";
import { composeSections } from "../create-index-content.js";
import {
  resolveOrigin,
  rewriteArtworkOrigin,
  rewriteDownloadOrigin,
} from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import debug from "../debug.js";

export default async function sectionsRoute(req, res) {
  try {
    await shopCache.get(); // ensure the library scan has populated filesMap
  } catch (err) {
    debug.error("sections: cache warm failed: %s", err.stack || err.message);
    res.status(503).json({ error: "library not ready: " + err.message });
    return;
  }

  try {
    const { filesMap, customs } = shopCache.getState();
    let json = JSON.stringify(composeSections(filesMap, customs));

    const origin = resolveOrigin(req, publicBaseUrl);
    if (origin) {
      json = rewriteDownloadOrigin(rewriteArtworkOrigin(json, origin), origin);
    }

    res.header("Content-Type", "application/json");
    // Same freshness policy as the shop index: never cache stale catalogs on
    // the client; the library changes underneath us as files are added.
    res.header("Cache-Control", "private, max-age=0, must-revalidate");
    res.status(200).send(json);
  } catch (err) {
    debug.error("sections: build failed: %s", err.stack || err.message);
    res.status(500).json({ error: "sections build failed: " + err.message });
  }
}
