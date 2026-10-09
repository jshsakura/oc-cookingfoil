// eShop price for a title, from Nintendo's public price endpoint, keyed by the
// titledb nsuId. The merged titledb prefers Korean records, so KR is asked
// first; titles only another region sells fall back to US then JP.
const ENDPOINT = "https://api.ec.nintendo.com/v1/price";
const COUNTRIES = [["KR", "ko"], ["US", "en"], ["JP", "ja"]];
const FOUND_TTL_MS = 12 * 60 * 60 * 1000;
const MISSING_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3000;
const NSU_ID_RE = /^\d{14}$/;

const cache = new Map();

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
