/**
 * Retro games across systems: what each listed game is (facts), the filter
 * values one system offers (facets), the /games filters on them, and the
 * day's theme rows ("무슨 게임하지?").
 *
 *   facts = { id, work, system, genres: [genre key], players, year, korean, achievements,
 *             region, rating, ratingCount, addedAt }
 *
 * `work` is the game across consoles (its English title, folded), so Tetris on
 * the Game Boy and on the NES fill one place in the theme rows.
 *
 * Genres are categories.js GENRE_LABELS keys, the same key in every language.
 * Outside they travel as slugs ("Board Game" → "board-game"), so a theme row's
 * id leads straight to its filter. Everything here is pure.
 */
import { genreLabel } from "../meta/categories.js";

export const THEME_ROWS = 6;
export const THEME_GAMES = 12;
export const THEME_MIN = 8;
// The best rated this many of a theme are shuffled by day, so a row is not the same twelve every day.
const THEME_POOL = 36;
const HIDDEN_MIN_RATING = 80;
const CLASSIC_MIN_RATING = 90;
const PLAYER_STEPS = [2, 3, 4];
const DECADE_MIN = 1970;

const THEME_NAMES = {
  coop: { en: "Play together", ko: "둘이 같이 하기", ja: "ふたりで遊ぶ", zh: "一起玩" },
  korean: { en: "In Korean", ko: "한국어로 즐기기", ja: "韓国語で遊ぶ", zh: "韩文版" },
  achievements: { en: "With achievements", ko: "업적 도전", ja: "実績に挑戦", zh: "挑战成就" },
  hidden: { en: "Hidden gems", ko: "숨은 명작", ja: "隠れた名作", zh: "隐藏佳作" },
  classic: { en: "All-time greats", ko: "90점 넘는 명작", ja: "90点超えの名作", zh: "90分以上的经典" },
  decadeGenre: {
    en: ([d, g]) => `'${String(d).slice(2)}s ${g}`,
    ko: ([d, g]) => `${String(d).slice(2)}년대 ${g}`,
    ja: ([d, g]) => `${String(d).slice(2)}年代の${g}`,
    zh: ([d, g]) => `${String(d).slice(2)}年代${g}`,
  },
  recent: { en: "Just added", ko: "새로 들어온 게임", ja: "新しく追加", zh: "新加入" },
  decade: {
    en: (d) => `'${String(d).slice(2)}s classics`,
    ko: (d) => `${String(d).slice(2)}년대 명작`,
    ja: (d) => `${String(d).slice(2)}年代の名作`,
    zh: (d) => `${String(d).slice(2)}年代经典`,
  },
};

/** A genre key as the API shows and takes it, [a-z0-9-]+: "Board Game" → "board-game", "Beat 'em Up" → "beat-em-up". */
export const genreSlug = (key) => String(key).toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const REGION_RE = /^[a-z]+$/;

const nameIn = (names, lang, arg) => {
  const n = names[lang] ?? names.en;
  return typeof n === "function" ? n(arg) : n;
};

/** A listed game's facts from its metadata record and what its versions say. */
export function factsOf(g, { record = null, korean = false, region = null, achievements = false, work = null } = {}) {
  const date = record?.releaseDate ?? null;
  return {
    id: g.id,
    work: work ?? g.id,
    system: g.system,
    genres: record?.genres ?? [],
    players: record?.numberOfPlayers ?? null,
    year: date ? Math.floor(date / 10000) : null,
    korean,
    achievements,
    region,
    rating: g.rating ?? null,
    ratingCount: g.ratingCount ?? 0,
    addedAt: g.addedAt ?? 0,
  };
}

const decadeOf = (year) => (year && year >= DECADE_MIN ? Math.floor(year / 10) * 10 : null);
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

const byRating = (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.ratingCount - a.ratingCount || String(a.id).localeCompare(String(b.id));

/** A small seeded random source (mulberry32), so one day always picks the same. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffled = (list, rand) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Every theme `list` could fill, as { id, kind: "genre" | "other", name(lang), games: ordered facts }. */
function candidates(list) {
  const out = [];
  const genres = new Set(list.flatMap((f) => f.genres));
  for (const key of genres) out.push({ id: `genre:${genreSlug(key)}`, kind: "genre", name: (lang) => genreLabel(key, lang), games: list.filter((f) => f.genres.includes(key)).sort(byRating) });
  const other = (id, names, games, arg) => out.push({ id, kind: "other", name: (lang) => nameIn(names, lang, arg), games });
  other("coop", THEME_NAMES.coop, list.filter((f) => (f.players ?? 0) >= 2).sort(byRating));
  other("korean", THEME_NAMES.korean, list.filter((f) => f.korean).sort(byRating));
  other("achievements", THEME_NAMES.achievements, list.filter((f) => f.achievements).sort(byRating));
  // Well rated by few: a high score that not many people have found.
  other("hidden", THEME_NAMES.hidden, list.filter((f) => (f.rating ?? 0) >= HIDDEN_MIN_RATING && f.ratingCount > 0).sort((a, b) => a.ratingCount - b.ratingCount || byRating(a, b)));
  other("recent", THEME_NAMES.recent, [...list].sort((a, b) => b.addedAt - a.addedAt || byRating(a, b)));
  other("classic", THEME_NAMES.classic, list.filter((f) => (f.rating ?? 0) >= CLASSIC_MIN_RATING).sort(byRating));
  const decades = new Set(list.map((f) => decadeOf(f.year)).filter(Boolean));
  for (const d of decades) {
    const inDecade = list.filter((f) => decadeOf(f.year) === d);
    other(`decade:${d}`, THEME_NAMES.decade, inDecade.sort(byRating), d);
    // A decade and a genre together ("90년대 RPG").
    for (const key of genres) {
      const games = inDecade.filter((f) => f.genres.includes(key));
      if (games.length) out.push({ id: `decade:${d}:genre:${genreSlug(key)}`, kind: "other", name: (lang) => nameIn(THEME_NAMES.decadeGenre, lang, [d, genreLabel(key, lang)]), games: games.sort(byRating) });
    }
  }
  return out;
}

/**
 * The day's theme rows: at most `rows`, `per` games each, no game in two rows,
 * none with fewer than `min`. Genre themes and the others take turns, in an
 * order fixed by `day` (days since the epoch), so the big genres do not
 * crowd the top and the same day always answers the same.
 */
export function pickThemes(list, { day = 0, lang = "en", rows = THEME_ROWS, per = THEME_GAMES, min = THEME_MIN } = {}) {
  const rand = seeded(day * 2654435761);
  const all = candidates(list).filter((t) => t.games.length >= min);
  const genre = shuffled(all.filter((t) => t.kind === "genre"), rand);
  const other = shuffled(all.filter((t) => t.kind === "other"), rand);
  const order = [];
  for (let first = rand() < 0.5 ? other : genre, second = first === other ? genre : other; first.length || second.length;) {
    if (first.length) order.push(first.shift());
    if (second.length) order.push(second.shift());
  }
  const used = new Set();
  const out = [];
  for (const t of order) {
    if (out.length >= rows) break;
    const seen = new Set(used);
    const fresh = t.games.filter((f) => !seen.has(f.work) && seen.add(f.work));
    // "recent" keeps its order; the rest shuffle their best by day.
    const pool = t.id === "recent" ? fresh : shuffled(fresh.slice(0, THEME_POOL), rand);
    const games = pool.slice(0, per);
    if (games.length < min) continue;
    for (const f of games) used.add(f.work);
    out.push({ id: t.id, name: t.name(lang), games });
  }
  return out;
}
