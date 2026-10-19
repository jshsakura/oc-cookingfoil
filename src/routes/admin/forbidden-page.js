/** Shown to a signed-in account that isn't an admin when it opens /admin. */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";

export function forbiddenPage() {
  return /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil 서버 관리</title>${ADMIN_HEAD}<style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:36px 32px;width:min(380px,100%);text-align:center}
h1{font-size:22px;margin:12px 0 8px}p{color:var(--muted);margin:0 0 20px}.row{display:grid;gap:10px}</style></head><body>
<div class="box"><img src="/assets/cookingfoil.svg" alt="" width="56" height="56"><h1>관리자 계정이 아닙니다</h1>
<p>관리 페이지는 관리자 계정만 엽니다. 관리자 계정으로 다시 로그인합니다.</p>
<div class="row"><button class="primary" type="button" id="other-account">다른 계정으로 로그인</button><a class="btn" href="/">대시보드로 돌아갑니다</a></div></div>
<script>
document.getElementById('other-account').addEventListener('click',async()=>{
  try{const me=await (await fetch('/auth/me')).json();await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':me.csrf||''}});}catch{}
  location.href='/login?next=%2Fadmin';});
</script></body></html>`;
}
