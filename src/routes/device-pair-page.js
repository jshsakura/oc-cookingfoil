/**
 * The signed-in device-approval page. `view` is one of:
 *   scan     /pair: camera scanner plus a device-code field
 *   confirm  /pair/<token>: the console's QR opened here directly
 *   done     the console behind the link is already approved
 *   expired  the link is gone
 *   signin   nobody to approve as (a pairing-only shop without an admin session)
 */
import { escapeHtml } from "./admin/escape.js";
import { PAIR_TEXT } from "./device-pair-text.js";

const STYLE = `:root{color-scheme:light dark;--bg:#F2F1EE;--card:#fff;--ink:#16161A;--muted:#55555E;--line:#E2E0DA;--soft:#F2F1EE;--accent:#FFC23D;--bad:#982929;font-family:'IBM Plex Sans KR',system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1C1C20;--ink:#F2F1EE;--muted:#A9A9B2;--line:#2E2E34;--soft:#26262B;--bad:#FF8A80}}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px;width:min(100%,460px)}
.brand{display:flex;align-items:center;gap:12px;margin:0 0 24px;text-decoration:none;color:inherit}.brand .wm{font-family:'Baloo 2',sans-serif;font-weight:800;font-size:28px;letter-spacing:-.02em}.brand .dot{color:var(--accent)}
h1{font-size:26px;margin:0 0 12px}p{font-size:17px;line-height:1.6;color:var(--muted);margin:0 0 16px;word-break:keep-all}
.who{font-size:15px;background:var(--soft);border-radius:10px;padding:10px 14px}
.device-code{display:block;font:700 30px monospace;letter-spacing:3px;padding:18px;text-align:center;background:var(--soft);border-radius:12px;margin:20px 0}
.viewer{position:relative;border-radius:14px;overflow:hidden;background:#000;aspect-ratio:1;margin:0 0 12px}.viewer video{width:100%;height:100%;object-fit:cover;display:block}
.viewer::after{content:"";position:absolute;inset:18%;border:3px solid var(--accent);border-radius:16px;box-shadow:0 0 0 999px rgba(0,0,0,.35)}
.divider{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:15px;margin:22px 0 14px}.divider::before,.divider::after{content:"";flex:1;border-top:1px solid var(--line)}
label{display:block;font-size:16px;margin:14px 0 8px}label span{color:var(--muted)}
input{font:inherit;font-size:19px;width:100%;border:1px solid var(--line);border-radius:10px;padding:13px;background:var(--card);color:var(--ink)}
#code{text-align:center;letter-spacing:4px;font-family:monospace;text-transform:uppercase}
.hint{font-size:14px;margin:6px 0 0}
button,.button{display:block;text-align:center;text-decoration:none;font:inherit;font-weight:700;font-size:18px;width:100%;border:0;border-radius:10px;padding:15px;background:var(--accent);color:#16161A;margin:16px 0 0;cursor:pointer}
button.ghost,.button.ghost{background:var(--soft);color:var(--ink)}button:disabled{opacity:.6;cursor:wait}
input:focus-visible,button:focus-visible,a:focus-visible{outline:4px solid #0AB4E8;outline-offset:3px}
.ok{color:#2E7D4F;margin:12px 0 0;font-size:16px}.ok:empty{display:none}
.block{border-top:1px solid var(--line);margin:28px 0 0;padding:24px 0 0}h2{font-size:20px;margin:0 0 10px}
.issued{background:var(--soft);border-radius:12px;padding:16px;margin:16px 0 0}.issued dl{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin:10px 0}
.issued button.ghost{background:var(--card);border:1px solid var(--line)}.issued dt{color:var(--muted);font-size:15px}.issued dd{margin:0;font:700 18px monospace;word-break:break-all;user-select:all}
.mine{list-style:none;margin:0;padding:0}.mine li{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--line)}
.mine li:last-child{border-bottom:0}.mine li div{display:flex;flex-direction:column;gap:2px;min-width:0}.mine .hint{margin:0}
button.small{width:auto;font-size:15px;padding:9px 14px;margin:0;background:var(--soft);color:var(--bad);flex:none}
#error{color:var(--bad);margin:12px 0 0;font-size:16px}#error:empty{display:none}
.back{display:block;text-align:center;margin:20px 0 0;color:var(--muted);font-size:15px}
.client-card{display:flex;align-items:center;gap:16px;padding:16px;margin:0 0 16px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}
.client-card img{width:64px;height:64px;border-radius:16px;flex:none;background:var(--card);object-fit:cover}
.client-card div{display:flex;flex-direction:column;gap:2px;min-width:0}.client-card strong{font-size:18px}.client-card .hint{font-weight:600;margin:0}
[hidden]{display:none!important}
@media(max-width:420px){body{padding:16px}.card{padding:22px}}`;

function form(t, { withCode, code }) {
  return `<form id="approve" novalidate>
${withCode ? `<label for="code">${t.codeLabel}</label><input id="code" name="code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" placeholder="A1B2C3D4" required><p class="hint">${t.codeHint}</p>` : `<strong class="device-code">${escapeHtml(code)}</strong>`}
<label for="label">${t.nameLabel} <span>${t.optional}</span></label><input id="label" name="label" maxlength="64" placeholder="${t.namePlaceholder}" autocomplete="off">
<button type="submit">${t.approve}</button></form>`;
}

function clientSection(t) {
  return `<section class="block" id="client"><h2>${t.clientTitle}</h2>
<div class="client-card"><img id="client-icon" src="/api/client/icon" alt="" width="64" height="64" decoding="async">
<div><strong>CookingFoil</strong><span class="hint" id="client-meta"></span></div></div>
<p>${t.clientLead}</p><button type="button" id="get-client">${t.clientGet}</button><p class="hint">${t.clientHint}</p></section>`;
}

function mineSection(t) {
  return `<section class="block"><h2>${t.mineTitle}</h2><ul id="mine" class="mine"><li class="hint">${t.mineEmpty}</li></ul></section>`;
}

function body(view, t, { code, approver, pairing = true }) {
  const who = approver === "admin" ? t.asAdmin : t.asUser.replace("{user}", `<strong>${escapeHtml(approver)}</strong>`);
  switch (view) {
    case "done":
      return `<h1>${t.doneTitle}</h1><p>${t.doneBody}</p><a class="button ghost" href="/pair">${t.another}</a>`;
    case "expired":
      return `<h1>${t.expiredTitle}</h1><p>${t.expiredBody}</p><a class="button ghost" href="/pair">${t.another}</a>`;
    case "signin":
      return `<h1>${t.title}</h1><p>${t.signIn}</p><a class="button" href="/admin">${t.openAdmin}</a>`;
    case "confirm":
      return `<h1>${t.title}</h1><p>${t.confirmLead}</p><p class="who">${who}</p>${form(t, { withCode: false, code })}`;
    default:
      return `<h1>${t.title}</h1><p>${t.lead}</p><p class="who">${who}</p>
${pairing ? `<div id="viewer" class="viewer" hidden><video id="video" playsinline muted></video></div>
<p id="camera-note" class="hint" hidden></p>
<button type="button" id="scan">${t.scan}</button>
<div class="divider">${t.or}</div>${form(t, { withCode: true })}<p id="status" class="ok" role="status"></p>` : ""}
${pairing ? clientSection(t) : ""}${mineSection(t)}`;
  }
}

// Strings the browser script needs, escaped for an inline <script>.
function clientText(t) {
  const keys = ["scan", "stop", "aim", "noCamera", "cameraDenied", "wrongQr", "doneTitle", "doneBody", "another",
    "errNotFound", "errUsed", "errAuth", "errOther", "errNetwork", "expiredBody", "mineEmpty", "kindQr", "kindLogin",
    "notUsed", "connected", "revoke", "revokeConfirm", "errCreate", "unnamed",
    "kindClient", "clientWaiting", "clientUsed", "clientExpired", "clientRevoked", "errNoBuild", "clientCancelConfirm", "cancel"];
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, t[k]]))).replace(/</g, "\\u003c");
}

const SCRIPT = `
const T=JSON.parse(document.getElementById('pair-text').textContent);
const main=document.querySelector('main .content'),approveForm=document.getElementById('approve'),error=document.getElementById('error');
const status=document.getElementById('status')||{};
const token=(location.pathname.match(/^\\/pair\\/([a-f0-9]{32})$/)||[])[1]||null;
function showDone(){main.innerHTML='';const h=document.createElement('h1');h.textContent=T.doneTitle;const p=document.createElement('p');p.textContent=T.doneBody;const a=document.createElement('a');a.className='button ghost';a.href='/pair';a.textContent=T.another;main.append(h,p,a);}
const MESSAGES={404:T.errNotFound,409:T.errUsed,410:T.expiredBody,401:T.errAuth,403:T.errAuth};
async function approve(payload){const button=approveForm.querySelector('button');button.disabled=true;error.textContent='';
  try{const r=await fetch('/pair/approve',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
    if(r.ok){stopCamera();if(token){showDone();return;}approveForm.reset();status.textContent=T.doneTitle+' '+T.doneBody;loadMine();return;}error.textContent=MESSAGES[r.status]||T.errOther;}
  catch{error.textContent=T.errNetwork;}finally{button.disabled=false;}}
if(approveForm)approveForm.addEventListener('submit',e=>{e.preventDefault();const label=document.getElementById('label').value;
  if(token){approve({token,label});return;}
  const code=document.getElementById('code').value.replace(/[\\s-]/g,'').toUpperCase();
  if(!/^[A-F0-9]{8}$/.test(code)){error.textContent=T.errNotFound;document.getElementById('code').focus();return;}
  approve({code,label});});

// ── camera scanner ──
const scanButton=document.getElementById('scan'),viewer=document.getElementById('viewer'),video=document.getElementById('video'),note=document.getElementById('camera-note');
let stream=null,timer=null,detect=null;
function stopCamera(){if(timer)clearTimeout(timer);timer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;if(viewer)viewer.hidden=true;if(scanButton)scanButton.textContent=T.scan;}
function say(text){note.textContent=text;note.hidden=!text;}
function tokenFrom(text){text=String(text||'').trim();
  try{const u=new URL(text,location.href);const m=u.pathname.match(/\\/pair\\/([a-f0-9]{32})$/);if(m&&u.host===location.host)return {token:m[1]};}catch{}
  const code=text.replace(/[\\s-]/g,'').toUpperCase();return /^[A-F0-9]{8}$/.test(code)?{code}:null;}
async function detector(){
  if('BarcodeDetector' in window){try{const formats=await BarcodeDetector.getSupportedFormats();if(formats.includes('qr_code')){const d=new BarcodeDetector({formats:['qr_code']});return async()=>((await d.detect(video))[0]||{}).rawValue;}}catch{}}
  await new Promise((ok,fail)=>{const s=document.createElement('script');s.src='/pair/qr.js';s.onload=ok;s.onerror=fail;document.head.append(s);});
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  return async()=>{const w=video.videoWidth,h=video.videoHeight;if(!w||!h)return null;const scale=Math.min(1,640/Math.max(w,h));
    canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const img=ctx.getImageData(0,0,canvas.width,canvas.height);return (window.jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'})||{}).data;};}
async function tick(){if(!stream)return;let text=null;try{text=await detect();}catch{}
  if(text){const found=tokenFrom(text);
    if(found&&found.token){stopCamera();location.href='/pair/'+found.token;return;}
    if(found&&found.code){stopCamera();document.getElementById('code').value=found.code;approveForm.requestSubmit();return;}
    say(T.wrongQr);}
  timer=setTimeout(tick,200);}
async function startCamera(){error.textContent='';
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});}
  catch{stream=null;say(T.cameraDenied);return;}
  video.srcObject=stream;viewer.hidden=false;scanButton.textContent=T.stop;say(T.aim);
  try{await video.play();detect=detect||await detector();tick();}catch{stopCamera();say(T.cameraDenied);}}
if(scanButton){
  if(!window.isSecureContext||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){scanButton.hidden=true;say(T.noCamera);}
  else scanButton.addEventListener('click',()=>stream?(stopCamera(),say('')):startCamera());}
window.addEventListener('pagehide',stopCamera);

// ── my devices and per-device logins ──
const mine=document.getElementById('mine'),newLogin=document.getElementById('new-login');
const post=(url,body)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body||{})});
const when=(ms)=>ms?new Date(ms).toLocaleString(document.documentElement.lang,{dateStyle:'medium',timeStyle:'short'}):null;
const CLIENT_STATE={used:T.clientUsed,expired:T.clientExpired,revoked:T.clientRevoked};
function clientRow(item){const li=document.createElement('li');const info=document.createElement('div');
  const name=document.createElement('strong');name.textContent=T.kindClient+' · '+when(item.createdAt);
  const meta=document.createElement('span');meta.className='hint';
  meta.textContent=item.state==='waiting'?T.clientWaiting.replace('{time}',when(item.expiresAt)):[CLIENT_STATE[item.state],item.code,item.state==='used'?when(item.usedAt):null].filter(Boolean).join(' · ');
  info.append(name,meta);li.append(info);
  if(item.state==='waiting'){const b=document.createElement('button');b.type='button';b.className='small';b.textContent=T.cancel;
    b.addEventListener('click',async()=>{if(!confirm(T.clientCancelConfirm))return;b.disabled=true;
      const r=await post('/pair/api/clients/'+item.id+'/revoke').catch(()=>null);if(r&&r.ok)loadMine();else{b.disabled=false;error.textContent=T.errOther;}});
    li.append(b);}
  return li;}
function row(item){if(item.kind==='client')return clientRow(item);const li=document.createElement('li');const info=document.createElement('div');
  const name=document.createElement('strong');name.textContent=item.label||(item.kind==='login'?item.name:T.unnamed);
  const meta=document.createElement('span');meta.className='hint';
  meta.textContent=item.kind==='login'?[T.kindLogin+' · '+item.name,item.locked?T.connected:T.notUsed].join(' · '):[T.kindQr,when(item.addedAt)].join(' · ');
  info.append(name,meta);const b=document.createElement('button');b.type='button';b.className='small';b.textContent=T.revoke;
  b.addEventListener('click',async()=>{if(!confirm(T.revokeConfirm))return;b.disabled=true;
    const r=await post(item.kind==='login'?'/pair/api/logins/'+encodeURIComponent(item.name)+'/revoke':'/pair/api/devices/revoke',item.kind==='login'?{}:{deviceKey:item.deviceKey}).catch(()=>null);
    if(r&&r.ok)loadMine();else{b.disabled=false;error.textContent=T.errOther;}});
  li.append(info,b);return li;}
async function loadMine(){if(!mine)return;try{const r=await fetch('/pair/api/mine',{credentials:'same-origin'});if(!r.ok)return;const d=await r.json();
  const items=[...(d.clients||[]).map((x)=>({...x,kind:'client'})),...d.devices.map((x)=>({...x,kind:'qr'})),...d.logins.map((x)=>({...x,kind:'login'}))];
  mine.replaceChildren(...(items.length?items.map(row):[Object.assign(document.createElement('li'),{className:'hint',textContent:T.mineEmpty})]));}catch{}}
if(newLogin)newLogin.addEventListener('submit',async(e)=>{e.preventDefault();const button=newLogin.querySelector('button');button.disabled=true;error.textContent='';
  try{const r=await post('/pair/api/logins',{label:document.getElementById('login-label').value});if(!r.ok)throw new Error();const d=await r.json();
    document.getElementById('issued-url').textContent=d.shopUrl;document.getElementById('issued-name').textContent=d.name;document.getElementById('issued-pass').textContent=d.password;
    document.getElementById('issued').hidden=false;lastLogin=d;newLogin.reset();loadMine();}
  catch{error.textContent=T.errCreate;}finally{button.disabled=false;}});
// CookingFoil reads its servers from sdmc:/switch/cookingfoil/config.json; with this login inside it connects without a QR.
let lastLogin=null;
const configButton=document.getElementById('issued-config');
if(configButton)configButton.addEventListener('click',()=>{if(!lastLogin)return;
  const config={servers:[{title:location.hostname,url:location.origin,username:lastLogin.name,password:lastLogin.password,cfClientId:'',cfClientSecret:'',enabled:true}],
    language:document.documentElement.lang,installTarget:'sd'};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
  a.download='config.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
// The client with this server and a one-day connection key inside, as one zip.
const getClient=document.getElementById('get-client');
if(getClient)getClient.addEventListener('click',async()=>{getClient.disabled=true;error.textContent='';
  try{const r=await post('/pair/api/client-bundle');
    if(!r.ok){error.textContent=r.status===404?T.errNoBuild:T.errOther;return;}
    const name=((r.headers.get('Content-Disposition')||'').match(/filename="([^"]+)"/)||[])[1]||'CookingFoil.zip';
    const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);loadMine();}
  catch{error.textContent=T.errNetwork;}finally{getClient.disabled=false;}});
if(location.hash==='#client'&&getClient)getClient.scrollIntoView({block:'center'});
// The build on offer: its version and size beside the icon; no build, no card.
if(getClient)fetch('/api/client/latest',{credentials:'same-origin'}).then((r)=>r.ok?r.json():null).then((b)=>{
  if(!b){document.getElementById('client').hidden=true;return;}
  document.getElementById('client-meta').textContent='v'+b.version+' · '+(b.size/1048576).toFixed(1)+' MB';}).catch(()=>{});
const clientIcon=document.getElementById('client-icon');if(clientIcon)clientIcon.addEventListener('error',()=>{clientIcon.style.visibility='hidden';});
loadMine();
`;

export function devicePairPage({ view = "scan", lang = "en", code = "", approver = null, pairing = true } = {}) {
  const t = PAIR_TEXT[lang] ?? PAIR_TEXT.en;
  const interactive = view === "scan" || view === "confirm";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${t.title} · CookingFoil</title><link rel="icon" href="/assets/cookingfoil.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/fonts.css"><style>${STYLE}</style></head>
<body><main class="card"><a class="brand" href="/"><img src="/assets/cookingfoil.svg" alt="" width="40" height="40"><span class="wm">cookingfoil<span class="dot">.</span></span></a>
<div class="content">${body(view, t, { code, approver, pairing })}</div><p id="error" role="alert"></p><a class="back" href="/">${t.back}</a></main>
${interactive ? `<script type="application/json" id="pair-text">${clientText(t)}</script><script>${SCRIPT}</script>` : ""}</body></html>`;
}
