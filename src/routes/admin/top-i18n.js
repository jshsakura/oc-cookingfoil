// The admin page's top area (brand, the six-group nav, the sub-page row and the account menu) in the
// language the web page uses. The panels below stay Korean for now.

export const TOP_LANGS = [["ko", "한국어"], ["en", "English"], ["ja", "日本語"], ["zh", "中文"]];

export const TOP_WORDS = {
  ko: {
    title: "CookingFoil 서버 관리", loading: "불러오고 있습니다", web: "웹 화면", guide: "운영 안내", dark: "어두운 테마",
    logout: "로그아웃", language: "언어", nav: "서버 관리 메뉴", subnav: "세부 메뉴",
    "g.overview": "개요", "g.games": "게임", "g.retro": "레트로", "g.homebrew": "홈브류", "g.people": "사용자", "g.ops": "운영",
    "s.library": "파일", "s.nsz": "변환", "s.upload": "업로드", "s.inbox": "임시 공유", "s.featured": "홈 추천",
    "s.users": "계정", "s.devices": "기기", "s.logs": "로그", "s.alerts": "알림", "s.settings": "서버 설정",
  },
  en: {
    title: "CookingFoil server admin", loading: "Loading", web: "Web page", guide: "Admin guide", dark: "Dark theme",
    logout: "Sign out", language: "Language", nav: "Server admin menu", subnav: "Section menu",
    "g.overview": "Overview", "g.games": "Games", "g.retro": "Retro", "g.homebrew": "Homebrew", "g.people": "Users", "g.ops": "Operations",
    "s.library": "Files", "s.nsz": "Convert", "s.upload": "Upload", "s.inbox": "Shared inbox", "s.featured": "Home picks",
    "s.users": "Accounts", "s.devices": "Devices", "s.logs": "Logs", "s.alerts": "Alerts", "s.settings": "Server settings",
  },
  ja: {
    title: "CookingFoil サーバー管理", loading: "読み込んでいます", web: "Web 画面", guide: "運用ガイド", dark: "ダークテーマ",
    logout: "ログアウト", language: "言語", nav: "サーバー管理メニュー", subnav: "サブメニュー",
    "g.overview": "概要", "g.games": "ゲーム", "g.retro": "レトロ", "g.homebrew": "自作アプリ", "g.people": "ユーザー", "g.ops": "運用",
    "s.library": "ファイル", "s.nsz": "変換", "s.upload": "アップロード", "s.inbox": "一時共有", "s.featured": "ホームのおすすめ",
    "s.users": "アカウント", "s.devices": "デバイス", "s.logs": "ログ", "s.alerts": "通知", "s.settings": "サーバー設定",
  },
  zh: {
    title: "CookingFoil 服务器管理", loading: "正在加载", web: "网页", guide: "运维指南", dark: "深色主题",
    logout: "退出登录", language: "语言", nav: "服务器管理菜单", subnav: "子菜单",
    "g.overview": "概览", "g.games": "游戏", "g.retro": "复古", "g.homebrew": "自制软件", "g.people": "用户", "g.ops": "运维",
    "s.library": "文件", "s.nsz": "转换", "s.upload": "上传", "s.inbox": "临时分享", "s.featured": "首页推荐",
    "s.users": "账户", "s.devices": "设备", "s.logs": "日志", "s.alerts": "通知", "s.settings": "服务器设置",
  },
};

/** A label in the top area: Korean in the HTML, swapped by the script for the stored language. */
export const top = (key) => `<span data-top="${key}">${TOP_WORDS.ko[key]}</span>`;

export const TOP_LANG_HTML = /* html */ `<div class="top-langs" role="group" data-top-label="language" aria-label="${TOP_WORDS.ko.language}">${TOP_LANGS.map(([code, name]) =>
  `<button type="button" data-admin-lang="${code}" lang="${code}" aria-pressed="false">${name}</button>`).join("")}</div>`;

export const TOP_LANG_CSS = /* css */ `
.top-langs{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;padding:2px 6px}
.top-langs button{padding:6px 4px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.top-langs button:hover{background:var(--line)}
.top-langs button[aria-pressed="true"]{background:var(--text);color:var(--panel)}
`;

// Defined before the other admin scripts: the activity menu reads adminLang as it draws.
export const TOP_I18N_SCRIPT = /* js */ `
const ADMIN_LANG_KEY='cookingfoil:lang';
const topWords=${JSON.stringify(TOP_WORDS)};
// The web page's choice (same key); Korean until one is made, like the rest of this page.
let adminLang=(()=>{try{const v=localStorage.getItem(ADMIN_LANG_KEY);return topWords[v]?v:'ko';}catch{return 'ko';}})();
const topText=(key)=>topWords[adminLang][key]??topWords.ko[key];
function applyTopI18n(relabelActivity=true){
  document.title=topText('title');
  for(const el of document.querySelectorAll('[data-top]'))el.textContent=topText(el.dataset.top);
  for(const el of document.querySelectorAll('[data-top-label]'))el.setAttribute('aria-label',topText(el.dataset.topLabel));
  const who=document.getElementById('who');if(who&&Object.values(topWords).some((w)=>w.loading===who.textContent))who.textContent=topText('loading');
  for(const b of document.querySelectorAll('[data-admin-lang]'))b.setAttribute('aria-pressed',String(b.dataset.adminLang===adminLang));
  // The activity menu is declared further down and draws its own labels on start.
  if(relabelActivity)activityMenu.relabel();}
for(const b of document.querySelectorAll('[data-admin-lang]'))b.addEventListener('click',()=>{
  adminLang=b.dataset.adminLang;
  try{localStorage.setItem(ADMIN_LANG_KEY,adminLang);}catch{/* storage blocked: this visit only */}
  applyTopI18n();});
applyTopI18n(false);
`;
