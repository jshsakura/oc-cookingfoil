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
// Action and アクション. Every name maps to the Korean eShop's own label.
const KOREAN_GENRE = {
  액션: ["action", "アクション", "動作"],
  어드벤처: ["adventure", "アドベンチャー", "冒險"],
  아케이드: ["arcade", "アーケード", "街機"],
  퍼즐: ["puzzle", "パズル", "益智"],
  시뮬레이션: ["simulation", "シミュレーション", "模擬"],
  전략: ["strategy", "ストラテジー", "策略"],
  RPG: ["rpg", "role-playing", "ロールプレイング", "角色扮演"],
  슈팅: ["shooter", "first-person shooter", "シューティング", "射擊"],
  파티: ["party", "パーティー", "派對"],
  보드: ["board game", "テーブル", "桌上遊戲"],
  학습: ["education", "study", "学習", "學習"],
  레이싱: ["racing", "レース", "競速"],
  트레이닝: ["training", "トレーニング", "訓練"],
  스포츠: ["sports", "スポーツ", "運動"],
  격투: ["fighting", "格闘", "格鬥"],
  실용: ["utility", "practical", "lifestyle", "video", "実用", "實用"],
  커뮤니케이션: ["communication", "コミュニケーション", "交流"],
  음악: ["music", "音楽", "音樂"],
  플랫포머: ["platformer"],
  기타: ["other", "その他", "其他"],
};
const TO_KOREAN = new Map(
  Object.entries(KOREAN_GENRE).flatMap(([ko, names]) => [[ko.toLowerCase(), ko], ...names.map((n) => [n.toLowerCase(), ko])]),
);
// US store tags that describe how a game is played or listed, not its genre.
const NOT_GENRES = new Set(["multiplayer", "updates"]);

/** Genres in Korean, without duplicates or non-genre tags; unknown names stay as written. */
export function normalizeGenres(value, max = MAX_CATEGORIES) {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((name) => typeof name === "string" && !NOT_GENRES.has(name.trim().toLowerCase()))
    .map((name) => TO_KOREAN.get(name.trim().toLowerCase()) ?? name);
  return normalizeCategories(names, max);
}
