/**
 * First-run enrollment. Served ONLY while the auto-generated secret is
 * unenrolled AND the caller is on a private address — after the first correct
 * code this page is gone for good.
 *
 * Manual key entry rather than a QR: every authenticator supports it, and it
 * keeps the page dependency-free (no bundled QR encoder, no CDN — the CSP-free
 * offline case this server actually runs in).
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { escapeHtml } from "./escape.js";
import { TOP_WORDS, topScript, TOP_LANG_HTML, TOP_LANG_CSS, top, topHtml } from "./top-i18n.js";

/** Groups the base32 secret into 4-char blocks so it can be typed accurately. */
function grouped(secret) {
  return String(secret).replace(/(.{4})/g, "$1 ").trim();
}

export function enrollPage({ secret, uri, owner }) {
  const safeUri = escapeHtml(uri ?? "");
  const safeOwner = escapeHtml(owner || "admin");
  return /* html */ `<!doctype html><html lang="ko" class="adm"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title data-top="er.docTitle">${TOP_WORDS.ko["er.docTitle"]}</title>${ADMIN_HEAD}<style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:30px;width:min(460px,100%);
box-shadow:0 30px 60px var(--shadow)}
.logo{display:block;margin:0 auto;background:var(--ground);border-radius:22%;padding:3px;box-sizing:border-box}h1{font-size:var(--fs-xl);margin:6px 0 6px;text-align:center}
.lead{color:var(--muted);font-size:var(--fs-sm);text-align:center;margin:0 0 22px}
ol{margin:0 0 20px;padding-left:20px;color:var(--muted);font-size:var(--fs-sm)}li{margin-bottom:6px}
.key{background:var(--sunk);border:1px solid var(--line);border-radius:var(--r-lg);padding:16px;text-align:center;
font-family:ui-monospace,monospace;font-size:var(--fs-xl);letter-spacing:2px;word-break:break-all;color:var(--accent)}
.row{display:flex;gap:8px;margin-top:10px}.row button{flex:1}
details{margin-top:16px}summary{cursor:pointer;color:var(--muted);font-size:var(--fs-sm)}
.uri{margin-top:8px;background:var(--sunk);border:1px solid var(--line);border-radius:var(--r-md);padding:10px;
font-family:ui-monospace,monospace;font-size:var(--fs-2xs);word-break:break-all;color:var(--muted)}
.done{margin-top:20px}.ok{color:var(--good);font-size:var(--fs-sm);min-height:18px;text-align:center;margin-top:8px}
${TOP_LANG_CSS}
#enroll .lang-menu{position:fixed;top:16px;right:16px}
</style></head><body><div id="enroll">${TOP_LANG_HTML}
<div class="box"><img class="logo" src="/assets/cookingfoil.svg" alt="" width="52" height="52"><h1>${top("er.h1")}</h1>
<p class="lead">${top("er.lead")}</p>
<ol>
<li>${top("er.s1")}</li>
<li>${topHtml("er.s2")}</li>
<li>${top("er.s3a")}<b>CookingFoil (${safeOwner})</b>${topHtml("er.s3b")}</li>
<li>${top("er.s4")}</li>
</ol>
<div class="key" id="key">${escapeHtml(grouped(secret))}</div>
<div class="row">
  <button type="button" id="copy">${top("er.copyBtn")}</button>
  <button type="button" class="primary" id="next">${top("er.doneBtn")}</button>
</div>
<div class="ok" id="ok"></div>
<details><summary>${top("er.advanced")}</summary><div class="uri">${safeUri}</div>
<div class="muted" style="margin-top:8px">${topHtml("er.storage")}</div>
</details></div></div>
<script>
${topScript(["er."])}
const raw=${JSON.stringify(String(secret))};
document.getElementById('copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(raw);document.getElementById('ok').textContent=topText('er.copied');}
  catch{document.getElementById('ok').textContent=topText('er.copyFail');}});
document.getElementById('next').addEventListener('click',()=>{location.href='/admin?enrolled=1';});
</script></body></html>`;
}
