/**
 * Retro games across systems: what each listed game is (facts), the filter
 * values one system offers (facets) and the /games filters on them. The rows
 * of the retro home are made from the same facts (retro/menu.js).
 *
 *   facts = { id, work, system, genres: [genre key], styles: [style slug], arcadeStyle, players,
 *             simultaneous, cooperative, family, maker, series, year, korean, achievements,
 *             region, rating, ratingCount, addedAt (seconds, as the catalog has it), size }
 *
 * `work` is the game across consoles and versions (an arcade set's parent, else
 * its folded English title), so one game takes one place in the rows. Genres
 * are categories.js GENRE_LABELS keys, the same key in every language; outside
 * they travel as slugs ("Board Game" → "board-game"). Everything here is pure.
 */
import { genreLabel } from "../meta/categories.js";

const PLAYER_STEPS = [2, 3, 4];
const DECADE_MIN = 1970;
const REGION_RE = /^[a-z]+$/;
const FAMILY_ESRB = new Set(["EC", "E", "E10+"]);

/** A key as the API shows and takes it, [a-z0-9-]+: "Board Game" → "board-game", "Beat 'em Up" → "beat-em-up". */
export const genreSlug = (key) => String(key).toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Company names written several ways in the sources ("Sega of America", "Taito Corporation Japan").
const COMPANY_SUFFIX = /\b(co|ltd|inc|corp|corporation|enterprises|of america|of europe|japan|usa|europe|america|company|limited|k\.k|kk)\b\.?/gi;

/** The company a game is filed under: an arcade set's maker, else its developer, else its publisher, tidied. */
export function makerOf(record, arcade = false) {
  const raw = (arcade ? record?.publisher ?? record?.developer : record?.developer ?? record?.publisher) ?? "";
  const first = String(raw).split(/[;/]/)[0].replace(/\(.*?\)/g, "").replace(/,/g, " ");
  const name = first.replace(COMPANY_SUFFIX, " ").replace(/\s+/g, " ").trim();
  return name && genreSlug(name) ? name : null;
}

export const decadeOf = (year) => (year && year >= DECADE_MIN ? Math.floor(year / 10) * 10 : null);

/** A listed game's facts from its metadata record and what its versions say. */
export function factsOf(g, { record = null, korean = false, region = null, achievements = false, work = null } = {}) {
  const date = record?.releaseDate ?? null;
  const arcade = g.system === "arcade";
  return {
    id: g.id,
    work: work ?? g.id,
    system: g.system,
    genres: record?.genres ?? [],
    styles: record?.styles ?? [],
    arcadeStyle: record?.arcadeStyle ?? null,
    players: record?.numberOfPlayers ?? null,
    simultaneous: record?.simultaneous ?? null,
    cooperative: record?.cooperative === true,
    family: FAMILY_ESRB.has(record?.esrb),
    maker: record ? makerOf(record, arcade) : null,
    series: record?.series ?? null,
    year: date ? Math.floor(date / 10000) : null,
    korean,
    achievements,
    region,
    rating: g.rating ?? null,
    ratingCount: g.ratingCount ?? 0,
    addedAt: g.addedAt ?? 0,
    size: g.size ?? 0,
  };
}

const counted = (map) => [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

/** The filter values `list` offers with their counts; values nobody has are left out. */
export function facetsOf(list, lang = "en") {
  const genres = new Map();
  const decades = new Map();
  const regions = new Map();
  let korean = 0;
  let achievements = 0;
  for (const f of list) {
    for (const g of f.genres) bump(genres, g);
    const d = decadeOf(f.year);
    if (d) bump(decades, d);
    if (REGION_RE.test(f.region ?? "")) bump(regions, f.region);
    if (f.korean) korean++;
    if (f.achievements) achievements++;
  }
  const players = PLAYER_STEPS.map((value) => ({ value, count: list.filter((f) => (f.players ?? 0) >= value).length })).filter((p) => p.count);
  return {
    ...(genres.size ? { genres: counted(genres).map(([key, count]) => ({ key: genreSlug(key), name: genreLabel(key, lang), count })) } : {}),
    ...(players.length ? { players } : {}),
    ...(decades.size ? { decades: [...decades].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count })) } : {}),
    ...(regions.size ? { regions: counted(regions).map(([value, count]) => ({ value, count })) } : {}),
    ...(korean ? { korean } : {}),
    ...(achievements ? { achievements } : {}),
  };
}

const intParam = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

/**
 * The /games filter on facts: genre (keys, comma for any of them), players
 * (at least), decade (1990), region (kr), korean=1, achievements=1. Pure.
 */
export function factsFilter(query) {
  const genres = typeof query.genre === "string" && query.genre ? query.genre.split(",").map((s) => genreSlug(s.trim())).filter(Boolean) : null;
  const players = intParam(query.players);
  const decade = intParam(query.decade);
  const region = typeof query.region === "string" && query.region ? query.region.toLowerCase() : null;
  const korean = query.korean === "1";
  const achievements = query.achievements === "1";
  const any = genres || players !== null || decade !== null || region || korean || achievements;
  if (!any) return null;
  return (f) =>
    Boolean(f) &&
    (!genres || f.genres.some((g) => genres.includes(genreSlug(g)))) &&
    (players === null || (f.players ?? 0) >= players) &&
    (decade === null || decadeOf(f.year) === decade) &&
    (!region || f.region === region) &&
    (!korean || f.korean) &&
    (!achievements || f.achievements);
}
