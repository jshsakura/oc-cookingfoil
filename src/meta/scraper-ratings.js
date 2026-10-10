/**
 * Review scores for base games, read from oc-scraper (COOK_RATINGS_URL), which
 * already collects Steam, IGDB and RAWG ratings per post and keeps them with
 * vote counts and a match confidence. Its /api/games list carries the Switch
 * title ids of each post, so scores are matched by title id, never by name.
 *
 * Kept conservative, like oc-scraper's own "best" lists:
 *   - a post that covers more than one base game (a bundle) is skipped
 *   - a provider counts only with a confident match and enough votes
 *     (Steam 100, IGDB 15, RAWG 100); Steam wins, then IGDB, then RAWG
 *
 * Refreshed with titledb (daily) and kept as titledb/ratings.json.
 */
import fs from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { titledbCacheDir, ratingsUrl } from "../helpers/envs.js";

const STORE_FILE = "ratings.json";
const STORE_VERSION = 1;
const PAGE_SIZE = 200;
const MAX_PAGES = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const MIN_CONFIDENCE = 0.9;
const MIN_VOTES = { steam: 100, igdb: 15, rawg: 100 };
const PROVIDER_ORDER = ["steam", "igdb", "rawg"];
const TITLE_ID_RE = /^[0-9A-F]{16}$/;

// Steam's review summary, keyed by its English wording; clients pick the label
// for their own language.
export const SCORE_LABELS = {
  "Overwhelmingly Positive": { en: "Overwhelmingly Positive", ko: "압도적으로 긍정적", ja: "圧倒的に好評", zh: "壓倒性好評" },
  "Very Positive": { en: "Very Positive", ko: "매우 긍정적", ja: "非常に好評", zh: "極度好評" },
  Positive: { en: "Positive", ko: "긍정적", ja: "好評", zh: "好評" },
  "Mostly Positive": { en: "Mostly Positive", ko: "대체로 긍정적", ja: "やや好評", zh: "大多好評" },
  Mixed: { en: "Mixed", ko: "복합적", ja: "賛否両論", zh: "褒貶不一" },
  "Mostly Negative": { en: "Mostly Negative", ko: "대체로 부정적", ja: "やや不評", zh: "大多負評" },
  Negative: { en: "Negative", ko: "부정적", ja: "不評", zh: "負評" },
  "Very Negative": { en: "Very Negative", ko: "매우 부정적", ja: "非常に不評", zh: "極度負評" },
  "Overwhelmingly Negative": { en: "Overwhelmingly Negative", ko: "압도적으로 부정적", ja: "圧倒的に不評", zh: "壓倒性負評" },
};
// oc-scraper hands the label over in Korean when it has one.
const LABEL_KEY = new Map(
  Object.entries(SCORE_LABELS).flatMap(([key, labels]) => Object.values(labels).map((name) => [name.toLowerCase(), key])),
);

let ratings = new Map(); // base title id → { score, count, source, label? }

/** The base id behind a base or update id; null for DLC and anything else. */
function baseIdOf(raw) {
  const id = String(raw ?? "").toUpperCase();
  if (!TITLE_ID_RE.test(id)) return null;
  const n = BigInt(`0x${id}`);
  if ((n & 0x1fffn) === 0n) return id;
  if ((n & 0x1fffn) === 0x800n) return (n & ~0x1fffn).toString(16).toUpperCase().padStart(16, "0");
  return null;
}

/** The single base game a post is about, or null for bundles and unknowns. */
export function baseIdOfPost(post) {
  const ids = [post?.metadata?.title_id, ...(post?.download_items ?? []).map((item) => item?.title_id)];
  const bases = new Set(ids.map(baseIdOf).filter(Boolean));
  return bases.size === 1 ? [...bases][0] : null;
}

/** The score a post's ratings support under the vote floors, or null. Pure. */
export function pickScore(postRatings) {
  for (const source of PROVIDER_ORDER) {
    const r = postRatings?.[source];
    const percent = Number(r?.percent);
    const count = Number(r?.count);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    if (!Number.isInteger(count) || count < MIN_VOTES[source]) continue;
    if (!(Number(r?.confidence) >= MIN_CONFIDENCE)) continue;
    const out = { score: Math.round(percent), count, source };
    const label = source === "steam" ? LABEL_KEY.get(String(r.label ?? "").toLowerCase()) : null;
    if (label) out.label = label;
    return out;
  }
  return null;
}

/** title id → score from oc-scraper posts; the best-sampled post wins a tie. Pure. */
export function buildStore(posts) {
  const out = {};
  for (const post of posts ?? []) {
    const base = baseIdOfPost(post);
    const picked = base && pickScore(post.ratings);
    if (picked && !(out[base]?.count >= picked.count)) out[base] = picked;
  }
  return { version: STORE_VERSION, ratings: out };
}

async function fetchPosts(baseUrl, fetchImpl) {
  const posts = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL("/api/games", baseUrl);
    url.search = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) }).toString();
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`oc-scraper returned HTTP ${res.status}`);
    const body = await res.json();
    posts.push(...(body?.posts ?? []));
    if (!body?.pagination?.has_next) break;
  }
  return posts;
}

function setFrom(stored) {
  ratings = new Map(Object.entries(stored?.version === STORE_VERSION ? stored.ratings ?? {} : {}));
}

export async function load() {
  try {
    setFrom(JSON.parse(await fs.readFile(path.join(titledbCacheDir, STORE_FILE), "utf8")));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("ratings: cannot read %s: %s", STORE_FILE, err.message);
    setFrom(null);
  }
  return ratings.size;
}

export async function hasStore() {
  try {
    await fs.access(path.join(titledbCacheDir, STORE_FILE));
    return true;
  } catch {
    return false;
  }
}

/** Reads every post from oc-scraper; keeps the old scores on failure. Off without COOK_RATINGS_URL. */
export async function refresh({ fetchImpl = fetch, baseUrl = ratingsUrl } = {}) {
  if (!baseUrl) return false;
  try {
    const next = buildStore(await fetchPosts(baseUrl, fetchImpl));
    if (!Object.keys(next.ratings).length) throw new Error("no post carried a usable score");
    const file = path.join(titledbCacheDir, STORE_FILE);
    await fs.mkdir(titledbCacheDir, { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(next));
    await fs.rename(`${file}.tmp`, file);
    setFrom(next);
    debug.log("ratings: %d scored titles", ratings.size);
    return true;
  } catch (err) {
    debug.error("ratings: refresh failed: %s", err.message);
    return false;
  }
}

/**
 * The score of a base game, or null. A release with its own title id (a
 * Korean edition) borrows from `siblings`, the releases sharing its eShop art.
 */
export function ratingOf(titleId, { siblings = [] } = {}) {
  const own = ratings.get(String(titleId ?? "").toUpperCase());
  if (own) return own;
  return siblings.map((id) => ratings.get(id)).filter(Boolean).sort((a, b) => b.count - a.count)[0] ?? null;
}

/** For tests. */
export function setRatings(entries) {
  ratings = new Map(entries);
}
