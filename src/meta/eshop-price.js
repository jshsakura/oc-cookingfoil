// eShop price for a title, from the public eShop price endpoint, keyed by the
// titledb nsuId. The merged titledb prefers Korean records, so KR is asked
// first; titles only another region sells fall back to US then JP.
//
// The cache is kept on disk (loadPrices at boot, saved after each refresh) so
// a restart does not empty the sale rows while thousands of ids are re-asked.
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { titledbCacheDir } from "../helpers/envs.js";
import * as activity from "../tasks/activity.js";
import { activityText } from "./meta-messages.js";

const ENDPOINT = "https://api.ec.nintendo.com/v1/price";
const COUNTRIES = [["KR", "ko"], ["US", "en"], ["JP", "ja"]];
const FOUND_TTL_MS = 12 * 60 * 60 * 1000;
// A title no checked eShop sells rarely comes back on sale, and it costs three requests to ask.
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
// After a failed ask the endpoint is left alone this long, however often the list is rebuilt.
const FAILED_RETRY_MS = 30 * 60 * 1000;
// A saved price the library no longer asks about (the title left, or its titledb record moved to
// another nsuId) is dropped once it is this old.
const UNUSED_DROP_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3000;
const NSU_ID_RE = /^\d{14}$/;
// The price endpoint answers up to 50 ids per request.
const BATCH_SIZE = 50;
const BATCH_PACE_MS = 300;

const STORE_VERSION = 1;
const cache = new Map();
const failedAt = new Map(); // nsuId → when asking for it last failed; memory only
const listeners = [];
let warming = null;
let storeFile = null; // set by loadPrices(); tests leave it off and never touch disk

/** Reads the saved cache; later refreshes write back to the same file. */
export function loadPrices(file = path.join(titledbCacheDir, "prices.json")) {
  storeFile = file;
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    if (stored?.version !== STORE_VERSION || !Array.isArray(stored.entries)) return 0;
    for (const [id, hit] of stored.entries) {
      if (NSU_ID_RE.test(String(id)) && Number.isFinite(hit?.at)) cache.set(String(id), { at: hit.at, value: hit.value ?? null });
    }
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("eshop prices: cannot read %s: %s", file, err.message);
  }
  return cache.size;
}

function savePrices() {
  if (!storeFile) return;
  try {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(`${storeFile}.tmp`, JSON.stringify({ version: STORE_VERSION, entries: [...cache] }));
    fs.renameSync(`${storeFile}.tmp`, storeFile);
  } catch (err) {
    debug.error("eshop prices: cannot save %s: %s", storeFile, err.message);
  }
}

function priceFrom(entry, country) {
  if (entry?.sales_status !== "onsale" || !entry.regular_price?.amount) return null;
  return {
    country,
    regular: entry.regular_price.amount,
    discount: entry.discount_price?.amount ?? null,
    discountEnds: entry.discount_price?.end_datetime ?? null,
  };
}

/**
 * Resolve the price, or null when no checked eShop sells it. A network error
 * is not saved as "not sold", so a flaky moment does not hide prices for a day;
 * the id is only left alone for FAILED_RETRY_MS.
 */
export async function eshopPrice(nsuId, { fetchImpl = fetch, now = Date.now } = {}) {
  const id = String(nsuId ?? "");
  if (!NSU_ID_RE.test(id)) return null;
  const hit = cache.get(id);
  if (isFresh(hit, now()) || coolingDown(id, now())) return hit?.value ?? null;
  let failed = false;
  for (const [country, lang] of COUNTRIES) {
    try {
      const res = await fetchImpl(`${ENDPOINT}?country=${country}&lang=${lang}&ids=${id}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) { failed = true; continue; }
      const body = await res.json();
      const value = priceFrom(body?.prices?.[0], country);
      if (value) {
        cache.set(id, { at: now(), value });
        failedAt.delete(id);
        return value;
      }
    } catch {
      failed = true;
    }
  }
  if (failed) failedAt.set(id, now());
  else {
    cache.set(id, { at: now(), value: null });
    failedAt.delete(id);
  }
  return null;
}

export function clearPriceCache() {
  cache.clear();
  failedAt.clear();
  storeFile = null;
}

const isFresh = (hit, now) => Boolean(hit) && now - hit.at < (hit.value ? FOUND_TTL_MS : MISSING_TTL_MS);
const coolingDown = (id, now) => failedAt.has(id) && now - failedAt.get(id) < FAILED_RETRY_MS;

/**
 * The cached price without asking the price endpoint: the price, null when no eShop
 * sells it, undefined when unknown. A stale entry is still returned so the
 * list keeps its prices while warmPrices() refreshes them.
 */
export function cachedPrice(nsuId) {
  const hit = cache.get(String(nsuId ?? ""));
  return hit ? hit.value : undefined;
}

export function onPricesChanged(fn) {
  listeners.push(fn);
}

async function fetchBatch(ids, country, lang, fetchImpl) {
  const res = await fetchImpl(`${ENDPOINT}?country=${country}&lang=${lang}&ids=${ids.join(",")}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body?.prices) ? body.prices : [];
}

/**
 * Looks up many titles in batches, KR first, then US and JP for the rest.
 * Titles no eShop sells are cached as null; a batch that fails leaves its ids
 * unknown, and a warm asks for them again after FAILED_RETRY_MS. Returns how many prices changed.
 */
export async function fetchPrices(nsuIds, { fetchImpl = fetch, now = Date.now, paceMs = BATCH_PACE_MS } = {}) {
  let pending = [...new Set(nsuIds.map(String))].filter((id) => NSU_ID_RE.test(id));
  const failed = new Set();
  let changed = 0;
  for (const [country, lang] of COUNTRIES) {
    const unsold = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const ids = pending.slice(i, i + BATCH_SIZE);
      let entries;
      try {
        entries = await fetchBatch(ids, country, lang, fetchImpl);
      } catch {
        for (const id of ids) failed.add(id);
        continue;
      }
      const byId = new Map(entries.map((e) => [String(e?.title_id), e]));
      for (const id of ids) {
        const value = priceFrom(byId.get(id), country);
        if (!value) { unsold.push(id); continue; }
        if (JSON.stringify(cache.get(id)?.value) !== JSON.stringify(value)) changed++;
        cache.set(id, { at: now(), value });
        failedAt.delete(id);
      }
      if (paceMs) await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
    pending = unsold;
  }
  for (const id of pending) {
    if (failed.has(id)) continue;
    if (cache.get(id)?.value) changed++;
    cache.set(id, { at: now(), value: null });
    failedAt.delete(id);
  }
  for (const id of failed) failedAt.set(id, now());
  return changed;
}

/** Forgets old prices the library no longer asks about; how many went. */
function dropUnused(nsuIds, now) {
  const wanted = new Set(nsuIds.map(String));
  let dropped = 0;
  for (const [id, hit] of cache) {
    if (!wanted.has(id) && now - hit.at > UNUSED_DROP_MS) {
      cache.delete(id);
      dropped++;
    }
  }
  return dropped;
}

/**
 * Refreshes the given titles in the background unless their prices are fresh;
 * listeners hear about it when anything changed. One run at a time.
 */
export function warmPrices(nsuIds, opts = {}) {
  if (warming) return warming;
  const now = opts.now ?? Date.now;
  const dropped = dropUnused(nsuIds, now());
  const stale = nsuIds.filter((id) => NSU_ID_RE.test(String(id)) && !isFresh(cache.get(String(id)), now()) && !coolingDown(String(id), now()));
  if (!stale.length) {
    if (dropped) savePrices();
    return Promise.resolve(0);
  }
  const job = activity.begin("eshop", { title: activityText("act.eshop"), detail: activityText("act.count", { n: stale.length }) });
  warming = fetchPrices(stale, opts)
    .then((changed) => {
      savePrices(); // also keeps the refreshed timestamps of unchanged prices
      if (changed) for (const fn of listeners) fn();
      // Runs after every build: one that changed nothing (or could not reach the eShop) leaves no trace.
      if (changed) job.done(activityText("act.changed", { n: changed }));
      else job.discard();
      return changed;
    })
    .catch((err) => { job.fail(err); return 0; })
    .finally(() => { warming = null; });
  return warming;
}
