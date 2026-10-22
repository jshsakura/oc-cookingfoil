/**
 * Finding a game by what an admin types: part of any of its names (every language the server has,
 * case, spaces, punctuation and accents ignored), Korean initial consonants ("ㅁㅇㅂㅇ" for 모여봐요),
 * or part of its title ID. Pure; library-games.js feeds it the library.
 */

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const SYLLABLES_PER_INITIAL = 588;
const CONSONANTS_ONLY_RE = /^[ㄱ-ㅎ]+$/;
const HEX_RE = /^[0-9a-f]+$/;
// Shorter hex runs are ordinary words ("ace", "bad") far more often than a title ID being typed.
const MIN_ID_PART = 4;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// Lower rank sorts first.
const RANK = { idExact: 0, namePrefix: 1, nameIn: 2, idIn: 3, initialsPrefix: 4, initialsIn: 5 };

/** Lowercase, accents and everything but letters and digits dropped. Not NFKC: it turns ㅁ into a conjoining jamo. */
export function fold(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The initial consonant of each Hangul syllable, other letters kept: "동물의 숲" -> "ㄷㅁㅇㅅ". */
export function choseong(text) {
  let out = "";
  for (const ch of fold(text)) {
    const code = ch.codePointAt(0);
    out += code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST ? CHOSEONG[Math.floor((code - SYLLABLE_FIRST) / SYLLABLES_PER_INITIAL)] : ch;
  }
  return out;
}

const namesOfGame = (game) => [...new Set([game.name, ...Object.values(game.names ?? {})].filter((n) => typeof n === "string" && n.trim()))];

/** How well one game matches the folded query: { rank, matched } or null. */
function matchGame(game, q) {
  const id = String(game.titleId).toLowerCase();
  if (id === q) return { rank: RANK.idExact, matched: null };
  let best = null;
  const take = (rank, name) => {
    if (!best || rank < best.rank) best = { rank, matched: name };
  };
  const initialsOnly = CONSONANTS_ONLY_RE.test(q);
  for (const name of namesOfGame(game)) {
    const folded = fold(name);
    if (folded.startsWith(q)) take(RANK.namePrefix, name);
    else if (folded.includes(q)) take(RANK.nameIn, name);
    if (!initialsOnly) continue;
    const initials = choseong(name);
    if (initials.startsWith(q)) take(RANK.initialsPrefix, name);
    else if (initials.includes(q)) take(RANK.initialsIn, name);
  }
  if (q.length >= MIN_ID_PART && HEX_RE.test(q) && id.includes(q)) take(RANK.idIn, null);
  return best;
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), "ko");

/**
 * Games matching `query`, best first then by name, at most `limit`: { total, items: [{ titleId, name,
 * matched? }] }. `matched` is the name that matched when it is not the one shown. An empty query
 * lists every game by name.
 */
export function searchGames(games, query, { limit = DEFAULT_LIMIT } = {}) {
  const cap = Math.min(Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT), MAX_LIMIT);
  const q = fold(query);
  const hits = q
    ? games.map((game) => ({ game, hit: matchGame(game, q) })).filter((x) => x.hit)
      .sort((a, b) => a.hit.rank - b.hit.rank || byName(a.game, b.game))
    : [...games].sort(byName).map((game) => ({ game, hit: null }));
  const items = hits.slice(0, cap).map(({ game, hit }) => ({
    titleId: game.titleId,
    name: game.name,
    ...(hit?.matched && hit.matched !== game.name ? { matched: hit.matched } : {}),
  }));
  return { total: hits.length, items };
}
