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
import { normalizeCategories, normalizeGenres, genreLabel, requestLang } from "../meta/categories.js";
import * as scores from "../meta/ratings.js";
import { versionedArtwork } from "../meta/artwork-version.js";
import { eshopPrice } from "../meta/eshop-price.js";
import * as titledbVersions from "../meta/titledb-versions.js";
import * as userPatches from "../meta/user-patches.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
// The detail must not wait on Nintendo; a slow price is simply left out.
const PRICE_WAIT_MS = 3000;
const MAX_RATING_REASONS = 8;

function priceWithin(nsuId, ms) {
  return Promise.race([
    eshopPrice(nsuId).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms).unref?.()),
  ]);
}

export default async function titleDetailRoute(req, res) {
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
  const price = fromDb?.nsuId ? await priceWithin(fromDb.nsuId, PRICE_WAIT_MS) : null;
  res.header("Cache-Control", "private, max-age=60");
  res.header("Vary", "Accept-Language");
  const categories = normalizeGenres(fromDb?.category);
  const lang = requestLang(req);
  const categoryLabels = categories?.map((key) => genreLabel(key, lang));
  const score = scores.ratingOf(base, { siblings: titledbStore.artSiblings(base) });
  res.json({
    id: base,
    name: fromDb?.name ?? extracted?.name ?? null,
    publisher: fromDb?.publisher ?? extracted?.publisher ?? null,
    description: fromDb?.description ?? extracted?.description ?? null,
    intro: fromDb?.intro ?? null,
    // categories are English keys (as in sections); category and categoryLabels
    // are their labels in the language the request asked for.
    category: categoryLabels ? categoryLabels.join(", ") : null,
    categories: categories ?? null,
    categoryLabels: categoryLabels ?? null,
    releaseDate: fromDb?.releaseDate ?? extracted?.releaseDate ?? null,
    region: fromDb?.region ?? null,
    rating: fromDb?.rating ?? null,
    // Why the age rating is what it is, e.g. ["약물"]; a client can show them beside it.
    ratingContent: normalizeCategories(fromDb?.ratingContent, MAX_RATING_REASONS) ?? null,
    numberOfPlayers: fromDb?.numberOfPlayers ?? null,
    size: fromDb?.size ?? extracted?.size ?? null,
    iconUrl: art(`/api/shop/icon/${base}`),
    bannerUrl: fromDb?.bannerUrl || overrides.banner ? art(`/api/shop/banner/${base}`) : null,
    screenshots,
    screenshotCount: screenshots.length,
    videos: titleVideos(fromDb),
    price,
    // Published updates, oldest first: [{ version, date }], and the DLC count.
    latestVersion: titledbVersions.latestVersion(base),
    updates: titledbVersions.updateHistory(base),
    dlcTotal: titledbVersions.dlcCount(base, titledbStore.dlcIdsOf(base)),
    requiredFirmware: titledbVersions.requiredFirmware(base, 0),
    // Review score (0-100) with its vote count and source; scoreLabel is Steam's
    // summary in the request language, scoreLabelKey its SCORE_LABELS key.
    score: score?.score ?? null,
    scoreCount: score?.count ?? null,
    scoreSource: score?.source ?? null,
    scoreLabel: score?.label ? (scores.SCORE_LABELS[score.label]?.[lang] ?? score.label) : null,
    scoreLabelKey: score?.label ?? null,
    // User patches for this game, as in /api/patches.
    patches: userPatches.forTitle(base),
  });
}
