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

const PAGE_CSS = /* css */ `
body{padding:28px 24px 60px}.wrap{max-width:1100px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:22px}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:44px;height:44px;flex:none}
h1{font-size:22px;font-weight:800;letter-spacing:-.02em;margin:0}
h1 .wm{font-family:'Baloo 2',inherit;font-weight:800;letter-spacing:-.02em;margin-right:4px}h1 .wm .dot{color:var(--accent)}
.who{color:var(--muted);font-size:13px}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.seg{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--line);border-radius:100px;background:var(--panel)}
.seg button{border:none;border-radius:100px;padding:6px 10px;color:var(--muted)}
.seg button.active{background:var(--text);color:var(--bg)}
.seg svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
nav.tabs{display:flex;gap:6px;padding:6px;margin-bottom:22px;overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:16px}
nav.tabs a{padding:10px 18px;color:var(--muted);text-decoration:none;font-weight:700;border-radius:11px;white-space:nowrap}
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
td .row-actions{display:flex;gap:6px;flex-wrap:wrap}
td.dim{color:var(--faint)}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;margin:0;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px}
dl.kv dt{color:var(--muted);font-size:13px}dl.kv dd{margin:0;font-size:13px;word-break:break-all}
dialog{border:1px solid var(--line);border-radius:22px;background:var(--panel);color:var(--text);padding:24px;width:min(520px,calc(100vw - 32px));box-shadow:0 30px 60px var(--shadow)}
dialog::backdrop{background:rgba(0,0,0,.55)}
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
@media (max-width:640px){th:nth-child(n+4),td:nth-child(n+4):not(:last-child){display:none}}
`;


export function dashboardPage() {
  return /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil 관리</title>${ADMIN_HEAD}<style>${ADMIN_CSS}${PAGE_CSS}</style></head><body>
<div class="wrap">
<header>
  <div class="brand"><img class="logo" src="/assets/cookingfoil.svg" alt="" width="42" height="42">
    <div><h1 aria-label="CookingFoil 관리"><span class="wm">cookingfoil<span class="dot">.</span></span> 관리</h1><div class="who" id="who">불러오고 있습니다</div></div></div>
  <div class="actions">
    <a class="btn" href="/">대시보드</a>
    <button type="button" id="logout">로그아웃</button>
  </div>
</header>

<nav class="tabs" aria-label="관리 메뉴">
  <a href="#overview" data-tab="overview">개요</a>
  <a href="#users" data-tab="users">사용자</a>
  <a href="#devices" data-tab="devices">기기<span class="count" id="pending-count" hidden></span></a>
  <a href="#security" data-tab="security">보안<span class="count" id="lock-count" hidden></span></a>
  <a href="#featured" data-tab="featured">추천</a>
  <a href="#library" data-tab="library">라이브러리</a>
</nav>

<section id="tab-overview">
  <div id="warnings"></div>
  <div class="lanes" id="lanes"></div>
  <div class="cards" id="cards"></div>
  <p class="muted" id="ts"></p>
</section>

<section id="tab-users" hidden>
  <form class="add" id="add-user">
    <input id="new-name" autocomplete="off" placeholder="사용자 이름 (영문, 숫자, . _ -)" aria-label="사용자 이름" required maxlength="32">
    <input id="new-pass" type="password" autocomplete="new-password" placeholder="비밀번호 (비우면 자동 생성)" aria-label="비밀번호" maxlength="128">
    <button class="primary" type="submit">사용자 추가</button>
  </form>
  <p class="muted">CyberFoil 과 Tinfoil 은 이 계정으로 접속합니다. 비밀번호는 만들거나 재발급할 때 한 번만 보여 주고 서버에는 해시만 남깁니다.</p>
  <div class="scroll" id="users"></div>
</section>

<section id="tab-devices" hidden>
  <p class="muted" id="devhint"></p>
  <h2>승인 대기</h2><div class="scroll" id="pending"></div>
  <h2>승인된 기기</h2><div class="scroll" id="devices"></div>
</section>

<section id="tab-security" hidden>
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
  <h2>서버 설정</h2>
  <dl class="kv" id="settings"></dl>
  <p class="muted">설정 값은 compose 환경변수에서 읽습니다. 바꾸려면 compose 를 고치고 컨테이너를 다시 띄웁니다.</p>
</section>
</div>

<dialog id="cred-dialog" aria-labelledby="cred-title">
  <h3 id="cred-title"></h3>
  <p class="muted">이 비밀번호는 지금만 볼 수 있습니다. 창을 닫기 전에 전달합니다.</p>
  <div class="cred" id="cred"></div>
  <div class="dialog-actions">
    <button type="button" id="cred-config">CookingFoil 설정 파일 받기</button>
    <button type="button" class="primary" id="cred-close">닫기</button>
  </div>
</dialog>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>${DASHBOARD_SCRIPT}</script></body></html>`;
}
