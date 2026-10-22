/**
 * The retro home's rows, a menu dealt anew each time the tab opens: what is
 * new, the arcade of back then, games to play together, then genres, eras,
 * the well rated, makers and the rest. Made from the games' facts
 * (retro/themes.js) and nothing else, so every row fills itself from the
 * collected metadata.
 *
 *   row = { id, group, name(lang), games: [facts] }
 *
 * menuRows makes the pool of rows once per facts; pickMenu deals from it for a
 * seed, so one seed always gives the same menu and a cursor can carry it on.
 * The client draws the rows in the order given, so the order is the design:
 * "recent" first when there is one, then one arcade row and one row to play
 * together (which of the two leads is up to the seed), then the groups in
 * turns. In a row the games are drawn from the top, middle and bottom of its
 * ranking, so a row is not the same best twelve every time, at most three of
 * one console when others are there, and one game (its work) takes one place
 * across all rows. Rows under MENU_MIN after that are left out. Pure.
 */
import { genreLabel } from "../meta/categories.js";
import { decadeOf, genreSlug } from "./themes.js";

export const MENU_GAMES = 12;
export const MENU_MIN = 8;
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
// facts.addedAt is in seconds, as the catalog keeps it.
const addedMs = (f) => f.addedAt * 1000;
const CLASSIC_RATING = 90;
const GOOD_RATING = 80;
const PER_SYSTEM = 3;
// How many of a row's twelve come from the top, middle and bottom third of its ranking.
const TIERS = [5, 4, 3];
// The turns after the first rows: genres twice as often as the rest.
const CYCLE = ["genre", "genre", "era", "fame", "play", "maker", "arcade", "together"];

export const STYLE_NAMES = {
  "beat-em-up": { en: "Beat 'em up", ko: "벨트스크롤 액션", ja: "ベルトスクロールアクション", zh: "清版动作" },
  "visual-novel": { en: "Visual novel", ko: "비주얼 노벨", ja: "ビジュアルノベル", zh: "视觉小说" },
  "management-sim": { en: "Management sim", ko: "경영 시뮬레이션", ja: "経営シミュレーション", zh: "经营模拟" },
  "life-sim": { en: "Life sim", ko: "육성 시뮬레이션", ja: "育成シミュレーション", zh: "养成模拟" },
  compilation: { en: "Compilations", ko: "모음집", ja: "コレクション", zh: "合集" },
  stealth: { en: "Stealth", ko: "잠입 액션", ja: "ステルス", zh: "潜行" },
  horror: { en: "Horror", ko: "호러", ja: "ホラー", zh: "恐怖" },
  "versus-fighter": { en: "Versus fighting", ko: "대전 격투", ja: "対戦格闘", zh: "对战格斗" },
  "vertical-shmup": { en: "Vertical shooters", ko: "종스크롤 슈팅", ja: "縦スクロールシューティング", zh: "纵版射击" },
  "horizontal-shmup": { en: "Horizontal shooters", ko: "횡스크롤 슈팅", ja: "横スクロールシューティング", zh: "横版射击" },
  "run-and-gun": { en: "Run and gun", ko: "런앤건", ja: "ランアンドガン", zh: "跑射" },
  platformer: { en: "Platformers", ko: "플랫포머", ja: "プラットフォーマー", zh: "平台" },
  lightgun: { en: "Light gun", ko: "건 슈팅", ja: "ガンシューティング", zh: "光枪射击" },
  puzzle: { en: "Puzzle", ko: "퍼즐", ja: "パズル", zh: "益智" },
  racing: { en: "Racing", ko: "레이싱", ja: "レース", zh: "竞速" },
  sports: { en: "Sports", ko: "스포츠", ja: "スポーツ", zh: "运动" },
  maze: { en: "Maze", ko: "미로", ja: "迷路", zh: "迷宫" },
};

const yy = (d) => String(d).slice(2);
// The same words as the console's Switch home rows (최근 추가, 한국어 지원, 2인 이상 플레이, …)
// where the idea is the same; the rest in the same plain style.
const NAMES = {
  recent: { en: "Recently added", ko: "최근 추가", ja: "最近追加", zh: "最近添加" },
  arcade: { en: "Arcade games", ko: "오락실 게임", ja: "アーケードゲーム", zh: "街机游戏" },
  arcadeDecade: { en: (d) => `'${yy(d)}s arcade`, ko: (d) => `${yy(d)}년대 오락실`, ja: (d) => `${yy(d)}年代のアーケード`, zh: (d) => `${yy(d)}年代街机` },
  arcadeStyle: { en: (s) => `Arcade ${s.toLowerCase()}`, ko: (s) => `오락실 ${s}`, ja: (s) => `アーケードの${s}`, zh: (s) => `街机${s}` },
  players2: { en: "2+ players", ko: "2인 이상 플레이", ja: "2人以上", zh: "2 人以上" },
  players4: { en: "4+ players", ko: "4인 이상 플레이", ja: "4人以上", zh: "4 人以上" },
  coop: { en: "Better together", ko: "함께 하면 더 재미있는 게임", ja: "みんなで遊ぶともっと楽しい", zh: "一起玩更有趣" },
  versus: { en: "Versus", ko: "대전", ja: "対戦", zh: "对战" },
  coopBeat: { en: "Beat 'em ups for two", ko: "2인 벨트스크롤", ja: "2人で遊ぶベルトスクロール", zh: "双人清版动作" },
  classic: { en: "Classics", ko: "명작", ja: "名作", zh: "经典" },
  good: { en: "Rated 80+", ko: "평점 80 이상", ja: "評価80以上", zh: "评分 80+" },
  hidden: { en: "Hidden gems", ko: "숨은 명작", ja: "隠れた名作", zh: "隐藏经典" },
  korean: { en: "Korean support", ko: "한국어 지원", ja: "韓国語対応", zh: "支持韩语" },
  achievements: { en: "Achievements", ko: "업적 지원", ja: "実績対応", zh: "支持成就" },
  family: { en: "Family games", ko: "가족 게임", ja: "ファミリーゲーム", zh: "家庭游戏" },
  decade: { en: (d) => `'${yy(d)}s classics`, ko: (d) => `${yy(d)}년대 명작`, ja: (d) => `${yy(d)}年代の名作`, zh: (d) => `${yy(d)}年代经典` },
  decadeGenre: { en: ([d, g]) => `'${yy(d)}s ${g}`, ko: ([d, g]) => `${yy(d)}년대 ${g}`, ja: ([d, g]) => `${yy(d)}年代の${g}`, zh: ([d, g]) => `${yy(d)}年代${g}` },
  maker: { en: (m) => `${m} games`, ko: (m) => `${m} 게임`, ja: (m) => `${m}のゲーム`, zh: (m) => `${m}游戏` },
  series: { en: (s) => `${s} series`, ko: (s) => `${s} 시리즈`, ja: (s) => `${s}シリーズ`, zh: (s) => `${s}系列` },
};

const nameIn = (names, lang, arg) => {
  const n = names[lang] ?? names.en;
  return typeof n === "function" ? n(arg) : n;
};
const styleName = (slug, lang) => nameIn(STYLE_NAMES[slug] ?? { en: slug }, lang);

const byRating = (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.ratingCount - a.ratingCount || String(a.id).localeCompare(String(b.id));
const byNewest = (a, b) => b.addedAt - a.addedAt || byRating(a, b);
const byFewestVotes = (a, b) => a.ratingCount - b.ratingCount || byRating(a, b);
const atOnce = (f) => (f.system === "arcade" ? f.simultaneous : f.simultaneous ?? f.players) ?? 0;
const isStyle = (f, slug) => f.styles.includes(slug) || f.arcadeStyle === slug;
const groupBy = (list, keyOf) => {
  const map = new Map();
  for (const f of list) for (const k of [keyOf(f)].flat()) if (k) map.set(k, [...(map.get(k) ?? []), f]);
  return map;
};

// A row's icon by its id, first match wins; names are from the client's icon set.
const ROW_ICONS = [
  [/^recent$/, "clock"], [/^arcade:/, "joystick"], [/^(players:|coop|versus)/, "users"], [/^genre:/, "tag"],
  [/^decade:/, "calendar"], [/^classic$/, "star"], [/^good$/, "thumbs-up"], [/^hidden$/, "sparkle"],
  [/^maker:/, "building"], [/^series:/, "layers"], [/^korean$/, "globe"], [/^achievements$/, "trophy"], [/^family$/, "home"],
];

export const rowIcon = (id) => ROW_ICONS.find(([re]) => re.test(id))?.[1] ?? "grid";

/** Every row `list` could fill, before games are shared out: { id, group, name(lang), games ranked }. */
export function menuRows(list, now) {
  const out = [];
  const row = (id, group, name, games, rank = byRating) => {
    if (new Set(games.map((f) => f.work)).size >= MENU_MIN) out.push({ id, group, name, games: [...games].sort(rank) });
  };
  row("recent", "recent", (lang) => nameIn(NAMES.recent, lang), list.filter((f) => addedMs(f) >= now - RECENT_MS), byNewest);

  const arcade = list.filter((f) => f.system === "arcade");
  row("arcade:all", "arcade", (lang) => nameIn(NAMES.arcade, lang), arcade);
  for (const [d, games] of groupBy(arcade, (f) => decadeOf(f.year))) row(`arcade:decade:${d}`, "arcade", (lang) => nameIn(NAMES.arcadeDecade, lang, d), games);
  for (const [s, games] of groupBy(arcade, (f) => f.arcadeStyle)) row(`arcade:genre:${s}`, "arcade", (lang) => nameIn(NAMES.arcadeStyle, lang, styleName(s, lang)), games);

  row("players:2", "together", (lang) => nameIn(NAMES.players2, lang), list.filter((f) => atOnce(f) >= 2));
  row("players:4", "together", (lang) => nameIn(NAMES.players4, lang), list.filter((f) => atOnce(f) >= 4));
  row("coop", "together", (lang) => nameIn(NAMES.coop, lang),
    list.filter((f) => f.cooperative || (atOnce(f) >= 2 && (f.arcadeStyle === "beat-em-up" || f.arcadeStyle === "run-and-gun"))));
  row("versus", "together", (lang) => nameIn(NAMES.versus, lang),
    list.filter((f) => atOnce(f) >= 2 && (f.genres.includes("Fighting") || f.arcadeStyle === "versus-fighter")));
  row("coop:beat-em-up", "together", (lang) => nameIn(NAMES.coopBeat, lang), list.filter((f) => atOnce(f) >= 2 && isStyle(f, "beat-em-up")));

  for (const [key, games] of groupBy(list, (f) => f.genres)) row(`genre:${genreSlug(key)}`, "genre", (lang) => genreLabel(key, lang), games);
  for (const [slug, games] of groupBy(list, (f) => f.styles)) row(`genre:${slug}`, "genre", (lang) => styleName(slug, lang), games);

  for (const [d, games] of groupBy(list, (f) => decadeOf(f.year))) {
    row(`decade:${d}`, "era", (lang) => nameIn(NAMES.decade, lang, d), games);
    for (const [key, inGenre] of groupBy(games, (f) => f.genres)) {
      row(`decade:${d}:genre:${genreSlug(key)}`, "era", (lang) => nameIn(NAMES.decadeGenre, lang, [d, genreLabel(key, lang)]), inGenre);
    }
  }

  row("classic", "fame", (lang) => nameIn(NAMES.classic, lang), list.filter((f) => (f.rating ?? 0) >= CLASSIC_RATING));
  row("good", "fame", (lang) => nameIn(NAMES.good, lang), list.filter((f) => (f.rating ?? 0) >= GOOD_RATING && f.rating < CLASSIC_RATING));
  // Well rated by few: a high score that not many people have found.
  row("hidden", "fame", (lang) => nameIn(NAMES.hidden, lang), list.filter((f) => (f.rating ?? 0) >= GOOD_RATING && f.ratingCount > 0), byFewestVotes);

  for (const [m, games] of groupBy(list, (f) => f.maker && genreSlug(f.maker))) row(`maker:${m}`, "maker", (lang) => nameIn(NAMES.maker, lang, games[0].maker), games);
  for (const [s, games] of groupBy(list, (f) => f.series && genreSlug(f.series))) row(`series:${s}`, "maker", (lang) => nameIn(NAMES.series, lang, games[0].series), games);

  row("korean", "play", (lang) => nameIn(NAMES.korean, lang), list.filter((f) => f.korean));
  row("achievements", "play", (lang) => nameIn(NAMES.achievements, lang), list.filter((f) => f.achievements));
  row("family", "play", (lang) => nameIn(NAMES.family, lang), list.filter((f) => f.family));
  return out;
}

/** A small seeded random source (mulberry32), so one seed always deals the same. */
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

/** `rows` in the order the client draws them, for `rand`. */
function ordered(rows, rand) {
  const pools = Object.fromEntries(["recent", ...new Set(CYCLE)].map((g) => [g, shuffled(rows.filter((r) => r.group === g), rand)]));
  const out = [];
  const take = (group) => pools[group].length && out.push(pools[group].shift());
  take("recent");
  for (const group of rand() < 0.5 ? ["together", "arcade"] : ["arcade", "together"]) take(group);
  const cycle = shuffled(CYCLE, rand);
  while (cycle.some((g) => pools[g].length)) for (const g of cycle) take(g);
  return out;
}

/**
 * Twelve of `ranked`: each third of its ranking gives its share (TIERS), at most
 * PER_SYSTEM of a console; then any third with that cap, then without it.
 */
function pickGames(ranked, rand) {
  if (ranked.length <= MENU_GAMES) return ranked;
  const third = Math.ceil(ranked.length / 3);
  const tiers = TIERS.map((want, i) => ({ want, games: shuffled(ranked.slice(i * third, (i + 1) * third), rand) }));
  const chosen = new Set();
  const perSystem = new Map();
  const fits = (f) => (perSystem.get(f.system) ?? 0) < PER_SYSTEM;
  const add = (f) => {
    chosen.add(f);
    perSystem.set(f.system, (perSystem.get(f.system) ?? 0) + 1);
  };
  for (const t of tiers) {
    let taken = 0;
    for (const f of t.games) if (taken < t.want && fits(f)) (add(f), taken++);
  }
  for (const capped of [true, false]) {
    for (const f of tiers.flatMap((t) => t.games)) if (chosen.size < MENU_GAMES && !chosen.has(f) && (!capped || fits(f))) add(f);
  }
  return ranked.filter((f) => chosen.has(f));
}

/**
 * The first `count` rows dealt from `rows` (menuRows) for `seed`: in order,
 * each with its games, one game in one row only, none under MENU_MIN.
 */
export function pickMenu(rows, { seed, count = Infinity }) {
  const rand = seeded(seed);
  const used = new Set();
  const out = [];
  for (const r of ordered(rows, rand)) {
    if (out.length >= count) break;
    const seen = new Set(used);
    const fresh = r.games.filter((f) => !seen.has(f.work) && seen.add(f.work));
    const games = r.group === "recent" ? fresh.slice(0, MENU_GAMES) : pickGames(fresh, rand);
    if (games.length < MENU_MIN) continue;
    for (const f of games) used.add(f.work);
    out.push({ id: r.id, group: r.group, name: r.name, games });
  }
  return out;
}
