import { escapeHtml } from "./escape.js";
import { LIGHT, SCALE } from "./styles.js";
import { TOP_WORDS, topScript, TOP_LANG_HTML, TOP_LANG_CSS, top, topPh } from "./top-i18n.js";
/** `repair`: "repairSame" or "repairOther" when the console is already registered and asks to be paired again. */
export function pairPage({ code = "", authenticated = false, approved = false, expired = false, repair = null } = {}) {
  const title = expired ? "pr.titleExpired" : approved ? "pr.titleApproved" : "pr.title";
  const content = expired ? `<p>${top("pr.expiredBody")}</p>`
    : approved ? `<p>${top("pr.approvedBody")}</p>`
    : `${repair ? `<p>${top(repair === "repairOther" ? "pr.repairOther" : "pr.repairSame")}</p>` : ""}<p>${top("pr.checkCode")}</p><strong class="device-code">${escapeHtml(code)}</strong>
${authenticated ? `<form id="approve"><label for="label">${top("pr.deviceLabel")} <span>${top("pr.optional")}</span></label><input id="label" maxlength="64" ${topPh("pr.labelPh")} autocomplete="off"><button type="submit">${top("pr.connectBtn")}</button></form>`
    : `<form id="verify"><label for="code">${top("pr.codeLabel")}</label><input id="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6" required autofocus><button type="submit">${top("pr.verifyBtn")}</button></form><p class="hint">${top("pr.hint")}</p>`}
<p id="error" role="alert"></p>`;
  return `<!doctype html><html lang="ko" class="adm"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title data-top="pr.docTitle">${TOP_WORDS.ko["pr.docTitle"]}</title>
<link rel="icon" href="/assets/cookingfoil.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/fonts.css"><style>/* The language chip rides the admin vars it was drawn with. */
:root{${SCALE};${LIGHT};font-family:"Inter","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);background:var(--bg)}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px}.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:32px;width:min(100%,440px)}.brand{display:flex;align-items:center;gap:12px;font-size:var(--fs-2xl);font-weight:700;letter-spacing:.04em;margin:0 0 28px}.brand .wm{font-family:'Baloo 2',sans-serif;font-weight:var(--fw-bold);font-size:var(--fs-3xl);letter-spacing:-.02em}.brand .dot{color:var(--accent)}h1{font-size:var(--fs-3xl);margin:0 0 14px}p{font-size:var(--fs-lg);line-height:1.6;color:var(--muted);margin:0 0 20px;word-break:keep-all}.device-code{display:block;font:700 30px monospace;letter-spacing:3px;padding:18px;text-align:center;background:var(--bg);border-radius:var(--r-lg);margin:24px 0}label{display:block;font-size:var(--fs-lg);margin-bottom:10px}label span{color:var(--muted)}input{font:inherit;font-size:var(--fs-xl);width:100%;border:1px solid var(--line);border-radius:var(--r-md);padding:14px;background:var(--panel);color:var(--text)}#code{text-align:center;letter-spacing:5px}button{font:inherit;font-weight:700;font-size:var(--fs-xl);width:100%;border:0;border-radius:var(--r-md);padding:16px;background:var(--accent);color:var(--text);margin:18px 0;cursor:pointer}button:disabled{opacity:.6;cursor:wait}input:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.hint{margin:0;font-size:var(--fs-lg)}#error{color:var(--bad);margin:12px 0 0;min-height:0}@media(max-width:420px){body{padding:16px}.card{padding:24px}}
${TOP_LANG_CSS}
.lang-menu{position:fixed;top:16px;right:16px}</style></head><body>${TOP_LANG_HTML}<main class="card"><div class="brand"><img src="/assets/cookingfoil.svg" alt="" width="40" height="40"><span class="wm">cookingfoil<span class="dot">.</span></span></div><h1>${top(title)}</h1>${content}</main>
<script>
${topScript(["pr."])}
const verify=document.getElementById('verify'),approve=document.getElementById('approve'),error=document.getElementById('error');
async function submit(form,url,body){const button=form.querySelector('button');button.disabled=true;error.textContent='';try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(response.ok){location.reload();return;}error.textContent=response.status===410?topText('pr.errGone'):response.status===401?topText('pr.errAuth'):response.status===409?topText('pr.errDone'):topText('pr.errFail');}catch{error.textContent=topText('pr.errNet');}finally{button.disabled=false;}}
if(verify)verify.addEventListener('submit',e=>{e.preventDefault();submit(verify,'/admin/verify',{code:document.getElementById('code').value});});
if(approve)approve.addEventListener('submit',e=>{e.preventDefault();submit(approve,'/admin/api/pair/'+location.pathname.split('/').pop()+'/approve',{label:document.getElementById('label').value});});
</script></body></html>`;
}
