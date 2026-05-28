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
};

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
      }
      for (const field of MERGED_FIELDS) {
        setIfEmpty(rec, field, entry[field]);
      }
      count++;
    }
    state.regionsLoaded.push({ region, file, count, format: slim ? "slim" : "raw" });
    debug.log("titledb store: %s loaded (%d entries, %s)", region, count, slim ? "slim" : "raw");
  }

  state.loadedAt = new Date();
  debug.log(
    "titledb store: merged %d titles from %d region file(s)",
    state.db.size,
    state.regionsLoaded.length
  );
  return status();
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
