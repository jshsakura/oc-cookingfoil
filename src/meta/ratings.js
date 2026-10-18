/**
 * One review score per base game, from the scores CookingFoil collects itself
 * (rating-sync). A release with its own title id (a Korean edition) borrows
 * from `siblings`, the releases sharing its eShop art; the best-sampled wins.
 */
import * as own from "./rating-sync.js";

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

export function ratingOf(titleId, { siblings = [] } = {}) {
  return own.ratingOf(titleId) ?? siblings.map((id) => own.ratingOf(id)).filter(Boolean).sort((a, b) => b.count - a.count)[0] ?? null;
}
