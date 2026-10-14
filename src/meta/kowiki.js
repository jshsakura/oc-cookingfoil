/**
 * Korean Wikipedia's lead paragraph for games English Wikipedia has an
 * article on: one Wikidata request turns up to BATCH English article titles
 * into their Korean articles, then each Korean article's summary is read.
 *
 * Wikipedia's text is CC BY-SA 4.0, so wherever it is shown ATTRIBUTION goes
 * with it (retro/meta/fields.js descriptionIn).
 */
const UA = "CookingFoil (https://github.com/jshsakura/oc-cookingfoil)";
const TIMEOUT_MS = 15 * 1000;
export const BATCH = 50;
const MIN_TEXT = 20;
const MAX_TEXT = 6000;
export const ATTRIBUTION = "출처: 위키백과 (CC BY-SA 4.0)";

// Pages in these namespaces are not articles ("1941: Counter Attack" is).
const NAMESPACES = /^(file|image|category|special|template|wikipedia|help|portal|talk|user|draft|module|media):/i;

/** MediaWiki's form of a title: spaces for underscores, the first letter in capitals. Pure. */
export const canonicalTitle = (t) => {
  const s = String(t ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
};

/** "https://en.wikipedia.org/wiki/Bubble_Bobble#Plot" → "Bubble Bobble"; null for any other page. Pure. */
export function enwikiTitle(url) {
  let u;
  try { u = new URL(String(url ?? "").trim()); } catch { return null; }
  if (!/^en\.(m\.)?wikipedia\.org$/i.test(u.hostname) || !u.pathname.startsWith("/wiki/")) return null;
  let title;
  try { title = canonicalTitle(decodeURIComponent(u.pathname.slice(6))); } catch { return null; }
  return title && !NAMESPACES.test(title) ? title : null;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.json();
}

/** Map(English title → Korean title) of the `titles` that have a Korean article. */
export async function koreanTitles(titles, { fetchImpl = fetch } = {}) {
  const out = new Map();
  const wanted = [...new Set(titles.map(canonicalTitle).filter(Boolean))];
  for (let i = 0; i < wanted.length; i += BATCH) {
    const q = new URLSearchParams({
      action: "wbgetentities", sites: "enwiki", titles: wanted.slice(i, i + BATCH).join("|"),
      props: "sitelinks", sitefilter: "enwiki|kowiki", format: "json",
    });
    const d = await getJson(`https://www.wikidata.org/w/api.php?${q}`, fetchImpl);
    for (const e of Object.values(d?.entities ?? {})) {
      const en = e?.sitelinks?.enwiki?.title;
      const ko = e?.sitelinks?.kowiki?.title;
      if (en && ko) out.set(canonicalTitle(en), ko);
    }
  }
  return out;
}

/** The Korean article's lead paragraph, or null (no such page, a disambiguation page, too short). */
export async function koreanSummary(title, { fetchImpl = fetch } = {}) {
  const path = encodeURIComponent(String(title).replace(/ /g, "_"));
  const d = await getJson(`https://ko.wikipedia.org/api/rest_v1/page/summary/${path}`, fetchImpl);
  if (!d || d.type !== "standard") return null;
  const text = String(d.extract ?? "").replace(/\r\n?/g, "\n").trim();
  return text.length >= MIN_TEXT ? text.slice(0, MAX_TEXT) : null;
}
