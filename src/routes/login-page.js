/**
 * The phone pages of Google sign-in: /login and the device approval it leads
 * to (/device, and /admin/pair/<token> when a console's QR is scanned).
 *
 *   loginPage   signin   the Google button
 *               pending  signed in, waiting for the admin to approve the account
 *               disabled the admin turned the account off
 *               off      Google sign-in is not set up on this server
 *   devicePage  code     type the 8-character code a console shows
 *               confirm  one console (its QR was scanned): a single button
 *               done     that console is already approved
 *               expired  the QR is gone
 */
import fs from "fs";
import { escapeHtml } from "./admin/escape.js";

// These pages sit outside the shop's sign-in, and /assets inside it, so the logo travels inline.
const LOGO = `data:image/svg+xml;base64,${fs.readFileSync(new URL("../views/assets/cookingfoil.svg", import.meta.url)).toString("base64")}`;

const TEXT = {
  ko: {
    signinTitle: "로그인",
    signinLead: "구글 계정으로 로그인합니다. 처음 로그인한 계정은 관리자가 승인한 뒤에 쓸 수 있습니다.",
    google: "Google 계정으로 로그인",
    pendingTitle: "승인을 기다립니다",
    pendingLead: "{email} 계정으로 로그인했습니다. 관리자가 승인하면 이 화면에서 기기를 연결할 수 있습니다.",
    retry: "승인됐는지 다시 확인",
    disabledTitle: "쓸 수 없는 계정입니다",
    disabledLead: "{email} 계정은 관리자가 사용을 중지했습니다.",
    offTitle: "로그인을 쓸 수 없습니다",
    offLead: "이 서버에는 구글 로그인이 설정되지 않았습니다. 관리자에게 문의합니다.",
    errorLead: "로그인하지 못했습니다. 다시 시도합니다.",
    adminLink: "관리자 인증으로 승인합니다",
    other: "다른 계정으로 로그인",
    signedInAs: "{email} 계정",
    signOut: "로그아웃",
    codeTitle: "기기 연결",
    codeLead: "스위치에 뜬 QR을 휴대폰 카메라로 찍거나, 스위치 화면의 기기 코드 8자리를 입력합니다.",
    codeLabel: "기기 코드",
    confirmTitle: "이 스위치를 연결합니다",
    confirmLead: "스위치에 표시된 기기 코드와 같은지 확인합니다.",
    nameLabel: "기기 이름",
    optional: "(선택)",
    approve: "연결을 승인합니다",
    doneTitle: "연결을 승인했습니다",
    doneLead: "스위치가 곧 자동으로 서버에 연결합니다. 이 창은 닫아도 됩니다.",
    expiredTitle: "연결 시간이 지났습니다",
    expiredLead: "스위치에서 새 QR을 띄워 다시 찍습니다.",
    errNotFound: "그 코드로 기다리는 스위치가 없습니다. 스위치 화면의 코드를 확인합니다.",
    errExpired: "연결 시간이 지났습니다. 스위치의 새 QR을 찍습니다.",
    errUsed: "이미 승인된 스위치입니다.",
    errAuth: "로그인이 풀렸습니다. 다시 로그인합니다.",
    errOther: "승인하지 못했습니다. 다시 시도합니다.",
    errNetwork: "서버에 연결하지 못했습니다. 다시 시도합니다.",
  },
  en: {
    signinTitle: "Sign in",
    signinLead: "Sign in with your Google account. A new account can be used once the admin approves it.",
    google: "Sign in with Google",
    pendingTitle: "Waiting for approval",
    pendingLead: "You are signed in as {email}. Once the admin approves the account, you can connect consoles here.",
    retry: "Check again",
    disabledTitle: "This account is turned off",
    disabledLead: "The admin has turned off {email}.",
    offTitle: "Sign-in is unavailable",
    offLead: "Google sign-in isn't set up on this server. Ask the admin.",
    errorLead: "Couldn't sign in. Try again.",
    adminLink: "Approve with the admin login instead",
    other: "Use another account",
    signedInAs: "Signed in as {email}",
    signOut: "Sign out",
    codeTitle: "Connect a console",
    codeLead: "Scan the QR on the Switch with your phone's camera, or type the 8-character device code it shows.",
    codeLabel: "Device code",
    confirmTitle: "Connect this Switch",
    confirmLead: "Check that the code matches the one on the Switch.",
    nameLabel: "Console name",
    optional: "(optional)",
    approve: "Approve the connection",
    doneTitle: "Connection approved",
    doneLead: "The Switch connects on its own in a moment. You can close this page.",
    expiredTitle: "This link has expired",
    expiredLead: "Show a new QR on the Switch and scan it again.",
    errNotFound: "No Switch is waiting with that code. Check the code on its screen.",
    errExpired: "This link has expired. Scan the Switch's new QR.",
    errUsed: "That Switch is already approved.",
    errAuth: "You were signed out. Sign in again.",
    errOther: "Couldn't approve it. Try again.",
    errNetwork: "Couldn't reach the server. Try again.",
  },
};

const textFor = (lang) => TEXT[lang] ?? TEXT.en;
const fill = (s, email) => escapeHtml(s).replace("{email}", `<b>${escapeHtml(email ?? "")}</b>`);

const STYLE = `:root{color-scheme:light dark;--bg:#F2F1EE;--card:#fff;--ink:#16161A;--muted:#55555E;--line:#E2E0DA;--soft:#F2F1EE;--accent:#FFC23D;--bad:#982929;font-family:'IBM Plex Sans KR',system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1C1C20;--ink:#F2F1EE;--muted:#A9A9B2;--line:#2E2E34;--soft:#26262B;--bad:#FF8A80}}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px;width:min(100%,440px)}
.brand{display:flex;align-items:center;gap:12px;margin:0 0 24px}.brand .wm{font-family:'Baloo 2',system-ui,sans-serif;font-weight:800;font-size:28px;letter-spacing:-.02em}.brand .dot{color:var(--accent)}
h1{font-size:26px;margin:0 0 12px}p{font-size:17px;line-height:1.6;color:var(--muted);margin:0 0 16px;word-break:keep-all}p b{color:var(--ink);word-break:break-all}
.device-code{display:block;font:700 30px monospace;letter-spacing:3px;padding:18px;text-align:center;background:var(--soft);border-radius:12px;margin:20px 0}
label{display:block;font-size:16px;margin:14px 0 8px}label span{color:var(--muted)}
input{font:inherit;font-size:19px;width:100%;border:1px solid var(--line);border-radius:10px;padding:13px;background:var(--card);color:var(--ink)}
#code{text-align:center;letter-spacing:4px;font-family:monospace;text-transform:uppercase}
button,.button{display:flex;align-items:center;justify-content:center;gap:10px;text-align:center;text-decoration:none;font:inherit;font-weight:700;font-size:18px;width:100%;min-height:54px;border:0;border-radius:12px;padding:14px;background:var(--accent);color:#16161A;margin:16px 0 0;cursor:pointer}
.button.google{background:#fff;color:#1F1F1F;border:1px solid #DADCE0}.button.google svg{flex:none}
.button.ghost,button.ghost{background:var(--soft);color:var(--ink);font-weight:600;font-size:16px;min-height:48px}button:disabled{opacity:.6;cursor:wait}
input:focus-visible,button:focus-visible,a:focus-visible{outline:4px solid #0AB4E8;outline-offset:3px}
.who{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px;color:var(--muted);border-top:1px solid var(--line);margin:24px 0 0;padding:16px 0 0}
.who span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.who button{width:auto;min-height:0;margin:0;padding:8px 12px;font-size:14px;background:var(--soft);color:var(--ink)}
.small{display:block;text-align:center;margin:18px 0 0;color:var(--muted);font-size:15px}
#error{color:var(--bad);margin:12px 0 0;font-size:16px}#error:empty{display:none}
@media(max-width:420px){body{padding:14px}.card{padding:22px}}`;

const GOOGLE_G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

function shell(lang, title, body, script = "") {
  return `<!doctype html><html lang="${lang === "ko" ? "ko" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>CookingFoil · ${escapeHtml(title)}</title><link rel="icon" href="${LOGO}" type="image/svg+xml"><style>${STYLE}</style></head>
<body><main class="card"><div class="brand"><img src="${LOGO}" alt="" width="40" height="40"><span class="wm">cookingfoil<span class="dot">.</span></span></div>
<h1>${escapeHtml(title)}</h1>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

const SIGN_OUT_SCRIPT = `const out=document.getElementById('signout');if(out)out.addEventListener('click',async()=>{out.disabled=true;try{await fetch('/auth/logout',{method:'POST'});}finally{location.href='/login';}});`;

function whoBar(t, email) {
  return `<div class="who"><span>${fill(t.signedInAs, email)}</span><button type="button" id="signout">${escapeHtml(t.signOut)}</button></div>`;
}

export function loginPage({ lang = "ko", state = "signin", next = "/device", email = null, error = false, adminHref = null } = {}) {
  const t = textFor(lang);
  const start = `/auth/google/start?next=${encodeURIComponent(next)}`;
  const admin = adminHref ? `<a class="small" href="${escapeHtml(adminHref)}">${escapeHtml(t.adminLink)}</a>` : "";
  if (state === "off") return shell(lang, t.offTitle, `<p>${escapeHtml(t.offLead)}</p>${admin}`);
  if (state === "pending") {
    return shell(lang, t.pendingTitle, `<p>${fill(t.pendingLead, email)}</p>
<a class="button" href="${escapeHtml(`/login?next=${encodeURIComponent(next)}`)}">${escapeHtml(t.retry)}</a>${admin}${whoBar(t, email)}`, SIGN_OUT_SCRIPT);
  }
  if (state === "disabled") {
    return shell(lang, t.disabledTitle, `<p>${fill(t.disabledLead, email)}</p>
<a class="button ghost" href="${escapeHtml(start)}">${escapeHtml(t.other)}</a>${whoBar(t, email)}`, SIGN_OUT_SCRIPT);
  }
  return shell(lang, t.signinTitle, `<p>${escapeHtml(t.signinLead)}</p>${error ? `<p id="error" role="alert">${escapeHtml(t.errorLead)}</p>` : ""}
<a class="button google" href="${escapeHtml(start)}">${GOOGLE_G}<span>${escapeHtml(t.google)}</span></a>${admin}`);
}

function approveScript(t) {
  const errs = JSON.stringify({ 404: t.errNotFound, 410: t.errExpired, 409: t.errUsed, 401: t.errAuth, other: t.errOther, net: t.errNetwork });
  return `const E=${errs},form=document.getElementById('approve'),error=document.getElementById('error');
if(form)form.addEventListener('submit',async(e)=>{e.preventDefault();const button=form.querySelector('button');const body={label:document.getElementById('label').value};
const code=document.getElementById('code');if(code)body.code=code.value;else body.token=form.dataset.token;
button.disabled=true;error.textContent='';try{const r=await fetch('/auth/device/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
if(r.ok){location.href=code?'/device?done=1':location.pathname;return;}if(r.status===401){location.href='/login?next='+encodeURIComponent(location.pathname);return;}error.textContent=E[r.status]||E.other;}
catch{error.textContent=E.net;}finally{button.disabled=false;}});${SIGN_OUT_SCRIPT}`;
}

export function devicePage({ lang = "ko", view = "code", code = "", token = "", email = "" } = {}) {
  const t = textFor(lang);
  if (view === "expired") return shell(lang, t.expiredTitle, `<p>${escapeHtml(t.expiredLead)}</p>`);
  if (view === "done") return shell(lang, t.doneTitle, `<p>${escapeHtml(t.doneLead)}</p>${whoBar(t, email)}`, SIGN_OUT_SCRIPT);
  const name = `<label for="label">${escapeHtml(t.nameLabel)} <span>${escapeHtml(t.optional)}</span></label><input id="label" maxlength="64" placeholder="Nintendo Switch" autocomplete="off">`;
  const body = view === "confirm"
    ? `<p>${escapeHtml(t.confirmLead)}</p><strong class="device-code">${escapeHtml(code)}</strong>
<form id="approve" data-token="${escapeHtml(token)}" novalidate>${name}<button type="submit">${escapeHtml(t.approve)}</button></form>`
    : `<p>${escapeHtml(t.codeLead)}</p><form id="approve" novalidate><label for="code">${escapeHtml(t.codeLabel)}</label>
<input id="code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="A1B2C3D4" required>${name}
<button type="submit">${escapeHtml(t.approve)}</button></form>`;
  return shell(lang, view === "confirm" ? t.confirmTitle : t.codeTitle, `${body}<p id="error" role="alert"></p>${whoBar(t, email)}`, approveScript(t));
}
