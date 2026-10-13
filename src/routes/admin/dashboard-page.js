/**
 * The operator dashboard.
 *
 * Its job, in order of importance:
 *   1. say out loud when the current auth configuration locks out a client
 *      that the operator thinks should work (the pairing-only / Tinfoil trap)
 *   2. manage who can connect: accounts, devices, lockouts
 *   3. show every refusal the server made, with the reason
 *   4. keep the library healthy without shell access
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { DASHBOARD_SCRIPT } from "./dashboard-script.js";
import { ICON_CSS, icon } from "../../views/icons.js";
import { INTEGRATIONS_CSS, INTEGRATIONS_HTML, INTEGRATIONS_SCRIPT } from "./integrations-panel.js";
import { RETRO_ART_CSS, RETRO_ART_HTML, RETRO_ART_SCRIPT } from "./retro-art-panel.js";
import { ALERTS_CSS, ALERTS_HTML, ALERTS_SCRIPT } from "./alerts-panel.js";
import { SERVER_SETTINGS_CSS, SERVER_SETTINGS_HTML, SERVER_SETTINGS_SCRIPT } from "./server-settings-panel.js";
import { LIBRARY_FILES_HTML, LIBRARY_FILES_SCRIPT } from "./library-files-panel.js";
import { CONTENT_DIALOG_HTML, GAME_PATCHES_HTML, PATCHES_CSS, PATCHES_HTML, PATCHES_SCRIPT } from "./patches-panel.js";
import { TOKENS_HTML, TOKENS_SCRIPT } from "./tokens-panel.js";

const PAGE_CSS = /* css */ `
body{padding:28px 24px 60px}.wrap{max-width:1100px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:22px}
.brand{margin:0}.brand a{display:flex;align-items:center;gap:12px;color:var(--text);text-decoration:none}
.logo{width:44px;height:44px;flex:none}
.brand .wm{font-family:'Baloo 2',inherit;font-size:31px;font-weight:800;letter-spacing:-.02em;line-height:1;padding-top:4px}.brand .wm .dot{color:var(--accent)}
/* the dashboard's view switch, so the admin page reads as its third tab */
.apptabs{display:inline-flex;gap:2px;padding:3px;margin-right:auto;border:1px solid var(--line);border-radius:100px;background:var(--panel)}
.apptabs a{padding:6px 14px;border-radius:100px;color:var(--muted);text-decoration:none;font-weight:600;font-size:13px;white-space:nowrap}
.apptabs a:hover{color:var(--text)}.apptabs a[aria-current="page"]{background:var(--text);color:var(--bg)}
.tfa{display:grid;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin-bottom:22px}
.tfa .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tfa-setup{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start}.tfa-setup[hidden]{display:none}
.tfa-qr{width:180px;height:180px;background:#fff;border-radius:12px;padding:6px}.tfa-qr svg{width:100%;height:100%;display:block}
.tfa-key{font-family:ui-monospace,monospace;font-size:15px;letter-spacing:1px;word-break:break-all;background:var(--sunk);border-radius:10px;padding:10px 12px}
@media(max-width:640px){.tfa-setup{grid-template-columns:1fr}}
.who{color:var(--muted);font-size:13px}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.seg{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--line);border-radius:100px;background:var(--panel)}
.seg button{border:none;border-radius:100px;padding:6px 10px;color:var(--muted)}
.seg button.active{background:var(--text);color:var(--bg)}
.seg svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
nav.tabs{display:flex;gap:6px;padding:6px;margin-bottom:22px;overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:16px}
nav.tabs a{padding:10px 13px;color:var(--muted);text-decoration:none;font-weight:700;border-radius:11px;white-space:nowrap}
nav.tabs a:hover{color:var(--text)}
nav.tabs a[aria-current="page"]{color:var(--bg);background:var(--text)}
.count[hidden]{display:none}
.count{display:inline-block;min-width:18px;padding:0 6px;margin-left:6px;border-radius:100px;font-size:11px;background:rgba(var(--bad-rgb),.18);color:var(--bad)}
section[hidden]{display:none}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px 20px}
.card .v{font-size:28px;font-weight:800;letter-spacing:-.02em}
.card .l{color:var(--muted);font-size:12px}
.card.alert{border-color:rgba(var(--bad-rgb),.45)}.card.alert .v{color:var(--bad)}
.lanes{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0}
.scroll{overflow-x:auto}
.hd{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.hd h2{margin:22px 0 10px}
form.add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:12px}
form.add input{flex:1;min-width:150px}
form.add label.toggle{flex-basis:100%;display:flex;align-items:center;gap:8px;font-weight:600}
form.add label.toggle input{flex:none;min-width:0;width:18px;height:18px}
.copy-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.copy-row[hidden],.add[hidden]{display:none}
/* One account menu, the same as the web page's: a circle that opens who you are, the web page, the guide and sign out. */
.acct-menu{position:relative}
.icon-btn{display:inline-grid;place-items:center;width:38px;height:38px;padding:0;border-radius:100px;border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer}
.icon-btn:hover,.icon-btn[aria-expanded="true"]{border-color:var(--text)}.icon-btn .ico{width:19px;height:19px}
.pop-list{position:absolute;right:0;top:calc(100% + 6px);z-index:60;min-width:210px;padding:6px;display:grid;gap:2px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 36px var(--shadow)}
.pop-list[hidden]{display:none}
.pop-list .who{margin:0 0 4px;padding:8px 12px 10px;border-bottom:1px solid var(--line);color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-list a,.pop-list button{display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;padding:9px 12px;border:0;border-radius:9px;background:none;text-decoration:none;color:var(--text);font:600 14px inherit;text-align:left;cursor:pointer}
.pop-list a:hover,.pop-list button:hover{background:var(--sunk)}.pop-list #logout{color:var(--bad)}
.howto{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:22px}
.howto ul{margin:8px 0 0;padding-left:20px;display:grid;gap:6px;font-size:14px;line-height:1.6}.howto .copy-row code{background:var(--sunk)}
.copy-row code{flex:1;min-width:0;overflow-wrap:anywhere;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13px;user-select:all}
.up-kinds{display:flex;gap:6px;flex-wrap:wrap}
.up-drop{display:grid;justify-items:center;gap:8px;text-align:center;padding:34px 20px;margin-bottom:14px;border:2px dashed var(--line);border-radius:20px;background:var(--panel);cursor:pointer;transition:border-color .15s,background .15s}
.up-drop:hover,.up-drop:focus-visible,.up-drop.over{border-color:var(--accent);background:rgba(var(--accent-rgb),.08);outline:none}
.up-drop svg{width:40px;height:40px;fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.up-drop b{font-size:17px}.up-drop span{color:var(--muted);font-size:13px;max-width:520px;word-break:break-word}
.up-drop.has span{color:var(--text);font-weight:600}
.up-drop .pick{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:6px}
.up-go{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.up-more summary{cursor:pointer;color:var(--muted);font-size:13px;font-weight:600}
.up-more[open]{display:grid;gap:12px}.up-more[hidden]{display:none}
.up-more label{display:grid;gap:6px;font-size:13px;color:var(--muted);font-weight:600}
.up-foot{margin-top:12px}
body.dragging #tab-upload .up-drop{border-color:var(--accent)}
.up-kinds button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
form.up{display:grid;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
form.up[hidden]{display:none}
form.up label{display:grid;gap:6px;font-size:13px;color:var(--muted);font-weight:600}
form.up label[hidden]{display:none}
form.up label.check,td label.check{display:flex;gap:8px;align-items:center;color:var(--text)}
form.up textarea{padding:10px 14px;border-radius:12px;border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:14px;min-height:72px;resize:vertical}
.bar{height:8px;border-radius:8px;background:var(--sunk);overflow:hidden}
.bar>i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.up-log{display:grid;gap:6px;margin-top:14px}
td .row-actions{display:flex;gap:6px;flex-wrap:wrap}
td .xline{display:flex;gap:6px;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:13px}
td.dim{color:var(--faint)}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;margin:0;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px}
dl.kv dt{color:var(--muted);font-size:13px}dl.kv dd{margin:0;font-size:13px;word-break:break-all}
dialog{border:1px solid var(--line);border-radius:22px;background:var(--panel);color:var(--text);padding:24px;width:min(520px,calc(100vw - 32px));box-shadow:0 30px 60px var(--shadow)}
dialog::backdrop{background:rgba(0,0,0,.55)}
#hb-apps tr.hb-off td:not(:first-child){opacity:.5}
dialog h3{margin:0 0 6px;font-size:18px}
.cred{display:grid;grid-template-columns:max-content 1fr max-content;gap:8px 12px;align-items:center;margin:16px 0}
.cred .v{font-family:ui-monospace,monospace;background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:7px 10px;word-break:break-all}
.dialog-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:12px 20px;border-radius:100px;font-size:13px;font-weight:600;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.show{opacity:1}
.fcard{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;margin-bottom:14px}
.fcard .top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.fcard .top input{flex:1;min-width:180px}
.fgames{list-style:none;margin:0 0 12px;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.fgames li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--sunk)}
.fgames li:last-child{border-bottom:none}
.fgames img{width:40px;height:40px;border-radius:10px;flex:none;background:var(--line)}
.fgames .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fgames button{padding:4px 9px}
.fadd{display:flex;gap:8px;flex-wrap:wrap}.fadd input{flex:1;min-width:200px}
h2.first{margin-top:0}
.note .note-go{margin-top:10px}
.hd h2.first{margin:0 0 10px}
.hb-reco{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-bottom:8px}
.hb-reco label{display:flex;gap:10px;align-items:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;cursor:pointer}
.hb-reco label.added{opacity:.6;cursor:default}
.hb-reco input{margin-top:3px;width:16px;height:16px;flex:none;padding:0}
.hb-reco b{display:block;font-size:13px;word-break:break-all}.hb-reco span{color:var(--muted);font-size:12px}
td select{max-width:220px}
td .err{color:var(--bad);font-size:12px;margin-top:4px}
td .muted{color:var(--muted);font-size:12px;margin-top:4px}
td a{color:var(--text);text-underline-offset:3px}
.desc-form{display:grid;gap:12px}#gd-body{display:grid;gap:12px}#gd-body h3{margin:6px 0 0;font-size:15px}#gd-body[hidden]{display:none}#gd-form{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}.desc-form label{display:grid;gap:6px;font-size:13px;color:var(--muted);font-weight:600}
.desc-form textarea{padding:10px 14px;border-radius:12px;border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:14px;min-height:90px;resize:vertical}
td .desc{color:var(--muted);font-size:12px;margin-top:4px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
form.add select{flex:none}
.logs-view{display:grid;grid-template-columns:minmax(200px,280px) 1fr;gap:12px;margin-bottom:8px}
.logs-list{display:grid;gap:8px;align-content:start;max-height:520px;overflow:auto}
.logs-list details{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
.logs-list summary{cursor:pointer;font-weight:700;display:flex;justify-content:space-between;gap:8px}
.logs-list summary span{color:var(--muted);font-weight:500;font-size:12px}
.logs-list button{display:flex;width:100%;justify-content:space-between;margin-top:6px;padding:7px 10px;font-weight:500}
.logs-list button[aria-pressed="true"]{border-color:var(--accent);background:rgba(var(--accent-rgb),.14)}
.logs-body{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column}
.logs-head{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--muted);font-size:13px;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.logs-body pre{margin:0;padding:14px;min-height:220px;max-height:520px;overflow:auto;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
.me{margin-left:6px}
/* Phones: tables turn into one card per row, each cell labelled. */
@media (max-width:640px){
body{padding:16px 12px 48px}header{margin-bottom:12px}
.brand .wm{font-size:24px}.brand img{width:32px;height:32px}
/* Every menu in sight: two rows of five, icon over label, instead of a strip that hides half of them. */
nav.tabs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;padding:6px;margin-bottom:18px;overflow:visible}
nav.tabs a{flex-direction:column;justify-content:center;gap:3px;padding:8px 2px;font-size:12px;border-radius:10px;text-align:center}
nav.tabs a svg{width:18px;height:18px}nav.tabs .count{position:absolute;margin:-30px 0 0 26px}nav.tabs a{position:relative}
form.add input,form.add select,form.add button{flex:1 1 100%}
.logs-view{grid-template-columns:1fr}
table,tbody,tr,td{display:block;width:100%}table{border:0;background:none}
tr:first-child:has(th){display:none}
tr{background:var(--panel);border:1px solid var(--line);border-radius:14px;margin-bottom:10px;padding:6px 0}
td{border:0;padding:6px 14px;display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:center}
td::before{content:attr(data-label);color:var(--muted);font-size:12px}
td[data-label=""]{grid-template-columns:1fr}td[data-label=""]::before{display:none}
/* The first cell is the card's title, full width, its details under it. */
td:first-child{grid-template-columns:1fr;padding-top:10px}td:first-child::before{display:none}td:first-child b{font-size:15px}
td .row-actions{display:flex;gap:8px}td .row-actions button,td[data-label=""]>button{flex:1 1 0;min-width:0}
td .xline{margin-bottom:8px}td>button{width:100%}
/* A labelled cell holding several things (a list and its button) keeps them all beside the label. */
td:not(:first-child):not([data-label=""])>*{grid-column:2}
}
`;


export function dashboardPage() {
  return /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil 관리</title>${ADMIN_HEAD}<style>${ADMIN_CSS}${PAGE_CSS}${INTEGRATIONS_CSS}${RETRO_ART_CSS}${ALERTS_CSS}${PATCHES_CSS}${SERVER_SETTINGS_CSS}${ICON_CSS}
nav.tabs a{display:inline-flex;align-items:center;gap:7px}</style></head><body>
<div class="wrap">
<header>
  <h1 class="brand" aria-label="CookingFoil 관리"><a href="/#all"><img class="logo" src="/assets/cookingfoil.svg" alt="" width="42" height="42"><span class="wm">cookingfoil<span class="dot">.</span></span></a></h1>
  <div class="acct-menu">
    <button class="icon-btn" id="acct-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="계정 메뉴" title="계정 메뉴">${icon("account")}</button>
    <div class="pop-list" id="acct-list" role="menu" hidden>
      <p class="who" id="who">불러오고 있습니다</p>
      <a role="menuitem" href="/">${icon("home")}웹 화면</a>
      <a role="menuitem" href="/admin/guide" target="_blank" rel="noopener">${icon("book")}운영 안내</a>
      <button role="menuitem" type="button" id="logout">${icon("logout")}로그아웃</button>
    </div>
  </div>
</header>

<nav class="tabs" aria-label="관리 메뉴">
  <a href="#overview" data-tab="overview">${icon("dashboard")}개요</a>
  <a href="#users" data-tab="users">${icon("users")}사용자<span class="count" id="account-count" hidden></span></a>
  <a href="#devices" data-tab="devices">${icon("device")}기기<span class="count" id="pending-count" hidden></span></a>
  <a href="#settings" data-tab="settings">${icon("sliders")}설정</a>
  <a href="#alerts" data-tab="alerts">${icon("bell")}알림</a>
  <a href="#logs" data-tab="logs">${icon("log")}로그<span class="count" id="lock-count" hidden></span></a>
  <a href="#featured" data-tab="featured">${icon("star")}추천</a>
  <a href="#library" data-tab="library">${icon("folder")}라이브러리</a>
  <a href="#upload" data-tab="upload">${icon("upload")}업로드</a>
  <a href="#homebrew" data-tab="homebrew">${icon("package")}홈브류</a>
  <a href="#retro" data-tab="retro">${icon("image")}레트로</a>
</nav>

<section id="tab-overview">
  <h2 class="first">연결</h2>
  <div class="howto">
    <div class="copy-row"><code id="shop-url">—</code><button type="button" id="shop-url-copy">복사</button></div>
    <ul>
      <li><b>CookingFoil</b>: 위 주소를 넣으면 기기 화면에 승인 요청이 뜹니다. 계정이 맞으면 바로 승인되고, 아니면 기기 탭의 승인 대기에서 승인합니다. 비밀번호를 기기에 남기지 않습니다.</li>
      <li><b>CyberFoil</b>: 설정의 주소(URL) 칸에 위 주소를 넣습니다. 사용자 이름과 비밀번호 칸에는 계정 비밀번호 대신 기기 탭의 '기기별 접속 정보'에서 만든 것을 넣습니다. 그 기기 하나에만 묶이고 언제든 끊을 수 있습니다.</li>
      <li><b>Tinfoil</b>(호환): File Browser 에서 + 로 위 주소를 넣습니다. 목록을 읽고 받는 호환 경로만 제공합니다.</li>
    </ul>
  </div>
  <div id="warnings"></div>
  <div class="lanes" id="lanes"></div>
  <div class="lanes" id="health"></div>
  <p class="muted" id="health-hint" hidden></p>
  <div class="cards" id="cards"></div>
  <p class="muted" id="ts"></p>
</section>

<section id="tab-users" hidden>
  <h2 class="first">계정</h2>
  <form class="add" id="add-user">
    <input id="new-name" autocomplete="off" placeholder="사용자 이름 (영문, 숫자, . _ -)" aria-label="사용자 이름" required maxlength="32">
    <input id="new-pass" type="password" autocomplete="new-password" placeholder="비밀번호 (비우면 자동 생성)" aria-label="비밀번호" maxlength="128">
    <select id="new-role" aria-label="역할"><option value="user">일반 사용자</option><option value="admin">관리자</option></select>
    <button class="primary" type="submit">사용자 추가</button>
  </form>
  <p class="muted">웹은 이 계정으로 /login 에서 로그인하고, CyberFoil 과 Tinfoil 은 같은 아이디와 비밀번호로 접속합니다. 관리자만 이 관리 페이지를 엽니다. 비밀번호는 만들거나 바꿀 때 한 번만 보여 주고 서버에는 해시만 남깁니다.</p>
  <div class="scroll" id="users"></div>
  <h2>구글 로그인 계정</h2>
  <p class="muted" id="accounthint"></p>
  <div class="scroll" id="accounts"></div>
</section>

<section id="tab-devices" hidden>
  <p class="muted" id="devhint"></p>
  <form class="add" id="approve-code">
    <input id="code-in" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="기기 화면의 기기 코드 8자리" aria-label="기기 코드" required maxlength="9">
    <input id="code-label" autocomplete="off" placeholder="기기 이름 (선택)" aria-label="기기 이름" maxlength="64">
    <button class="primary" type="submit">기기 코드로 승인</button>
  </form>
  <h2>승인 대기</h2><div class="scroll" id="pending"></div>
  <h2>승인된 기기</h2><div class="scroll" id="devices"></div>
  <h2>기기별 접속 정보 (CyberFoil·Tinfoil)</h2>
  <p class="muted">사용자가 기기 승인 화면(/pair)에서 기기마다 만든 아이디와 비밀번호입니다. 처음 접속한 기기에만 묶이고, 서버의 목록을 읽고 파일을 받는 것만 할 수 있습니다.</p>
  <form class="add" id="add-login">
    <input id="login-label" autocomplete="off" placeholder="기기 이름 (선택)" aria-label="기기 이름" maxlength="64">
    <button class="primary" type="submit">접속 정보 만들기</button>
  </form>
  <div class="scroll" id="logins"></div>
</section>

<section id="tab-settings" hidden>
  ${SERVER_SETTINGS_HTML}
  ${INTEGRATIONS_HTML}
  <div class="hd"><h2>구글 로그인 설정</h2></div>
  <p class="muted">구글 로그인은 덤입니다. 꺼 두면 아이디와 비밀번호로만 로그인하고, 켜면 로그인 화면에 구글 버튼이 붙습니다. 저장하면 바로 적용합니다.</p>
  <form class="add google-form" id="google-form" autocomplete="off">
    <label class="toggle"><input type="checkbox" id="g-enabled"> 구글 로그인을 씁니다</label>
    <input id="g-id" placeholder="클라이언트 ID (….apps.googleusercontent.com)" aria-label="클라이언트 ID" maxlength="200" spellcheck="false">
    <input id="g-secret" type="password" autocomplete="new-password" placeholder="클라이언트 시크릿" aria-label="클라이언트 시크릿" maxlength="200">
    <button class="primary" type="submit">저장</button>
    <button type="button" id="g-clear" class="danger">키 지우기</button>
  </form>
  <p class="muted">구글 클라우드 콘솔의 OAuth 클라이언트(웹 애플리케이션)에 아래 리디렉션 URI를 등록합니다.</p>
  <div class="copy-row"><code id="g-redirect">불러오고 있습니다</code><button type="button" id="g-copy">복사</button></div>
  <p class="muted" id="g-status"></p>
  <div class="hd"><h2>관리 페이지 2단계 인증</h2></div>
  <div class="tfa" id="tfa">
    <p id="tfa-status" class="muted">불러오고 있습니다</p>
    <div class="row" id="tfa-actions"></div>
    <div class="tfa-setup" id="tfa-setup" hidden>
      <div class="tfa-qr" id="tfa-qr" role="img" aria-label="인증 앱 QR 코드"></div>
      <div class="tfa-steps">
        <p class="muted">인증 앱(Google Authenticator, 1Password 등)으로 QR 을 찍거나 아래 키를 직접 넣습니다. 그다음 앱에 나온 6자리 코드를 입력하면 등록이 끝납니다. 끝내기 전까지는 지금 로그인 방식이 그대로입니다.</p>
        <div class="tfa-key" id="tfa-key"></div>
        <div class="row" style="margin-top:10px">
          <input id="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="확인 코드">
          <button type="button" class="primary" id="tfa-confirm">등록</button>
          <button type="button" id="tfa-cancel">취소</button>
        </div>
      </div>
    </div>
  </div>
  <p class="muted">관리 페이지는 관리자 계정으로 로그인한 뒤에 한 번 더 확인합니다. 관리자 비밀번호나 인증 앱 코드 중 하나를 넣습니다.</p>
  <div class="hd"><h2>관리자 비밀번호</h2></div>
  <form class="tfa" id="ap-form" autocomplete="off">
    <p id="ap-status" class="muted">불러오고 있습니다</p>
    <div class="row">
      <input id="ap-current" type="password" autocomplete="current-password" placeholder="지금 비밀번호" aria-label="지금 비밀번호" maxlength="200">
      <input id="ap-new" type="password" autocomplete="new-password" placeholder="새 비밀번호 (12자 이상)" aria-label="새 비밀번호" minlength="12" maxlength="200">
      <input id="ap-new2" type="password" autocomplete="new-password" placeholder="새 비밀번호 한 번 더" aria-label="새 비밀번호 확인" maxlength="200">
    </div>
    <div class="row"><button class="primary" type="submit">비밀번호 정하기</button><button type="button" class="danger" id="ap-clear">여기서 정한 비밀번호 지우기</button></div>
  </form>
  ${TOKENS_HTML}
</section>

<section id="tab-logs" hidden>
  <div class="hd"><h2>클라이언트 로그</h2><button type="button" id="cl-refresh">새로 고침</button></div>
  <p class="muted">CookingFoil 이 오류를 만나면 보내 온 기록입니다. 기기마다 최근 50개를 남깁니다.</p>
  <div class="logs-view">
    <div class="logs-list" id="cl-list"></div>
    <div class="logs-body"><div class="logs-head" id="cl-head">왼쪽에서 기록을 고릅니다.</div><pre id="cl-text" tabindex="0"></pre></div>
  </div>
  <div class="hd"><h2>차단된 IP</h2><button type="button" id="unlock-all">모두 해제</button></div>
  <div class="scroll" id="lockouts"></div>
  <div class="hd"><h2>거부 기록</h2><button type="button" id="clrdeny">기록 지우기</button></div>
  <p class="muted">서버가 거절한 요청과 그 이유입니다. 클라이언트가 말없이 실패할 때 여기에 남습니다.</p>
  <div class="scroll" id="denials"></div>
</section>

<section id="tab-featured" hidden>
  <div class="hd"><h2>추천</h2>
    <div class="actions"><button type="button" id="f-add">추천 줄 추가</button>
    <button type="button" class="primary" id="f-save">저장</button></div></div>
  <p class="muted">CookingFoil 클라이언트의 홈 맨 위에 이 순서대로 줄이 나옵니다. 게임이 없는 줄은 보내지 않습니다. 저장하면 클라이언트가 다음에 목록을 받을 때 반영됩니다.</p>
  <div id="f-list"></div>
  <datalist id="f-candidates"></datalist>
</section>

<section id="tab-library" hidden>
  <div class="hd"><h2>라이브러리</h2><button type="button" class="primary" id="rescan">다시 스캔</button></div>
  <div class="cards" id="lib-cards"></div>
  ${LIBRARY_FILES_HTML}
  ${PATCHES_HTML}
  <h2>게임 이름, 소개, 추가 정보</h2>
  <p class="muted">소개는 titledb 가 새로 받아 오면 바뀔 수 있는 게임 설명이고, 직접 쓰면 그 글이 대신 나옵니다. 추가 정보는 운영자만 쓰는 안내(함께 설치할 것, 필요한 용량, 맞는 판, 오버클럭)로 자동 갱신이 건드리지 않습니다.</p>
  <form class="desc-form" id="gd-form">
    <label>게임 (이름이나 타이틀 ID 로 찾습니다)<input id="gd-game" list="gd-games" autocomplete="off" placeholder="게임 이름이나 16자리 타이틀 ID"></label>
    <datalist id="gd-games"></datalist>
    <div id="gd-body" hidden>
      <h3>이름</h3>
      <p class="muted" id="gd-name-original"></p>
      <div class="ct-pair"><label>한국어<input id="gd-name-ko" maxlength="120" autocomplete="off"></label><label>영어 (다른 언어의 기본값)<input id="gd-name-en" maxlength="120" autocomplete="off"></label></div>
      ${GAME_PATCHES_HTML}
      <h3>추가 정보</h3>
      <label>한국어<textarea id="gd-notes-ko" maxlength="2000" placeholder="예: 게임 데이터 패치(약 49GB)를 함께 설치해야 실행됩니다."></textarea></label>
      <label>영어 (다른 언어의 기본값)<textarea id="gd-notes-en" maxlength="2000"></textarea></label>
      <h3>소개</h3>
      <p class="muted" id="gd-original"></p>
      <label>한국어<textarea id="gd-ko" maxlength="2000"></textarea></label>
      <label>영어 (다른 언어의 기본값)<textarea id="gd-en" maxlength="2000"></textarea></label>
      <div class="row-actions"><button type="submit" class="primary">저장</button><button type="button" id="gd-reset">소개를 titledb 것으로 되돌리기</button></div>
    </div>
  </form>
  <h2>서버 설정</h2>
  <dl class="kv" id="settings"></dl>
  <p class="muted">바꿀 수 있는 설정은 설정 탭의 서버 동작에 있습니다.</p>
</section>

${RETRO_ART_HTML}
${ALERTS_HTML}
<section id="tab-homebrew" hidden>
  <h2 class="first">GitHub 저장소 추가</h2>
  <form class="add" id="hb-add">
    <input id="hb-repo" autocomplete="off" spellcheck="false" placeholder="GitHub 주소 또는 owner/name" aria-label="GitHub 저장소" required maxlength="200">
    <input id="hb-asset" autocomplete="off" spellcheck="false" placeholder="쓸 파일 이름 (선택, 예: *-classic.nro)" aria-label="쓸 파일 이름" maxlength="100">
    <button class="primary" type="submit">추가</button>
  </form>
  <p class="muted">추가하면 서버가 바로 확인해 최신 릴리스를 받아 둡니다. 릴리스에 .nro 가 여럿이면 저장소 이름과 같은 것을, 없으면 .zip 안의 .nro 를 씁니다. 다른 파일을 쓰려면 따라가는 저장소 목록에서 고릅니다.</p>
  <h2>앱</h2>
  <p class="muted">서버에 있는 홈브류 앱 전체입니다. 끄면 기기 목록에서 빠지고 서버에는 남습니다. GitHub 앱은 빼기로 더 따라가지 않고, 직접 넣은 앱은 GitHub 연결로 저장소를 따라가게 바꾸거나 지웁니다. 앱마다 도구나 포트로 나누고, 그 앱의 패치와 세이브를 올리거나 지웁니다.</p>
  <div class="scroll" id="hb-apps"></div>
  <div class="hd"><h2>추천 홈브류</h2><div class="actions"><button type="button" id="hb-add-picked">고른 것 추가</button><button type="button" class="primary" id="hb-add-all">모두 추가</button></div></div>
  <p class="muted">최신 릴리스에서 바로 받을 수 있는 것을 확인한 목록입니다. 추가하면 서버가 GitHub 릴리스를 따라가며 새 버전을 알려 줍니다.</p>
  <div class="hb-reco" id="hb-reco"></div>
  <div class="hd"><h2>따라가는 저장소</h2><button type="button" id="hb-check-all">모두 지금 확인</button></div>
  <div class="scroll" id="hb-sources"></div>
</section>

<section id="tab-upload" hidden>
  <div class="hd"><h2>업로드</h2></div>
  <div class="up-drop" id="up-drop" tabindex="0" role="button" aria-label="올릴 파일 고르기">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
    <b id="up-drop-t">파일이나 폴더를 여기에 끌어다 놓습니다</b>
    <span id="up-chosen">게임 패키지, 레트로 롬, 홈브류 .nro, 패치·세이브 zip 이나 폴더를 넣으면 종류를 알아서 고릅니다</span>
    <div class="pick">
      <button type="button" id="up-file-btn">파일 고르기</button>
      <button type="button" id="up-dir-btn">폴더 고르기</button>
    </div>
    <input type="file" id="up-file" multiple hidden>
    <input type="file" id="up-dir" webkitdirectory hidden>
  </div>
  <div id="up-note"></div>
  <form class="up" id="up-form" hidden>
    <div class="up-kinds" id="up-kinds" role="group" aria-label="종류">
      <button type="button" data-kind="game">패키지</button>
      <button type="button" data-kind="retro">레트로 롬</button>
      <button type="button" data-kind="patch">패치</button>
      <button type="button" data-kind="save">세이브</button>
      <button type="button" data-kind="homebrew">홈브류</button>
      <button type="button" data-kind="port">포트</button>
    </div>
    <p class="muted" id="up-hint"></p>
    <label id="up-system-l" hidden>기종<select id="up-system"></select></label>
    <label id="up-target-l" hidden>대상<select id="up-target"><option value="">게임</option></select></label>
    <label id="up-game-l" hidden>게임 (이름이나 타이틀 ID 로 찾습니다)<input id="up-game" list="up-games" autocomplete="off" placeholder="게임 이름이나 16자리 타이틀 ID"></label>
    <datalist id="up-games"></datalist>
    <label id="up-name-l" hidden>이름<input id="up-name" maxlength="100" autocomplete="off"></label>
    <label class="check" id="up-required-l" hidden><input type="checkbox" id="up-required"> 이 패치 없이는 게임이 실행되지 않습니다 (필수)</label>
    <label id="up-savetype-l" hidden>세이브 종류<select id="up-savetype"><option value="">백업 .meta 를 따르거나 어느 쪽에나 적용합니다</option><option value="device">본체 공용 세이브</option><option value="account">계정 세이브</option></select></label>
    <details class="up-more" id="up-desc-l" hidden><summary>설명 넣기 (선택)</summary>
      <label>영어 설명 (다른 언어의 기본값)<textarea id="up-desc" maxlength="2000"></textarea></label>
      <label>한국어 설명<textarea id="up-desc-ko" maxlength="2000"></textarea></label>
    </details>
    <div class="bar" id="up-bar" hidden><i></i></div>
    <div class="up-go"><button type="submit" class="primary" id="up-go">올리기</button><button type="button" id="up-clear">다시 고르기</button><span class="muted" id="up-progress"></span></div>
  </form>
  <p class="muted up-foot">올린 파일은 그 폴더에 바로 들어가고 서버 목록에 반영됩니다. 같은 이름이 이미 있으면 덮어쓰지 않고 거절합니다.</p>
  <div class="up-log" id="up-log"></div>
</section>
</div>

<dialog id="cred-dialog" aria-labelledby="cred-title">
  <h3 id="cred-title"></h3>
  <p class="muted">이 비밀번호는 지금만 볼 수 있습니다. 창을 닫기 전에 전달합니다.</p>
  <div class="cred" id="cred"></div>
  <p class="muted">CookingFoil 은 설정 파일을 sdmc:/switch/cookingfoil/config.json 에 넣으면 QR 없이 바로 연결합니다. CyberFoil 은 주소와 사용자·비밀번호를 설정에 입력합니다.</p>
  <div class="dialog-actions">
    <button type="button" id="cred-config">CookingFoil 설정 파일 받기</button>
    <button type="button" class="primary" id="cred-close">닫기</button>
  </div>
</dialog>
<dialog id="hb-desc" aria-labelledby="hb-desc-title">
  <h3 id="hb-desc-title"></h3>
  <p class="muted" id="hb-desc-hint"></p>
  <form class="desc-form" id="hb-desc-form" method="dialog">
    <label>영어 설명 (모든 언어의 기본값)<textarea id="hb-desc-en" maxlength="2000"></textarea></label>
    <label>한국어 설명 (한국어로 볼 때)<textarea id="hb-desc-ko" maxlength="2000"></textarea></label>
    <div class="dialog-actions">
      <button type="button" id="hb-desc-reset">GitHub 기본값으로</button>
      <button type="button" id="hb-desc-close">닫기</button>
      <button type="submit" class="primary">저장</button>
    </div>
  </form>
</dialog>
${CONTENT_DIALOG_HTML}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>${DASHBOARD_SCRIPT}${INTEGRATIONS_SCRIPT}${RETRO_ART_SCRIPT}${ALERTS_SCRIPT}${PATCHES_SCRIPT}${LIBRARY_FILES_SCRIPT}${SERVER_SETTINGS_SCRIPT}${TOKENS_SCRIPT}</script></body></html>`;
}
