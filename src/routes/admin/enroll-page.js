/**
 * First-run enrollment. Served ONLY while the auto-generated secret is
 * unenrolled AND the caller is on a private address — after the first correct
 * code this page is gone for good.
 *
 * Manual key entry rather than a QR: every authenticator supports it, and it
 * keeps the page dependency-free (no bundled QR encoder, no CDN — the CSP-free
 * offline case this server actually runs in).
 */
import { ADMIN_CSS, THEME_BOOT } from "./styles.js";
import { escapeHtml } from "./escape.js";

/** Groups the base32 secret into 4-char blocks so it can be typed accurately. */
function grouped(secret) {
  return String(secret).replace(/(.{4})/g, "$1 ").trim();
}

export function enrollPage({ secret, uri, owner }) {
  const safeUri = escapeHtml(uri ?? "");
  const safeOwner = escapeHtml(owner || "admin");
  return /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil 관리 설정</title>${THEME_BOOT}<style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:30px;width:min(460px,100%);
box-shadow:0 30px 60px var(--shadow)}
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
<div class="box"><div class="logo">🧈</div><h1>관리자 인증 설정</h1>
<p class="lead">관리 페이지는 인증 앱의 6자리 코드로 엽니다. 아래 키를 인증 앱에 등록하면 설정이 끝납니다.</p>
<ol>
<li>인증 앱(Google Authenticator, Aegis, 1Password 등)을 엽니다</li>
<li><b>설정 키 입력</b>(수동 입력)을 고릅니다</li>
<li>계정 이름은 <b>CookingFoil (${safeOwner})</b>, 종류는 <b>시간 기반</b>으로 둡니다</li>
<li>아래 키를 붙여 넣고 다음으로 넘어갑니다</li>
</ol>
<div class="key" id="key">${escapeHtml(grouped(secret))}</div>
<div class="row">
  <button type="button" id="copy">키 복사</button>
  <button type="button" class="primary" id="next">등록했습니다</button>
</div>
<div class="ok" id="ok"></div>
<details><summary>고급: otpauth:// 주소</summary><div class="uri">${safeUri}</div>
<div class="muted" style="margin-top:8px">키는 <span class="mono">&lt;data&gt;/security/admin-totp.json</span> 에 저장됩니다.
직접 관리하려면 <span class="mono">COOK_ADMIN_TOTP_SECRET</span> 을 설정합니다. 처음으로 코드가 맞으면 이 화면은 더 나오지 않습니다.</div>
</details></div>
<script>
const raw=${JSON.stringify(String(secret))};
document.getElementById('copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(raw);document.getElementById('ok').textContent='키를 복사했습니다';}
  catch{document.getElementById('ok').textContent='복사하지 못했습니다. 키를 직접 선택해 복사합니다';}});
document.getElementById('next').addEventListener('click',()=>{location.href='/admin?enrolled=1';});
</script></body></html>`;
}
