/**
 * The first-run setup page: setup code → admin account → authenticator → done.
 * One page; the script moves between steps. Text in ko / en / ja / zh.
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./admin/styles.js";

const T = {
  ko: {
    title: "CookingFoil 처음 설정",
    lead: "이 서버에는 아직 계정이 없습니다. 관리자 계정을 만들기 전까지 다른 화면은 열리지 않습니다.",
    codeH: "설정 코드",
    codeP: "서버를 켤 때 컨테이너 로그에 설정 코드를 찍었습니다. docker logs <컨테이너> 로 확인해 넣습니다. 코드는 서버를 켤 때마다 바뀝니다.",
    accountH: "관리자 계정",
    accountP: "관리 페이지와 대시보드에 로그인할 계정입니다. 아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 32자까지 쓰고 비밀번호는 8자 이상입니다.",
    name: "아이디", password: "비밀번호", password2: "비밀번호 확인",
    otpH: "인증 앱 등록",
    otpP: "관리 페이지는 비밀번호에 더해 인증 앱의 6자리 코드를 한 번 더 묻습니다. Google Authenticator, 1Password 같은 앱으로 QR 을 찍거나 키를 직접 넣고, 앱에 나온 코드를 입력합니다.",
    otpCode: "6자리 코드",
    skip: "인증 앱 없이 진행합니다", skipWarn: "권장하지 않습니다. 인증 앱 없이 마치면 관리자 계정 비밀번호만으로 관리 페이지가 열려, 비밀번호가 새면 누구든 이 서버를 관리할 수 있습니다. 인증 앱은 나중에 설정 탭에서 등록할 수 있고, 등록하기 전까지 서버가 계속 경고합니다.", skipBtn: "위험을 알고 건너뜁니다", skipAsk: "인증 앱 없이 셋업을 마칠까요? 관리자 계정 비밀번호만으로 관리 페이지가 열립니다.",
    doneH: "설정을 마쳤습니다",
    doneP: "관리 페이지의 설정 탭에서 외부 서비스 키를 넣을 수 있습니다. 키마다 어디서 발급하는지 안내가 붙어 있습니다. 넣지 않아도 서버는 동작합니다.",
    next: "다음", open: "관리 페이지 열기",
    err: {
      "bad-code": "설정 코드가 맞지 않습니다.", "locked-out": "여러 번 틀려 잠시 막았습니다. 잠시 뒤 다시 시도합니다.",
      "invalid-name": "아이디 형식이 맞지 않습니다.", "weak-password": "비밀번호는 8자 이상이어야 합니다.", mismatch: "두 비밀번호가 다릅니다.",
      "bad-otp": "코드가 맞지 않습니다. 앱의 시간이 맞는지 확인합니다.", expired: "시간이 지났습니다. 화면을 새로 고칩니다.",
      "setup-closed": "설정이 이미 끝났습니다.", locked: "설정 코드부터 넣습니다.", origin: "접속한 주소가 서버가 아는 주소와 다릅니다. 리버스 프록시나 터널 뒤라면 .env 의 COOK_TRUST_PROXY 를 확인합니다.", other: "처리하지 못했습니다. 다시 시도합니다.",
    },
  },
  en: {
    title: "CookingFoil first-run setup",
    lead: "This server has no accounts yet. Nothing else opens until you create the admin account.",
    codeH: "Setup code",
    codeP: "The server printed a setup code to the container log when it started. Read it with docker logs <container>. It changes on every start.",
    accountH: "Admin account",
    accountP: "The account for the admin page and the web pages. IDs use letters, digits, dot, underscore and dash, up to 32; passwords need at least 8 characters.",
    name: "ID", password: "Password", password2: "Repeat password",
    otpH: "Authenticator app",
    otpP: "On top of the password, the admin page asks for a 6-digit code from an authenticator app. Scan the QR with Google Authenticator, 1Password or similar (or type the key), then enter the code it shows.",
    otpCode: "6-digit code",
    skip: "Continue without an authenticator", skipWarn: "Not recommended. Without an authenticator the admin page opens with the admin account's password alone, so anyone who learns it can run this server. You can register an authenticator later on the settings tab, and the server keeps warning until you do.", skipBtn: "Skip, I understand the risk", skipAsk: "Finish setup without an authenticator? The admin page will open with the account password alone.",
    doneH: "Setup is done",
    doneP: "Keys for outside services go in the admin page's settings tab, each with where to get it. The server works without them.",
    next: "Next", open: "Open the admin page",
    err: {
      "bad-code": "That setup code is wrong.", "locked-out": "Too many tries. Wait a while and try again.",
      "invalid-name": "That ID isn't allowed.", "weak-password": "Passwords need at least 8 characters.", mismatch: "The passwords differ.",
      "bad-otp": "That code doesn't match. Check the app's clock.", expired: "Time ran out. Reload the page.",
      "setup-closed": "Setup is already finished.", locked: "Enter the setup code first.", origin: "The address you opened is not the one the server sees. Behind a reverse proxy or tunnel, check COOK_TRUST_PROXY in .env.", other: "Something went wrong. Try again.",
    },
  },
  ja: {
    title: "CookingFoil 初期設定",
    lead: "このサーバーにはまだアカウントがありません。管理者アカウントを作るまで他の画面は開きません。",
    codeH: "設定コード",
    codeP: "起動時にコンテナのログへ設定コードを出力しました。docker logs <コンテナ> で確認して入力します。コードは起動のたびに変わります。",
    accountH: "管理者アカウント",
    accountP: "管理ページとウェブ画面に使うアカウントです。IDは英数字・ドット・アンダースコア・ハイフンで32文字まで、パスワードは8文字以上です。",
    name: "ID", password: "パスワード", password2: "パスワード(確認)",
    otpH: "認証アプリの登録",
    otpP: "管理ページはパスワードに加えて認証アプリの6桁コードを確認します。Google Authenticator や 1Password などで QR を読み取るかキーを入力し、表示されたコードを入れます。",
    otpCode: "6桁コード",
    skip: "認証アプリなしで進めます", skipWarn: "おすすめしません。認証アプリなしで終えると、管理者アカウントのパスワードだけで管理ページが開き、パスワードが漏れると誰でもこのサーバーを管理できます。認証アプリは後で設定タブから登録でき、登録するまでサーバーは警告を出し続けます。", skipBtn: "リスクを理解してスキップします", skipAsk: "認証アプリなしでセットアップを終えますか？管理者アカウントのパスワードだけで管理ページが開きます。",
    doneH: "設定が完了しました",
    doneP: "外部サービスのキーは管理ページの設定タブで入力できます。キーごとに取得先の案内があります。入れなくてもサーバーは動きます。",
    next: "次へ", open: "管理ページを開く",
    err: {
      "bad-code": "設定コードが違います。", "locked-out": "失敗が続いたため一時的に止めています。しばらくして再試行します。",
      "invalid-name": "IDの形式が正しくありません。", "weak-password": "パスワードは8文字以上必要です。", mismatch: "パスワードが一致しません。",
      "bad-otp": "コードが一致しません。アプリの時刻を確認します。", expired: "時間切れです。ページを再読み込みします。",
      "setup-closed": "設定はすでに完了しています。", locked: "先に設定コードを入力します。", origin: "開いたアドレスがサーバーの認識するアドレスと違います。リバースプロキシやトンネルの後ろなら .env の COOK_TRUST_PROXY を確認します。", other: "処理できませんでした。再試行します。",
    },
  },
  zh: {
    title: "CookingFoil 初始设置",
    lead: "这台服务器还没有账户。创建管理员账户之前，其他页面都无法打开。",
    codeH: "设置码",
    codeP: "服务器启动时已把设置码打印到容器日志中。用 docker logs <容器> 查看后输入。每次启动设置码都会改变。",
    accountH: "管理员账户",
    accountP: "用于管理页面和网页的账户。ID 可用字母、数字、点、下划线和连字符，最多 32 个字符；密码至少 8 个字符。",
    name: "ID", password: "密码", password2: "确认密码",
    otpH: "注册验证器",
    otpP: "管理页面除密码外还会要求验证器应用的 6 位验证码。用 Google Authenticator、1Password 等扫描二维码或手动输入密钥，然后输入应用显示的验证码。",
    otpCode: "6 位验证码",
    skip: "不使用身份验证器继续", skipWarn: "不建议这样做。不登记身份验证器就完成时，只凭管理员账户的密码就能打开管理页面，密码一旦泄露，任何人都能管理这台服务器。之后可在设置标签中登记身份验证器，在登记之前服务器会一直发出警告。", skipBtn: "我了解风险，跳过", skipAsk: "不使用身份验证器完成设置吗？只凭账户密码就能打开管理页面。",
    doneH: "设置完成",
    doneP: "外部服务的密钥可在管理页面的设置选项卡中填写，每项都附有获取方法。不填写服务器也能运行。",
    next: "下一步", open: "打开管理页面",
    err: {
      "bad-code": "设置码不正确。", "locked-out": "尝试次数过多，已暂时锁定。请稍后再试。",
      "invalid-name": "ID 格式不正确。", "weak-password": "密码至少需要 8 个字符。", mismatch: "两次输入的密码不一致。",
      "bad-otp": "验证码不匹配。请检查应用的时间。", expired: "已超时。请刷新页面。",
      "setup-closed": "设置已经完成。", locked: "请先输入设置码。", origin: "你打开的地址与服务器识别的地址不一致。如果在反向代理或隧道之后，请检查 .env 中的 COOK_TRUST_PROXY。", other: "处理失败，请重试。",
    },
  },
};

export function setupPage({ step, lang }) {
  const t = T[lang] ?? T.en;
  const json = JSON.stringify({ step, err: t.err }).replace(/</g, "\\u003c");
  return /* html */ `<!doctype html><html lang="${lang in T ? lang : "en"}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>${ADMIN_HEAD}<style>${ADMIN_CSS}
body{min-height:100vh;display:grid;place-items:center;padding:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:30px;width:min(460px,100%);box-shadow:0 30px 60px var(--shadow)}
.logo{display:block;margin:0 auto;background:#F2F1EE;border-radius:22%;padding:3px;box-sizing:border-box}
h1{font-size:19px;margin:6px 0 6px;text-align:center}h2{font-size:16px;margin:0 0 6px}
.lead{color:var(--muted);font-size:13px;text-align:center;margin:0 0 22px}
.step p{color:var(--muted);font-size:13px;margin:0 0 14px}
form{display:flex;flex-direction:column;gap:10px}form input{width:100%}
.qr{width:200px;height:200px;margin:0 auto 10px;background:#fff;border-radius:12px;padding:6px}.qr svg{width:100%;height:100%;display:block}
.key{background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center;font-family:ui-monospace,monospace;letter-spacing:2px;word-break:break-all;color:var(--accent);margin-bottom:12px}
.err{color:var(--bad,#d33);font-size:13px;min-height:18px;margin:4px 0 0}
a.btn{display:block;text-align:center;text-decoration:none}
.skip{margin-top:18px;font-size:13px}.skip summary{cursor:pointer;color:var(--muted)}
.step .skip p.warn{color:var(--bad,#d33);background:rgba(var(--bad-rgb),.08);border:1px solid rgba(var(--bad-rgb),.35);border-radius:10px;padding:10px 12px;margin:10px 0}
</style></head><body>
<main class="box">
<img class="logo" src="/assets/cookingfoil.svg" alt="" width="52" height="52">
<h1>${t.title}</h1><p class="lead">${t.lead}</p>
<section class="step" data-step="code" hidden><h2>${t.codeH}</h2><p>${t.codeP}</p>
  <form data-api="unlock"><input name="code" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX" aria-label="${t.codeH}" maxlength="12" required><button class="primary">${t.next}</button></form></section>
<section class="step" data-step="account" hidden><h2>${t.accountH}</h2><p>${t.accountP}</p>
  <form data-api="account"><input name="name" autocomplete="username" spellcheck="false" placeholder="${t.name}" aria-label="${t.name}" maxlength="32" required>
  <input name="password" type="password" autocomplete="new-password" placeholder="${t.password}" aria-label="${t.password}" minlength="8" maxlength="128" required>
  <input name="password2" type="password" autocomplete="new-password" placeholder="${t.password2}" aria-label="${t.password2}" minlength="8" maxlength="128" required>
  <button class="primary">${t.next}</button></form></section>
<section class="step" data-step="otp" hidden><h2>${t.otpH}</h2><p>${t.otpP}</p>
  <div class="qr" id="qr" role="img" aria-label="QR"></div><div class="key" id="key"></div>
  <form data-api="otp/confirm"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" aria-label="${t.otpCode}" maxlength="6" required><button class="primary">${t.next}</button></form>
  <details class="skip"><summary>${t.skip}</summary><p class="warn">${t.skipWarn}</p>
  <form data-api="otp/skip" data-confirm="${t.skipAsk}"><button class="danger">${t.skipBtn}</button></form></details></section>
<section class="step" data-step="done" hidden><h2>${t.doneH}</h2><p>${t.doneP}</p><a class="btn primary" href="/admin#settings">${t.open}</a></section>
<p class="err" id="err" role="alert"></p>
</main>
<script>
const S=${json};const $=(id)=>document.getElementById(id);
async function post(path,body){const r=await fetch('/setup/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body||{})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'other');return d;}
async function show(step){document.querySelectorAll('.step').forEach((s)=>{s.hidden=s.dataset.step!==step;});$('err').textContent='';
  if(step==='otp'){try{const d=await post('otp/start');$('qr').innerHTML=d.qr||'';$('key').textContent=String(d.secret).replace(/(.{4})/g,'$1 ').trim();}catch(e){fail(e);}}
  const f=document.querySelector('.step:not([hidden]) input');if(f)f.focus();}
function fail(e){$('err').textContent=S.err[e.message]||S.err.other;}
document.querySelectorAll('form[data-api]').forEach((f)=>f.addEventListener('submit',async(ev)=>{ev.preventDefault();
  if(f.dataset.confirm&&!confirm(f.dataset.confirm))return;
  const body=Object.fromEntries(new FormData(f));
  if(body.password2!==undefined){if(body.password!==body.password2)return fail(new Error('mismatch'));delete body.password2;}
  try{const d=await post(f.dataset.api,body);show(d.next);}catch(e){fail(e);}}));
show(S.step);
</script></body></html>`;
}
