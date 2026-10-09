/**
 * eShop popularity rank (1 = most popular), for the client's "인기" row.
 *
 * blawar/titledb carries a `rank` field but leaves it empty in every region,
 * so the rank comes from the search index nintendo.com's own US store uses:
 * its game records carry `popularityRank` and the US `nsuid`. The US titledb
 * file maps that nsuid to a title id. Refreshed with titledb (daily) and kept
 * as titledb/popularity.json, { titleId: rank }.
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
const MAX_RANK = 9000;
const REQUEST_TIMEOUT_MS = 10_000;
const STORE_FILE = "popularity.json";
const US_TITLEDB_FILES = ["US.en.slim.json", "US.en.json"];
const TITLE_ID_RE = /^[0-9A-F]{16}$/;

let ranks = new Map();

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

/** nsuid → popularity rank, for ranks 1..MAX_RANK. */
export async function fetchRanks({ fetchImpl = fetch } = {}) {
  const out = new Map();
  for (let after = 0; after < MAX_RANK; after += RANK_WINDOW) {
    for (let page = 0; page * PAGE_SIZE < RANK_WINDOW; page++) {
      const hits = await query({
        query: "", hitsPerPage: PAGE_SIZE, page,
        attributesToRetrieve: "nsuid,popularityRank",
        filters: `topLevelCategoryCode:GAMES AND popularityRank > ${after} AND popularityRank <= ${after + RANK_WINDOW}`,
      }, fetchImpl);
      for (const hit of hits) {
        const rank = Number(hit?.popularityRank);
        const nsuId = String(hit?.nsuid ?? "");
        if (!Number.isInteger(rank) || rank <= 0 || !/^\d{14}$/.test(nsuId)) continue;
        if (!out.has(nsuId) || out.get(nsuId) > rank) out.set(nsuId, rank);
      }
      if (hits.length < PAGE_SIZE) break;
    }
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

export async function load() {
  try {
    const stored = JSON.parse(await fs.readFile(path.join(titledbCacheDir, STORE_FILE), "utf8"));
    ranks = new Map(Object.entries(stored ?? {}).filter(([, rank]) => Number.isInteger(rank)));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("popularity: cannot read %s: %s", STORE_FILE, err.message);
    ranks = new Map();
  }
  return ranks.size;
}

export async function hasStore() {
  try {
    await fs.access(path.join(titledbCacheDir, STORE_FILE));
    return true;
  } catch {
    return false;
  }
}

/** Downloads the ranking and maps it to title ids; keeps the old one on failure. */
export async function refresh(opts = {}) {
  try {
    const byNsuId = await fetchRanks(opts);
    const ids = nsuIdIndex(await readUsTitledb());
    const next = new Map();
    for (const [nsuId, rank] of byNsuId) {
      const id = ids.get(nsuId);
      if (id && !next.has(id)) next.set(id, rank);
    }
    if (!next.size) throw new Error("no ranked title matched the US titledb");
    const file = path.join(titledbCacheDir, STORE_FILE);
    await fs.mkdir(titledbCacheDir, { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(next)));
    await fs.rename(`${file}.tmp`, file);
    ranks = next;
    debug.log("popularity: %d ranked titles", next.size);
    return true;
  } catch (err) {
    debug.error("popularity: refresh failed: %s", err.message);
    return false;
  }
}

/** Popularity rank of a title, or null when it is not among the ranked ones. */
export function rankOf(titleId) {
  return ranks.get(String(titleId ?? "").toUpperCase()) ?? null;
}

/** For tests. */
export function setRanks(entries) {
  ranks = new Map(entries);
}
