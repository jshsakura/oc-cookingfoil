/** The 6-digit TOTP prompt shown to anyone without a valid admin session. */
import { ADMIN_CSS } from "./styles.js";
import { escapeHtml } from "./escape.js";

export function gatePage({ owner } = {}) {
  return /* html */ `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil · Admin</title><style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:32px;width:340px;
text-align:center;box-shadow:0 30px 60px rgba(0,0,0,.4)}
.logo{font-size:40px;margin-bottom:8px}h1{font-size:18px;margin:0 0 4px}
p{color:var(--muted);font-size:13px;margin:0 0 20px}
input{width:100%;padding:12px;font-size:22px;letter-spacing:8px;text-align:center;border-radius:10px;
border:1px solid #45475a;background:var(--sunk);color:var(--text);font-family:inherit}
button{margin-top:14px;width:100%;padding:11px}
.err{color:var(--bad);font-size:13px;min-height:18px;margin-top:10px}</style></head><body>
<div class="box"><div class="logo">🔐</div><h1>Admin access</h1>
<p>Enter the 6-digit code for <b>${escapeHtml(owner || "admin")}</b> from your authenticator app.</p>
<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" autofocus>
<button id="go" class="primary" type="button">Unlock</button><div class="err" id="err"></div></div>
<script>
const code=document.getElementById('code'),go=document.getElementById('go'),err=document.getElementById('err');
async function submit(){err.textContent='';const v=code.value.trim();
if(!/^\\d{6}$/.test(v)){err.textContent='Enter 6 digits';return;}
go.disabled=true;try{const r=await fetch('/admin/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:v})});
if(r.ok){location.reload();}else{err.textContent='Invalid code';code.value='';code.focus();}}
catch{err.textContent='Network error';}finally{go.disabled=false;}}
go.addEventListener('click',submit);
code.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
</script></body></html>`;
}
