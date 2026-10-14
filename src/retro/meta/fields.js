/**
 * Retro game metadata in the shape the regular game detail uses
 * (src/routes/title-detail.js), from what LaunchBox, MAME and IGDB call things:
 *
 *   record = { source, id?, description?: { en, ko?, ja?, zh? }, publisher?, developer?,
 *              releaseDate?: YYYYMMDD, numberOfPlayers?, genres?: [genre key], shots?: [image URL],
 *              wiki?: English Wikipedia title, koFrom?: "wikipedia", koTriedAt?: ms }
 *
 * description.ko comes from Korean Wikipedia (meta/kowiki.js, by `wiki`); koFrom
 * says so, and the text is shown with Wikipedia's attribution. koTriedAt is
 * when Korean Wikipedia last had nothing for the game.
 *
 * A field a source doesn't know is left out, never stored empty. Genres are
 * the keys of categories.js GENRE_LABELS, so every one has a label in en, ko,
 * ja and zh; a source's genre with no such key is dropped. Everything here is pure.
 */
import { GENRE_LABELS, GENRE_LANGS, genreLabel } from "../../meta/categories.js";
import { ATTRIBUTION, enwikiTitle } from "../../meta/kowiki.js";

export const MAX_SHOTS = 8;
const MAX_GENRES = 4;
const MAX_TEXT = 6000;
const MAX_PLAYERS = 64;
const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

const LAUNCHBOX_SHOT_TYPES = ["Screenshot - Gameplay", "Screenshot - Game Title", "Screenshot - Game Select", "Screenshot - High Scores", "Screenshot - Game Over"];
export const SHOT_TYPES = new Set(LAUNCHBOX_SHOT_TYPES);
const LAUNCHBOX_IMAGES = "https://images.launchbox-app.com/";
const IGDB_IMAGES = "https://images.igdb.com/igdb/image/upload/t_screenshot_big/";

// Genre names of each source → GENRE_LABELS keys (lower case).
const GENRE_MAP = {
  action: "Action", adventure: "Adventure", shooter: "Shooter", platform: "Platformer", puzzle: "Puzzle",
  "role-playing": "RPG", "role-playing (rpg)": "RPG", mmo: "RPG", strategy: "Strategy", sports: "Sports", sport: "Sports",
  racing: "Racing", driving: "Racing", education: "Education", fighting: "Fighting", fighter: "Fighting",
  "board game": "Board Game", "card & board game": "Board Game", tabletop: "Board Game",
  "construction and management simulation": "Simulation", "life simulation": "Simulation", "flight simulator": "Simulation",
  "vehicle simulation": "Simulation", simulator: "Simulation", sandbox: "Simulation",
  music: "Music", party: "Party", quiz: "Party", "quiz/trivia": "Party",
  "beat 'em up": "Action", "hack and slash/beat 'em up": "Action", stealth: "Action", maze: "Action", climbing: "Platformer",
  "visual novel": "Adventure", "point-and-click": "Adventure", horror: "Adventure",
  pinball: "Arcade", arcade: "Arcade", "ball & paddle": "Arcade",
  "turn-based strategy (tbs)": "Strategy", "real time strategy (rts)": "Strategy", tactical: "Strategy",
};

const text = (v) => {
  const s = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
  return s ? s.slice(0, MAX_TEXT) : null;
};

/** Genre keys for source names, known ones only, without repeats. */
export function genreKeys(names) {
  const keys = (names ?? []).map((n) => GENRE_MAP[String(n).trim().toLowerCase()] ?? (GENRE_LABELS[String(n).trim()] ? String(n).trim() : null)).filter(Boolean);
  const unique = [...new Set(keys)].slice(0, MAX_GENRES);
  return unique.length ? unique : null;
}

const validYear = (y) => Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR;

/** "1994-12-01" (or with a time after it) → 19941201; a year alone → YYYY0000. */
export function releaseDateInt(date, year = null) {
  const y = Number.parseInt(year, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));
  if (m && validYear(Number(m[1])) && (!validYear(y) || Number(m[1]) === y)) return Number(`${m[1]}${m[2]}${m[3]}`);
  return validYear(y) ? y * 10000 : null;
}

export function playersInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PLAYERS ? n : null;
}

/** Drops the fields that are null, so an unknown field is absent. */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

/** A LaunchBox <Game> (with its images: [{ FileName, Type }]) → record. */
export function fromLaunchBox(game, images = []) {
  const overview = text(game.Overview);
  const shots = LAUNCHBOX_SHOT_TYPES.flatMap((type) => images.filter((i) => i.Type === type && /^[\w.-]+$/.test(i.FileName ?? "")))
    .slice(0, MAX_SHOTS).map((i) => LAUNCHBOX_IMAGES + i.FileName);
  return compact({
    source: "launchbox",
    id: game.DatabaseID ? String(game.DatabaseID) : null,
    description: overview ? { en: overview } : null,
    publisher: text(game.Publisher),
    developer: text(game.Developer),
    releaseDate: releaseDateInt(game.ReleaseDate, game.ReleaseYear),
    numberOfPlayers: playersInt(game.MaxPlayers),
    genres: genreKeys(String(game.Genres ?? "").split(";")),
    shots: shots.length ? shots : null,
    wiki: enwikiTitle(game.WikipediaURL),
  });
}

/** A MAME entry from LaunchBox's Mame.xml → record (no description or pictures there). */
export function fromMame(m) {
  const players = /(\d+)P/.exec(String(m.PlayMode ?? ""));
  return compact({
    source: "mame",
    publisher: text(m.Publisher),
    developer: text(m.Developer),
    releaseDate: /^\d{4}$/.test(String(m.Year ?? "")) ? releaseDateInt(null, m.Year) : null,
    numberOfPlayers: players ? playersInt(players[1]) : null,
    genres: genreKeys([String(m.Genre ?? "").split("/")[0]]),
  });
}

/** An IGDB game (with the expanded fields igdb.js asks for) → record. */
export function fromIgdb(g) {
  const companies = g.involved_companies ?? [];
  const company = (role) => text(companies.filter((c) => c[role]).map((c) => c.company?.name).filter(Boolean).join(", "));
  const modes = g.multiplayer_modes ?? [];
  const most = Math.max(0, ...modes.flatMap((m) => [m.offlinemax, m.offlinecoopmax]).filter(Number.isInteger));
  const single = (g.game_modes ?? []).length > 0 && (g.game_modes ?? []).every((m) => m.slug === "single-player");
  const date = Number.isInteger(g.first_release_date) ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null;
  const shots = (g.screenshots ?? []).map((s) => s.image_id).filter((id) => /^\w+$/.test(id ?? "")).slice(0, MAX_SHOTS).map((id) => `${IGDB_IMAGES}${id}.jpg`);
  const summary = text(g.summary);
  return compact({
    source: "igdb",
    id: g.id ? String(g.id) : null,
    description: summary ? { en: summary } : null,
    publisher: company("publisher"),
    developer: company("developer"),
    releaseDate: date ? releaseDateInt(date) : null,
    numberOfPlayers: most > 0 ? playersInt(most) : single ? 1 : null,
    genres: genreKeys((g.genres ?? []).map((x) => x.name)),
    shots: shots.length ? shots : null,
  });
}

/** `base`'s fields, with the ones it lacks taken from `extra` (not its source or id). */
export function fillFrom(base, extra) {
  if (!extra) return base;
  const { source: _s, id: _i, ...rest } = extra;
  return { ...rest, ...base };
}

/** The description in `lang`, else English; null without one. Wikipedia's text carries its attribution. */
export function descriptionIn(record, lang) {
  const d = record?.description;
  if (!d) return null;
  if (lang === "ko" && d.ko && record.koFrom === "wikipedia") return `${d.ko}\n\n${ATTRIBUTION}`;
  return (GENRE_LANGS.includes(lang) && d[lang]) || d.en || null;
}

/**
 * The detail fields a record gives, in the request's language, each only
 * when known. `shotUrls` are the screenshots on disk, already versioned.
 */
export function detailFields(record, lang, shotUrls = []) {
  const genres = record?.genres?.map((k) => genreLabel(k, lang));
  return compact({
    description: descriptionIn(record, lang),
    publisher: record?.publisher ?? null,
    developer: record?.developer ?? null,
    releaseDate: Number.isInteger(record?.releaseDate) ? record.releaseDate : null,
    numberOfPlayers: Number.isInteger(record?.numberOfPlayers) ? record.numberOfPlayers : null,
    genres: genres?.length ? genres : null,
    screenshots: shotUrls.length ? shotUrls.slice(0, MAX_SHOTS) : null,
  });
}
