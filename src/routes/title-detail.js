/**
 * GET /api/title/:baseTitleId
 *
 * On-demand rich detail for one base title — description, publisher, region,
 * release date, rating, players, plus proxied icon/banner/screenshot URLs.
 *
 * Why a dedicated endpoint: the shop response deliberately DROPS the top-level
 * `titledb` map (COOK_EMIT_TITLEDB off) to avoid CyberFoil ghost rows, so this
 * rich metadata never rides along with /shop.json or the sections list. The
 * data still lives in the warmed titledb store, so we surface it here — fetched
 * only when a title is opened, keeping the list itself lean. Falls back to
 * NACP-extracted metadata for titles blawar's titledb doesn't carry.
 *
 * Artwork URLs point at our proxy endpoints (/api/shop/icon|banner|screenshot)
 * and are made origin-absolute like the shop/sections payloads so on-device
 * clients can curl them verbatim; a same-origin browser keeps the relative form.
 */
import * as titledbStore from "../meta/titledb-store.js";
import * as extractedMeta from "../meta/extracted-meta-store.js";
import * as customArt from "../meta/custom-art.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import { titleVideos } from "../meta/title-videos.js";
import { versionedArtwork } from "../meta/artwork-version.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;

export default function titleDetailRoute(req, res) {
  const base = String(req.params.baseTitleId || "").toUpperCase();
  if (!TITLE_ID_RE.test(base)) {
    res.status(400).json({ error: "invalid titleId" });
    return;
  }

  const fromDb = titledbStore.get(base);
  const extracted = fromDb ? null : extractedMeta.get(base);
  const overrides = customArt.list(base);
  if (!fromDb && !extracted && !overrides.icon && !overrides.banner && !overrides.screens.length) {
    res.status(404).json({ error: "no metadata for title" });
    return;
  }

  const origin = resolveOrigin(req, publicBaseUrl);
  const art = (path) => {
    const url = versionedArtwork(path);
    return origin ? origin + url : url;
  };

  const slots = new Set(overrides.screens.filter((i) => Number.isInteger(i) && i >= 0 && i <= 30));
  if (Array.isArray(fromDb?.screenshots)) {
    fromDb.screenshots.slice(0, 31).forEach((url, i) => { if (url) slots.add(i); });
  }
  const screenshots = [...slots].sort((a, b) => a - b).map((i) => art(`/api/shop/screenshot/${base}/${i}`));

  // titledb changes at most on the ~24h refresh; let the dashboard/client hold
  // a detail for a minute instead of re-fetching on every open.
  res.header("Cache-Control", "private, max-age=60");
  res.json({
    id: base,
    name: fromDb?.name ?? extracted?.name ?? null,
    publisher: fromDb?.publisher ?? extracted?.publisher ?? null,
    description: fromDb?.description ?? extracted?.description ?? null,
    intro: fromDb?.intro ?? null,
    category: fromDb?.category ?? null,
    releaseDate: fromDb?.releaseDate ?? extracted?.releaseDate ?? null,
    region: fromDb?.region ?? null,
    rating: fromDb?.rating ?? null,
    numberOfPlayers: fromDb?.numberOfPlayers ?? null,
    size: fromDb?.size ?? extracted?.size ?? null,
    iconUrl: art(`/api/shop/icon/${base}`),
    bannerUrl: fromDb?.bannerUrl || overrides.banner ? art(`/api/shop/banner/${base}`) : null,
    screenshots,
    screenshotCount: screenshots.length,
    videos: titleVideos(fromDb),
  });
}
