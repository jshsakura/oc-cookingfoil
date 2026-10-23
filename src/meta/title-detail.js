/**
 * One base title's rich detail: description, publisher, region, release date, rating, players, updates,
 * DLC count, patches and artwork URLs on the /api/shop proxies. GET /api/title/:baseTitleId serves it,
 * and the game_get capability reads it.
 */
import * as titledbStore from "./titledb-store.js";
import { iconSource, bannerSource, iconKnown, bannerKnown, iconLangs } from "./localized-art.js";
import * as extractedMeta from "./extracted-meta-store.js";
import * as customArt from "./custom-art.js";
import { langPriority } from "../helpers/envs.js";
import * as contentMeta from "./content-meta.js";
import { fileNamesOver } from "./name-pick.js";
import { titleVideos } from "./title-videos.js";
import { normalizeCategories, normalizeGenres, genreLabel } from "./categories.js";
import { fallbacks, parseLang, pick } from "./langs.js";
import * as scores from "./ratings.js";
import { versionedArtwork } from "./artwork-version.js";
import { eshopPrice } from "./eshop-price.js";
import * as titledbVersions from "./titledb-versions.js";
import * as userPatches from "./user-patches.js";
import * as gameDescriptions from "./game-descriptions.js";
import * as itemVerified from "./item-verified.js";
import * as shopCache from "./shop-cache.js";
import { titleKeyNeed } from "./key-needs.js";
import { integrityOf } from "./file-integrity.js";
import path from "path";

/**
 * What the file check found in this title's files (base, updates, DLC), only
 * those with something to say: [{ file, kind, titleId, verdict }] with the
 * file's name, "base" | "update" | "dlc", and "modified" | "damaged".
 * Informational; every file is offered all the same.
 */
export function integrityFor(base, files = shopCache.files()) {
  const out = [];
  for (const f of files) {
    if (f.baseTitleId !== base) continue;
    const verdict = integrityOf(f.rel);
    if (verdict) out.push({ file: path.basename(f.rel), kind: f.kind ?? null, titleId: f.titleId ?? null, verdict });
  }
  return out;
}

// The admin writes names in Korean and English; a Korean or English reader gets the other one rather than none.
const ownName = (own, lang) => (own ? pick(own, lang) ?? (lang === "ko" || lang === "en" ? own.ko ?? null : null) : null);

// The detail must not wait on the price endpoint; a slow price is simply left out.
const PRICE_WAIT_MS = 3000;
const MAX_RATING_REASONS = 8;

function priceWithin(nsuId, ms) {
  return Promise.race([
    eshopPrice(nsuId).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms).unref?.()),
  ]);
}

/**
 * One base title's detail, or null when nothing at all is known of it. `lang` is the reader's language;
 * `asked` is it when the reader named one (?lang= or Accept-Language), else null for the server's order.
 * Artwork URLs are made absolute on `origin` when given; `price: false` skips the eShop price lookup (up to PRICE_WAIT_MS).
 */
export async function titleDetail(base, { lang, asked = null, origin = null, price: withPrice = true }) {
  const fromDb = titledbStore.get(base);
  const extracted = fromDb ? null : extractedMeta.get(base);
  const overrides = customArt.list(base);
  const customDesc = gameDescriptions.describe(base, lang);
  const notes = gameDescriptions.notes(base, lang);
  if (!fromDb && !extracted && !overrides.icon && !overrides.banner && !overrides.screens.length && !customDesc && !notes && !gameDescriptions.names(base)) return null;

  const art = (path, l = null) => {
    const url = versionedArtwork(path, l);
    return origin ? origin + url : url;
  };

  const slots = new Set(overrides.screens.filter((i) => Number.isInteger(i) && i >= 0 && i <= 30));
  if (Array.isArray(fromDb?.screenshots)) {
    fromDb.screenshots.slice(0, 31).forEach((url, i) => { if (url) slots.add(i); });
  }
  const screenshots = [...slots].sort((a, b) => a - b).map((i) => art(`/api/shop/screenshot/${base}/${i}`));

  const price = withPrice && fromDb?.nsuId ? await priceWithin(fromDb.nsuId, PRICE_WAIT_MS) : null;
  const categories = normalizeGenres(fromDb?.category);
  // A reader who names a language gets text only in it or its fallbacks (meta/langs.js), an unknown
  // one being English: never the server's first language. The file's own title stands in when titledb
  // has none of them. Without one the detail keeps the server's order.
  const descriptions = titledbStore.descriptionsOf(base);
  const descriptionLang = asked ? fallbacks(asked).find((l) => descriptions?.[l]) ?? null : null;
  const priority = asked ? fallbacks(asked) : langPriority;
  const fromDbNames = titledbStore.namesOf(base);
  const fileTitles = [(extracted ?? extractedMeta.get(base))?.name, contentMeta.get(base, 0)?.englishName];
  const names = { ...fileNamesOver(fromDbNames, fileTitles, priority), ...(fromDbNames ?? {}) };
  const nameLang = priority.map((l) => parseLang(l) ?? l).find((l) => names[l]);
  const own = gameDescriptions.get(base);
  // The admin's text in the asked language (their plain text counts as Korean with Hangul, else English), else titledb's in it, else
  // the admin's English, else titledb's English: the order a name takes too, as namesOf lays the admin's over titledb's.
  const ownDescription = asked ? own?.description?.[asked] ?? (descriptions?.[asked] ? null : own?.description?.en) ?? null : customDesc;
  // The asked language's box art, else its fallbacks'. A language whose art is the default one stops there.
  const artIn = (source, known) => {
    const l = asked ? fallbacks(asked).find((x) => source(base, x) || known(base, x)) : null;
    return l && source(base, l) ? l : null;
  };
  const categoryLabels = categories?.map((key) => genreLabel(key, lang));
  const score = scores.ratingOf(base, { siblings: titledbStore.artSiblings(base) });
  return {
    id: base,
    // A reader who asked: `names` has the admin's name laid over titledb's language by language, so the
    // admin's in that language, titledb's in it, then English. Without one the admin's name wins outright.
    name: (asked ? null : ownName(gameDescriptions.names(base), lang)) ?? (nameLang ? names[nameLang] : null) ?? fromDb?.name ?? extracted?.name ?? null,
    publisher: fromDb?.publisher ?? extracted?.publisher ?? null,
    // What the admin wrote wins over every source; descriptionCustom says they did.
    // titledb's text per language when it has them; one kept without languages (a game file's) is shown as it is.
    description: ownDescription ?? (asked && descriptions && Object.keys(descriptions).length
      ? (descriptionLang && descriptions[descriptionLang]) || null
      : fromDb?.description ?? extracted?.description ?? null),
    descriptionCustom: Boolean(ownDescription),
    // Extra information only the admin writes (what to install with it, space,
    // version); kept apart from the description, which titledb may refresh.
    notes,
    // The name and description in each language titledb has them in.
    names: Object.keys(names).length ? names : null,
    descriptionLang,
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
    // With ?lang=, the icon and banner of that language's release when it has its own art.
    iconUrl: art(`/api/shop/icon/${base}`, artIn(iconSource, iconKnown)),
    bannerUrl: fromDb?.bannerUrl || overrides.banner
      ? art(`/api/shop/banner/${base}`, artIn(bannerSource, bannerKnown))
      : null,
    icons: iconLangs(base).length
      ? Object.fromEntries(iconLangs(base).map((l) => [l, art(`/api/shop/icon/${base}`, l)]))
      : null,
    screenshots,
    screenshotCount: screenshots.length,
    videos: titleVideos(fromDb),
    price,
    // Published updates, oldest first: [{ version, date }], and the DLC count.
    latestVersion: titledbVersions.latestVersion(base),
    updates: titledbVersions.updateHistory(base),
    dlcTotal: titledbVersions.dlcCount(base, titledbStore.dlcIdsOf(base)),
    requiredFirmware: titledbVersions.requiredFirmware(base, 0),
    // The master key generation the game and its updates in the library need, and its firmware; null until read.
    ...titleKeyNeed(base),
    // Review score (0-100) with its vote count and source; scoreLabel is Steam's
    // summary in the request language, scoreLabelKey its SCORE_LABELS key.
    score: score?.score ?? null,
    scoreCount: score?.count ?? null,
    scoreSource: score?.source ?? null,
    scoreLabel: score?.label ? (pick(scores.SCORE_LABELS[score.label], lang) ?? score.label) : null,
    scoreLabelKey: score?.label ?? null,
    // User patches for this game, as in /api/patches.
    patches: userPatches.forTitle(base),
    // Files of this title the file check found modified or damaged (see integrityFor).
    integrity: integrityFor(base),
    // Tried on a console by the admin (a 검수됨 badge): verified, verified_at (ISO) or null.
    ...itemVerified.fields("game", base),
  };
}
