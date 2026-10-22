/**
 * Every filter one console's game list can take, for the client to draw
 * without a list of its own (GET /api/retro/systems/:id/filters):
 *
 *   { groups: [{ key, en, ko, ja, zh, pick: "many" | "one",
 *                options: [{ key, en, ko, ja, zh, count, params: { <query>: "<value>" } }] }],
 *     sorts: [{ key, en, ko, ja, zh }] }
 *
 * A client adds an option's params to /api/retro/games as they are. Within a
 * "many" group the same param joins with commas (any of them) and different
 * params all apply; groups all apply; a "one" group takes one option. `count`
 * is how many of the console's games that option alone keeps. Options no game
 * has, and groups left empty, are not sent. Pure.
 */
import { GENRE_LABELS } from "../meta/categories.js";
import { decadeOf, genreKeysOf, genreSlug } from "./themes.js";
import { STYLE_NAMES } from "./menu.js";

const LANGS = ["en", "ko", "ja", "zh"];
const text = (en, ko, ja, zh) => ({ en, ko, ja, zh });
const each = (fn) => Object.fromEntries(LANGS.map((l) => [l, fn(l)]));

const GROUPS = {
  genre: text("Genre", "장르", "ジャンル", "类型"),
  players: text("Players", "인원", "人数", "人数"),
  decade: text("Decade", "연대", "年代", "年代"),
  region: text("Region", "지역", "地域", "地区"),
  rating: text("Rating", "평점", "評価", "评分"),
  size: text("Size", "용량", "サイズ", "大小"),
  features: text("Features", "특징", "特徴", "特点"),
};

const REGIONS = {
  kr: text("Korea", "한국", "韓国", "韩国"),
  jp: text("Japan", "일본", "日本", "日本"),
  us: text("North America", "북미", "北米", "北美"),
  eu: text("Europe", "유럽", "ヨーロッパ", "欧洲"),
  asia: text("Asia", "아시아", "アジア", "亚洲"),
  world: text("World", "세계", "ワールド", "全球"),
  br: text("Brazil", "브라질", "ブラジル", "巴西"),
  hisp: text("Latin America", "중남미", "中南米", "拉丁美洲"),
};

const RATINGS = [90, 80];
const MB = 1024 * 1024;
const SIZES = [
  { key: "under-10mb", params: { maxSize: String(10 * MB) }, label: text("Up to 10 MB", "10MB 이하", "10MB以下", "10MB 以下"), keep: (s) => s <= 10 * MB },
  { key: "under-100mb", params: { maxSize: String(100 * MB) }, label: text("Up to 100 MB", "100MB 이하", "100MB以下", "100MB 以下"), keep: (s) => s <= 100 * MB },
  { key: "under-1gb", params: { maxSize: String(1024 * MB) }, label: text("Up to 1 GB", "1GB 이하", "1GB以下", "1GB 以下"), keep: (s) => s <= 1024 * MB },
  { key: "over-1gb", params: { minSize: String(1024 * MB + 1) }, label: text("Over 1 GB", "1GB 초과", "1GB超", "1GB 以上"), keep: (s) => s > 1024 * MB },
];

export const SORTS = [
  { key: "rating", ...text("Rating", "평점순", "評価順", "按评分") },
  { key: "name", ...text("Name", "이름순", "名前順", "按名称") },
  { key: "added", ...text("Recently added", "최근 추가순", "追加順", "最近添加") },
  { key: "size", ...text("Size", "용량순", "サイズ順", "按大小") },
];

const option = (key, label, count, params) => ({ key, ...label, count, params });
const group = (key, pick, options) => ({ key, ...GROUPS[key], pick, options: options.filter((o) => o.count > 0) });
const countWhere = (list, keep) => list.reduce((n, x) => n + (keep(x) ? 1 : 0), 0);

function genreLabel(slug, sources) {
  if (STYLE_NAMES[slug]) return each((l) => STYLE_NAMES[slug][l] ?? STYLE_NAMES[slug].en);
  const key = sources.get(slug);
  return each((l) => GENRE_LABELS[key]?.[l] ?? GENRE_LABELS[key]?.en ?? key ?? slug);
}

/** The filter groups for `games` (catalog games, with their `bezel`) and `factsOf` (id → facts). */
export function filtersOf(games, factsOf) {
  const rows = games.map((g) => ({ g, f: factsOf(g.id) })).filter((r) => r.f);
  const facts = rows.map((r) => r.f);
  const genreCounts = new Map();
  const genreSource = new Map();
  for (const f of facts) {
    for (const g of f.genres) if (!genreSource.has(genreSlug(g))) genreSource.set(genreSlug(g), g);
    for (const k of genreKeysOf(f)) genreCounts.set(k, (genreCounts.get(k) ?? 0) + 1);
  }
  const decades = [...new Set(facts.map((f) => decadeOf(f.year)).filter(Boolean))].sort();
  const regions = [...new Set(facts.map((f) => f.region).filter((r) => REGIONS[r]))];
  const groups = [
    group("genre", "many", [...genreCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([slug, n]) => option(slug, genreLabel(slug, genreSource), n, { genre: slug }))),
    group("players", "one", [2, 3, 4].map((p) => option(String(p), text(`${p}+ players`, `${p}인 이상`, `${p}人以上`, `${p} 人以上`),
      countWhere(facts, (f) => (f.players ?? 0) >= p), { players: String(p) }))),
    group("decade", "many", decades.map((d) => option(String(d), text(`${d}s`, `${d}년대`, `${d}年代`, `${d}年代`),
      countWhere(facts, (f) => decadeOf(f.year) === d), { decade: String(d) }))),
    group("region", "many", regions.sort().map((r) => option(r, REGIONS[r], countWhere(facts, (f) => f.region === r), { region: r }))),
    group("rating", "one", RATINGS.map((r) => option(String(r), text(`Rated ${r}+`, `평점 ${r} 이상`, `評価${r}以上`, `评分 ${r}+`),
      countWhere(facts, (f) => (f.rating ?? -1) >= r), { minRating: String(r) }))),
    group("size", "one", SIZES.map((s) => option(s.key, s.label, countWhere(rows, (r) => s.keep(r.g.size)), s.params))),
    group("features", "many", [
      option("korean", text("Korean", "한국어", "韓国語", "韩语"), countWhere(facts, (f) => f.korean), { korean: "1" }),
      option("achievements", text("Achievements", "업적", "実績", "成就"), countWhere(facts, (f) => f.achievements), { achievements: "1" }),
      option("bezel", text("Own bezel", "전용 베젤", "専用ベゼル", "专属边框"), countWhere(rows, (r) => r.g.bezel && !r.g.bezel.generic), { bezel: "1" }),
    ]),
  ];
  return { groups: groups.filter((g) => g.options.length), sorts: SORTS };
}
