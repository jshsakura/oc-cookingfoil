/**
 * Review scores collected by CookingFoil itself, the way oc-scraper does it,
 * so every game in the library gets one without anything set up by hand:
 *
 *   Steam  storesearch by English name → appreviews summary  (no key needed)
 *   IGDB   games search on Switch (platform 130)            (COOK_IGDB_CLIENT_ID/SECRET)
 *
 * A game is matched by name only when the best candidate is nearly the same
 * title (similarity ≥ 0.9 after normalizing), so a wrong game never lends its
 * score. Results, including "not found", are kept in titledb/ratings-own.json:
 * a found score is re-read weekly (reviews move), a miss is retried after two
 * weeks. The library is worked through in small paced batches every ten
 * minutes, new games first.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { titledbCacheDir, ratingSync, igdbClientId, igdbClientSecret } from "../helpers/envs.js";
import { pickScore } from "./scraper-ratings.js";

const STORE_FILE = "ratings-own.json";
const STORE_VERSION = 1;
const MATCH_MIN = 0.9;
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH = 40;
const LOOP_MS = 10 * 60 * 1000;
const FIRST_RUN_MS = 2 * 60 * 1000;
const PAUSE_MS = 500;
const TIMEOUT_MS = 15_000;
const STEAM_SEARCH = "https://store.steampowered.com/api/storesearch";
const STEAM_REVIEWS = "https://store.steampowered.com/appreviews";
const IGDB_TOKEN = "https://id.twitch.tv/oauth2/token";
const IGDB_GAMES = "https://api.igdb.com/v4/games";
const SWITCH_PLATFORM = 130;
// Steam's review summary wording, as the keys SCORE_LABELS uses.
const STEAM_LABELS = new Set([
  "Overwhelmingly Positive", "Very Positive", "Positive", "Mostly Positive", "Mixed",
  "Mostly Negative", "Negative", "Very Negative", "Overwhelmingly Negative",
]);
// Words that name an edition or a platform, not the game.
const EDITION_RE = /\b(nintendo switch( 2)?( edition)?|switch( 2)? edition|for nintendo switch|deluxe|definitive|complete|remastered|remaster|hd|edition|goty|game of the year|digital|standard|bundle)\b/g;

const ROMAN = { ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9" };

let titles = {};          // TID → { steam?, igdb? }, each { at, percent, count, label?, confidence, id, name } or { at, miss: true }
let wanted = new Map();   // TID → { names: [English names], year }
let running = null;
let onChangeFn = null;

/** Lower-case Latin title without bracketed tags, marks or edition words. Pure. */
export function normalizeName(name) {
  return String(name ?? "")
    .replace(/[™®©]/g, "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[([{【〈《][^)\]}】〉》]*[)\]}】〉》]/g, " ")
    .replace(/[:\-–—_.,!?'’"&/+]/g, " ")
    .replace(EDITION_RE, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // "II" and "2" are the same sequel; lone I, V and X are too often just letters
    .split(" ").map((w) => ROMAN[w] ?? w).join(" ");
}

function longestCommon(a, b) {
  let best = { i: 0, j: 0, len: 0 };
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best.len) best = { i: i - prev[j], j: j - prev[j], len: prev[j] };
      diag = keep;
    }
  }
  return best;
}

function matches(a, b) {
  if (!a.length || !b.length) return 0;
  const m = longestCommon(a, b);
  if (!m.len) return 0;
  return m.len + matches(a.slice(0, m.i), b.slice(0, m.j)) + matches(a.slice(m.i + m.len), b.slice(m.j + m.len));
}

// The numbers in a title ("2", "II" is already "2", "2077"): a sequel differs
// from its original by little more than these, so they must agree exactly.
function numerals(normalized) {
  return normalized.split(" ").filter((w) => /^\d+$/.test(w)).map(Number).sort().join(",");
}

/** Ratcliff/Obershelp similarity of two normalized names, 0..1 (Python's difflib ratio). Pure. */
export function similarity(a, b) {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return 0;
  if (numerals(x) !== numerals(y)) return 0;
  return (2 * matches(x, y)) / (x.length + y.length);
}

/** The candidate whose name is closest to one of `names`, with its score. Pure. */
export function bestMatch(names, candidates, nameOf = (c) => c.name) {
  let best = null;
  for (const c of candidates ?? []) {
    for (const n of names) {
      const score = similarity(n, nameOf(c));
      if (!best || score > best.confidence) best = { item: c, confidence: score };
    }
  }
  return best;
}

async function getJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** Steam's review summary for a game, or { miss } when no near-exact store match exists. */
export async function steamRating(names, { fetchImpl = fetch } = {}) {
  const candidates = [];
  for (const term of names.slice(0, 2)) {
    const url = `${STEAM_SEARCH}?term=${encodeURIComponent(term)}&l=english&cc=us`;
    const body = await getJson(fetchImpl, url);
    candidates.push(...(body?.items ?? []).slice(0, 5));
  }
  const best = bestMatch(names, candidates);
  if (!best || best.confidence < MATCH_MIN) return { miss: true };
  const url = `${STEAM_REVIEWS}/${best.item.id}?json=1&language=all&purchase_type=all&filter=summary&num_per_page=0`;
  const summary = (await getJson(fetchImpl, url))?.query_summary;
  const total = Number(summary?.total_reviews);
  if (!Number.isInteger(total) || total <= 0) return { miss: true };
  const out = {
    id: best.item.id, name: best.item.name, confidence: Math.round(best.confidence * 1000) / 1000,
    percent: Math.round((Number(summary.total_positive) / total) * 10000) / 100, count: total,
  };
  if (STEAM_LABELS.has(summary.review_score_desc)) out.label = summary.review_score_desc;
  return out;
}

let igdbToken = null; // { value, expiresAt }

async function igdbAuth(fetchImpl) {
  if (igdbToken && Date.now() < igdbToken.expiresAt - 30_000) return igdbToken.value;
  const url = `${IGDB_TOKEN}?client_id=${encodeURIComponent(igdbClientId)}&client_secret=${encodeURIComponent(igdbClientSecret)}&grant_type=client_credentials`;
  const body = await getJson(fetchImpl, url, { method: "POST" });
  igdbToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 0) * 1000 };
  return igdbToken.value;
}

/** IGDB's rating for the Switch release, or { miss }. Only when keys are set. */
export async function igdbRating(names, year, { fetchImpl = fetch } = {}) {
  const token = await igdbAuth(fetchImpl);
  const term = names[0].replace(/"/g, "");
  const body = `search "${term}"; fields id,name,first_release_date,total_rating,total_rating_count; where platforms = (${SWITCH_PLATFORM}); limit 5;`;
  const games = await getJson(fetchImpl, IGDB_GAMES, {
    method: "POST", body,
    headers: { "Client-ID": igdbClientId, Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const best = bestMatch(names, games);
  if (!best || best.confidence < MATCH_MIN) return { miss: true };
  const g = best.item;
  const released = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
  // A same-named game from another era is a different game.
  if (year && released && Math.abs(year - released) >= 4) return { miss: true };
  if (!Number.isFinite(g.total_rating) || !g.total_rating_count) return { miss: true };
  return {
    id: g.id, name: g.name, confidence: Math.round(best.confidence * 1000) / 1000,
    percent: Math.round(g.total_rating * 100) / 100, count: g.total_rating_count,
  };
}

const due = (entry, now) => !entry || now - entry.at >= (entry.miss ? MISS_TTL_MS : HIT_TTL_MS);

/** Titles that need a lookup now: never looked up first, then the oldest. Pure. */
export function dueTitles(wantedMap, store, now = Date.now(), { providers = ["steam"], limit = BATCH } = {}) {
  const list = [];
  for (const [tid, info] of wantedMap) {
    if (!info.names.length) continue;
    const entry = store[tid] ?? {};
    const stale = providers.filter((p) => due(entry[p], now));
    if (!stale.length) continue;
    const oldest = Math.min(...stale.map((p) => entry[p]?.at ?? 0));
    list.push({ tid, providers: stale, oldest });
  }
  return list.sort((a, b) => a.oldest - b.oldest).slice(0, limit);
}

/** The score for a title from what this module collected, in pickScore's shape, or null. */
export function ratingOf(titleId) {
  const entry = titles[String(titleId ?? "").toUpperCase()];
  if (!entry) return null;
  const toPick = (r) => (r && !r.miss ? { percent: r.percent, count: r.count, confidence: r.confidence, label: r.label } : null);
  return pickScore({ steam: toPick(entry.steam), igdb: toPick(entry.igdb) });
}

/** The library's base games and their English names; called whenever sections are composed. */
export function track(list) {
  const next = new Map();
  for (const { titleId, names, year } of list) {
    const clean = [...new Set(names.map((n) => String(n).trim()).filter((n) => normalizeName(n)))];
    next.set(String(titleId).toUpperCase(), { names: clean, year: year || null });
  }
  wanted = next;
}

function storePath() {
  return path.join(titledbCacheDir, STORE_FILE);
}

export function load() {
  try {
    const stored = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    titles = stored?.version === STORE_VERSION && stored.titles ? stored.titles : {};
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("rating sync: cannot read %s: %s", STORE_FILE, err.message);
    titles = {};
  }
  return Object.keys(titles).length;
}

function save() {
  try {
    fs.mkdirSync(titledbCacheDir, { recursive: true });
    fs.writeFileSync(`${storePath()}.tmp`, JSON.stringify({ version: STORE_VERSION, titles }));
    fs.renameSync(`${storePath()}.tmp`, storePath());
  } catch (err) {
    debug.error("rating sync: cannot save %s: %s", STORE_FILE, err.message);
  }
}

export function providers() {
  return igdbClientId && igdbClientSecret ? ["steam", "igdb"] : ["steam"];
}

/** One paced batch. A network error leaves the title due so the next batch retries it. */
export async function runBatch({ fetchImpl = fetch, now = Date.now, pauseMs = PAUSE_MS } = {}) {
  if (running) return running;
  running = (async () => {
    let changed = 0;
    for (const { tid, providers: todo } of dueTitles(wanted, titles, now(), { providers: providers() })) {
      const info = wanted.get(tid);
      for (const p of todo) {
        try {
          const result = p === "steam" ? await steamRating(info.names, { fetchImpl }) : await igdbRating(info.names, info.year, { fetchImpl });
          const before = JSON.stringify(titles[tid]?.[p] && { ...titles[tid][p], at: 0 });
          titles[tid] = { ...titles[tid], [p]: { ...result, at: now() } };
          if (before !== JSON.stringify({ ...titles[tid][p], at: 0 })) changed++;
        } catch (err) {
          debug.error("rating sync: %s %s: %s", p, tid, err.message);
        }
        if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      }
    }
    if (changed) save();
    return changed;
  })().finally(() => { running = null; });
  return running;
}

/** Load the saved scores and start the paced loop. `onChange` runs after a batch that changed any. */
export function start({ onChange } = {}) {
  load();
  if (!ratingSync) {
    debug.log("rating sync: off (COOK_RATING_SYNC=false)");
    return;
  }
  onChangeFn = onChange;
  const tick = () => runBatch()
    .then((changed) => { if (changed) { debug.log("rating sync: %d scores changed", changed); onChangeFn?.(); } })
    .catch((err) => debug.error("rating sync: batch failed: %s", err.message));
  setTimeout(tick, FIRST_RUN_MS).unref();
  setInterval(tick, LOOP_MS).unref();
  debug.log("rating sync: %s, %d titles on file", providers().join(" + "), Object.keys(titles).length);
}

/** Counts for the admin page and logs. */
export function stats() {
  const out = { tracked: wanted.size, providers: providers() };
  for (const p of ["steam", "igdb"]) {
    const entries = Object.values(titles).map((t) => t[p]).filter(Boolean);
    out[p] = { found: entries.filter((e) => !e.miss).length, missing: entries.filter((e) => e.miss).length };
  }
  return out;
}

/** For tests. */
export function reset(store = {}, wantedList = []) {
  titles = store;
  wanted = new Map();
  track(wantedList);
  igdbToken = null;
}
