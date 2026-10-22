import { pick } from "./langs.js";

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
export const GENRE_LABELS = {
  Action: { en: "Action", ko: "액션", ja: "アクション", zh: "动作", "zh-Hant": "動作", es: "Acción", fr: "Action", de: "Action", it: "Azione", pt: "Ação", ru: "Экшен", nl: "Actie" },
  Adventure: { en: "Adventure", ko: "어드벤처", ja: "アドベンチャー", zh: "冒险", "zh-Hant": "冒險", es: "Aventura", fr: "Aventure", de: "Abenteuer", it: "Avventura", pt: "Aventura", ru: "Приключения", nl: "Avontuur" },
  Arcade: { en: "Arcade", ko: "아케이드", ja: "アーケード", zh: "街机", "zh-Hant": "街機", es: "Arcade", fr: "Arcade", de: "Arcade", it: "Arcade", pt: "Arcade", ru: "Аркада", nl: "Arcade" },
  Puzzle: { en: "Puzzle", ko: "퍼즐", ja: "パズル", zh: "益智", "zh-Hant": "益智", es: "Puzle", fr: "Réflexion", de: "Puzzle", it: "Rompicapo", pt: "Quebra-cabeça", ru: "Головоломка", nl: "Puzzel" },
  Simulation: { en: "Simulation", ko: "시뮬레이션", ja: "シミュレーション", zh: "模拟", "zh-Hant": "模擬", es: "Simulación", fr: "Simulation", de: "Simulation", it: "Simulazione", pt: "Simulação", ru: "Симулятор", nl: "Simulatie" },
  Strategy: { en: "Strategy", ko: "전략", ja: "ストラテジー", zh: "策略", "zh-Hant": "策略", es: "Estrategia", fr: "Stratégie", de: "Strategie", it: "Strategia", pt: "Estratégia", ru: "Стратегия", nl: "Strategie" },
  RPG: { en: "RPG", ko: "RPG", ja: "ロールプレイング", zh: "角色扮演", "zh-Hant": "角色扮演", es: "Rol", fr: "Jeu de rôle", de: "Rollenspiel", it: "Gioco di ruolo", pt: "RPG", ru: "Ролевая игра", nl: "Rollenspel" },
  Shooter: { en: "Shooter", ko: "슈팅", ja: "シューティング", zh: "射击", "zh-Hant": "射擊", es: "Disparos", fr: "Tir", de: "Shooter", it: "Sparatutto", pt: "Tiro", ru: "Шутер", nl: "Schietspel" },
  Party: { en: "Party", ko: "파티", ja: "パーティー", zh: "派对", "zh-Hant": "派對", es: "Party", fr: "Party", de: "Party", it: "Party", pt: "Festa", ru: "Для вечеринок", nl: "Party" },
  "Board Game": { en: "Board Game", ko: "보드", ja: "テーブル", zh: "桌上游戏", "zh-Hant": "桌上遊戲", es: "Juego de mesa", fr: "Jeu de société", de: "Brettspiel", it: "Gioco da tavolo", pt: "Jogo de tabuleiro", ru: "Настольная игра", nl: "Bordspel" },
  Education: { en: "Education", ko: "학습", ja: "学習", zh: "学习", "zh-Hant": "學習", es: "Educativo", fr: "Éducatif", de: "Lernen", it: "Educativo", pt: "Educativo", ru: "Обучение", nl: "Educatief" },
  Racing: { en: "Racing", ko: "레이싱", ja: "レース", zh: "竞速", "zh-Hant": "競速", es: "Carreras", fr: "Course", de: "Rennspiel", it: "Corse", pt: "Corrida", ru: "Гонки", nl: "Racen" },
  Training: { en: "Training", ko: "트레이닝", ja: "トレーニング", zh: "训练", "zh-Hant": "訓練", es: "Entrenamiento", fr: "Entraînement", de: "Training", it: "Allenamento", pt: "Treino", ru: "Тренировка", nl: "Training" },
  Sports: { en: "Sports", ko: "스포츠", ja: "スポーツ", zh: "运动", "zh-Hant": "運動", es: "Deportes", fr: "Sport", de: "Sport", it: "Sport", pt: "Esportes", ru: "Спорт", nl: "Sport" },
  Fighting: { en: "Fighting", ko: "격투", ja: "格闘", zh: "格斗", "zh-Hant": "格鬥", es: "Lucha", fr: "Combat", de: "Kampfspiel", it: "Picchiaduro", pt: "Luta", ru: "Файтинг", nl: "Vechtspel" },
  Utility: { en: "Utility", ko: "실용", ja: "実用", zh: "实用", "zh-Hant": "實用", es: "Utilidades", fr: "Utilitaire", de: "Werkzeug", it: "Utilità", pt: "Utilitário", ru: "Утилиты", nl: "Hulpprogramma" },
  Communication: { en: "Communication", ko: "커뮤니케이션", ja: "コミュニケーション", zh: "交流", "zh-Hant": "交流", es: "Comunicación", fr: "Communication", de: "Kommunikation", it: "Comunicazione", pt: "Comunicação", ru: "Общение", nl: "Communicatie" },
  Music: { en: "Music", ko: "음악", ja: "音楽", zh: "音乐", "zh-Hant": "音樂", es: "Música", fr: "Musique", de: "Musik", it: "Musica", pt: "Música", ru: "Музыка", nl: "Muziek" },
  Platformer: { en: "Platformer", ko: "플랫포머", ja: "プラットフォーマー", zh: "平台", "zh-Hant": "平台", es: "Plataformas", fr: "Plateforme", de: "Jump 'n' Run", it: "Piattaforme", pt: "Plataforma", ru: "Платформер", nl: "Platformspel" },
  Other: { en: "Other", ko: "기타", ja: "その他", zh: "其他", "zh-Hant": "其他", es: "Otros", fr: "Autre", de: "Sonstiges", it: "Altro", pt: "Outros", ru: "Другое", nl: "Overig" },
};
// Names a region uses that are not one of the labels above, simplified Chinese included.
const ALIASES = {
  Action: ["动作"],
  Adventure: ["冒险"],
  Arcade: ["街机"],
  Simulation: ["模拟"],
  RPG: ["role-playing", "角色扮演"],
  Shooter: ["first-person shooter", "射击"],
  Party: ["派对", "family", "家庭", "ファミリー", "가족"],
  "Board Game": ["board", "table", "桌上游戏"],
  Education: ["study", "學習", "学习"],
  Racing: ["竞速"],
  Training: ["训练", "fitness", "フィットネス", "피트니스"],
  Sports: ["sport", "运动", "体育", "體育"],
  Fighting: ["格斗"],
  Utility: ["practical", "lifestyle", "video", "实用", "生活方式", "ライフスタイル", "라이프스타일", "system tool", "tool", "tools"],
  Communication: ["communications"],
  Music: ["音乐"],
};
const TO_KEY = new Map();
for (const [key, labels] of Object.entries(GENRE_LABELS)) {
  for (const name of [key, ...Object.values(labels), ...(ALIASES[key] ?? [])]) TO_KEY.set(name.toLowerCase(), key);
}

/** English genre keys, without duplicates; a name that is no known genre is left out, so no stray label reaches the genre chips. */
export function normalizeGenres(value, max = MAX_CATEGORIES) {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((name) => typeof name === "string")
    .map((name) => TO_KEY.get(name.trim().toLowerCase()))
    .filter(Boolean);
  return normalizeCategories(names, max);
}

/** The label of a genre key in `lang`; an unknown key is its own label. */
export function genreLabel(key, lang = "en") {
  return pick(GENRE_LABELS[key], lang) ?? key;
}
