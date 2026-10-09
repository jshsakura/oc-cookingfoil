/**
 * eShop popularity rank (1 = most popular), for the client's "인기" row.
 *
 * blawar/titledb carries a `rank` field but leaves it empty in every region,
 * so the rank comes from the search index nintendo.com's own US store uses:
 * its game records carry `popularityRank`, the US `nsuid` and the title. The
 * US titledb file maps that nsuid to a title id. Refreshed with titledb
 * (daily) and kept as titledb/popularity.json.
 *
 * A Korean-only release has its own title id that the US store never lists.
 * rankOf() then borrows the rank of the release that shares its eShop artwork,
 * or of the store title that matches its English name exactly.
 */
import fs from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { titledbCacheDir } from "../helpers/envs.js";

// Public search-only credentials nintendo.com ships to every visitor.
const ENDPOINT = "https://u3b6gr4ua3-dsn.algolia.net/1/indexes/store_game_en_us/query";
const HEADERS = {
  "X-Algolia-Application-Id": "U3B6GR4UA3",
  "X-Algolia-API-Key": "a29c6927638bfd8cee23993e51e721c9",
};
const PAGE_SIZE = 500;
// The index serves at most 1000 hits per query and does not return them in
// strict rank order, so the ranking is read in fixed rank windows that each
// fit in one query.
const RANK_WINDOW = 900;
const MAX_RANK = 30_000;
// Two empty windows in a row mean the ranking has ended.
const EMPTY_WINDOWS_TO_STOP = 2;
const STORE_VERSION = 2;
const REQUEST_TIMEOUT_MS = 10_000;
const STORE_FILE = "popularity.json";
const US_TITLEDB_FILES = ["US.en.slim.json", "US.en.json"];
const TITLE_ID_RE = /^[0-9A-F]{16}$/;

let ranks = new Map(); // title id → rank
let byName = new Map(); // normalized store title → rank

/** Folds a title to compare across stores: "Pokémon™ Legends: Z-A" → "pokemon legends z a". */
export function normalizeTitle(title) {
  return String(title ?? "")
    .replace(/[™®©]/g, "") // before NFKD, which spells ™ out as "TM"
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function query(params, fetchImpl) {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ params: new URLSearchParams(params).toString() }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`popularity query returned HTTP ${res.status}`);
  return (await res.json())?.hits ?? [];
}

/** nsuid → { rank, title }, best rank per nsuid, until the ranking runs out. */
export async function fetchRanks({ fetchImpl = fetch } = {}) {
  const out = new Map();
  let empty = 0;
  for (let after = 0; after < MAX_RANK && empty < EMPTY_WINDOWS_TO_STOP; after += RANK_WINDOW) {
    let seen = 0;
    for (let page = 0; page * PAGE_SIZE < RANK_WINDOW; page++) {
      const hits = await query({
        query: "", hitsPerPage: PAGE_SIZE, page,
        attributesToRetrieve: "nsuid,popularityRank,title",
        filters: `topLevelCategoryCode:GAMES AND popularityRank > ${after} AND popularityRank <= ${after + RANK_WINDOW}`,
      }, fetchImpl);
      seen += hits.length;
      for (const hit of hits) {
        const rank = Number(hit?.popularityRank);
        const nsuId = String(hit?.nsuid ?? "");
        if (!Number.isInteger(rank) || rank <= 0 || !/^\d{14}$/.test(nsuId)) continue;
        if (!out.has(nsuId) || out.get(nsuId).rank > rank) out.set(nsuId, { rank, title: String(hit.title ?? "") });
      }
      if (hits.length < PAGE_SIZE) break;
    }
    empty = seen ? 0 : empty + 1;
  }
  return out;
}

/** US titledb: nsuid → title id. Raw files are keyed by nsuid, slim ones by id. */
export function nsuIdIndex(usTitledb) {
  const out = new Map();
  for (const entry of Object.values(usTitledb ?? {})) {
    const id = typeof entry?.id === "string" ? entry.id.toUpperCase() : "";
    if (TITLE_ID_RE.test(id) && entry.nsuId) out.set(String(entry.nsuId), id);
  }
  return out;
}

async function readUsTitledb() {
  for (const name of US_TITLEDB_FILES) {
    try {
      return JSON.parse(await fs.readFile(path.join(titledbCacheDir, name), "utf8"));
    } catch { /* try the next form */ }
  }
  return null;
}

function setFrom(stored) {
  const valid = (entries) => entries.filter(([, rank]) => Number.isInteger(rank) && rank > 0);
  ranks = new Map(valid(Object.entries(stored?.ids ?? {})));
  byName = new Map(valid(Object.entries(stored?.names ?? {})));
}

export async function load() {
  try {
    const stored = JSON.parse(await fs.readFile(path.join(titledbCacheDir, STORE_FILE), "utf8"));
    setFrom(stored?.version === STORE_VERSION ? stored : null);
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("popularity: cannot read %s: %s", STORE_FILE, err.message);
    setFrom(null);
  }
  return ranks.size;
}

/** False before the first refresh, and for a file from an older format. */
export async function hasStore() {
  try {
    const stored = JSON.parse(await fs.readFile(path.join(titledbCacheDir, STORE_FILE), "utf8"));
    return stored?.version === STORE_VERSION;
  } catch {
    return false;
  }
}

/** Title ids and normalized titles with their best rank. Pure. */
export function buildStore(byNsuId, nsuIdToTitleId) {
  const ids = {};
  const names = {};
  for (const [nsuId, { rank, title }] of byNsuId) {
    const id = nsuIdToTitleId.get(nsuId);
    if (id && !(ids[id] <= rank)) ids[id] = rank;
    const name = normalizeTitle(title);
    if (name && !(names[name] <= rank)) names[name] = rank;
  }
  return { version: STORE_VERSION, ids, names };
}

/** Downloads the ranking and maps it to title ids; keeps the old one on failure. */
export async function refresh(opts = {}) {
  try {
    const byNsuId = await fetchRanks(opts);
    const next = buildStore(byNsuId, nsuIdIndex(await readUsTitledb()));
    if (!Object.keys(next.ids).length) throw new Error("no ranked title matched the US titledb");
    const file = path.join(titledbCacheDir, STORE_FILE);
    await fs.mkdir(titledbCacheDir, { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(next));
    await fs.rename(`${file}.tmp`, file);
    setFrom(next);
    debug.log("popularity: %d ranked titles, %d store titles", ranks.size, byName.size);
    return true;
  } catch (err) {
    debug.error("popularity: refresh failed: %s", err.message);
    return false;
  }
}

/**
 * Popularity rank of a title, or null. Falls back to the best rank among
 * `siblings` (releases sharing its eShop artwork), then to an exact match of
 * one of its English `names` against the store's titles.
 */
export function rankOf(titleId, { siblings = [], names = [] } = {}) {
  const own = ranks.get(String(titleId ?? "").toUpperCase());
  if (own) return own;
  const borrowed = siblings.map((id) => ranks.get(id)).filter(Boolean);
  if (borrowed.length) return Math.min(...borrowed);
  const matched = names.map((name) => byName.get(normalizeTitle(name))).filter(Boolean);
  return matched.length ? Math.min(...matched) : null;
}

/** For tests. */
export function setRanks(entries, names = []) {
  ranks = new Map(entries);
  byName = new Map(names);
}
