// The admin page's top area (brand, the six-group nav, the sub-page row and the account menu) in the
// language the web page uses. The panels below stay Korean for now.

export const TOP_LANGS = [["ko", "한국어"], ["en", "English"], ["ja", "日本語"], ["zh", "中文"]];

export const TOP_WORDS = {
  ko: {
    title: "CookingFoil 서버 관리", loading: "불러오고 있습니다", web: "대시보드", guide: "운영 안내", dark: "어두운 테마",
    logout: "로그아웃", language: "언어", nav: "서버 관리 메뉴", subnav: "세부 메뉴",
    "g.overview": "개요", "g.games": "파일·정리", "g.retro": "레트로", "g.homebrew": "홈브류", "g.people": "계정·기기", "g.ops": "운영",
    "s.library": "파일", "s.nsz": "변환", "s.upload": "업로드", "s.inbox": "임시 공유", "s.featured": "홈 추천",
    "s.users": "계정", "s.devices": "기기", "s.logs": "로그", "s.alerts": "알림", "s.settings": "서버 설정",
    "f.type": "종류", "up.entry": "파일 올리기", "ops.status": "서버 현황", "up.seeFiles": "올린 파일은 파일 목록에서 확인합니다.",
  },
  en: {
    title: "CookingFoil server admin", loading: "Loading", web: "Web page", guide: "Admin guide", dark: "Dark theme",
    logout: "Sign out", language: "Language", nav: "Server admin menu", subnav: "Section menu",
    "g.overview": "Overview", "g.games": "Files", "g.retro": "Retro", "g.homebrew": "Homebrew", "g.people": "Accounts", "g.ops": "Operations",
    "s.library": "Files", "s.nsz": "Convert", "s.upload": "Upload", "s.inbox": "Shared inbox", "s.featured": "Home picks",
    "s.users": "Accounts", "s.devices": "Devices", "s.logs": "Logs", "s.alerts": "Alerts", "s.settings": "Server settings",
    "f.type": "Type", "up.entry": "Upload files", "ops.status": "Server status", "up.seeFiles": "Check uploaded files in the file list.",
  },
  ja: {
    title: "CookingFoil サーバー管理", loading: "読み込んでいます", web: "Web 画面", guide: "運用ガイド", dark: "ダークテーマ",
    logout: "ログアウト", language: "言語", nav: "サーバー管理メニュー", subnav: "サブメニュー",
    "g.overview": "概要", "g.games": "ファイル", "g.retro": "レトロ", "g.homebrew": "自作アプリ", "g.people": "アカウント", "g.ops": "運用",
    "s.library": "ファイル", "s.nsz": "変換", "s.upload": "アップロード", "s.inbox": "一時共有", "s.featured": "ホームのおすすめ",
    "s.users": "アカウント", "s.devices": "デバイス", "s.logs": "ログ", "s.alerts": "通知", "s.settings": "サーバー設定",
    "f.type": "種類", "up.entry": "ファイルをアップロード", "ops.status": "サーバーの状況", "up.seeFiles": "アップロードしたファイルはファイル一覧で確認します。",
  },
  zh: {
    title: "CookingFoil 服务器管理", loading: "正在加载", web: "网页", guide: "运维指南", dark: "深色主题",
    logout: "退出登录", language: "语言", nav: "服务器管理菜单", subnav: "子菜单",
    "g.overview": "概览", "g.games": "文件", "g.retro": "复古", "g.homebrew": "自制软件", "g.people": "账户", "g.ops": "运维",
    "s.library": "文件", "s.nsz": "转换", "s.upload": "上传", "s.inbox": "临时分享", "s.featured": "首页推荐",
    "s.users": "账户", "s.devices": "设备", "s.logs": "日志", "s.alerts": "通知", "s.settings": "服务器设置",
    "f.type": "类型", "up.entry": "上传文件", "ops.status": "服务器状态", "up.seeFiles": "上传的文件可在文件列表中查看。",
  },
};

/** A label in the top area: Korean in the HTML, swapped by the script for the stored language. */
export const top = (key) => `<span data-top="${key}">${TOP_WORDS.ko[key]}</span>`;

// The language chip left of the account button, the same as the web page's: the current code, a list on click.
export const TOP_LANG_HTML = /* html */ `<div class="lang-menu">
  <button class="lang-btn" id="lang-btn" type="button" aria-haspopup="menu" aria-expanded="false" data-top-label="language" aria-label="${TOP_WORDS.ko.language}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>
    <span id="lang-current">KO</span>
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
  </button>
  <div class="lang-list" id="lang-list" role="menu" hidden>${TOP_LANGS.map(([code, name]) =>
    `<button type="button" role="menuitemradio" data-admin-lang="${code}" lang="${code}" aria-checked="false">${name}</button>`).join("")}</div>
</div>`;

export const TOP_LANG_CSS = /* css */ `
.lang-menu{position:relative}
.lang-btn{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;cursor:pointer;border-radius:100px;border:1px solid var(--line);background:var(--panel);color:var(--text);font:700 13px inherit;font-family:inherit}
.lang-btn:hover,.lang-btn[aria-expanded="true"]{border-color:var(--text)}
.lang-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lang-btn .chev{width:13px;height:13px;color:var(--muted)}
.lang-list{position:absolute;right:0;top:calc(100% + 6px);z-index:60;min-width:148px;padding:6px;display:grid;gap:2px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 36px rgba(0,0,0,.18)}
.lang-list[hidden]{display:none}
.lang-list button{display:flex;justify-content:flex-start;height:auto;box-shadow:none;text-align:left;padding:9px 12px;border:0;border-radius:9px;cursor:pointer;background:transparent;color:var(--text);font:600 14px inherit;font-family:inherit}
.lang-list button:hover:not([aria-checked="true"]){background:var(--sunk)}
.lang-list button[aria-checked="true"]{background:var(--text);color:var(--panel)}
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
  for(const b of document.querySelectorAll('[data-admin-lang]'))b.setAttribute('aria-checked',String(b.dataset.adminLang===adminLang));
  document.getElementById('lang-current').textContent=adminLang.toUpperCase();
  // The activity menu is declared further down and draws its own labels on start.
  if(relabelActivity)activityMenu.relabel();}
const langList=document.getElementById('lang-list'),langBtn=document.getElementById('lang-btn');
function setLangMenu(open){langList.hidden=!open;langBtn.setAttribute('aria-expanded',String(open));
  if(open)langList.querySelector('[aria-checked="true"]')?.focus();}
langBtn.addEventListener('click',(e)=>{e.stopPropagation();setLangMenu(langList.hidden);});
document.addEventListener('click',(e)=>{if(!langList.hidden&&!e.target.closest('.lang-menu'))setLangMenu(false);});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!langList.hidden){setLangMenu(false);langBtn.focus();}});
for(const b of document.querySelectorAll('[data-admin-lang]'))b.addEventListener('click',()=>{
  adminLang=b.dataset.adminLang;
  try{localStorage.setItem(ADMIN_LANG_KEY,adminLang);}catch{/* storage blocked: this visit only */}
  setLangMenu(false);langBtn.focus();applyTopI18n();});
applyTopI18n(false);
`;
