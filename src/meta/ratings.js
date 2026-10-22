/**
 * One review score per base game, from the scores CookingFoil collects itself
 * (rating-sync). A release with its own title id (a Korean edition) borrows
 * from `siblings`, the releases sharing its eShop art; the best-sampled wins.
 */
import * as own from "./rating-sync.js";

// Steam's review summary, keyed by its English wording; clients pick the label
// for their own language.
export const SCORE_LABELS = {
  "Overwhelmingly Positive": { en: "Overwhelmingly Positive", ko: "압도적으로 긍정적", ja: "圧倒的に好評", zh: "好评如潮", "zh-Hant": "壓倒性好評", es: "Extremadamente positivas", fr: "Extrêmement positives", de: "Äußerst positiv", it: "Estremamente positive", pt: "Extremamente positivas", ru: "Крайне положительные", nl: "Overweldigend positief" },
  "Very Positive": { en: "Very Positive", ko: "매우 긍정적", ja: "非常に好評", zh: "特别好评", "zh-Hant": "極度好評", es: "Muy positivas", fr: "Très positives", de: "Sehr positiv", it: "Molto positive", pt: "Muito positivas", ru: "Очень положительные", nl: "Zeer positief" },
  Positive: { en: "Positive", ko: "긍정적", ja: "好評", zh: "好评", "zh-Hant": "好評", es: "Positivas", fr: "Positives", de: "Positiv", it: "Positive", pt: "Positivas", ru: "Положительные", nl: "Positief" },
  "Mostly Positive": { en: "Mostly Positive", ko: "대체로 긍정적", ja: "やや好評", zh: "多半好评", "zh-Hant": "大多好評", es: "Mayormente positivas", fr: "Plutôt positives", de: "Größtenteils positiv", it: "Perlopiù positive", pt: "Ligeiramente positivas", ru: "В основном положительные", nl: "Grotendeels positief" },
  Mixed: { en: "Mixed", ko: "복합적", ja: "賛否両論", zh: "褒贬不一", "zh-Hant": "褒貶不一", es: "Variadas", fr: "Moyennes", de: "Ausgeglichen", it: "Nella media", pt: "Neutras", ru: "Смешанные", nl: "Gemengd" },
  "Mostly Negative": { en: "Mostly Negative", ko: "대체로 부정적", ja: "やや不評", zh: "多半差评", "zh-Hant": "大多負評", es: "Mayormente negativas", fr: "Plutôt négatives", de: "Größtenteils negativ", it: "Perlopiù negative", pt: "Ligeiramente negativas", ru: "В основном отрицательные", nl: "Grotendeels negatief" },
  Negative: { en: "Negative", ko: "부정적", ja: "不評", zh: "差评", "zh-Hant": "負評", es: "Negativas", fr: "Négatives", de: "Negativ", it: "Negative", pt: "Negativas", ru: "Отрицательные", nl: "Negatief" },
  "Very Negative": { en: "Very Negative", ko: "매우 부정적", ja: "非常に不評", zh: "特别差评", "zh-Hant": "極度負評", es: "Muy negativas", fr: "Très négatives", de: "Sehr negativ", it: "Molto negative", pt: "Muito negativas", ru: "Очень отрицательные", nl: "Zeer negatief" },
  "Overwhelmingly Negative": { en: "Overwhelmingly Negative", ko: "압도적으로 부정적", ja: "圧倒的に不評", zh: "差评如潮", "zh-Hant": "壓倒性負評", es: "Extremadamente negativas", fr: "Extrêmement négatives", de: "Äußerst negativ", it: "Estremamente negative", pt: "Extremamente negativas", ru: "Крайне отрицательные", nl: "Overweldigend negatief" },
};

export function ratingOf(titleId, { siblings = [] } = {}) {
  return own.ratingOf(titleId) ?? siblings.map((id) => own.ratingOf(id)).filter(Boolean).sort((a, b) => b.count - a.count)[0] ?? null;
}
