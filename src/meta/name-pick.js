/**
 * When the game's own file names it better than titledb does.
 *
 * titledb only has the names of the regions a game was sold in, so a game sold
 * in Japan alone has its Japanese name there, while the NACP inside the file
 * (an Asian release, an Arcade Archives title) often carries a Korean or an
 * English title too. With the languages in order (COOK_LANG_PRIORITY, ko, en,
 * ja by default) the file's title wins when its language comes before every
 * language titledb has. The language of a file's title is read from its script:
 * Hangul is ko, kana is ja, Han alone is zh, anything else en.
 */

import { parseLang } from "./langs.js";

const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const KANA_RE = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HAN_RE = /[㐀-䶿一-鿿]/;

/** The language a title is written in, by its script: "ko", "ja", "zh" or "en". Pure. */
export function scriptLang(name) {
  const s = String(name ?? "");
  if (HANGUL_RE.test(s)) return "ko";
  if (KANA_RE.test(s)) return "ja";
  if (HAN_RE.test(s)) return "zh";
  return "en";
}

const rankIn = (priority) => {
  // "en-US" ranks as en, "zh-TW" and "zh-Hant" as zh-Hant: the keys titledb's names use.
  const order = priority.map((l) => parseLang(l) ?? String(l).split("-")[0].toLowerCase());
  return (lang) => {
    const i = order.indexOf(lang);
    return i === -1 ? Infinity : i;
  };
};

/**
 * The file's titles (`own`, any number, empty ones skipped) whose language comes
 * before every language in `titledbNames`, as { lang: name }, best first. Pure.
 */
export function fileNamesOver(titledbNames, own, priority) {
  const rank = rankIn(priority);
  const best = Math.min(Infinity, ...Object.entries(titledbNames ?? {}).filter(([, v]) => v).map(([l]) => rank(l)));
  const out = {};
  for (const raw of own ?? []) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) continue;
    const lang = scriptLang(name);
    if (rank(lang) < best && !(lang in out)) out[lang] = name;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => rank(a) - rank(b)));
}

/** The file's title to show instead of titledb's, or null when titledb's is as good. Pure. */
export function pickFileName(titledbNames, own, priority) {
  return Object.values(fileNamesOver(titledbNames, own, priority))[0] ?? null;
}
