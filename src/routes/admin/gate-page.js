/** The 6-digit TOTP prompt shown to anyone without a valid admin session. */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { escapeHtml } from "./escape.js";

export function gatePage({ owner } = {}) {
  return /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil 관리</title>${ADMIN_HEAD}<style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:36px 32px;width:min(360px,100%);
text-align:center;box-shadow:0 30px 60px var(--shadow)}
.logo{display:block;margin:0 auto 12px}h1{font-size:22px;font-weight:800;margin:0 0 6px}
p{color:var(--muted);font-size:13px;margin:0 0 20px}
input{width:100%;padding:12px;font-size:22px;letter-spacing:8px;text-align:center}
#go{margin-top:14px;width:100%;padding:14px;font-size:15px;border-radius:14px}
.err{color:var(--bad);font-size:13px;min-height:18px;margin-top:10px}
.back{display:inline-block;margin-top:16px;color:var(--muted);font-size:13px}</style></head><body>
<div class="box"><img class="logo" src="/assets/cookingfoil.svg" alt="" width="56" height="56"><h1>관리 페이지</h1>
<p><b>${escapeHtml(owner || "admin")}</b> 계정의 인증 앱에 표시된 6자리 코드를 입력합니다.</p>
<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="인증 코드" autofocus>
<button id="go" class="primary" type="button">들어가기</button><div class="err" id="err" role="alert"></div>
<a class="back" href="/">대시보드로 돌아갑니다</a></div>
<script>
const code=document.getElementById('code'),go=document.getElementById('go'),err=document.getElementById('err');
async function submit(){err.textContent='';const v=code.value.trim();
if(!/^\\d{6}$/.test(v)){err.textContent='숫자 6자리를 입력합니다.';return;}
go.disabled=true;try{const r=await fetch('/admin/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:v})});
if(r.ok){location.reload();}else{err.textContent='코드가 맞지 않습니다.';code.value='';code.focus();}}
catch{err.textContent='서버에 연결하지 못했습니다.';}finally{go.disabled=false;}}
go.addEventListener('click',submit);
code.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
</script></body></html>`;
}
