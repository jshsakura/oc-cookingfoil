/**
 * One base title's rich detail: description, publisher, region, release date, rating, players, updates,
 * DLC count, patches and artwork URLs on the /api/library proxies. GET /api/title/:baseTitleId serves it,
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
import * as titledbVersions from "./titledb-versions.js";
import * as userPatches from "./user-patches.js";
import * as gameDescriptions from "./game-descriptions.js";
import * as itemVerified from "./item-verified.js";
import { mergeField, valueOf, ADMIN, TITLEDB, LOCAL } from "./field-merge.js";
import { agentOrder, agentValues, creditOf } from "../plugins/agent-values.js";
import * as libraryCache from "./library-cache.js";
import { titleKeyNeed } from "./key-needs.js";
import { findingOf, signedOf } from "./file-integrity.js";
import { signedHelp } from "./signed-help.js";
import { explain as explainIntegrity } from "./integrity-help.js";
import path from "path";

/**
 * What the file check found in this title's files (base, updates, DLC), only
 * those with something to say: [{ file, kind, titleId, verdict, reason,
 * certain, present?, label, help: { title, body } }] with the file's name,
 * "base" | "update" | "dlc", "modified" | "damaged", and the label and help
 * in `lang` (integrity-help.js). Informational; every file is offered all the same.
 */
export function integrityFor(base, lang = "en", files = libraryCache.files()) {
  const out = [];
  for (const f of files) {
    if (f.baseTitleId !== base) continue;
    const finding = findingOf(f.rel);
    if (finding) out.push({ file: path.basename(f.rel), kind: f.kind ?? null, titleId: f.titleId ?? null, verdict: finding.verdict, ...explainIntegrity(finding, lang) });
  }
  return out;
}

/**
 * Whether this title's files are signed, for every file the check knows about: [{ file, kind, titleId,
 * nca, ticket, help? }], nca and ticket true, false or null, help { title, body } in `lang` when one is
 * false. A stock console refuses a file with a false.
 */
export function signedFor(base, lang = "en", files = libraryCache.files()) {
  const out = [];
  for (const f of files) {
    if (f.baseTitleId !== base) continue;
    const s = signedOf(f.rel);
    if (!s) continue;
    const help = signedHelp(s, lang);
    out.push({ file: path.basename(f.rel), kind: f.kind ?? null, titleId: f.titleId ?? null, nca: s.nca ?? null, ticket: s.ticket ?? null, ...(help ? { help } : {}) });
  }
  return out;
}

// The admin writes names in Korean and English; a Korean or English reader gets the other one rather than none.
const ownName = (own, lang) => (own ? pick(own, lang) ?? (lang === "ko" || lang === "en" ? own.ko ?? null : null) : null);

const MAX_RATING_REASONS = 8;

/**
 * One base title's detail, or null when nothing at all is known of it. `lang` is the reader's language;
 * `asked` is it when the reader named one (?lang= or Accept-Language), else null for the server's order.
 * Artwork URLs are made absolute on `origin` when given.
 */
export async function titleDetail(base, { lang, asked = null, origin = null }) {
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

  // Game files carry no screenshots: only the admin's.
  const slots = new Set(overrides.screens.filter((i) => Number.isInteger(i) && i >= 0 && i <= 30));
  const screenshots = [...slots].sort((a, b) => a - b).map((i) => art(`/api/library/screenshot/${base}/${i}`));

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
  // titledb's text per language when it has them (a reader who asked gets none in another language); otherwise the one text it
  // or the game file has. A metadata plugin's takes part in the field's order either way.
  const perLanguage = Boolean(asked && descriptions && Object.keys(descriptions).length);
  const description = mergeField("description", {
    [TITLEDB]: perLanguage ? (descriptionLang && descriptions[descriptionLang]) || null : fromDb?.description,
    [LOCAL]: perLanguage ? null : extracted?.description,
    ...agentValues("description", base, { lang }),
  }, { order: agentOrder("description", [TITLEDB, LOCAL], base) });
  const categoryLabels = categories?.map((key) => genreLabel(key, lang));
  const score = scores.ratingOf(base, { siblings: titledbStore.artSiblings(base) });
  return {
    id: base,
    // A reader who asked: `names` has the admin's name laid over titledb's language by language, so the
    // admin's in that language, titledb's in it, then English. Without one the admin's name wins outright.
    name: valueOf("name", {
      [ADMIN]: () => (asked ? null : ownName(gameDescriptions.names(base), lang)),
      names: () => (nameLang ? names[nameLang] : null),
      [TITLEDB]: fromDb?.name,
      [LOCAL]: extracted?.name,
      ...agentValues("name", base, { lang }),
    }, { order: agentOrder("name", [ADMIN, "names", TITLEDB, LOCAL], base) }),
    publisher: valueOf("publisher", { [TITLEDB]: fromDb?.publisher, [LOCAL]: extracted?.publisher, ...agentValues("publisher", base, { lang }) }, { order: agentOrder("publisher", [TITLEDB, LOCAL], base) }),
    // What the admin wrote wins over every source; descriptionCustom says they did.
    // titledb's text per language when it has them; one kept without languages (a game file's) is shown as it is.
    description: ownDescription ?? description.value,
    descriptionCustom: Boolean(ownDescription),
    // Who wrote a description a metadata plugin supplied, so the detail view can say so under it.
    ...(ownDescription ? {} : { descriptionCredit: creditOf(description.source, base) ?? undefined }),
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
    releaseDate: valueOf("releaseDate", { [TITLEDB]: fromDb?.releaseDate, [LOCAL]: extracted?.releaseDate, ...agentValues("releaseDate", base, { lang }) }, { order: agentOrder("releaseDate", [TITLEDB, LOCAL], base) }),
    region: fromDb?.region ?? null,
    rating: fromDb?.rating ?? null,
    // Why the age rating is what it is, e.g. ["약물"]; a client can show them beside it.
    ratingContent: normalizeCategories(fromDb?.ratingContent, MAX_RATING_REASONS) ?? null,
    numberOfPlayers: fromDb?.numberOfPlayers ?? null,
    size: valueOf("size", { [TITLEDB]: fromDb?.size, [LOCAL]: extracted?.size, ...agentValues("size", base, { lang }) }, { order: agentOrder("size", [TITLEDB, LOCAL], base) }),
    // With ?lang=, the icon and banner of that language's release when it has its own art.
    // A banner is drawn from the icon, so a game with an icon has one.
    iconUrl: art(`/api/library/icon/${base}`, artIn(iconSource, iconKnown)),
    bannerUrl: bannerKnown(base, null) || bannerKnown(base, lang)
      ? art(`/api/library/banner/${base}`, artIn(bannerSource, bannerKnown))
      : null,
    icons: iconLangs(base).length
      ? Object.fromEntries(iconLangs(base).map((l) => [l, art(`/api/library/icon/${base}`, l)]))
      : null,
    screenshots,
    screenshotCount: screenshots.length,
    videos: titleVideos(fromDb),
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
    integrity: integrityFor(base, lang),
    // Files of this title whose signatures the check knows (see signedFor).
    signed: signedFor(base, lang),
    // Tried on a console by the admin (a 검수됨 badge): verified, verified_at (ISO) or null.
    ...itemVerified.fields("game", base),
  };
}
