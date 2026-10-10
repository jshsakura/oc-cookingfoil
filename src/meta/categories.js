// Genre names from titledb. Kept short so the per-file section payload stays small.
const MAX_CATEGORIES = 4;
export function normalizeCategories(value, max = MAX_CATEGORIES) {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((name) => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name.length <= 40);
  const unique = [...new Set(names)].slice(0, max);
  return unique.length ? unique : undefined;
}

// Each region file names the same eShop genres in its own language, and a
// title borrows whichever region it was found in, so the list mixed 액션,
// Action and アクション. Every name folds onto one English key; clients show
// the label for their own language from GENRE_LABELS.
export const GENRE_LANGS = ["en", "ko", "ja", "zh"];
export const GENRE_LABELS = {
  Action: { en: "Action", ko: "액션", ja: "アクション", zh: "動作" },
  Adventure: { en: "Adventure", ko: "어드벤처", ja: "アドベンチャー", zh: "冒險" },
  Arcade: { en: "Arcade", ko: "아케이드", ja: "アーケード", zh: "街機" },
  Puzzle: { en: "Puzzle", ko: "퍼즐", ja: "パズル", zh: "益智" },
  Simulation: { en: "Simulation", ko: "시뮬레이션", ja: "シミュレーション", zh: "模擬" },
  Strategy: { en: "Strategy", ko: "전략", ja: "ストラテジー", zh: "策略" },
  RPG: { en: "RPG", ko: "RPG", ja: "ロールプレイング", zh: "角色扮演" },
  Shooter: { en: "Shooter", ko: "슈팅", ja: "シューティング", zh: "射擊" },
  Party: { en: "Party", ko: "파티", ja: "パーティー", zh: "派對" },
  "Board Game": { en: "Board Game", ko: "보드", ja: "テーブル", zh: "桌上遊戲" },
  Education: { en: "Education", ko: "학습", ja: "学習", zh: "學習" },
  Racing: { en: "Racing", ko: "레이싱", ja: "レース", zh: "競速" },
  Training: { en: "Training", ko: "트레이닝", ja: "トレーニング", zh: "訓練" },
  Sports: { en: "Sports", ko: "스포츠", ja: "スポーツ", zh: "運動" },
  Fighting: { en: "Fighting", ko: "격투", ja: "格闘", zh: "格鬥" },
  Utility: { en: "Utility", ko: "실용", ja: "実用", zh: "實用" },
  Communication: { en: "Communication", ko: "커뮤니케이션", ja: "コミュニケーション", zh: "交流" },
  Music: { en: "Music", ko: "음악", ja: "音楽", zh: "音樂" },
  Platformer: { en: "Platformer", ko: "플랫포머", ja: "プラットフォーマー", zh: "平台" },
  Other: { en: "Other", ko: "기타", ja: "その他", zh: "其他" },
};
// Names a region uses that are not one of the labels above.
const ALIASES = {
  RPG: ["role-playing"],
  Shooter: ["first-person shooter"],
  Education: ["study", "學習", "学习"],
  Utility: ["practical", "lifestyle", "video"],
};
const TO_KEY = new Map();
for (const [key, labels] of Object.entries(GENRE_LABELS)) {
  for (const name of [key, ...Object.values(labels), ...(ALIASES[key] ?? [])]) TO_KEY.set(name.toLowerCase(), key);
}
// US store tags that describe how a game is played or listed, not its genre.
const NOT_GENRES = new Set(["multiplayer", "updates"]);

/** English genre keys, without duplicates or non-genre tags; unknown names stay as written. */
export function normalizeGenres(value, max = MAX_CATEGORIES) {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((name) => typeof name === "string" && !NOT_GENRES.has(name.trim().toLowerCase()))
    .map((name) => TO_KEY.get(name.trim().toLowerCase()) ?? name);
  return normalizeCategories(names, max);
}

/** The label of a genre key in `lang`; an unknown key is its own label. */
export function genreLabel(key, lang = "en") {
  return GENRE_LABELS[key]?.[lang] ?? GENRE_LABELS[key]?.en ?? key;
}

/** "en" | "ko" | "ja" | "zh" from ?lang= or Accept-Language; English otherwise. */
export function requestLang(req) {
  const asked = [req.query?.lang, ...String(req.get?.("accept-language") ?? "").split(",")]
    .map((tag) => String(tag ?? "").trim().slice(0, 2).toLowerCase());
  return asked.find((tag) => GENRE_LANGS.includes(tag)) ?? "en";
}
