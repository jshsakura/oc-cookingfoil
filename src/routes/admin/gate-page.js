/**
 * The prompt shown to anyone without a valid admin session. What it asks for
 * depends on how the page is locked:
 *   "code"      the authenticator's 6-digit code (no COOK_ADMIN_PASSWORD)
 *   "password"  the admin password
 *   "both"      the admin password, then the code (an authenticator was
 *               enrolled from the admin page)
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { escapeHtml } from "./escape.js";

const PASSWORD_FIELD = `<input id="pw" class="pw" type="password" autocomplete="current-password" placeholder="관리자 비밀번호" aria-label="관리자 비밀번호" autofocus>`;
const CODE_FIELD = (focus) =>
  `<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="인증 코드"${focus ? " autofocus" : ""}>`;

export function gatePage({ owner, mode = "code" } = {}) {
  const prompt = {
    code: `<b>${escapeHtml(owner || "admin")}</b> 계정의 인증 앱에 표시된 6자리 코드를 입력합니다.`,
    password: "관리자 비밀번호를 입력합니다.",
    both: "관리자 비밀번호와 인증 앱에 표시된 6자리 코드를 입력합니다.",
  }[mode];
  const fields = mode === "code" ? CODE_FIELD(true) : mode === "password" ? PASSWORD_FIELD : PASSWORD_FIELD + CODE_FIELD(false);
  return /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil 관리</title>${ADMIN_HEAD}<style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:36px 32px;width:min(360px,100%);
text-align:center;box-shadow:0 30px 60px var(--shadow)}
.logo{display:block;margin:0 auto 12px}h1{font-size:22px;font-weight:800;margin:0 0 6px}
p{color:var(--muted);font-size:13px;margin:0 0 20px}
.fields{display:grid;gap:10px}
input{width:100%;padding:12px;font-size:22px;letter-spacing:8px;text-align:center}
input.pw{font-size:16px;letter-spacing:normal}
#go{margin-top:14px;width:100%;padding:14px;font-size:15px;border-radius:14px}
.err{color:var(--bad);font-size:13px;min-height:18px;margin-top:10px}
.back{display:inline-block;margin-top:16px;color:var(--muted);font-size:13px}</style></head><body>
<div class="box"><img class="logo" src="/assets/cookingfoil.svg" alt="" width="56" height="56"><h1>관리 페이지</h1>
<p>${prompt}</p>
<div class="fields">${fields}</div>
<button id="go" class="primary" type="button">들어가기</button><div class="err" id="err" role="alert"></div>
<a class="back" href="/">대시보드로 돌아갑니다</a></div>
<script>
const MODE=${JSON.stringify(mode)};
const pw=document.getElementById('pw'),code=document.getElementById('code'),go=document.getElementById('go'),err=document.getElementById('err');
async function submit(){err.textContent='';
const body={};
if(pw){if(!pw.value){err.textContent='비밀번호를 입력합니다.';pw.focus();return;}body.password=pw.value;}
if(code){const v=code.value.trim();if(!/^\\d{6}$/.test(v)){err.textContent='숫자 6자리를 입력합니다.';code.focus();return;}body.code=v;}
go.disabled=true;try{const r=await fetch('/admin/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
if(r.ok){location.reload();return;}
err.textContent=MODE==='code'?'코드가 맞지 않습니다.':MODE==='password'?'비밀번호가 맞지 않습니다.':'비밀번호나 코드가 맞지 않습니다.';
if(code){code.value='';}(pw||code).focus();}
catch{err.textContent='서버에 연결하지 못했습니다.';}finally{go.disabled=false;}}
go.addEventListener('click',submit);
for(const el of [pw,code])if(el)el.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
</script></body></html>`;
}
