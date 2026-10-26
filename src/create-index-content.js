/**
 * Build the library response payload (consumed by /games.json and the sections
 * view via the chokidar-warmed cache in src/meta/library-cache.js).
 *
 * Pipeline:
 *   fast-glob scan
 *     → filename parse  (name, titleId, version, contentType)
 *     → per-item enrich with name + size + icon_url + titleId + kind
 *     → titledb store overlay (per-field language fallback already applied)
 *     → custom_entries.jsonc verbatim merge (with synthetic-titleId support)
 *     → rewrite every titledb image URL to the local proxy (/api/library/...)
 *     → include the configured custom library entries
 *
 * Two surfaces:
 *   - generateIndex() — convenience wrapper that does a full scan + compose.
 *     Useful for one-shot callers (tests, ad-hoc invocation).
 *   - scanLibrary() / readOneFile() / composeResponse() — primitives used
 *     by the cache layer to maintain an incremental in-memory state. A
 *     chokidar event for a single file produces a single readOneFile()
 *     and a re-compose, instead of re-walking thousands of unchanged
 *     entries.
 *
 * Invariants (FINDINGS §6, §7):
 *   - Every scanned file ends up in `files[]`. Parse failures only thin out
 *     metadata; they never drop the item.
 *   - The library response is self-contained: one request, all the metadata.
 *   - Image URLs in the response point to OUR proxy endpoints — never raw
 *     eShop CDN URLs, so the client app gets locally-cached
 *     bytes (offline-friendly) and we control retention.
 */
import { GAME_FILE_RE } from "./helpers/file-send.js";
import fs from "fs/promises";
import path from "path";
import FastGlob from "fast-glob";

import debug from "./debug.js";
import { parseFromFilename } from "./meta/filename-parser.js";
import { incomingInGames } from "./helpers/envs.js";
import { loadCustomEntries } from "./meta/custom-entries.js";
import * as titledbStore from "./meta/titledb-store.js";
import { normalizeSupportedLanguages } from "./meta/supported-languages.js";
import { sectionExtras } from "./meta/section-extras.js";
import { normalizeGenres, GENRE_LABELS } from "./meta/categories.js";
import { SCORE_LABELS } from "./meta/ratings.js";
import { SWITCH_LABELS, attachSwitchLabels } from "./meta/card-labels.js";
import { dlcDisplayName } from "./meta/dlc-name.js";
import * as contentMeta from "./meta/content-meta.js";
import * as titledbVersions from "./meta/titledb-versions.js";
import { firmwareOf } from "./meta/generations.js";
import * as featured from "./meta/featured.js";
import * as userPatches from "./meta/user-patches.js";
import * as scores from "./meta/ratings.js";
import * as ratingSync from "./meta/rating-sync.js";
import { iconLangs } from "./meta/localized-art.js";
import * as extractedMeta from "./meta/extracted-meta-store.js";
import * as gameDescriptions from "./meta/game-descriptions.js";
import { fileNamesOver, pickFileName } from "./meta/name-pick.js";
import { valueOf, LOCAL_PREFERRED, TITLEDB, LOCAL, FILENAME } from "./meta/field-merge.js";
import { agentOrder, agentValues } from "./plugins/agent-values.js";
import { agentParts } from "./plugins/instance.js";
import { artFiller } from "./meta/art-filler.js";
import { parseLang } from "./meta/langs.js";
import * as nacpExtractor from "./meta/nacp-extractor.js";
import { findingOf, signedOf } from "./meta/file-integrity.js";
import { summary as integritySummary } from "./meta/integrity-help.js";
import {
  shouldAutoExtract,
  wantsExtractByMode,
  iconFileOrder,
  BYTES_PER_GB,
} from "./meta/extract-policy.js";
import {
  romsDirPath,
  customEntriesPath,
  extractIcons,
  extractMaxGb,
  extractMaxBytes,
  langPriority,
} from "./helpers/envs.js";
import { withEncodedUrl as encodeUrlObject } from "./helpers/file-url.js";
import { versionedArtwork as withVersion } from "./meta/artwork-version.js";
import { cachePathFor, hasCached } from "./meta/image-cache.js";

// Every proxy artwork URL carries ?v=, a hash of the picture's bytes
// (meta/artwork-version.js): the console client caches pictures by URL, so a
// changed picture gets a new URL and an unchanged one is never fetched again.

const SCAN_PATTERNS = ["**/*.nsp", "**/*.nsz", "**/*.xci", "**/*.xcz", "**/*.nro"];
export { GAME_FILE_RE };

export function isGameFile(relOrAbsPath) {
  return GAME_FILE_RE.test(relOrAbsPath);
}

export function encodeRelPath(relPath) {
  // The inner path is percent-encoded (incl. `/`), then a literal "../" prefix
  // is prepended; helpers/origin.js anchors it at the request's origin.
  const encoded = encodeUrlObject({ url: relPath }).url;
  return "../" + encoded;
}

function normalizeTitleId(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.length === 16 ? hex : null;
}

// A search on the console matches the `name` field of each entry, and the
// console's on-screen keyboard types English most easily. So when titledb
// picks a Korean (or other CJK) display name, the title is hard to find from
// the device unless we glue the English rendering onto the name ourselves:
//
//   "젤다의 전설 (The Legend of Zelda)"
//
// We do this for exactly the "CJK pick + English alias exists" case:
//   - skip when the picked name is already ASCII ("Mario" stays "Mario")
//   - skip when no English alias was collected for the title
// The first ASCII alias different from the picked name is the one we
// surface: there's typically only one canonical English title, and
// extra clutter would just push the row off-screen on the console.
const CJK_RE = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿가-힯]/;
const ASCII_RE = /^[\x00-\x7f]+$/;

// When titledb has no English alias (Korean-only release ids, games newer
// than the US file), the English title read from the game's own NACP is used.
// A name that already spells the English title out is left alone.
export function decorateNameWithAlias(name, fromDb, nacpEnglish = null) {
  if (!CJK_RE.test(name)) return name;
  const aliases = Array.isArray(fromDb?.aliases) ? fromDb.aliases : [];
  const alias = aliases.find(
    (a) => typeof a === "string" && ASCII_RE.test(a.trim()) && a.trim() !== name
  );
  const eng = alias?.trim() || nacpEnglish?.trim();
  if (!eng || name.toLowerCase().includes(eng.toLowerCase())) return name;
  return `${name} (${eng})`;
}

// Resolve a title's DISPLAY name from the best available source, in order:
// titledb (rich, may carry a localized name + English aliases for the 한(영)
// decoration) → NACP data extracted from the container (homebrew / fan /
// brand-new titles blawar's titledb never has) → the filename. Without the
// extracted layer a title missing from titledb collapsed to its filename —
// often the bare "[TITLEID][vVER]" tokens. Returns the decorated name.
// Shared by buildFileItem (the file list) and buildSectionItem (the sections).
function resolveDisplayName(parsed, fromDb) {
  if (parsed.contentType !== "dlc") return baseDisplayName(parsed, fromDb);
  // fromDb is the BASE game here; the add-on may have its own titledb entry.
  const own = titledbStore.get(parsed.titleId);
  return dlcDisplayName({
    ownName: own?.name ? decorateNameWithAlias(own.name, own) : null,
    fileName: parsed.name,
    baseName: fromDb ? baseDisplayName(parsed, fromDb) : null,
    titleId: parsed.titleId,
  });
}

/**
 * The admin's own name for a game, in the first display language they wrote it
 * in, with the English one after it the way titledb names are shown. Pure.
 */
export function ownDisplayName(own, priority) {
  const lang = priority.map((l) => parseLang(l) ?? l.split("-")[0]).find((l) => own[l]) ?? ["en", "ko", ...Object.keys(own)].find((l) => own[l]);
  const name = own[lang];
  return lang !== "en" && own.en && !name.toLowerCase().includes(own.en.toLowerCase()) ? `${name} (${own.en})` : name;
}

/** The titles the game's own file carries: the one read for its language order, and its English one. */
function fileTitles(titleId, nacpEnglish = contentMeta.get(titleId, 0)?.englishName) {
  return [extractedMeta.get(titleId)?.name, nacpEnglish];
}

function baseDisplayName(parsed, fromDb) {
  const baseId = parsed.groupTitleId;
  const own = baseId ? gameDescriptions.names(baseId) : null;
  if (own) return ownDisplayName(own, langPriority);
  const extracted = !fromDb && baseId ? extractedMeta.get(baseId) : null;
  // A title never released in the preferred-language region has no titledb
  // entry for ITS id, so `fromDb.name` is the foreign one — even though the
  // localized name exists in the same titledb under the sibling release's id.
  // The eShop artwork hash links them. Without this the catalog shows
  // "Dead Cells" while "데드 셀" sits right there (measured: 52 titles).
  const sibling = baseId ? titledbStore.preferredSibling(baseId) : null;
  const source = sibling ?? fromDb;
  const nacpEnglish = baseId ? contentMeta.get(baseId, 0)?.englishName : null;
  // A Korean or English title in the file beats titledb's when titledb has only later languages (a Japan-only release).
  const fromFile = baseId && !sibling ? pickFileName(titledbStore.namesOf(baseId), fileTitles(baseId, nacpEnglish), langPriority) : null;
  const rawName = valueOf("name", { [LOCAL_PREFERRED]: fromFile, [TITLEDB]: source?.name, [LOCAL]: extracted?.name, [FILENAME]: parsed.name, ...agentValues("name", baseId, {}) }, { skipEmpty: true, order: agentOrder("name", [LOCAL_PREFERRED, TITLEDB, LOCAL, FILENAME], baseId) });
  return decorateNameWithAlias(rawName, source ?? fromDb, nacpEnglish);
}

// European titles are mostly the English one; those are left out of a list item, as a client falls back to English.
const TWIN_LANGS = new Set(["es", "fr", "de", "it", "pt", "ru", "nl"]);
const withoutEnglishTwins = (names) => Object.fromEntries(Object.entries(names).filter(([l, v]) => !TWIN_LANGS.has(l) || v !== names.en));

function buildFileItem(relPath, size, mtimeMs) {
  const parsed = parseFromFilename(relPath);
  const baseId = parsed.groupTitleId;
  const fromDb = baseId ? titledbStore.get(baseId) : null;
  const item = {
    url: encodeRelPath(relPath),
    name: resolveDisplayName(parsed, fromDb),
    size,
  };
  // File mtime (epoch seconds) so consumers can sort by "recently added"
  // without keeping their own first-seen bookkeeping. The stat is already
  // in hand — fast-glob runs with `stats: true` and readOneFile stats
  // anyway — so this costs no extra I/O. Omitted when unknown rather than
  // emitted as 0, which would read as "1970" to a naive sort.
  if (Number.isFinite(mtimeMs) && mtimeMs > 0) {
    item.mtime = Math.floor(mtimeMs / 1000);
  }
  if (parsed.titleId) {
    item.titleId = parsed.titleId;
    item.baseTitleId = baseId;
    item.kind = parsed.contentType; // "base" | "update" | "dlc"
    item.version = parsed.version ?? 0;
    item.icon_url = withVersion(`/api/library/icon/${parsed.titleId}`);
  }
  return item;
}

/**
 * Re-read one file from disk and build its file item. Returns null if the
 * file disappeared between the chokidar event and this stat — the caller
 * should treat that as a removal.
 */
export async function readOneFile(relPath) {
  try {
    const st = await fs.stat(path.join(romsDirPath, relPath));
    return buildFileItem(relPath, st.size, st.mtimeMs);
  } catch (err) {
    if (err.code !== "ENOENT") {
      debug.error("readOneFile %s: %s", relPath, err.message);
    }
    return null;
  }
}

/** The file item again from one already built, for when only the names it carries changed. */
export function rebuildFileItem(relPath, item) {
  return buildFileItem(relPath, item.size, item.mtime ? item.mtime * 1000 : undefined);
}

/**
 * Full library scan + custom-entries load. Returns the primitive state
 * (`filesMap` keyed by relative path, plus `customs` array) that the
 * library-cache layer then mutates via delta apply and re-composes on each
 * change.
 */
export async function scanLibrary() {
  const entries = await FastGlob(SCAN_PATTERNS, {
    cwd: romsDirPath,
    dot: false,
    onlyFiles: true,
    braceExpansion: false,
    caseSensitiveMatch: false,
    stats: true,
    // The drop box is sorted into the library; what waits there is not listed yet.
    ignore: incomingInGames ? [`${incomingInGames}/**`] : [],
  });
  debug.log("scanned files: %d", entries.length);

  const filesMap = new Map();
  for (const entry of entries) {
    const rel = entry.path;
    const size = entry.stats?.size ?? 0;
    filesMap.set(rel, buildFileItem(rel, size, entry.stats?.mtimeMs));
  }

  const customs = await loadCustomEntries(customEntriesPath);
  return { filesMap, customs };
}

export async function loadCustoms() {
  return loadCustomEntries(customEntriesPath);
}

/**
 * A file as /games.json lists it: its name ends in "[TITLEID][vVERSION]", the
 * form automation reading the catalog parses for the file's identity. Pure.
 */
function catalogEntry({ version, ...item }) {
  return item.titleId ? { ...item, name: `${item.name} [${item.titleId}][v${version}]` } : item;
}

/**
 * Produce the library response payload from current primitive state. Cheap
 * (O(filesMap.size + customs.length) iteration, no I/O), so safe to call
 * after every chokidar delta. Output ordering follows Map insertion order
 * + customs append, which is deterministic given the same state.
 */
export function composeResponse(filesMap, customs) {
  const files = [];
  const byBase = new Map();

  for (const [relPath, item] of filesMap.entries()) {
    files.push(catalogEntry(item));
    const baseId = item.baseTitleId;
    if (!baseId) continue;
    if (!byBase.has(baseId)) byBase.set(baseId, []);
    byBase.get(baseId).push({ relPath, item, titleId: item.titleId, fileName: relPath });
  }
  for (const [baseId, owned] of byBase) queueExtraction(baseId, iconFileOrder(owned, baseId));

  for (const raw of customs) {
    const entry = { ...raw };
    const tid = normalizeTitleId(entry.titleId);
    if (tid && !entry.icon_url && !entry.iconUrl) {
      entry.icon_url = withVersion(`/api/library/icon/${tid}`);
    }
    files.push(entry);
  }

  return { files };
}

// Queue one title's file for NACP/icon extraction per the COOK_EXTRACT_ICONS policy:
//   all     → every title's name and icon.
//   missing → every title's icon (game files are the only source of icons),
//             and the name only for titles titledb can't cover.
//   off     → never.
// The worker de-dupes by titleId AND skips containers whose icon is
// already on disk, so re-enqueueing on every rebuild stays cheap.
// `wantMeta` is false for titledb-covered titles — they only need the
// icon, so the worker can skip the expensive nstool dump when one is
// already cached. Use the raw relPath (filesMap key) — item.url is
// percent-encoded for wire transport and would point the extractor at
// a non-existent path otherwise.
//
// Policy (pure, in extract-policy.js): mode gate × size cap. A giant
// uncovered file is SKIPPED rather than allowed to grind for minutes —
// it keeps its filename fallback. `item.size` is the fast-glob stat from
// scanLibrary, so no extra fs.stat here.
//
// A record stored garbled (a compressed NACP read as plain text by an older
// decoder) is a repair, not an optional extraction: it is read again in full
// whatever the mode and whether or not titledb knows the title, still through
// the paced queue and under the size cap.
function queueExtraction(baseId, candidates) {
  if (!candidates.length) return;
  const fromDb = titledbStore.get(baseId);
  const read = extractedMeta.get(baseId);
  const repair = Boolean(read?.garbled);
  const needIcon = !hasCached(cachePathFor(baseId, "icon"));
  // A record already read is read again only when nacp-extractor.js asks for it (needsReread), or for its icon.
  if (!fromDb && read && !nacpExtractor.needsReread(read) && !needIcon) return;
  const extractMode = repair || (needIcon && extractIcons !== "off") ? "all" : extractIcons;
  const readable = candidates.filter(({ relPath, item }) =>
    shouldAutoExtract({ sizeBytes: item.size, extractMode, fromDb, maxBytes: extractMaxBytes, fileName: relPath }));
  if (readable.length) {
    const [first, ...rest] = readable.map(({ relPath, item }) => ({ absPath: path.join(romsDirPath, relPath), fileName: item.name }));
    nacpExtractor.enqueue({ ...first, fallbacks: rest, baseTitleId: baseId, wantMeta: repair || !fromDb });
  } else if (wantsExtractByMode({ extractMode, fromDb })) {
    const { item } = candidates[0];
    debug.log("[extract] skip %s (%s GB > cap %s GB)", item.name, (item.size / BYTES_PER_GB).toFixed(2), extractMaxGb);
  }
}

// ── Sections view (/api/library/sections) ─────────────────────────────────────
// The catalog the CookingFoil client and the web page read: each item carries
// its own fields (clean name, title_id, app_version, app_type, icon_url), so
// nothing is read back out of a file name. Schema per the client's
// remoteInstall.cpp::ParseRemoteSectionsBody:
//   { sections: [ { id, title, items: [ { url, name, size, title_id,
//     app_id, app_version, app_type, release_date, icon_url } ] } ] }
// URLs are emitted RELATIVE here; the route makes them absolute against the
// request's origin (helpers/origin.js) so on-device curl can fetch them.

function buildSectionItem(relPath, wireItem) {
  const parsed = parseFromFilename(relPath);
  const baseId = parsed.groupTitleId;
  const fromDb = baseId ? titledbStore.get(baseId) : null;
  const extracted = !fromDb && baseId ? extractedMeta.get(baseId) : null;
  const item = {
    url: wireItem.url, // already "../" + percent-encoded relPath
    name: resolveDisplayName(parsed, fromDb), // CLEAN — no [TID][vVER] suffix
    size: wireItem.size,
  };
  // The primitive already carries stat.mtime in epoch seconds. Reuse it
  // without another stat, including for files with no title metadata.
  if (Number.isFinite(wireItem.mtime) && wireItem.mtime > 0) {
    item.added_at = Math.floor(wireItem.mtime);
  }
  const languages = normalizeSupportedLanguages(fromDb?.languages);
  if (languages) item.languages = languages;
  const categories = normalizeGenres(fromDb?.category);
  if (categories) item.categories = categories;
  if (parsed.titleId) {
    item.title_id = parsed.titleId;
    item.app_id = parsed.titleId;
    // Grouping key: base + update + dlc all carry the base's id so the client
    // collapses them into one card (M2c) without re-deriving it from the name.
    item.base_title_id = baseId;
    item.app_version = parsed.version ?? 0;
    item.app_type = parsed.contentType; // "base" | "update" | "dlc"
    // Lightweight rich fields — inlined only when known (titledb, else NACP
    // fallback). Kept to a few small fields so the sections payload stays lean;
    // full detail (description/screenshots) is the on-demand /api/title/:id.
    const publisher = valueOf("publisher", { [TITLEDB]: fromDb?.publisher, [LOCAL]: extracted?.publisher, ...agentValues("publisher", baseId, {}) }, { order: agentOrder("publisher", [TITLEDB, LOCAL], baseId) });
    if (publisher) item.publisher = publisher;
    if (fromDb?.region) item.region = fromDb.region;
    if (typeof fromDb?.releaseDate === "number") item.release_date = fromDb.releaseDate;
    Object.assign(item, sectionExtras(fromDb));
    if (parsed.contentType === "base") {
      // The name in each language titledb has (client feature "item-names").
      // A game titledb does not list still has the English name its own file carries.
      const nacpEnglish = contentMeta.get(parsed.titleId, 0)?.englishName;
      const fromDbNames = titledbStore.namesOf(parsed.titleId);
      // The file's own titles fill the languages titledb lacks, so a Korean client finds the Korean one.
      const names = withoutEnglishTwins({ ...fileNamesOver(fromDbNames, fileTitles(parsed.titleId, nacpEnglish), langPriority), ...(fromDbNames ?? {}) });
      if (Object.keys(names).length) item.names = names;
      // Box art per language where it differs from icon_url (feature "item-icons").
      const langs = iconLangs(parsed.titleId);
      if (langs.length) {
        item.icons = Object.fromEntries(langs.map((l) => [l, withVersion(`/api/library/icon/${parsed.titleId}`, l)]));
      }
      Object.assign(item, scoreFields(scores.ratingOf(parsed.titleId, { siblings: titledbStore.artSiblings(parsed.titleId) })));
      const patchCount = userPatches.countFor(parsed.titleId);
      if (patchCount) {
        item.patches = patchCount;
        item.patch_required = Boolean(userPatches.requiredFor(parsed.titleId));
      }
      const required = patchCount ? userPatches.requiredFor(parsed.titleId) : 0;
      if (required) item.required_patches = required;
      const korean = patchCount ? userPatches.koreanFor(parsed.titleId) : 0;
      if (korean) item.korean_patches = korean;
    }
    item.icon_url = withVersion(`/api/library/icon/${parsed.titleId}`);
    attachContentMeta(item, relPath, parsed);
  }
  return item;
}

// Facts read from inside the file: the install size (NSZ files understate it),
// the firmware a game or update needs, the base update a DLC needs, and the
// display version ("1.4.1") of an update. Until a file has been read it is
// queued and the next rebuild picks the facts up; titledb's cnmts fill the
// firmware and DLC requirement meanwhile (and for XCI, which is never read).
function attachContentMeta(item, relPath, parsed) {
  const { titleId, version } = parsed;
  const meta = contentMeta.get(titleId, version);
  if (meta?.installSize) item.install_size = meta.installSize;
  // The master key generation the file needs and the firmware that brought it (feature "item-key-generation").
  if (Number.isInteger(meta?.keyGeneration)) {
    item.key_generation = meta.keyGeneration;
    item.key_firmware = firmwareOf(meta.keyGeneration);
  }
  const firmware = meta?.requiredFirmware ?? titledbVersions.requiredFirmware(titleId, version);
  if (firmware) item.required_firmware = firmware;
  const needsUpdate = meta?.requiredAppVersion ?? titledbVersions.requiredAppVersion(titleId, version);
  if (needsUpdate) item.required_app_version = needsUpdate;
  if (parsed.contentType === "base") {
    // What the eShop has published, so a client can tell a stale update apart.
    const latest = titledbVersions.latestVersion(titleId);
    if (latest) item.latest_version = latest;
    const dlcTotal = titledbVersions.dlcCount(titleId, titledbStore.dlcIdsOf(titleId));
    if (dlcTotal) item.dlc_total = dlcTotal;
  }
  if (parsed.contentType === "update" && meta?.displayVersion) item.version_name = meta.displayVersion;
  // What the file check found, only when there is something to say (feature "item-integrity"),
  // and why in short (feature "item-integrity-detail"). It informs; the file is offered all the same.
  const finding = findingOf(relPath);
  if (finding) {
    item.integrity = finding.verdict;
    item.integrity_detail = integritySummary(finding);
  }
  // Whether the content and the ticket are signed, as far as the file check knows (feature "item-signed").
  const signed = signedOf(relPath);
  if (signed) item.signed = signed;
  if (extractIcons !== "off") {
    contentMeta.enqueue({
      absPath: path.join(romsDirPath, relPath), titleId: parsed.titleId,
      version: parsed.version, contentType: parsed.contentType,
    });
  }
}

function buildSectionItemFromCustom(raw) {
  // A section item needs a `url`; title-only custom rows are skipped.
  if (!raw || typeof raw.url !== "string" || !raw.url) return null;
  const tid = normalizeTitleId(raw.titleId);
  const item = {
    url: raw.url,
    name: typeof raw.name === "string" ? raw.name : "",
    size: typeof raw.size === "number" ? raw.size : 0,
  };
  const addedAt = raw.added_at ?? raw.mtime;
  if (Number.isFinite(addedAt) && addedAt > 0) item.added_at = Math.floor(addedAt);
  const languages = normalizeSupportedLanguages(raw.languages);
  if (languages) item.languages = languages;
  const categories = normalizeGenres(raw.categories ?? raw.category);
  if (categories) item.categories = categories;
  if (tid) {
    item.title_id = tid;
    item.app_id = tid;
    // Custom rows are standalone — they group under their own id.
    item.base_title_id = tid;
    if (typeof raw.version === "number") item.app_version = raw.version;
    if (raw.publisher) item.publisher = raw.publisher;
    if (raw.region) item.region = raw.region;
    item.icon_url = raw.icon_url ?? raw.iconUrl ?? withVersion(`/api/library/icon/${tid}`);
  }
  return item;
}

// English titles a release goes by, for matching it against the US store:
// titledb's English aliases and the title in the game's own NACP.
function englishNamesOf(titleId, fromDb) {
  const names = (fromDb?.aliases ?? []).filter((a) => typeof a === "string" && ASCII_RE.test(a));
  const nacpEnglish = contentMeta.get(titleId, 0)?.englishName;
  if (nacpEnglish) names.push(nacpEnglish);
  return names;
}

// Review score (meta/ratings.js); score_label is a SCORE_LABELS key (Steam only).
function scoreFields(rating) {
  if (!rating) return {};
  const fields = { score: rating.score, score_count: rating.count, score_source: rating.source };
  if (rating.label) fields.score_label = rating.label;
  return fields;
}

/**
 * Build the sections payload from the warmed primitive state. A single "All"
 * section holds every item; per-item `app_type` drives the client's
 * "base only" filter.
 */
export function composeSections(filesMap, customs) {
  const items = [];
  if (filesMap) {
    for (const [relPath, wireItem] of filesMap.entries()) {
      items.push(buildSectionItem(relPath, wireItem));
    }
  }
  for (const raw of customs ?? []) {
    const item = buildSectionItemFromCustom(raw);
    if (item) items.push(item);
  }
  attachSwitchLabels(items);
  const picks = featured.forSections();
  // Hand the library's base games to the rating collector (it works them through on its own pace).
  ratingSync.track(items.filter((i) => i.app_type === "base" && i.title_id).map((i) => ({
    titleId: i.title_id,
    names: englishNamesOf(i.title_id, titledbStore.get(i.title_id)),
    year: i.release_date ? Math.floor(i.release_date / 10000) : null,
  })));
  // The library's base games to the metadata plugins; they are asked in the background and the answers are read from the cache.
  agentParts().runner.track(items.filter((i) => i.app_type === "base" && i.title_id).map((i) => ({ titleId: i.title_id, name: i.name ?? null, hasFile: true })));
  // The same games to the picture filler: one lacking an icon gets titledb's, else a plugin's, fetched in the background (meta/art-fill.js).
  artFiller().track(items.filter((i) => i.app_type === "base" && i.title_id).map((i) => i.title_id));
  const body = { sections: [{ id: "all", title: "All", items }] };
  // Item categories are English keys; this maps each to its label per language.
  body.genres = GENRE_LABELS;
  // score_label keys → their label per language.
  body.score_labels = SCORE_LABELS;
  // Card label keys on base items → their text per language, tone, icon and order.
  body.labels = SWITCH_LABELS;
  // Operator-picked home rows refer to items by base id (see meta/featured.js).
  if (picks.length) body.featured = picks;
  return body;
}

/**
 * Convenience wrapper: full scan + immediate compose. Used by tests and
 * any caller that doesn't need to maintain incremental state.
 */
export default async function generateIndex() {
  const { filesMap, customs } = await scanLibrary();
  return composeResponse(filesMap, customs);
}
