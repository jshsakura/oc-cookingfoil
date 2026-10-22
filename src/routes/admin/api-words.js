/**
 * Error messages the admin API sends, in the four admin languages.
 *
 * The admin page sends its chosen language as Accept-Language (dashboard-script.js api()), so a
 * route answers in it; a token or script without the header gets English, as every other route
 * does for a language it does not know. {name} placeholders are filled by apiWord.
 */
import { requestLang } from "../../meta/langs.js";

export const API_WORDS = {
  ko: {
    failed: "처리하지 못했습니다. 서버 기록을 봅니다",
    "guide.badPath": "폴더 경로는 retro/roms/gba 처럼 저장 폴더 기준 상대 경로로 적습니다",
    "guide.unknown": "안내가 있는 폴더가 아닙니다",
  },
  en: {
    failed: "Could not do that. See the server log",
    "guide.badPath": "Write the folder path relative to the storage folder, like retro/roms/gba",
    "guide.unknown": "There is no guide for that folder",
  },
  ja: {
    failed: "処理できませんでした。サーバーのログを確認します",
    "guide.badPath": "フォルダーのパスは retro/roms/gba のように保存フォルダーからの相対パスで書きます",
    "guide.unknown": "案内のあるフォルダーではありません",
  },
  zh: {
    failed: "无法处理。请查看服务器日志",
    "guide.badPath": "文件夹路径请写成相对于存储文件夹的路径，例如 retro/roms/gba",
    "guide.unknown": "这个文件夹没有说明",
  },
};

const wordsFor = (lang) => API_WORDS[lang] ?? (lang === "zh-Hant" ? API_WORDS.zh : API_WORDS.en);

/** The message `key` in the request's language (English when it is not an admin language), placeholders filled. */
export function apiWord(req, key, vars = {}) {
  const text = wordsFor(requestLang(req))[key] ?? API_WORDS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
}
