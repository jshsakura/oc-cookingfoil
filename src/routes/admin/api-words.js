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
    "fileReplace.taken": "폴더에 {name} 이 이미 있어 바꾸지 않았습니다. 그 파일을 먼저 정리합니다",
    "fileReplace.one": "파일 하나만 올립니다 (.nro 또는 .nsp)",
    "coreSwitch.bad": "core 와 enabled(true/false) 가 필요합니다",
    "fileReplace.unknown": "직접 넣은 앱 목록에 없습니다",
    "fileReplace.kind": "{name} 은 {want} 파일로만 바꿉니다. 형식을 바꾸려면 앱을 삭제하고 새로 올립니다",
    "fileReplace.badNro": "올바른 NRO 가 아닙니다: {why}",
    "fileReplace.badNsp": "올바른 NSP 가 아닙니다",
    "fileReplace.nspUnread": "NSP 의 타이틀 ID 를 읽지 못했습니다. 서버에 nstool 과 키가 있는지 확인합니다",
    "fileReplace.nspNotApp": "업데이트나 DLC NSP 로는 바꾸지 않습니다",
    "fileReplace.otherTitle": "다른 타이틀의 NSP 입니다 (올린 파일 {got}, 지금 앱 {want})",
    "device.limit": "이 계정은 기기를 최대 {n}대까지 등록할 수 있습니다. 쓰지 않는 기기를 해제한 뒤 다시 승인해 주세요.",
    "content.folderTaken": "그 게임에 같은 이름의 폴더가 이미 있습니다. 이름을 바꾸거나 그쪽을 먼저 삭제합니다",
    "upload.replaceToTrash": "지금 있는 {name} 을 휴지통에 옮기지 못해 올리지 않았습니다: {why}",
    "upload.folderAppeared": "그사이 {name} 폴더가 새로 생겨 올리지 않았습니다. 다시 올립니다",
    "games.searchFailed": "게임을 찾지 못했습니다. 서버 기록을 봅니다",
    failed: "처리하지 못했습니다. 서버 기록을 봅니다",
    "guide.badPath": "폴더 경로는 retro/roms/gba 처럼 저장 폴더 기준 상대 경로로 적습니다",
    "guide.unknown": "안내가 있는 폴더가 아닙니다",
    "retroKo.noGame": "목록에 없는 레트로 게임입니다",
    "retroKo.noGuess": "이 게임에는 결정을 기다리는 한글 제목 제안이 없습니다",
  },
  en: {
    "fileReplace.taken": "The folder already has {name}, so nothing was replaced. Clear that file first",
    "fileReplace.one": "Upload one file (.nro or .nsp)",
    "coreSwitch.bad": "core and enabled (true/false) are required",
    "fileReplace.unknown": "That app is not among the hand-placed apps",
    "fileReplace.kind": "{name} takes only a {want} file. To change the format, delete the app and upload it again",
    "fileReplace.badNro": "Not a valid NRO: {why}",
    "fileReplace.badNsp": "Not a valid NSP",
    "fileReplace.nspUnread": "Could not read the NSP's title id. Check that the server has nstool and the keys",
    "fileReplace.nspNotApp": "An update or DLC NSP does not replace an app",
    "fileReplace.otherTitle": "That NSP is another title (uploaded {got}, app {want})",
    "device.limit": "This account can register up to {n} consoles. Remove a console it no longer uses, then approve again.",
    "content.folderTaken": "That game already has a folder with the same name. Rename it or delete that one first",
    "upload.replaceToTrash": "The existing {name} could not go to the trash, so nothing was uploaded: {why}",
    "upload.folderAppeared": "A {name} folder appeared in the meantime, so nothing was uploaded. Upload again",
    "games.searchFailed": "Could not search the games. See the server log",
    failed: "Could not do that. See the server log",
    "guide.badPath": "Write the folder path relative to the storage folder, like retro/roms/gba",
    "guide.unknown": "There is no guide for that folder",
    "retroKo.noGame": "That retro game is not in the list",
    "retroKo.noGuess": "This game has no Korean title suggestion waiting for a decision",
  },
  ja: {
    "fileReplace.taken": "フォルダーに {name} がすでにあるため、置き換えませんでした。先にそのファイルを整理します",
    "fileReplace.one": "ファイルを 1 つだけアップロードします (.nro または .nsp)",
    "coreSwitch.bad": "core と enabled (true/false) が必要です",
    "fileReplace.unknown": "手動で置いたアプリの一覧にありません",
    "fileReplace.kind": "{name} は {want} ファイルでのみ置き換えます。形式を変えるにはアプリを削除して新しくアップロードします",
    "fileReplace.badNro": "正しい NRO ではありません: {why}",
    "fileReplace.badNsp": "正しい NSP ではありません",
    "fileReplace.nspUnread": "NSP のタイトル ID を読み取れませんでした。サーバーに nstool とキーがあるか確認します",
    "fileReplace.nspNotApp": "アップデートや DLC の NSP では置き換えません",
    "fileReplace.otherTitle": "別のタイトルの NSP です (アップロード {got}、現在のアプリ {want})",
    "device.limit": "このアカウントに登録できる本体は最大 {n} 台です。使っていない本体を解除してから、もう一度承認してください。",
    "content.folderTaken": "そのゲームには同じ名前のフォルダーがすでにあります。名前を変えるか、先にそちらを削除します",
    "upload.replaceToTrash": "今ある {name} をゴミ箱に移動できなかったため、アップロードしませんでした: {why}",
    "upload.folderAppeared": "その間に {name} フォルダーが新しくできたため、アップロードしませんでした。もう一度アップロードします",
    "games.searchFailed": "ゲームを検索できませんでした。サーバーのログを確認します",
    failed: "処理できませんでした。サーバーのログを確認します",
    "guide.badPath": "フォルダーのパスは retro/roms/gba のように保存フォルダーからの相対パスで書きます",
    "guide.unknown": "案内のあるフォルダーではありません",
    "retroKo.noGame": "一覧にないレトロゲームです",
    "retroKo.noGuess": "このゲームには判断待ちの韓国語タイトル候補がありません",
  },
  zh: {
    "fileReplace.taken": "文件夹中已有 {name}，因此没有替换。请先处理那个文件",
    "fileReplace.one": "只上传一个文件 (.nro 或 .nsp)",
    "coreSwitch.bad": "需要 core 和 enabled (true/false)",
    "fileReplace.unknown": "不在手动放置的应用列表中",
    "fileReplace.kind": "{name} 只能用 {want} 文件替换。要更换格式，请删除应用后重新上传",
    "fileReplace.badNro": "不是有效的 NRO: {why}",
    "fileReplace.badNsp": "不是有效的 NSP",
    "fileReplace.nspUnread": "无法读取 NSP 的标题 ID。请确认服务器上有 nstool 和密钥",
    "fileReplace.nspNotApp": "不能用更新或 DLC 的 NSP 替换应用",
    "fileReplace.otherTitle": "这是另一个标题的 NSP (上传的 {got}，当前应用 {want})",
    "device.limit": "此账户最多可以登记 {n} 台主机。请先解除不再使用的主机，然后重新批准。",
    "content.folderTaken": "该游戏已有同名文件夹。请改名或先删除那个文件夹",
    "upload.replaceToTrash": "无法将现有的 {name} 移入回收站，因此没有上传: {why}",
    "upload.folderAppeared": "在此期间出现了新的 {name} 文件夹，因此没有上传。请重新上传",
    "games.searchFailed": "无法搜索游戏。请查看服务器日志",
    failed: "无法处理。请查看服务器日志",
    "guide.badPath": "文件夹路径请写成相对于存储文件夹的路径，例如 retro/roms/gba",
    "guide.unknown": "这个文件夹没有说明",
    "retroKo.noGame": "列表中没有这个复古游戏",
    "retroKo.noGuess": "这个游戏没有等待决定的韩语标题建议",
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
