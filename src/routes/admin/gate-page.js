/**
 * The admin page's own check, after signing in at /login. What it asks for
 * depends on what the server has:
 *   "code"      the authenticator's 6-digit code (no COOK_ADMIN_PASSWORD)
 *   "password"  the admin password (no authenticator registered yet)
 *   "either"    one of the two, the admin's choice (both are set up)
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { BRAND_MOTION_CSS } from "../../views/brand-motion.js";
import { escapeHtml } from "./escape.js";
import { TOP_WORDS, topScript, TOP_LANG_HTML, TOP_LANG_CSS, top, topLabel } from "./top-i18n.js";

const LEAD = {
  code: "gt.leadCode",
  password: "gt.leadPassword",
  either: "gt.leadEither",
};

export function gatePage({ owner, mode = "code" } = {}) {
  const either = mode === "either";
  const code = mode !== "password";
  const password = mode !== "code";
  return /* html */ `<!doctype html><html lang="ko" class="adm"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TOP_WORDS.ko.title}</title>${ADMIN_HEAD}<style>${ADMIN_CSS}${BRAND_MOTION_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
${TOP_LANG_CSS}
#gate .lang-menu{position:fixed;top:16px;right:16px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-pill);padding:34px 30px;width:min(380px,100%);
text-align:center;box-shadow:0 30px 60px var(--shadow)}
.logo{display:block;margin:0 auto 12px}h1{font-size:var(--fs-2xl);font-weight:var(--fw-bold);margin:0 0 6px}
.step{color:var(--muted);font-size:var(--fs-xs);font-weight:700;letter-spacing:.02em;margin:0 0 4px}
p{color:var(--muted);font-size:var(--fs-sm);margin:0 0 18px;line-height:1.6}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:var(--r-xl);background:var(--sunk);margin-bottom:14px}
.seg button{border:0;background:none;padding:9px 6px;border-radius:var(--r-md);color:var(--muted)}
.seg button[aria-pressed="true"]{background:var(--panel);color:var(--text);box-shadow:0 1px 3px var(--shadow)}
label{display:block;text-align:left;font-size:var(--fs-sm);font-weight:var(--fw-bold);margin:0 0 6px}
label[hidden],input[hidden]{display:none}
input{width:100%;padding:12px;font-size:var(--fs-lg)}
#code{font-size:var(--fs-2xl);letter-spacing:8px;text-align:center}
#go{margin-top:14px;width:100%;padding:14px;font-size:var(--fs-md);border-radius:var(--r-xl)}
.err{color:var(--bad);font-size:var(--fs-sm);min-height:18px;margin-top:10px}
.back{display:inline-block;margin-top:14px;color:var(--muted);font-size:var(--fs-sm)}</style></head><body>
<div id="gate">${TOP_LANG_HTML}<div class="box"><img class="logo brand-motion" src="/assets/cookingfoil.svg" alt="" width="56" height="56">
<div class="step">${escapeHtml(owner || "admin")}</div><h1>${top("gt.h1")}</h1>
<p>${top(LEAD[mode] ?? LEAD.code)}</p>
${either ? `<div class="seg" role="group" ${topLabel("gt.method")}><button type="button" data-use="code" aria-pressed="true">${top("gt.code")}</button><button type="button" data-use="pw" aria-pressed="false">${top("gt.pw")}</button></div>` : ""}
${code ? `<label for="code">${top("gt.code")}</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" autofocus>` : ""}
${password ? `<label for="pw"${either ? " hidden" : ""}>${top("gt.pw")}</label><input id="pw" type="password" autocomplete="current-password"${either ? " hidden" : " autofocus"}>` : ""}
<button id="go" class="primary" type="button">${top("gt.go")}</button><div class="err" id="err" role="alert"></div>
<a class="back" href="/">${top("gt.back")}</a></div></div>
<script>
${topScript(["gt.", "as.codeDigits"])}
const MODE=${JSON.stringify(mode)};
const pw=document.getElementById('pw'),code=document.getElementById('code'),go=document.getElementById('go'),err=document.getElementById('err');
let use=MODE==='password'?'pw':'code';
for(const b of document.querySelectorAll('[data-use]'))b.addEventListener('click',()=>{use=b.dataset.use;err.textContent='';
  for(const x of document.querySelectorAll('[data-use]'))x.setAttribute('aria-pressed',String(x===b));
  for(const [el,on] of [[code,use==='code'],[pw,use==='pw']]){el.hidden=!on;el.previousElementSibling.hidden=!on;}
  (use==='code'?code:pw).focus();});
async function submit(){err.textContent='';const body={};
  if(use==='pw'){if(!pw.value){err.textContent=topText('gt.pwNeeded');pw.focus();return;}body.password=pw.value;}
  else{const v=code.value.trim();if(!/^\\d{6}$/.test(v)){err.textContent=topText('as.codeDigits');code.focus();return;}body.code=v;}
  go.disabled=true;try{const r=await fetch('/admin/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.ok){location.reload();return;}
    const j=r.status===429?await r.json().catch(()=>({})):{};
    err.textContent=r.status===429?(j.message||topText('gt.locked')):use==='pw'?topText('gt.pwWrong'):topText('gt.codeWrong');
    if(use==='code')code.value='';(use==='pw'?pw:code).focus();}
  catch{err.textContent=topText('gt.noConn');}finally{go.disabled=false;}}
go.addEventListener('click',submit);
for(const el of [pw,code])if(el)el.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
</script></body></html>`;
}
