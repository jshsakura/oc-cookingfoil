// eShop price for a title, from Nintendo's public price endpoint, keyed by the
// titledb nsuId. The merged titledb prefers Korean records, so KR is asked
// first; titles only another region sells fall back to US then JP.
const ENDPOINT = "https://api.ec.nintendo.com/v1/price";
const COUNTRIES = [["KR", "ko"], ["US", "en"], ["JP", "ja"]];
const FOUND_TTL_MS = 12 * 60 * 60 * 1000;
const MISSING_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3000;
const NSU_ID_RE = /^\d{14}$/;
// The price endpoint answers up to 50 ids per request.
const BATCH_SIZE = 50;
const BATCH_PACE_MS = 300;

const cache = new Map();
const listeners = [];
let warming = null;

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
 * Resolve the price, or null when no checked eShop sells it. Network errors
 * are not cached so a flaky moment does not hide prices for hours.
 */
export async function eshopPrice(nsuId, { fetchImpl = fetch, now = Date.now } = {}) {
  const id = String(nsuId ?? "");
  if (!NSU_ID_RE.test(id)) return null;
  const hit = cache.get(id);
  if (hit && now() - hit.at < (hit.value ? FOUND_TTL_MS : MISSING_TTL_MS)) return hit.value;
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
        return value;
      }
    } catch {
      failed = true;
    }
  }
  if (!failed) cache.set(id, { at: now(), value: null });
  return null;
}

export function clearPriceCache() {
  cache.clear();
}

const isFresh = (hit, now) => hit && now - hit.at < (hit.value ? FOUND_TTL_MS : MISSING_TTL_MS);

/**
 * The cached price without asking Nintendo: the price, null when no eShop
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
 * unknown so the next warm retries them. Returns how many prices changed.
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
      }
      if (paceMs) await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
    pending = unsold;
  }
  for (const id of pending) {
    if (failed.has(id)) continue;
    if (cache.get(id)?.value) changed++;
    cache.set(id, { at: now(), value: null });
  }
  return changed;
}

/**
 * Refreshes the given titles in the background unless their prices are fresh;
 * listeners hear about it when anything changed. One run at a time.
 */
export function warmPrices(nsuIds, opts = {}) {
  if (warming) return warming;
  const now = opts.now ?? Date.now;
  const stale = nsuIds.filter((id) => NSU_ID_RE.test(String(id)) && !isFresh(cache.get(String(id)), now()));
  if (!stale.length) return Promise.resolve(0);
  warming = fetchPrices(stale, opts)
    .then((changed) => {
      if (changed) for (const fn of listeners) fn();
      return changed;
    })
    .catch(() => 0)
    .finally(() => { warming = null; });
  return warming;
}
