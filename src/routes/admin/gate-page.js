/**
 * The admin page's own check, after signing in at /login. What it asks for
 * depends on what the server has:
 *   "code"      the authenticator's 6-digit code (no COOK_ADMIN_PASSWORD)
 *   "password"  the admin password (no authenticator registered yet)
 *   "either"    one of the two, the admin's choice (both are set up)
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { escapeHtml } from "./escape.js";

const LEAD = {
  code: "인증 앱에 표시된 6자리 코드를 입력합니다.",
  password: "관리자 비밀번호를 입력합니다. 로그인할 때 쓴 계정 비밀번호와는 다른, 관리 페이지 설정 탭에서 정했거나 서버 설정(COOK_ADMIN_PASSWORD)에 넣은 비밀번호입니다.",
  either: "인증 앱 코드나 관리자 비밀번호 중 하나를 입력합니다. 관리자 비밀번호는 계정 비밀번호와 다른, 관리 페이지 설정 탭에서 정했거나 서버 설정(COOK_ADMIN_PASSWORD)에 넣은 비밀번호입니다.",
};

export function gatePage({ owner, mode = "code" } = {}) {
  const either = mode === "either";
  const code = mode !== "password";
  const password = mode !== "code";
  return /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil 서버 관리</title>${ADMIN_HEAD}<style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:34px 30px;width:min(380px,100%);
text-align:center;box-shadow:0 30px 60px var(--shadow)}
.logo{display:block;margin:0 auto 12px}h1{font-size:22px;font-weight:800;margin:0 0 6px}
.step{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.02em;margin:0 0 4px}
p{color:var(--muted);font-size:13px;margin:0 0 18px;line-height:1.6}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:14px;background:var(--sunk);margin-bottom:14px}
.seg button{border:0;background:none;padding:9px 6px;border-radius:10px;color:var(--muted)}
.seg button[aria-pressed="true"]{background:var(--panel);color:var(--text);box-shadow:0 1px 3px var(--shadow)}
label{display:block;text-align:left;font-size:13px;font-weight:600;margin:0 0 6px}
label[hidden],input[hidden]{display:none}
input{width:100%;padding:12px;font-size:16px}
#code{font-size:22px;letter-spacing:8px;text-align:center}
#go{margin-top:14px;width:100%;padding:14px;font-size:15px;border-radius:14px}
.err{color:var(--bad);font-size:13px;min-height:18px;margin-top:10px}
.back{display:inline-block;margin-top:14px;color:var(--muted);font-size:13px}</style></head><body>
<div class="box"><img class="logo" src="/assets/cookingfoil.svg" alt="" width="56" height="56">
<div class="step">${escapeHtml(owner || "admin")}</div><h1>관리 페이지 확인</h1>
<p>${LEAD[mode] ?? LEAD.code}</p>
${either ? `<div class="seg" role="group" aria-label="확인 방법"><button type="button" data-use="code" aria-pressed="true">인증 앱 코드</button><button type="button" data-use="pw" aria-pressed="false">관리자 비밀번호</button></div>` : ""}
${code ? `<label for="code">인증 앱 코드</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" autofocus>` : ""}
${password ? `<label for="pw"${either ? " hidden" : ""}>관리자 비밀번호</label><input id="pw" type="password" autocomplete="current-password"${either ? " hidden" : " autofocus"}>` : ""}
<button id="go" class="primary" type="button">들어가기</button><div class="err" id="err" role="alert"></div>
<a class="back" href="/">대시보드로 돌아갑니다</a></div>
<script>
const MODE=${JSON.stringify(mode)};
const pw=document.getElementById('pw'),code=document.getElementById('code'),go=document.getElementById('go'),err=document.getElementById('err');
let use=MODE==='password'?'pw':'code';
for(const b of document.querySelectorAll('[data-use]'))b.addEventListener('click',()=>{use=b.dataset.use;err.textContent='';
  for(const x of document.querySelectorAll('[data-use]'))x.setAttribute('aria-pressed',String(x===b));
  for(const [el,on] of [[code,use==='code'],[pw,use==='pw']]){el.hidden=!on;el.previousElementSibling.hidden=!on;}
  (use==='code'?code:pw).focus();});
async function submit(){err.textContent='';const body={};
  if(use==='pw'){if(!pw.value){err.textContent='관리자 비밀번호를 입력합니다.';pw.focus();return;}body.password=pw.value;}
  else{const v=code.value.trim();if(!/^\\d{6}$/.test(v)){err.textContent='숫자 6자리를 입력합니다.';code.focus();return;}body.code=v;}
  go.disabled=true;try{const r=await fetch('/admin/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.ok){location.reload();return;}
    const j=r.status===429?await r.json().catch(()=>({})):{};
    err.textContent=r.status===429?(j.message||'너무 여러 번 틀려 잠겼습니다. 잠시 뒤에 다시 시도합니다.'):use==='pw'?'관리자 비밀번호가 맞지 않습니다.':'코드가 맞지 않습니다. 인증 앱의 새 코드를 입력합니다.';
    if(use==='code')code.value='';(use==='pw'?pw:code).focus();}
  catch{err.textContent='서버에 연결하지 못했습니다.';}finally{go.disabled=false;}}
go.addEventListener('click',submit);
for(const el of [pw,code])if(el)el.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
</script></body></html>`;
}
