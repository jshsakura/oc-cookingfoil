/**
 * In-memory titledb store with per-field language fallback.
 *
 * Loads every `titles.<REGION>.<lang>.json` file under data/titledb/ and
 * merges them into a single map keyed by uppercase title ID. Files are
 * applied in COOK_LANG_PRIORITY order — first defined value per field wins,
 * so a `ko` description still gets backfilled by `en` if Korean is missing
 * just that field. Implements the per-field fallback in FINDINGS §5.
 */
import path from "path";
import { readdir, readFile } from "fs/promises";
import debug from "../debug.js";
import { titledbCacheDir, langPriority } from "../helpers/envs.js";
import { slimPathFor, writeSlimFromJson } from "./titledb-slim.js";

// Fields we surface in the merged record. Keep the list aligned with the
// shop_template.jsonc Tinfoil titledb spec and CyberFoil's info panel.
const MERGED_FIELDS = [
  "name", "publisher", "description", "releaseDate", "region", "rating",
  "rank", "size", "intro", "category", "iconUrl", "bannerUrl",
  "screenshots", "version", "nsuId", "numberOfPlayers",
];

// blawar/titledb publishes one file per country/lang pair, named "XX.yy.json"
// (e.g. KR.ko.json, US.en.json). We also accept "XX.yy.slim.json" — the
// pre-indexed slim sibling emitted by the fetcher/store on first parse —
// and prefer it when both are present.
const REGION_FILE_RE = /^([A-Z]{2}\.[a-z]{2,3})\.json$/;
const REGION_SLIM_RE = /^([A-Z]{2}\.[a-z]{2,3})\.slim\.json$/;

function regionToLang(region) {
  // "US.en" → "en", "JP.ja" → "ja", "KR.ko" → "ko".
  const dot = region.lastIndexOf(".");
  return (dot >= 0 ? region.slice(dot + 1) : region).toLowerCase();
}

const state = {
  db: new Map(),
  loadedAt: null,
  regionsLoaded: [],
  // artwork URL → title id of the preferred-language release that shares it.
  // `null` marks an ambiguous key (two different titles claim the same art);
  // we keep the entry so lookups can tell "ambiguous" from "unknown" and skip
  // both. Built once at the end of load() — see buildArtIndex().
  artIndex: new Map(),
};

// eShop CDN artwork is the practical cross-region join key. The same game
// released in another country gets a DIFFERENT title id but Nintendo serves
// the SAME asset hash for its icon/banner, so the art URL links the two.
const ART_FIELDS = ["iconUrl", "bannerUrl"];

function isBaseTitleId(id) {
  // Content type lives in the low 13 bits (base=0, update=0x800, dlc=0x1000+n).
  // 16 hex digits exceed Number's safe range — BigInt or the mask is garbage.
  try {
    return (BigInt(`0x${id}`) & 0x1fffn) === 0n;
  } catch {
    return false;
  }
}

function setIfEmpty(target, field, value) {
  if (value === undefined || value === null || value === "") return;
  const existing = target[field];
  if (existing === undefined || existing === null || existing === "") {
    target[field] = value;
  }
}

function priIndex(region) {
  const lang = regionToLang(region);
  const i = langPriority.indexOf(lang);
  return i === -1 ? langPriority.length : i;
}

export async function load() {
  state.db = new Map();
  state.regionsLoaded = [];

  let entries;
  try {
    entries = await readdir(titledbCacheDir);
  } catch (err) {
    if (err.code !== "ENOENT") {
      debug.error("titledb store: readdir(%s): %s", titledbCacheDir, err.message);
    }
    state.loadedAt = new Date();
    return status();
  }

  // Build a region → {file, slim} map preferring slim siblings. A raw file
  // is only used when its slim counterpart is missing — and when that
  // happens, we emit slim opportunistically after the parse so the next
  // boot is fast.
  const bestForRegion = new Map();
  for (const name of entries) {
    const ms = name.match(REGION_SLIM_RE);
    if (ms) {
      bestForRegion.set(ms[1], { file: name, region: ms[1], slim: true });
      continue;
    }
    const mr = name.match(REGION_FILE_RE);
    if (mr) {
      const existing = bestForRegion.get(mr[1]);
      // Slim already chosen for this region? leave it.
      if (existing && existing.slim) continue;
      bestForRegion.set(mr[1], { file: name, region: mr[1], slim: false });
    }
  }

  const regionFiles = Array.from(bestForRegion.values()).sort(
    (a, b) =>
      priIndex(a.region) - priIndex(b.region) ||
      a.region.localeCompare(b.region)
  );

  // Phase 1: read + parse every region file in parallel. The fs reads
  // overlap (saves wall-clock time on cold disk caches), and the JSON
  // parses still serialize on the event loop — but cooperatively, so the
  // server stays responsive during boot instead of pegging on one huge
  // synchronous read.
  const parsed = await Promise.all(
    regionFiles.map(async ({ file, region, slim }) => {
      const fullPath = path.join(titledbCacheDir, file);
      try {
        const text = await readFile(fullPath, "utf-8");
        return { file, region, slim, json: JSON.parse(text), error: null };
      } catch (err) {
        return { file, region, slim, json: null, error: err };
      }
    })
  );

  // Phase 2: merge sequentially in `langPriority` order (priIndex already
  // sorted `regionFiles`, and `Promise.all` preserves input order) so the
  // "first defined value per field wins" rule stays intact.
  for (const { file, region, slim, json, error } of parsed) {
    if (error) {
      debug.error("titledb store: parse error in %s: %s", file, error.message);
      continue;
    }
    if (!json || typeof json !== "object") continue;

    // Opportunistically emit slim when we just parsed a raw file. Fire and
    // forget — failures don't affect this boot, and on next boot we'll try
    // again the same way.
    if (!slim) {
      const rawPath = path.join(titledbCacheDir, file);
      const slimPath = slimPathFor(rawPath);
      const capturedJson = json; // hold the reference so GC keeps it alive
      setImmediate(() => {
        writeSlimFromJson(capturedJson, slimPath)
          .then((r) => debug.log("titledb store: emitted slim for %s (%d entries)", region, r.count))
          .catch((err) => debug.error("titledb store: slim emit failed for %s: %s", region, err.message));
      });
    }

    // blawar/titledb top-level keys are nsuIds (eShop ids). The actual Switch
    // title id is in entry.id. Key the merged DB by entry.id so lookups from
    // filename-parsed title ids work.
    let count = 0;
    for (const entry of Object.values(json)) {
      if (!entry || typeof entry !== "object") continue;
      const rawId = entry.id;
      if (typeof rawId !== "string") continue;
      const id = rawId.toUpperCase();
      if (!/^[0-9A-F]{16}$/.test(id)) continue;

      let rec = state.db.get(id);
      if (!rec) {
        rec = { id, aliases: [] };
        state.db.set(id, rec);
      }
      // Cross-language search support: collect every distinct name we
      // see across region files (KR.ko, US.en, JP.ja, ...) so a Tinfoil
      // user typing English on the on-screen keyboard finds the game
      // even when the displayed name happens to be Korean.
      if (typeof entry.name === "string") {
        const n = entry.name.trim();
        if (n && !rec.aliases.includes(n)) rec.aliases.push(n);
        // Remember which language actually supplied the displayed name. A
        // title absent from the top-priority region keeps a lower-priority
        // name here, and that's exactly the case the art-sibling lookup
        // below is for.
        if (n && rec.name === undefined) rec.nameLang = regionToLang(region);
      }
      for (const field of MERGED_FIELDS) {
        setIfEmpty(rec, field, entry[field]);
      }
      count++;
    }
    state.regionsLoaded.push({ region, file, count, format: slim ? "slim" : "raw" });
    debug.log("titledb store: %s loaded (%d entries, %s)", region, count, slim ? "slim" : "raw");
  }

  buildArtIndex();

  state.loadedAt = new Date();
  debug.log(
    "titledb store: merged %d titles from %d region file(s)",
    state.db.size,
    state.regionsLoaded.length
  );
  return status();
}

/**
 * Index the preferred-language releases by their artwork URL.
 *
 * Only records whose NAME came from the top-priority language are indexed —
 * those are the ones worth borrowing a name from. Only base title ids are
 * indexed: include DLC rows and Skyrim ends up borrowing the name of its own
 * "스페인어 언어 팩". A URL claimed by two different titles is marked
 * ambiguous (null) and never used; showing the wrong localized name is worse
 * than showing the right foreign one.
 */
function buildArtIndex() {
  state.artIndex = new Map();
  const preferredLang = langPriority[0];
  if (!preferredLang) return;

  for (const rec of state.db.values()) {
    if (rec.nameLang !== preferredLang) continue;
    if (!rec.name || !isBaseTitleId(rec.id)) continue;
    for (const field of ART_FIELDS) {
      const url = rec[field];
      if (typeof url !== "string" || !url) continue;
      const existing = state.artIndex.get(url);
      if (existing === undefined) state.artIndex.set(url, rec.id);
      else if (existing !== rec.id) state.artIndex.set(url, null); // ambiguous
    }
  }
  debug.log("titledb store: art index built (%d artwork keys)", state.artIndex.size);
}

/**
 * The preferred-language release of the same game under a different title id,
 * found via shared eShop artwork. Returns null when the record already has a
 * preferred-language name, when nothing matches, or when the match is
 * ambiguous.
 *
 * Why this exists: a title released only outside Korea has no KR.ko entry for
 * ITS id, so the merged record keeps the English name and the catalog shows
 * "Dead Cells" where "데드 셀" exists under 0100E0E00E64C000. Nothing in
 * titledb links the two ids — the artwork hash does.
 */
export function preferredSibling(titleId) {
  const rec = get(titleId);
  if (!rec) return null;
  const preferredLang = langPriority[0];
  if (!preferredLang || rec.nameLang === preferredLang) return null;

  for (const field of ART_FIELDS) {
    const url = rec[field];
    if (typeof url !== "string" || !url) continue;
    const siblingId = state.artIndex.get(url);
    if (!siblingId || siblingId === rec.id) continue;
    const sibling = state.db.get(siblingId);
    if (sibling?.name) return sibling;
  }
  return null;
}

export function get(titleId) {
  if (typeof titleId !== "string") return null;
  return state.db.get(titleId.toUpperCase()) ?? null;
}

export function size() {
  return state.db.size;
}

export function isLoaded() {
  return state.loadedAt !== null;
}

export function status() {
  return {
    loadedAt: state.loadedAt,
    regions: state.regionsLoaded,
    titles: state.db.size,
  };
}
