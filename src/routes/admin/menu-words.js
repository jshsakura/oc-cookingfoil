/**
 * The admin menu's names (2026-11-12, picked by the owner): 대시보드, 업로드, 라이브러리, 메타데이터, 사용자, 홈 화면, 시스템, 설정,
 * and the tabs that read differently from their page's own heading. Korean is the source of truth.
 */
const KEYS = ["mn.dashboard", "mn.upload", "mn.retro", "mn.users", "mn.client", "mn.home", "mn.system", "mn.compress", "mn.xfer", "mn.clientLog", "mn.secLog", "mn.meta", "mn.review", "mn.artwork", "mn.titles", "mn.reqFiles"];

const ROWS = {
  ko: ["대시보드", "업로드", "레트로", "사용자", "클라이언트", "홈 화면", "시스템", "압축", "전송 기록", "클라이언트 기록", "보안 기록", "메타데이터", "검토 필요", "아트워크", "제목", "필수 파일"],
  en: ["Dashboard", "Upload", "Retro", "Users", "Client", "Home screen", "System", "Compression", "Transfer log", "Client log", "Security log", "Metadata", "Needs review", "Artwork", "Titles", "Required files"],
  ja: ["ダッシュボード", "アップロード", "レトロ", "ユーザー", "クライアント", "ホーム画面", "システム", "圧縮", "転送ログ", "クライアントログ", "セキュリティログ", "メタデータ", "要確認", "アートワーク", "タイトル", "必須ファイル"],
  zh: ["仪表板", "上传", "复古", "用户", "客户端", "主屏幕", "系统", "压缩", "传输记录", "客户端记录", "安全记录", "元数据", "待检查", "图稿", "标题", "必需文件"],
  "zh-Hant": ["儀表板", "上傳", "復古", "使用者", "用戶端", "主畫面", "系統", "壓縮", "傳輸記錄", "用戶端記錄", "安全記錄", "中繼資料", "待檢查", "圖稿", "標題", "必要檔案"],
  es: ["Panel", "Subida", "Retro", "Usuarios", "Cliente", "Pantalla de inicio", "Sistema", "Compresión", "Registro de transferencias", "Registro del cliente", "Registro de seguridad", "Metadatos", "Por revisar", "Ilustraciones", "Títulos", "Archivos necesarios"],
  fr: ["Tableau de bord", "Téléversement", "Rétro", "Utilisateurs", "Client", "Écran d'accueil", "Système", "Compression", "Journal des transferts", "Journal du client", "Journal de sécurité", "Métadonnées", "À vérifier", "Illustrations", "Titres", "Fichiers requis"],
  de: ["Dashboard", "Upload", "Retro", "Benutzer", "Client", "Startbildschirm", "System", "Komprimierung", "Übertragungsprotokoll", "Client-Protokoll", "Sicherheitsprotokoll", "Metadaten", "Zu prüfen", "Artwork", "Titel", "Erforderliche Dateien"],
  it: ["Dashboard", "Caricamento", "Retro", "Utenti", "Client", "Schermata iniziale", "Sistema", "Compressione", "Registro trasferimenti", "Registro client", "Registro sicurezza", "Metadati", "Da rivedere", "Grafica", "Titoli", "File richiesti"],
  pt: ["Painel", "Envio", "Retrô", "Usuários", "Cliente", "Tela inicial", "Sistema", "Compressão", "Registro de transferências", "Registro do cliente", "Registro de segurança", "Metadados", "A revisar", "Arte", "Títulos", "Arquivos necessários"],
  nl: ["Dashboard", "Uploaden", "Retro", "Gebruikers", "Client", "Startscherm", "Systeem", "Compressie", "Overdrachtslog", "Clientlog", "Beveiligingslog", "Metadata", "Te controleren", "Artwork", "Titels", "Vereiste bestanden"],
  ru: ["Панель", "Загрузка", "Ретро", "Пользователи", "Клиент", "Главный экран", "Система", "Сжатие", "Журнал передач", "Журнал клиента", "Журнал безопасности", "Метаданные", "На проверку", "Обложки", "Названия", "Нужные файлы"],
};

export const MENU_WORDS = Object.fromEntries(Object.entries(ROWS).map(([lang, row]) => {
  if (row.length !== KEYS.length) throw new Error(`menu-words: ${lang} has ${row.length} words for ${KEYS.length} keys`);
  return [lang, Object.fromEntries(KEYS.map((k, i) => [k, row[i]]))];
}));
