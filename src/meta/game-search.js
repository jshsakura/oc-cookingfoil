/**
 * Finding a game by what an admin types: part of any of its names (every language the server has,
 * case, width, spaces, punctuation and Latin accents ignored), Korean initial consonants ("ㅁㅇㅂㅇ"
 * for 모여봐요), or part of its title ID. Pure; library-games.js feeds it the library and keeps the
 * index between requests.
 *
 * Korean is compared key by key (jamo), the way it is typed, so a word caught halfway by the input
 * method still finds its game: "젤ㄷ" finds 젤다, "모엽" (모여 with the next ㅂ stuck on as a final)
 * finds 모여봐요, "모여보" finds 모여봐요.
 */

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
// Vowels and finals as the keys that type them: 봐 is ㅂ ㅗ ㅏ, 닭 is ㄷ ㅏ ㄹ ㄱ.
const JUNGSEONG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅗㅏ", "ㅗㅐ", "ㅗㅣ", "ㅛ", "ㅜ", "ㅜㅓ", "ㅜㅔ", "ㅜㅣ", "ㅠ", "ㅡ", "ㅡㅣ", "ㅣ"];
const JONGSEONG = ["", "ㄱ", "ㄲ", "ㄱㅅ", "ㄴ", "ㄴㅈ", "ㄴㅎ", "ㄷ", "ㄹ", "ㄹㄱ", "ㄹㅁ", "ㄹㅂ", "ㄹㅅ", "ㄹㅌ", "ㄹㅍ", "ㄹㅎ", "ㅁ", "ㅂ", "ㅂㅅ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
// A lone compound jamo the input method shows before the next syllable takes part of it.
const COMPOUND_JAMO = {
  ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ",
  ㅘ: "ㅗㅏ", ㅙ: "ㅗㅐ", ㅚ: "ㅗㅣ", ㅝ: "ㅜㅓ", ㅞ: "ㅜㅔ", ㅟ: "ㅜㅣ", ㅢ: "ㅡㅣ",
};
const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const SYLLABLES_PER_INITIAL = 588;
const FINALS = 28;
const CONSONANTS_ONLY_RE = /^[ㄱ-ㅎ]+$/;
const HEX_RE = /^[0-9a-f]+$/;
// A whole title ID inside what was typed, such as the "name [ID]" a picker fills in, even with the "]" gone.
const WHOLE_ID_RE = /(?:^|[^0-9a-f])([0-9a-f]{16})(?![0-9a-f])/i;
// Shorter hex runs are years and numbers in titles ("1945", "2048") far more often than a title ID being typed.
const MIN_ID_PART = 6;
// Combining marks dropped from Latin letters; Japanese voiced marks (゛゜) stay, so ハ, バ and パ differ.
const MARK_RE = /\p{M}/gu;
const VOICED_MARKS = new Set(["\u3099", "\u309a"]);
const dropAccent = (mark) => (VOICED_MARKS.has(mark) ? mark : "");
// Fullwidth Latin and halfwidth katakana, which NFKC turns into the usual forms. Not NFKC on the
// whole text: it would turn a typed ㅁ into a conjoining jamo.
const WIDTH_RE = /[\uff01-\uff5e\uff61-\uff9f]+/g;
const MAX_QUERY = 200;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const SORTS = ["name", "recent"];

// Lower rank sorts first.
const RANK = { idExact: 0, namePrefix: 1, nameIn: 2, idIn: 3, initialsPrefix: 4, initialsIn: 5 };

/** Lowercase, width and Latin accents folded, everything but letters and digits dropped. */
export function fold(text) {
  return String(text ?? "").replace(WIDTH_RE, (s) => s.normalize("NFKC")).normalize("NFD").replace(MARK_RE, dropAccent)
    .normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const syllable = (ch) => {
  const code = ch.codePointAt(0);
  return code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST ? code - SYLLABLE_FIRST : -1;
};

/** The initial consonant of each Hangul syllable, other letters kept: "동물의 숲" -> "ㄷㅁㅇㅅ". */
export function choseong(text) {
  let out = "";
  for (const ch of fold(text)) {
    const s = syllable(ch);
    out += s < 0 ? ch : CHOSEONG[Math.floor(s / SYLLABLES_PER_INITIAL)];
  }
  return out;
}

/** Folded text with Hangul spelled out key by key: "모여봐" -> "ㅁㅗㅇㅕㅂㅗㅏ". */
export function jamo(text) {
  let out = "";
  for (const ch of fold(text)) {
    const s = syllable(ch);
    if (s < 0) out += COMPOUND_JAMO[ch] ?? ch;
    else out += CHOSEONG[Math.floor(s / SYLLABLES_PER_INITIAL)] + JUNGSEONG[Math.floor((s % SYLLABLES_PER_INITIAL) / FINALS)] + JONGSEONG[s % FINALS];
  }
  return out;
}

const namesOfGame = (game) => {
  const extra = Array.isArray(game.names) ? game.names : Object.values(game.names ?? {});
  return [...new Set([game.name, ...extra].filter((n) => typeof n === "string" && n.trim()))];
};

const collator = new Intl.Collator("ko");

/**
 * Everything a search needs, worked out once per library: games [{ titleId, name, names, edited,
 * added }] in, an index out. `added` is when the game came into the library (epoch seconds), for
 * the "recently added" order.
 */
export function buildIndex(games) {
  const entries = games.map((game) => ({
    titleId: game.titleId,
    id: String(game.titleId).toLowerCase(),
    name: game.name ?? "",
    edited: game.edited === true,
    added: Number(game.added) || 0,
    names: namesOfGame(game).map((name) => ({ name, keys: jamo(name), initials: choseong(name) })),
  }));
  const byName = [...entries].sort((a, b) => collator.compare(a.name, b.name));
  byName.forEach((e, i) => { e.nameAt = i; });
  const byRecent = [...byName].sort((a, b) => b.added - a.added || a.nameAt - b.nameAt);
  byRecent.forEach((e, i) => { e.recentAt = i; });
  return { byName, byRecent };
}

/** How well one game matches: the rank and the name that matched, or null. */
function matchEntry(entry, q) {
  if (q.id) return entry.id === q.id ? { rank: RANK.idExact, matched: null } : null;
  if (entry.id === q.text) return { rank: RANK.idExact, matched: null };
  let rank = Infinity;
  let matched = null;
  for (const n of entry.names) {
    let r = Infinity;
    if (q.initialsOnly) {
      if (n.initials.startsWith(q.text)) r = RANK.initialsPrefix;
      else if (n.initials.includes(q.text)) r = RANK.initialsIn;
    } else if (n.keys.startsWith(q.keys)) r = RANK.namePrefix;
    else if (n.keys.includes(q.keys)) r = RANK.nameIn;
    if (r < rank) [rank, matched] = [r, n.name];
  }
  if (q.idPart && RANK.idIn < rank && entry.id.includes(q.text)) [rank, matched] = [RANK.idIn, null];
  return rank === Infinity ? null : { rank, matched };
}

function parseQuery(query) {
  const raw = String(query ?? "").slice(0, MAX_QUERY);
  const whole = WHOLE_ID_RE.exec(raw);
  if (whole) return { id: whole[1].toLowerCase() };
  const text = fold(raw);
  if (!text) return null;
  return {
    text,
    keys: jamo(text),
    initialsOnly: CONSONANTS_ONLY_RE.test(text),
    idPart: text.length >= MIN_ID_PART && HEX_RE.test(text),
  };
}

const clamp = (n, lo, hi, fallback) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(Math.max(lo, v), hi) : fallback;
};

/**
 * Games matching `query`, best first then in `sort` order ("name" or "recent"), `limit` of them
 * from `offset`: { total, offset, items: [{ titleId, name, edited, matched? }] }. `matched` is the
 * name that matched when it is not the one shown. An empty query lists every game.
 */
export function searchIndex(index, query, { limit = DEFAULT_LIMIT, offset = 0, sort = "name" } = {}) {
  const cap = clamp(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const from = clamp(offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const recent = sort === "recent";
  const order = recent ? index.byRecent : index.byName;
  const q = parseQuery(query);
  let hits;
  if (!q) hits = order.map((entry) => ({ entry, hit: null }));
  else {
    hits = [];
    for (const entry of order) {
      const hit = matchEntry(entry, q);
      if (hit) hits.push({ entry, hit });
    }
    // Stable: equal ranks keep the chosen order.
    hits.sort((a, b) => a.hit.rank - b.hit.rank);
  }
  const items = hits.slice(from, from + cap).map(({ entry, hit }) => ({
    titleId: entry.titleId,
    name: entry.name,
    edited: entry.edited,
    ...(hit?.matched && hit.matched !== entry.name ? { matched: hit.matched } : {}),
  }));
  return { total: hits.length, offset: from, items };
}

/** searchIndex over a list built on the spot, for callers that search once. */
export function searchGames(games, query, options) {
  return searchIndex(buildIndex(games), query, options);
}
