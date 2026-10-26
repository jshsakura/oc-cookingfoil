/** Shown to a signed-in account that isn't an admin when it opens /admin. */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { escapeHtml } from "./escape.js";
import { parseLang } from "../../meta/langs.js";
import { FORBIDDEN_WORDS } from "./forbidden-words.js";

export function forbiddenPage(language = "ko") {
  const lang = parseLang(language) ?? "en";
  const words = FORBIDDEN_WORDS[lang];
  const say = (key) => escapeHtml(words[key]);
  return /* html */ `<!doctype html><html lang="${lang}" class="adm"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${say("title")}</title>${ADMIN_HEAD}<style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-pill);padding:36px 32px;width:min(380px,100%);text-align:center}
h1{font-size:var(--fs-2xl);margin:12px 0 8px}p{color:var(--muted);margin:0 0 20px}.row{display:grid;gap:10px}</style></head><body>
<div class="box"><img src="/assets/cookingfoil.svg" alt="" width="56" height="56"><h1>${say("heading")}</h1>
<p>${say("lead")}</p>
<div class="row"><button class="primary" type="button" id="other-account">${say("signIn")}</button><a class="btn" href="/">${say("back")}</a></div></div>
<script>
document.getElementById('other-account').addEventListener('click',async()=>{
  try{const me=await (await fetch('/auth/me')).json();await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':me.csrf||''}});}catch{}
  location.href='/login?next=%2Fadmin';});
</script></body></html>`;
}
