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
import { LANGS, pick } from "../meta/langs.js";
import { decadeOf, genreKeysOf, genreSlug } from "./themes.js";
import { STYLE_NAMES } from "./menu.js";

const text = (words) => ({ ...words });
const each = (fn) => Object.fromEntries(LANGS.map((l) => [l, fn(l)]));
// A label with a number in it, per language.
const counted = (forms, n) => Object.fromEntries(Object.entries(forms).map(([l, f]) => [l, f(n)]));

const GROUPS = {
  genre: text({ en: "Genre", ko: "장르", ja: "ジャンル", zh: "类型", "zh-Hant": "類型", es: "Género", fr: "Genre", de: "Genre", it: "Genere", pt: "Gênero", ru: "Жанр", nl: "Genre" }),
  players: text({ en: "Players", ko: "인원", ja: "人数", zh: "人数", "zh-Hant": "人數", es: "Jugadores", fr: "Joueurs", de: "Spieler", it: "Giocatori", pt: "Jogadores", ru: "Игроки", nl: "Spelers" }),
  decade: text({ en: "Decade", ko: "연대", ja: "年代", zh: "年代", "zh-Hant": "年代", es: "Década", fr: "Décennie", de: "Jahrzehnt", it: "Decennio", pt: "Década", ru: "Десятилетие", nl: "Decennium" }),
  region: text({ en: "Region", ko: "지역", ja: "地域", zh: "地区", "zh-Hant": "地區", es: "Región", fr: "Région", de: "Region", it: "Regione", pt: "Região", ru: "Регион", nl: "Regio" }),
  rating: text({ en: "Rating", ko: "평점", ja: "評価", zh: "评分", "zh-Hant": "評分", es: "Valoración", fr: "Note", de: "Wertung", it: "Voto", pt: "Nota", ru: "Рейтинг", nl: "Score" }),
  size: text({ en: "Size", ko: "용량", ja: "サイズ", zh: "大小", "zh-Hant": "大小", es: "Tamaño", fr: "Taille", de: "Größe", it: "Dimensione", pt: "Tamanho", ru: "Размер", nl: "Grootte" }),
  features: text({ en: "Features", ko: "특징", ja: "特徴", zh: "特点", "zh-Hant": "特點", es: "Características", fr: "Caractéristiques", de: "Merkmale", it: "Caratteristiche", pt: "Recursos", ru: "Особенности", nl: "Kenmerken" }),
};

export const REGIONS = {
  kr: text({ en: "Korea", ko: "한국", ja: "韓国", zh: "韩国", "zh-Hant": "韓國", es: "Corea", fr: "Corée", de: "Korea", it: "Corea", pt: "Coreia", ru: "Корея", nl: "Korea" }),
  jp: text({ en: "Japan", ko: "일본", ja: "日本", zh: "日本", "zh-Hant": "日本", es: "Japón", fr: "Japon", de: "Japan", it: "Giappone", pt: "Japão", ru: "Япония", nl: "Japan" }),
  us: text({ en: "North America", ko: "북미", ja: "北米", zh: "北美", "zh-Hant": "北美", es: "Norteamérica", fr: "Amérique du Nord", de: "Nordamerika", it: "Nord America", pt: "América do Norte", ru: "Северная Америка", nl: "Noord-Amerika" }),
  eu: text({ en: "Europe", ko: "유럽", ja: "ヨーロッパ", zh: "欧洲", "zh-Hant": "歐洲", es: "Europa", fr: "Europe", de: "Europa", it: "Europa", pt: "Europa", ru: "Европа", nl: "Europa" }),
  asia: text({ en: "Asia", ko: "아시아", ja: "アジア", zh: "亚洲", "zh-Hant": "亞洲", es: "Asia", fr: "Asie", de: "Asien", it: "Asia", pt: "Ásia", ru: "Азия", nl: "Azië" }),
  world: text({ en: "World", ko: "세계", ja: "ワールド", zh: "全球", "zh-Hant": "全球", es: "Mundial", fr: "Monde", de: "Welt", it: "Mondo", pt: "Mundial", ru: "Весь мир", nl: "Wereld" }),
  br: text({ en: "Brazil", ko: "브라질", ja: "ブラジル", zh: "巴西", "zh-Hant": "巴西", es: "Brasil", fr: "Brésil", de: "Brasilien", it: "Brasile", pt: "Brasil", ru: "Бразилия", nl: "Brazilië" }),
  hisp: text({ en: "Latin America", ko: "중남미", ja: "中南米", zh: "拉丁美洲", "zh-Hant": "拉丁美洲", es: "Latinoamérica", fr: "Amérique latine", de: "Lateinamerika", it: "America Latina", pt: "América Latina", ru: "Латинская Америка", nl: "Latijns-Amerika" }),
};

const RATINGS = [90, 80];
const PLAYERS = {
  en: (p) => `${p}+ players`, ko: (p) => `${p}인 이상`, ja: (p) => `${p}人以上`, zh: (p) => `${p} 人以上`, "zh-Hant": (p) => `${p} 人以上`,
  es: (p) => `${p}+ jugadores`, fr: (p) => `${p} joueurs et +`, de: (p) => `Ab ${p} Spielern`, it: (p) => `${p}+ giocatori`,
  pt: (p) => `${p}+ jogadores`, ru: (p) => `${p}+ игрока`, nl: (p) => `${p}+ spelers`,
};
const DECADES = {
  en: (d) => `${d}s`, ko: (d) => `${d}년대`, ja: (d) => `${d}年代`, zh: (d) => `${d}年代`, "zh-Hant": (d) => `${d}年代`,
  es: (d) => `Años ${d}`, fr: (d) => `Années ${d}`, de: (d) => `${d}er`, it: (d) => `Anni ${d}`,
  pt: (d) => `Anos ${d}`, ru: (d) => `${d}-е`, nl: (d) => `Jaren ${d}`,
};
const RATED = {
  en: (r) => `Rated ${r}+`, ko: (r) => `평점 ${r} 이상`, ja: (r) => `評価${r}以上`, zh: (r) => `评分 ${r}+`, "zh-Hant": (r) => `評分 ${r}+`,
  es: (r) => `Nota ${r}+`, fr: (r) => `Note ${r}+`, de: (r) => `Wertung ${r}+`, it: (r) => `Voto ${r}+`,
  pt: (r) => `Nota ${r}+`, ru: (r) => `Рейтинг ${r}+`, nl: (r) => `Score ${r}+`,
};
const MB = 1024 * 1024;
const SIZES = [
  { key: "under-10mb", params: { maxSize: String(10 * MB) }, label: text({ en: "Up to 10 MB", ko: "10MB 이하", ja: "10MB以下", zh: "10MB 以下", "zh-Hant": "10MB 以下", es: "Hasta 10 MB", fr: "Jusqu'à 10 Mo", de: "Bis 10 MB", it: "Fino a 10 MB", pt: "Até 10 MB", ru: "До 10 МБ", nl: "Tot 10 MB" }), keep: (s) => s <= 10 * MB },
  { key: "under-100mb", params: { maxSize: String(100 * MB) }, label: text({ en: "Up to 100 MB", ko: "100MB 이하", ja: "100MB以下", zh: "100MB 以下", "zh-Hant": "100MB 以下", es: "Hasta 100 MB", fr: "Jusqu'à 100 Mo", de: "Bis 100 MB", it: "Fino a 100 MB", pt: "Até 100 MB", ru: "До 100 МБ", nl: "Tot 100 MB" }), keep: (s) => s <= 100 * MB },
  { key: "under-1gb", params: { maxSize: String(1024 * MB) }, label: text({ en: "Up to 1 GB", ko: "1GB 이하", ja: "1GB以下", zh: "1GB 以下", "zh-Hant": "1GB 以下", es: "Hasta 1 GB", fr: "Jusqu'à 1 Go", de: "Bis 1 GB", it: "Fino a 1 GB", pt: "Até 1 GB", ru: "До 1 ГБ", nl: "Tot 1 GB" }), keep: (s) => s <= 1024 * MB },
  { key: "over-1gb", params: { minSize: String(1024 * MB + 1) }, label: text({ en: "Over 1 GB", ko: "1GB 초과", ja: "1GB超", zh: "超过 1GB", "zh-Hant": "超過 1GB", es: "Más de 1 GB", fr: "Plus de 1 Go", de: "Über 1 GB", it: "Oltre 1 GB", pt: "Mais de 1 GB", ru: "Более 1 ГБ", nl: "Meer dan 1 GB" }), keep: (s) => s > 1024 * MB },
];

export const SORTS = [
  { key: "added", ...text({ en: "Recently added", ko: "최근 추가순", ja: "追加が新しい順", zh: "最近添加", "zh-Hant": "最近新增", es: "Añadidos recientemente", fr: "Ajouts récents", de: "Zuletzt hinzugefügt", it: "Aggiunti di recente", pt: "Adicionados recentemente", ru: "Недавно добавленные", nl: "Recent toegevoegd" }) },
  { key: "name", ...text({ en: "Name", ko: "이름순", ja: "名前順", zh: "按名称", "zh-Hant": "名稱", es: "Nombre", fr: "Nom", de: "Name", it: "Nome", pt: "Nome", ru: "Название", nl: "Naam" }) },
  { key: "size", ...text({ en: "Largest", ko: "용량 큰순", ja: "容量が大きい順", zh: "容量最大", "zh-Hant": "容量最大", es: "Más grandes", fr: "Les plus volumineux", de: "Größte", it: "Più grandi", pt: "Maiores", ru: "Самые большие", nl: "Grootste" }) },
  { key: "rating", ...text({ en: "Rating", ko: "평점순", ja: "評価順", zh: "评分", "zh-Hant": "評分", es: "Valoración", fr: "Note", de: "Bewertung", it: "Valutazione", pt: "Avaliação", ru: "Оценка", nl: "Beoordeling" }) },
];

const option = (key, label, count, params) => ({ key, ...label, count, params });
const group = (key, pick, options) => ({ key, ...GROUPS[key], pick, options: options.filter((o) => o.count > 0) });
const countWhere = (list, keep) => list.reduce((n, x) => n + (keep(x) ? 1 : 0), 0);

function genreLabel(slug, sources) {
  if (STYLE_NAMES[slug]) return each((l) => pick(STYLE_NAMES[slug], l));
  const key = sources.get(slug);
  return each((l) => pick(GENRE_LABELS[key], l) ?? key ?? slug);
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
    group("players", "one", [2, 3, 4].map((p) => option(String(p), counted(PLAYERS, p),
      countWhere(facts, (f) => (f.players ?? 0) >= p), { players: String(p) }))),
    group("decade", "many", decades.map((d) => option(String(d), counted(DECADES, d),
      countWhere(facts, (f) => decadeOf(f.year) === d), { decade: String(d) }))),
    group("region", "many", regions.sort().map((r) => option(r, REGIONS[r], countWhere(facts, (f) => f.region === r), { region: r }))),
    group("rating", "one", RATINGS.map((r) => option(String(r), counted(RATED, r),
      countWhere(facts, (f) => (f.rating ?? -1) >= r), { minRating: String(r) }))),
    group("size", "one", SIZES.map((s) => option(s.key, s.label, countWhere(rows, (r) => s.keep(r.g.size)), s.params))),
    group("features", "many", [
      option("korean", text({ en: "Korean", ko: "한국어", ja: "韓国語", zh: "韩语", "zh-Hant": "韓語", es: "Coreano", fr: "Coréen", de: "Koreanisch", it: "Coreano", pt: "Coreano", ru: "Корейский", nl: "Koreaans" }), countWhere(facts, (f) => f.korean), { korean: "1" }),
      option("achievements", text({ en: "Achievements", ko: "업적", ja: "実績", zh: "成就", "zh-Hant": "成就", es: "Logros", fr: "Succès", de: "Erfolge", it: "Obiettivi", pt: "Conquistas", ru: "Достижения", nl: "Prestaties" }), countWhere(facts, (f) => f.achievements), { achievements: "1" }),
      option("bezel", text({ en: "Own bezel", ko: "전용 베젤", ja: "専用ベゼル", zh: "专属边框", "zh-Hant": "專屬邊框", es: "Marco propio", fr: "Cadre dédié", de: "Eigener Rahmen", it: "Cornice dedicata", pt: "Moldura própria", ru: "Своя рамка", nl: "Eigen rand" }), countWhere(rows, (r) => r.g.bezel && !r.g.bezel.generic), { bezel: "1" }),
    ]),
  ];
  return { groups: groups.filter((g) => g.options.length), sorts: SORTS };
}
