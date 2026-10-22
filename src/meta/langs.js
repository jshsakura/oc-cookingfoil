/**
 * The languages clients show, and how a request picks one.
 *
 * A request names its language with ?lang= or Accept-Language. "zh" is
 * simplified Chinese and "zh-Hant" traditional (zh-TW, zh-HK and zh-MO too).
 * A language this server does not know is English, never the server's own
 * first language, so a Spanish client is never shown Korean.
 *
 * Text kept per language falls back the same way everywhere (pick): the language
 * asked for, then English. Simplified and traditional Chinese never stand in for
 * each other, as the client's own fallback does not either.
 */
export const LANGS = ["en", "ko", "ja", "zh", "zh-Hant", "es", "fr", "de", "it", "pt", "ru", "nl"];

const TRADITIONAL_REGIONS = new Set(["tw", "hk", "mo"]);

/**
 * The language a tag ("ko-KR", "zh-Hant-TW", "pt-BR") names, or null for one not
 * in LANGS. Chinese goes by its script subtag, else by its region. Pure.
 */
export function parseLang(tag) {
  const parts = String(tag ?? "").trim().toLowerCase().split(/[-_]/);
  if (parts[0] === "zh") {
    const rest = parts.slice(1);
    if (rest.includes("hans")) return "zh";
    return rest.includes("hant") || rest.some((p) => TRADITIONAL_REGIONS.has(p)) ? "zh-Hant" : "zh";
  }
  return LANGS.includes(parts[0]) ? parts[0] : null;
}

/** The languages of an Accept-Language header, most wanted first. Pure. */
function accepted(header) {
  return String(header ?? "").split(",")
    .map((part, i) => {
      const [tag, ...params] = part.split(";");
      const q = Number(params.map((p) => p.trim()).find((p) => p.startsWith("q="))?.slice(2) ?? 1);
      return { tag, q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}

/** The request's language: ?lang= when given (English if unknown), else the first known in Accept-Language, else English. */
export function requestLang(req) {
  const raw = req.query?.lang;
  // ?lang=a&lang=b arrives as a list; the first one is what was asked.
  const asked = Array.isArray(raw) ? raw[0] : raw;
  if (typeof asked === "string" && asked !== "") return parseLang(asked) ?? "en";
  for (const tag of accepted(req.get?.("accept-language"))) {
    const lang = parseLang(tag);
    if (lang) return lang;
  }
  return "en";
}

/** Where `lang` looks for text, in order. Pure. */
export const fallbacks = (lang) => [...new Set([lang, "en"])];

/** The key of a fixed text table ({ en, ko, ... }) to answer `lang` with: its fallbacks, else English. Pure. */
export const tableLang = (table, lang) => fallbacks(lang).find((l) => table[l]) ?? "en";

/** `texts[lang]` with the fallbacks, or null. Pure. */
export function pick(texts, lang) {
  if (!texts) return null;
  for (const l of fallbacks(lang)) if (texts[l] != null && texts[l] !== "") return texts[l];
  return null;
}
