/**
 * The sidebar words of the menu plans (incoming row, group names, address words, moved server facts). First, the rows the menu plan added, in all twelve admin languages: the
 * incoming row (upload, temp folder, temp share as tabs) and its temp folder
 * page, plus the games page's "game list" tab and the patches and saves list tabs. Korean is the source of truth.
 */
const KEYS = ["m.incoming", "m.organize", "m.gameList", "m.list", "m.grpOps", "m.setLogin", "m.setAuto", "ip.self", "ip.lan", "ss.aboutVersion", "ss.aboutOrigin", "ss.aboutRegions", "lib.rescan", "lv.hashAll"];

const ROWS = {
  ko: ["파일 업로드", "임시 폴더", "게임 목록", "목록", "작업과 기록", "로그인", "자동화 토큰", "이 서버", "내부망", "버전", "공개 주소", "읽어 둔 titledb 지역", "다시 스캔", "전체 해시 검사"],
  en: ["File upload", "Temp folder", "Game list", "List", "Jobs and records", "Sign-in", "Automation tokens", "This server", "Internal network", "Version", "Public address", "titledb regions loaded", "Rescan", "Check all hashes"],
  ja: ["ファイルのアップロード", "一時フォルダー", "ゲーム一覧", "一覧", "作業と記録", "ログイン", "自動化トークン", "このサーバー", "内部ネットワーク", "バージョン", "公開アドレス", "読み込み済みの titledb 地域", "再スキャン", "すべてのハッシュを検査"],
  zh: ["上传文件", "临时文件夹", "游戏列表", "列表", "任务与记录", "登录", "自动化令牌", "本服务器", "内网", "版本", "公开地址", "已读取的 titledb 地区", "重新扫描", "检查全部哈希"],
  "zh-Hant": ["上傳檔案", "暫存資料夾", "遊戲清單", "清單", "工作與記錄", "登入", "自動化權杖", "本伺服器", "內網", "版本", "公開位址", "已讀取的 titledb 地區", "重新掃描", "檢查全部雜湊"],
  es: ["Subir archivos", "Carpeta temporal", "Lista de juegos", "Lista", "Tareas y registros", "Inicio de sesión", "Tokens de automatización", "Este servidor", "Red interna", "Versión", "Dirección pública", "Regiones de titledb cargadas", "Volver a escanear", "Comprobar todos los hashes"],
  fr: ["Envoi de fichiers", "Dossier temporaire", "Liste des jeux", "Liste", "Tâches et journaux", "Connexion", "Jetons d'automatisation", "Ce serveur", "Réseau interne", "Version", "Adresse publique", "Régions titledb chargées", "Réanalyser", "Vérifier tous les hachages"],
  de: ["Datei-Upload", "Temporärer Ordner", "Spieleliste", "Liste", "Aufgaben und Protokolle", "Anmeldung", "Automatisierungs-Tokens", "Dieser Server", "Internes Netz", "Version", "Öffentliche Adresse", "Geladene titledb-Regionen", "Neu scannen", "Alle Hashes prüfen"],
  it: ["Caricamento file", "Cartella temporanea", "Elenco giochi", "Elenco", "Attività e registri", "Accesso", "Token di automazione", "Questo server", "Rete interna", "Versione", "Indirizzo pubblico", "Regioni titledb caricate", "Scansiona di nuovo", "Controlla tutti gli hash"],
  pt: ["Envio de arquivos", "Pasta temporária", "Lista de jogos", "Lista", "Tarefas e registros", "Login", "Tokens de automação", "Este servidor", "Rede interna", "Versão", "Endereço público", "Regiões do titledb carregadas", "Verificar novamente", "Verificar todos os hashes"],
  nl: ["Bestanden uploaden", "Tijdelijke map", "Spellenlijst", "Lijst", "Taken en logboeken", "Inloggen", "Automatiseringstokens", "Deze server", "Intern netwerk", "Versie", "Openbaar adres", "Geladen titledb-regio's", "Opnieuw scannen", "Alle hashes controleren"],
  ru: ["Загрузка файлов", "Временная папка", "Список игр", "Список", "Задачи и журналы", "Вход", "Токены автоматизации", "Этот сервер", "Внутренняя сеть", "Версия", "Публичный адрес", "Загруженные регионы titledb", "Сканировать снова", "Проверить все хеши"],
};

export const NAV_WORDS = Object.fromEntries(Object.entries(ROWS).map(([lang, row]) => {
  if (row.length !== KEYS.length) throw new Error(`nav-words: ${lang} has ${row.length} words for ${KEYS.length} keys`);
  return [lang, Object.fromEntries(KEYS.map((k, i) => [k, row[i]]))];
}));
