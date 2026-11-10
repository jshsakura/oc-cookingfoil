/**
 * The sidebar words of the menu plans (incoming row, group names, address words, moved server facts). First, the rows the menu plan added, in all twelve admin languages: the
 * holding area (upload, temp share and temp folder on one page) and its temp folder
 * section, plus the patches and saves list tabs. Korean is the source of truth.
 */
const KEYS = ["m.incoming", "m.organize", "m.list", "m.grpOps", "m.setLogin", "m.setAuto", "ip.self", "ip.lan", "ss.aboutVersion", "ss.aboutOrigin", "ss.aboutRegions", "lib.rescan", "lv.hashAll"];

const ROWS = {
  ko: ["임시 보관함", "임시 폴더", "목록", "작업과 기록", "구글 로그인", "자동화 토큰", "이 서버", "내부망", "버전", "공개 주소", "읽어 둔 titledb 지역", "다시 스캔", "전체 해시 검사"],
  en: ["Holding area", "Temp folder", "List", "Jobs and records", "Google sign-in", "Automation tokens", "This server", "Internal network", "Version", "Public address", "titledb regions loaded", "Rescan", "Check all hashes"],
  ja: ["一時保管庫", "一時フォルダー", "一覧", "作業と記録", "Google ログイン", "自動化トークン", "このサーバー", "内部ネットワーク", "バージョン", "公開アドレス", "読み込み済みの titledb 地域", "再スキャン", "すべてのハッシュを検査"],
  zh: ["临时存放区", "临时文件夹", "列表", "任务与记录", "Google 登录", "自动化令牌", "本服务器", "内网", "版本", "公开地址", "已读取的 titledb 地区", "重新扫描", "检查全部哈希"],
  "zh-Hant": ["臨時存放區", "暫存資料夾", "清單", "工作與記錄", "Google 登入", "自動化權杖", "本伺服器", "內網", "版本", "公開位址", "已讀取的 titledb 地區", "重新掃描", "檢查全部雜湊"],
  es: ["Depósito temporal", "Carpeta temporal", "Lista", "Tareas y registros", "Inicio de sesión con Google", "Tokens de automatización", "Este servidor", "Red interna", "Versión", "Dirección pública", "Regiones de titledb cargadas", "Volver a escanear", "Comprobar todos los hashes"],
  fr: ["Dépôt temporaire", "Dossier temporaire", "Liste", "Tâches et journaux", "Connexion Google", "Jetons d'automatisation", "Ce serveur", "Réseau interne", "Version", "Adresse publique", "Régions titledb chargées", "Réanalyser", "Vérifier tous les hachages"],
  de: ["Zwischenlager", "Temporärer Ordner", "Liste", "Aufgaben und Protokolle", "Google-Anmeldung", "Automatisierungs-Tokens", "Dieser Server", "Internes Netz", "Version", "Öffentliche Adresse", "Geladene titledb-Regionen", "Neu scannen", "Alle Hashes prüfen"],
  it: ["Deposito temporaneo", "Cartella temporanea", "Elenco", "Attività e registri", "Accesso con Google", "Token di automazione", "Questo server", "Rete interna", "Versione", "Indirizzo pubblico", "Regioni titledb caricate", "Scansiona di nuovo", "Controlla tutti gli hash"],
  pt: ["Depósito temporário", "Pasta temporária", "Lista", "Tarefas e registros", "Login do Google", "Tokens de automação", "Este servidor", "Rede interna", "Versão", "Endereço público", "Regiões do titledb carregadas", "Verificar novamente", "Verificar todos os hashes"],
  nl: ["Tijdelijke opslag", "Tijdelijke map", "Lijst", "Taken en logboeken", "Inloggen met Google", "Automatiseringstokens", "Deze server", "Intern netwerk", "Versie", "Openbaar adres", "Geladen titledb-regio's", "Opnieuw scannen", "Alle hashes controleren"],
  ru: ["Временное хранилище", "Временная папка", "Список", "Задачи и журналы", "Вход через Google", "Токены автоматизации", "Этот сервер", "Внутренняя сеть", "Версия", "Публичный адрес", "Загруженные регионы titledb", "Сканировать снова", "Проверить все хеши"],
};

export const NAV_WORDS = Object.fromEntries(Object.entries(ROWS).map(([lang, row]) => {
  if (row.length !== KEYS.length) throw new Error(`nav-words: ${lang} has ${row.length} words for ${KEYS.length} keys`);
  return [lang, Object.fromEntries(KEYS.map((k, i) => [k, row[i]]))];
}));
