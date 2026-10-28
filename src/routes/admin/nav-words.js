/**
 * The sidebar rows the menu plan added, in all twelve admin languages: the
 * incoming row (upload, temp folder, temp share as tabs) and its temp folder
 * page, plus the games page's "game list" tab and the patches and saves list tabs. Korean is the source of truth.
 */
const KEYS = ["m.incoming", "m.organize", "m.gameList", "m.list"];

const ROWS = {
  ko: ["들어온 파일", "임시 폴더", "게임 목록", "목록"],
  en: ["Incoming", "Temp folder", "Game list", "List"],
  ja: ["受け取ったファイル", "一時フォルダー", "ゲーム一覧", "一覧"],
  zh: ["收到的文件", "临时文件夹", "游戏列表", "列表"],
  "zh-Hant": ["收到的檔案", "暫存資料夾", "遊戲清單", "清單"],
  es: ["Recibidos", "Carpeta temporal", "Lista de juegos", "Lista"],
  fr: ["Fichiers reçus", "Dossier temporaire", "Liste des jeux", "Liste"],
  de: ["Eingang", "Temporärer Ordner", "Spieleliste", "Liste"],
  it: ["File ricevuti", "Cartella temporanea", "Elenco giochi", "Elenco"],
  pt: ["Recebidos", "Pasta temporária", "Lista de jogos", "Lista"],
  nl: ["Binnengekomen", "Tijdelijke map", "Spellenlijst", "Lijst"],
  ru: ["Входящие файлы", "Временная папка", "Список игр", "Список"],
};

export const NAV_WORDS = Object.fromEntries(Object.entries(ROWS).map(([lang, row]) => {
  if (row.length !== KEYS.length) throw new Error(`nav-words: ${lang} has ${row.length} words for ${KEYS.length} keys`);
  return [lang, Object.fromEntries(KEYS.map((k, i) => [k, row[i]]))];
}));
