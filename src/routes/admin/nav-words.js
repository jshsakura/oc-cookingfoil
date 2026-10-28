/**
 * The sidebar rows the menu plan added, in all twelve admin languages: the
 * incoming row (upload, temp folder, temp share as tabs) and its temp folder
 * page. Korean is the source of truth.
 */
const KEYS = ["m.incoming", "m.organize"];

const ROWS = {
  ko: ["들어온 파일", "임시 폴더"],
  en: ["Incoming", "Temp folder"],
  ja: ["受け取ったファイル", "一時フォルダー"],
  zh: ["收到的文件", "临时文件夹"],
  "zh-Hant": ["收到的檔案", "暫存資料夾"],
  es: ["Recibidos", "Carpeta temporal"],
  fr: ["Fichiers reçus", "Dossier temporaire"],
  de: ["Eingang", "Temporärer Ordner"],
  it: ["File ricevuti", "Cartella temporanea"],
  pt: ["Recebidos", "Pasta temporária"],
  nl: ["Binnengekomen", "Tijdelijke map"],
  ru: ["Входящие файлы", "Временная папка"],
};

export const NAV_WORDS = Object.fromEntries(Object.entries(ROWS).map(([lang, row]) => {
  if (row.length !== KEYS.length) throw new Error(`nav-words: ${lang} has ${row.length} words for ${KEYS.length} keys`);
  return [lang, Object.fromEntries(KEYS.map((k, i) => [k, row[i]]))];
}));
