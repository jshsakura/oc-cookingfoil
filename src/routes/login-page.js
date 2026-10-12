/**
 * The sign-in page (/login) and the phone's device approval it leads to
 * (/device, and /pair/<token> when a console's QR is scanned).
 *
 *   loginPage   the ID and password form; a Google button under it when Google
 *               sign-in is on, and a note when a Google account is waiting or turned off
 *   devicePage  code     type the 8-character code a console shows
 *               confirm  one console (its QR was scanned): a single button
 *               done     that console is already approved
 *               expired  the QR is gone
 */
import { ICON_CSS, icon } from "../views/icons.js";
import fs from "fs";
import { escapeHtml } from "./admin/escape.js";

// These pages sit outside the shop's sign-in, and /assets inside it, so the logo travels inline.
const LOGO = `data:image/svg+xml;base64,${fs.readFileSync(new URL("../views/assets/cookingfoil.svg", import.meta.url)).toString("base64")}`;

const TEXT = {
  ko: {
    signinTitle: "로그인",
    username: "아이디",
    password: "비밀번호",
    submit: "로그인",
    or: "또는",
    google: "Google 계정으로 로그인",
    googleHint: "구글 계정은 관리자 승인 뒤에 쓸 수 있습니다.",
    pendingLead: "{email} 계정은 관리자의 승인을 기다리고 있습니다. 승인되면 다시 로그인합니다.",
    disabledLead: "{email} 계정은 관리자가 사용을 중지했습니다.",
    errWrong: "아이디나 비밀번호가 맞지 않습니다.",
    errLocked: "로그인에 너무 여러 번 실패해 잠겼습니다. 관리자에게 해제를 요청합니다.",
    errStale: "화면이 오래돼 다시 불러왔습니다. 한 번 더 로그인합니다.",
    errGoogle: "구글로 로그인하지 못했습니다. 다시 시도합니다.",
    signedInAs: "{email} 계정",
    signOut: "로그아웃",
    codeTitle: "기기 연결",
    codeLead: "기기 화면의 QR을 휴대폰 카메라로 찍거나, 기기 화면에 나온 기기 코드 8자리를 입력합니다.",
    codeLabel: "기기 코드",
    confirmTitle: "이 기기를 연결합니다",
    confirmLead: "기기 화면에 표시된 기기 코드와 같은지 확인합니다.",
    nameLabel: "기기 이름",
    namePlaceholder: "거실 기기",
    optional: "(선택)",
    approve: "연결을 승인합니다",
    doneTitle: "연결을 승인했습니다",
    doneLead: "기기가 곧 자동으로 서버에 연결합니다. 이 창은 닫아도 됩니다.",
    expiredTitle: "연결 시간이 지났습니다",
    expiredLead: "기기에서 새 QR을 띄워 다시 찍습니다.",
    errNotFound: "그 코드로 기다리는 기기가 없습니다. 기기 화면의 코드를 확인합니다.",
    errExpired: "연결 시간이 지났습니다. 기기의 새 QR을 찍습니다.",
    errUsed: "이미 승인된 기기입니다.",
    errAuth: "로그인이 풀렸습니다. 다시 로그인합니다.",
    errOther: "승인하지 못했습니다. 다시 시도합니다.",
    errNetwork: "서버에 연결하지 못했습니다. 다시 시도합니다.",
  },
  en: {
    signinTitle: "Sign in",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    or: "or",
    google: "Sign in with Google",
    googleHint: "Google accounts work once the admin approves them.",
    pendingLead: "{email} is waiting for the admin's approval. Sign in again once it is approved.",
    disabledLead: "The admin has turned off {email}.",
    errWrong: "Wrong username or password.",
    errLocked: "Locked after too many failed sign-ins. Ask the admin to unlock it.",
    errStale: "The page was stale and has been reloaded. Sign in once more.",
    errGoogle: "Couldn't sign in with Google. Try again.",
    signedInAs: "Signed in as {email}",
    signOut: "Sign out",
    codeTitle: "Connect a console",
    codeLead: "Scan the QR on the console with your phone's camera, or type the 8-character device code it shows.",
    codeLabel: "Device code",
    confirmTitle: "Connect this console",
    confirmLead: "Check that the code matches the one on the console.",
    nameLabel: "Console name",
    namePlaceholder: "Living room",
    optional: "(optional)",
    approve: "Approve the connection",
    doneTitle: "Connection approved",
    doneLead: "The console connects on its own in a moment. You can close this page.",
    expiredTitle: "This link has expired",
    expiredLead: "Show a new QR on the console and scan it again.",
    errNotFound: "No console is waiting with that code. Check the code on its screen.",
    errExpired: "This link has expired. Scan the console's new QR.",
    errUsed: "That console is already approved.",
    errAuth: "You were signed out. Sign in again.",
    errOther: "Couldn't approve it. Try again.",
    errNetwork: "Couldn't reach the server. Try again.",
  },
  ja: {
    signinTitle: "ログイン",
    username: "ID",
    password: "パスワード",
    submit: "ログイン",
    or: "または",
    google: "Google でログイン",
    googleHint: "Google アカウントは管理者の承認後に使えます。",
    pendingLead: "{email} は管理者の承認を待っています。承認されたらもう一度ログインします。",
    disabledLead: "{email} は管理者が利用を停止しました。",
    errWrong: "ID またはパスワードが違います。",
    errLocked: "ログインに何度も失敗したためロックされました。管理者に解除を依頼します。",
    errStale: "画面が古くなったため読み込み直しました。もう一度ログインします。",
    errGoogle: "Google でログインできませんでした。もう一度試します。",
    signedInAs: "{email} でログイン中",
    signOut: "ログアウト",
    codeTitle: "本体を接続",
    codeLead: "本体に表示された QR をスマートフォンのカメラで読み取るか、本体の画面に出ている 8 文字の端末コードを入力します。",
    codeLabel: "端末コード",
    confirmTitle: "この本体を接続します",
    confirmLead: "本体に表示された端末コードと同じか確認します。",
    nameLabel: "本体の名前",
    namePlaceholder: "リビング",
    optional: "（任意）",
    approve: "接続を承認します",
    doneTitle: "接続を承認しました",
    doneLead: "本体はまもなく自動でサーバーに接続します。このページは閉じてかまいません。",
    expiredTitle: "接続の期限が切れました",
    expiredLead: "本体に新しい QR を表示して、もう一度読み取ります。",
    errNotFound: "そのコードで待っている本体はありません。本体の画面のコードを確認します。",
    errExpired: "接続の期限が切れました。本体の新しい QR を読み取ります。",
    errUsed: "すでに承認された本体です。",
    errAuth: "ログインが切れました。もう一度ログインします。",
    errOther: "承認できませんでした。もう一度試します。",
    errNetwork: "サーバーに接続できませんでした。もう一度試します。",
  },
  zh: {
    signinTitle: "登录",
    username: "账号",
    password: "密码",
    submit: "登录",
    or: "或",
    google: "使用 Google 登录",
    googleHint: "Google 账号需管理员批准后才能使用。",
    pendingLead: "{email} 正在等待管理员批准。批准后请重新登录。",
    disabledLead: "管理员已停用 {email}。",
    errWrong: "账号或密码不正确。",
    errLocked: "登录失败次数过多，已被锁定。请联系管理员解除。",
    errStale: "页面已过期，已重新载入。请再登录一次。",
    errGoogle: "无法使用 Google 登录，请重试。",
    signedInAs: "已登录：{email}",
    signOut: "退出登录",
    codeTitle: "连接主机",
    codeLead: "用手机相机扫描主机上的二维码，或输入主机屏幕上显示的 8 位设备码。",
    codeLabel: "设备码",
    confirmTitle: "连接这台主机",
    confirmLead: "请确认与主机上显示的设备码一致。",
    nameLabel: "主机名称",
    namePlaceholder: "客厅",
    optional: "（可选）",
    approve: "批准连接",
    doneTitle: "已批准连接",
    doneLead: "主机很快会自动连接到服务器。可以关闭此页面。",
    expiredTitle: "连接已过期",
    expiredLead: "请在主机上显示新的二维码并重新扫描。",
    errNotFound: "没有主机在用这个设备码等待。请核对主机屏幕上的设备码。",
    errExpired: "连接已过期。请扫描主机上的新二维码。",
    errUsed: "这台主机已经批准过了。",
    errAuth: "登录已失效，请重新登录。",
    errOther: "无法批准，请重试。",
    errNetwork: "无法连接到服务器，请重试。",
  },
};

const textFor = (lang) => TEXT[lang] ?? TEXT.en;
const fill = (s, email) => escapeHtml(s).replace("{email}", `<b>${escapeHtml(email ?? "")}</b>`);

const STYLE = `:root{color-scheme:light dark;--bg:#F2F1EE;--card:#fff;--ink:#16161A;--muted:#55555E;--line:#E2E0DA;--soft:#F2F1EE;--accent:#FFC23D;--bad:#982929;font-family:'IBM Plex Sans KR',system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1C1C20;--ink:#F2F1EE;--muted:#A9A9B2;--line:#2E2E34;--soft:#26262B;--bad:#FF8A80}}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px;width:min(100%,440px)}
.brand{display:flex;align-items:center;gap:12px;margin:0 0 24px}.brand .wm{font-family:'Baloo 2',system-ui,sans-serif;font-weight:800;font-size:28px;letter-spacing:-.02em}.brand .dot{color:var(--accent)}
h1{font-size:26px;margin:0 0 12px}p{font-size:17px;line-height:1.6;color:var(--muted);margin:0 0 16px;overflow-wrap:anywhere}:lang(ko) p{word-break:keep-all}p b{color:var(--ink);word-break:break-all}
.device-code{display:block;font:700 30px monospace;letter-spacing:3px;padding:18px;text-align:center;background:var(--soft);border-radius:12px;margin:20px 0}
label{display:flex;align-items:center;gap:6px;font-size:16px;margin:14px 0 8px}label span{color:var(--muted)}
input{font:inherit;font-size:19px;width:100%;border:1px solid var(--line);border-radius:10px;padding:13px;background:var(--card);color:var(--ink)}
#code{text-align:center;letter-spacing:4px;font-family:monospace;text-transform:uppercase}
button,.button{display:flex;align-items:center;justify-content:center;gap:10px;text-align:center;text-decoration:none;font:inherit;font-weight:700;font-size:18px;width:100%;min-height:54px;border:0;border-radius:12px;padding:14px;background:var(--accent);color:#16161A;margin:16px 0 0;cursor:pointer}
.button.google{background:#fff;color:#1F1F1F;border:1px solid #DADCE0}.button.google svg{flex:none}
.button.ghost,button.ghost{background:var(--soft);color:var(--ink);font-weight:600;font-size:16px;min-height:48px}button:disabled{opacity:.6;cursor:wait}
input:focus-visible,button:focus-visible,a:focus-visible{outline:4px solid #0AB4E8;outline-offset:3px}
.who{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px;color:var(--muted);border-top:1px solid var(--line);margin:24px 0 0;padding:16px 0 0}
.who span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.who button{display:inline-flex;align-items:center;gap:6px;width:auto;min-height:0;margin:0;padding:8px 12px;font-size:14px;background:var(--soft);color:var(--ink)}
.divider{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:14px;margin:22px 0 0}.divider::before,.divider::after{content:"";flex:1;border-top:1px solid var(--line)}
.note{font-size:15px;background:var(--soft);border-radius:10px;padding:12px 14px;margin:0 0 16px}
.hint{display:flex;align-items:center;justify-content:center;gap:5px;font-size:13px;line-height:1.5;margin:10px 0 0;text-align:center}
.small{display:block;text-align:center;margin:18px 0 0;color:var(--muted);font-size:15px}
#error{color:var(--bad);margin:12px 0 0;font-size:16px}#error:empty{display:none}
@media(max-width:420px){body{padding:14px}.card{padding:22px}}`;

const GOOGLE_G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

function shell(lang, title, body, script = "") {
  return `<!doctype html><html lang="${{ ko: "ko", ja: "ja", zh: "zh-Hans" }[lang] ?? "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>CookingFoil · ${escapeHtml(title)}</title><link rel="icon" href="${LOGO}" type="image/svg+xml"><style>${STYLE}${ICON_CSS}</style></head>
<body><main class="card"><div class="brand"><img src="${LOGO}" alt="" width="40" height="40"><span class="wm">cookingfoil<span class="dot">.</span></span></div>
<h1>${escapeHtml(title)}</h1>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

const SIGN_OUT_SCRIPT = `const out=document.getElementById('signout');if(out)out.addEventListener('click',async()=>{out.disabled=true;try{await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':out.dataset.csrf}});}finally{location.href='/login';}});`;

function whoBar(t, user, csrf) {
  return `<div class="who"><span>${fill(t.signedInAs, user)}</span><button type="button" id="signout" data-csrf="${escapeHtml(csrf)}">${icon("logout")}${escapeHtml(t.signOut)}</button></div>`;
}

export function loginPage({ lang = "ko", next = "/", csrf = "", google = false, googleState = null, googleEmail = null, error = null } = {}) {
  const t = textFor(lang);
  const errText = { wrong: t.errWrong, locked: t.errLocked, expired: t.errStale, google: t.errGoogle }[error];
  const note = googleState === "pending" ? t.pendingLead : googleState === "disabled" ? t.disabledLead : null;
  const googleBlock = google
    ? `<div class="divider">${escapeHtml(t.or)}</div><a class="button google" href="${escapeHtml(`/auth/google/start?next=${encodeURIComponent(next)}`)}">${GOOGLE_G}<span>${escapeHtml(t.google)}</span></a><p class="hint">${icon("info")}${escapeHtml(t.googleHint)}</p>`
    : "";
  return shell(lang, t.signinTitle, `${note ? `<p class="note">${fill(note, googleEmail)}</p>` : ""}
<form method="post" action="/login" novalidate>
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="next" value="${escapeHtml(next)}">
<label for="username">${icon("user")}${escapeHtml(t.username)}</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" required autofocus>
<label for="password">${icon("lock")}${escapeHtml(t.password)}</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required>
${errText ? `<p id="error" role="alert">${escapeHtml(errText)}</p>` : ""}<button type="submit">${icon("login")}<span>${escapeHtml(t.submit)}</span></button></form>${googleBlock}`);
}

function approveScript(t, csrf) {
  const errs = JSON.stringify({ 404: t.errNotFound, 410: t.errExpired, 409: t.errUsed, 401: t.errAuth, other: t.errOther, net: t.errNetwork });
  return `const E=${errs},form=document.getElementById('approve'),error=document.getElementById('error');
if(form)form.addEventListener('submit',async(e)=>{e.preventDefault();const button=form.querySelector('button');const body={label:document.getElementById('label').value};
const code=document.getElementById('code');if(code)body.code=code.value;else body.token=form.dataset.token;
button.disabled=true;error.textContent='';try{const r=await fetch('/auth/device/approve',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':${JSON.stringify(csrf)}},body:JSON.stringify(body)});
if(r.ok){location.href=code?'/device?done=1':location.pathname;return;}if(r.status===401){location.href='/login?next='+encodeURIComponent(location.pathname);return;}error.textContent=E[r.status]||E.other;}
catch{error.textContent=E.net;}finally{button.disabled=false;}});${SIGN_OUT_SCRIPT}`;
}

export function devicePage({ lang = "ko", view = "code", code = "", token = "", user = "", csrf = "" } = {}) {
  const t = textFor(lang);
  if (view === "expired") return shell(lang, t.expiredTitle, `<p>${escapeHtml(t.expiredLead)}</p>`);
  if (view === "done") return shell(lang, t.doneTitle, `<p>${escapeHtml(t.doneLead)}</p>${whoBar(t, user, csrf)}`, SIGN_OUT_SCRIPT);
  const name = `<label for="label">${icon("tag")}${escapeHtml(t.nameLabel)} <span>${escapeHtml(t.optional)}</span></label><input id="label" maxlength="64" placeholder="${escapeHtml(t.namePlaceholder)}" autocomplete="off">`;
  const body = view === "confirm"
    ? `<p>${escapeHtml(t.confirmLead)}</p><strong class="device-code">${escapeHtml(code)}</strong>
<form id="approve" data-token="${escapeHtml(token)}" novalidate>${name}<button type="submit">${icon("check")}<span>${escapeHtml(t.approve)}</span></button></form>`
    : `<p>${escapeHtml(t.codeLead)}</p><form id="approve" novalidate><label for="code">${icon("keypad")}${escapeHtml(t.codeLabel)}</label>
<input id="code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="A1B2C3D4" required>${name}
<button type="submit">${icon("check")}<span>${escapeHtml(t.approve)}</span></button></form>`;
  return shell(lang, view === "confirm" ? t.confirmTitle : t.codeTitle, `${body}<p id="error" role="alert"></p>${whoBar(t, user, csrf)}`, approveScript(t, csrf));
}
