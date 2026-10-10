/**
 * One review score per base game from every source we have: oc-scraper's
 * (COOK_RATINGS_URL) and the ones CookingFoil collects itself (rating-sync).
 * When both have one, the better-sampled score (more reviews) wins.
 */
import * as scraper from "./scraper-ratings.js";
import * as own from "./rating-sync.js";

export function ratingOf(titleId, { siblings = [] } = {}) {
  const fromScraper = scraper.ratingOf(titleId, { siblings });
  const fromOwn = own.ratingOf(titleId) ?? siblings.map((id) => own.ratingOf(id)).filter(Boolean).sort((a, b) => b.count - a.count)[0] ?? null;
  return [fromScraper, fromOwn].filter(Boolean).sort((a, b) => b.count - a.count)[0] ?? null;
}

export { SCORE_LABELS } from "./scraper-ratings.js";
