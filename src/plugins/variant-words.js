/**
 * What the core says when a download option cannot be served, in the twelve client languages. A refusal
 * a plugin makes brings its own text; these are for the cases the plugin cannot speak in: it is off, in a
 * pause, missing, or its hook failed.
 */
export const VARIANT_WORDS = {
  en: {
    unavailable: "This download option is not available right now. Try again later, or install the original file.",
    failed: "The server could not prepare this download option. Try again later, or install the original file.",
    hookFailed: "A plugin could not prepare this download. Try again later.",
    routeFailed: "The server could not answer this request. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    tooMany: "Ask about at most {max} files at a time.",
    badFiles: "Send a list of game file paths in \"files\".",
  },
  ko: {
    unavailable: "이 받기 옵션을 지금은 쓸 수 없습니다. 잠시 뒤에 다시 시도하거나 원본 파일로 설치해 주세요.",
    failed: "서버가 이 받기 옵션을 준비하지 못했습니다. 잠시 뒤에 다시 시도하거나 원본 파일로 설치해 주세요.",
    hookFailed: "플러그인이 이 다운로드를 준비하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.",
    routeFailed: "서버가 이 요청에 답하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.",
    rateLimited: "요청이 너무 많습니다. 잠시 기다렸다가 다시 시도해 주세요.",
    tooMany: "한 번에 최대 {max}개 파일까지만 물어볼 수 있습니다.",
    badFiles: "\"files\" 에 게임 파일 경로 목록을 보내 주세요.",
  },
  ja: {
    unavailable: "このダウンロードオプションは現在利用できません。しばらくしてからやり直すか、元のファイルでインストールしてください。",
    failed: "サーバーがこのダウンロードオプションを準備できませんでした。しばらくしてからやり直すか、元のファイルでインストールしてください。",
    hookFailed: "プラグインがこのダウンロードを準備できませんでした。しばらくしてからやり直してください。",
    routeFailed: "サーバーがこのリクエストに応答できませんでした。しばらくしてからやり直してください。",
    rateLimited: "リクエストが多すぎます。しばらく待ってからやり直してください。",
    tooMany: "一度に問い合わせられるファイルは最大 {max} 個です。",
    badFiles: "\"files\" にゲームファイルのパスの一覧を送ってください。",
  },
  zh: {
    unavailable: "此下载选项目前不可用。请稍后重试,或安装原始文件。",
    failed: "服务器无法准备此下载选项。请稍后重试,或安装原始文件。",
    hookFailed: "插件无法准备此下载。请稍后重试。",
    routeFailed: "服务器无法响应此请求。请稍后重试。",
    rateLimited: "请求过多。请稍等片刻后重试。",
    tooMany: "一次最多只能查询 {max} 个文件。",
    badFiles: "请在 \"files\" 中发送游戏文件路径列表。",
  },
  "zh-Hant": {
    unavailable: "此下載選項目前無法使用。請稍後重試,或安裝原始檔案。",
    failed: "伺服器無法準備此下載選項。請稍後重試,或安裝原始檔案。",
    hookFailed: "插件无法准备此下载。请稍后重试。",
    routeFailed: "服务器无法响应此请求。请稍后重试。",
    rateLimited: "请求过多。请稍等片刻后重试。",
    tooMany: "一次最多只能查詢 {max} 個檔案。",
    badFiles: "請在 \"files\" 中傳送遊戲檔案路徑清單。",
  },
  es: {
    unavailable: "Esta opción de descarga no está disponible ahora. Inténtalo más tarde o instala el archivo original.",
    failed: "El servidor no pudo preparar esta opción de descarga. Inténtalo más tarde o instala el archivo original.",
    hookFailed: "A plugin could not prepare this download. Try again later.",
    routeFailed: "The server could not answer this request. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    tooMany: "Se pueden consultar como máximo {max} archivos a la vez.",
    badFiles: "Envía en \"files\" una lista de rutas de archivos de juego.",
  },
  fr: {
    unavailable: "Cette option de téléchargement n'est pas disponible pour le moment. Réessayez plus tard ou installez le fichier d'origine.",
    failed: "Le serveur n'a pas pu préparer cette option de téléchargement. Réessayez plus tard ou installez le fichier d'origine.",
    hookFailed: "A plugin could not prepare this download. Try again later.",
    routeFailed: "The server could not answer this request. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    tooMany: "Vous pouvez interroger au plus {max} fichiers à la fois.",
    badFiles: "Envoyez dans \"files\" une liste de chemins de fichiers de jeu.",
  },
  de: {
    unavailable: "Diese Download-Option ist gerade nicht verfügbar. Versuche es später erneut oder installiere die Originaldatei.",
    failed: "Der Server konnte diese Download-Option nicht vorbereiten. Versuche es später erneut oder installiere die Originaldatei.",
    hookFailed: "A plugin could not prepare this download. Try again later.",
    routeFailed: "The server could not answer this request. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    tooMany: "Es können höchstens {max} Dateien auf einmal abgefragt werden.",
    badFiles: "Sende in \"files\" eine Liste von Spieldateipfaden.",
  },
  it: {
    unavailable: "Questa opzione di download non è disponibile al momento. Riprova più tardi oppure installa il file originale.",
    failed: "Il server non è riuscito a preparare questa opzione di download. Riprova più tardi oppure installa il file originale.",
    hookFailed: "A plugin could not prepare this download. Try again later.",
    routeFailed: "The server could not answer this request. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    tooMany: "Si possono interrogare al massimo {max} file alla volta.",
    badFiles: "Invia in \"files\" un elenco di percorsi di file di gioco.",
  },
  pt: {
    unavailable: "Esta opção de download não está disponível agora. Tente novamente mais tarde ou instale o arquivo original.",
    failed: "O servidor não conseguiu preparar esta opção de download. Tente novamente mais tarde ou instale o arquivo original.",
    hookFailed: "A plugin could not prepare this download. Try again later.",
    routeFailed: "The server could not answer this request. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    tooMany: "Você pode consultar no máximo {max} arquivos por vez.",
    badFiles: "Envie em \"files\" uma lista de caminhos de arquivos de jogo.",
  },
  ru: {
    unavailable: "Этот вариант загрузки сейчас недоступен. Повторите попытку позже или установите исходный файл.",
    failed: "Сервер не смог подготовить этот вариант загрузки. Повторите попытку позже или установите исходный файл.",
    hookFailed: "A plugin could not prepare this download. Try again later.",
    routeFailed: "The server could not answer this request. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    tooMany: "За один раз можно запросить не более {max} файлов.",
    badFiles: "Передайте в \"files\" список путей к файлам игр.",
  },
  nl: {
    unavailable: "Deze downloadoptie is nu niet beschikbaar. Probeer het later opnieuw of installeer het originele bestand.",
    failed: "De server kon deze downloadoptie niet voorbereiden. Probeer het later opnieuw of installeer het originele bestand.",
    hookFailed: "A plugin could not prepare this download. Try again later.",
    routeFailed: "The server could not answer this request. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    tooMany: "Je kunt maximaal {max} bestanden tegelijk opvragen.",
    badFiles: "Stuur in \"files\" een lijst met paden van spelbestanden.",
  },
};

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));

/** The text of `key` in every language, with `vars` filled in. */
export const wordsOf = (key, vars = {}) => Object.fromEntries(Object.entries(VARIANT_WORDS).map(([lang, t]) => [lang, fill(t[key], vars)]));
