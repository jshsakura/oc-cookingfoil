/**
 * First-run enrollment. Served ONLY while the auto-generated secret is
 * unenrolled AND the caller is on a private address — after the first correct
 * code this page is gone for good.
 *
 * Manual key entry rather than a QR: every authenticator supports it, and it
 * keeps the page dependency-free (no bundled QR encoder, no CDN — the CSP-free
 * offline case this server actually runs in).
 */
import { ADMIN_CSS } from "./styles.js";
import { escapeHtml } from "./escape.js";

/** Groups the base32 secret into 4-char blocks so it can be typed accurately. */
function grouped(secret) {
  return String(secret).replace(/(.{4})/g, "$1 ").trim();
}

export function enrollPage({ secret, uri, owner }) {
  const safeUri = escapeHtml(uri ?? "");
  const safeOwner = escapeHtml(owner || "admin");
  return /* html */ `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil · Admin setup</title><style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:30px;width:min(460px,100%);
box-shadow:0 30px 60px rgba(0,0,0,.4)}
.logo{font-size:38px;text-align:center}h1{font-size:19px;margin:6px 0 6px;text-align:center}
.lead{color:var(--muted);font-size:13px;text-align:center;margin:0 0 22px}
ol{margin:0 0 20px;padding-left:20px;color:var(--muted);font-size:13px}li{margin-bottom:6px}
.key{background:var(--sunk);border:1px solid var(--line);border-radius:12px;padding:16px;text-align:center;
font-family:ui-monospace,monospace;font-size:18px;letter-spacing:2px;word-break:break-all;color:var(--accent)}
.row{display:flex;gap:8px;margin-top:10px}.row button{flex:1}
details{margin-top:16px}summary{cursor:pointer;color:var(--muted);font-size:13px}
.uri{margin-top:8px;background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:10px;
font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;color:var(--muted)}
.done{margin-top:20px}.ok{color:var(--good);font-size:13px;min-height:18px;text-align:center;margin-top:8px}
</style></head><body>
<div class="box"><div class="logo">🧈</div><h1>Set up admin access</h1>
<p class="lead">No admin 2FA was configured, so CookingFoil generated a secret for you. Add it to an authenticator app to finish.</p>
<ol>
<li>Open your authenticator (Google Authenticator, Aegis, 1Password, …)</li>
<li>Choose <b>“Enter a setup key”</b> / manual entry</li>
<li>Account: <b>CookingFoil (${safeOwner})</b> · Type: <b>Time based</b></li>
<li>Paste the key below, then continue</li>
</ol>
<div class="key" id="key">${escapeHtml(grouped(secret))}</div>
<div class="row">
  <button type="button" id="copy">Copy key</button>
  <button type="button" class="primary" id="next">I've added it</button>
</div>
<div class="ok" id="ok"></div>
<details><summary>Advanced: otpauth:// URI</summary><div class="uri">${safeUri}</div>
<div class="muted" style="margin-top:8px">Persisted at <span class="mono">&lt;data&gt;/security/admin-totp.json</span>.
Set <span class="mono">COOK_ADMIN_TOTP_SECRET</span> to manage it yourself instead. This page disappears after your first successful code.</div>
</details></div>
<script>
const raw=${JSON.stringify(String(secret))};
document.getElementById('copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(raw);document.getElementById('ok').textContent='Key copied';}
  catch{document.getElementById('ok').textContent='Copy failed — select the key manually';}});
document.getElementById('next').addEventListener('click',()=>{location.href='/admin?enrolled=1';});
</script></body></html>`;
}
