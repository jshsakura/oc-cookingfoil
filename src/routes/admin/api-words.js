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
    "content.folderTaken": "그 게임에 같은 이름의 폴더가 이미 있습니다. 이름을 바꾸거나 그쪽을 먼저 삭제합니다",
    "upload.replaceToTrash": "지금 있는 {name} 을 휴지통에 옮기지 못해 올리지 않았습니다: {why}",
    "upload.folderAppeared": "그사이 {name} 폴더가 새로 생겨 올리지 않았습니다. 다시 올립니다",
    "games.searchFailed": "게임을 찾지 못했습니다. 서버 기록을 봅니다",
    failed: "처리하지 못했습니다. 서버 기록을 봅니다",
    "guide.badPath": "폴더 경로는 retro/roms/gba 처럼 저장 폴더 기준 상대 경로로 적습니다",
    "guide.unknown": "안내가 있는 폴더가 아닙니다",
  },
  en: {
    "content.folderTaken": "That game already has a folder with the same name. Rename it or delete that one first",
    "upload.replaceToTrash": "The existing {name} could not go to the trash, so nothing was uploaded: {why}",
    "upload.folderAppeared": "A {name} folder appeared in the meantime, so nothing was uploaded. Upload again",
    "games.searchFailed": "Could not search the games. See the server log",
    failed: "Could not do that. See the server log",
    "guide.badPath": "Write the folder path relative to the storage folder, like retro/roms/gba",
    "guide.unknown": "There is no guide for that folder",
  },
  ja: {
    "content.folderTaken": "そのゲームには同じ名前のフォルダーがすでにあります。名前を変えるか、先にそちらを削除します",
    "upload.replaceToTrash": "今ある {name} をゴミ箱に移動できなかったため、アップロードしませんでした: {why}",
    "upload.folderAppeared": "その間に {name} フォルダーが新しくできたため、アップロードしませんでした。もう一度アップロードします",
    "games.searchFailed": "ゲームを検索できませんでした。サーバーのログを確認します",
    failed: "処理できませんでした。サーバーのログを確認します",
    "guide.badPath": "フォルダーのパスは retro/roms/gba のように保存フォルダーからの相対パスで書きます",
    "guide.unknown": "案内のあるフォルダーではありません",
  },
  zh: {
    "content.folderTaken": "该游戏已有同名文件夹。请改名或先删除那个文件夹",
    "upload.replaceToTrash": "无法将现有的 {name} 移入回收站，因此没有上传: {why}",
    "upload.folderAppeared": "在此期间出现了新的 {name} 文件夹，因此没有上传。请重新上传",
    "games.searchFailed": "无法搜索游戏。请查看服务器日志",
    failed: "无法处理。请查看服务器日志",
    "guide.badPath": "文件夹路径请写成相对于存储文件夹的路径，例如 retro/roms/gba",
    "guide.unknown": "这个文件夹没有说明",
  },
};

const wordsFor = (lang) => API_WORDS[lang] ?? (lang === "zh-Hant" ? API_WORDS.zh : API_WORDS.en);

/** The message `key` in `lang` (English when it is not an admin language), placeholders filled. Pure. */
export function apiText(lang, key, vars = {}) {
  const text = wordsFor(lang)[key] ?? API_WORDS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
}

/** The message `key` in the request's language. */
export const apiWord = (req, key, vars = {}) => apiText(requestLang(req), key, vars);
