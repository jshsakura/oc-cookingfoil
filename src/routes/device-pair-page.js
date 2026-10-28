/**
 * The signed-in device-approval page. `view` is one of:
 *   scan     /pair: camera scanner plus a device-code field
 *   confirm  /pair/<token>: the console's QR opened here directly
 *   done     the console behind the link is already approved
 *   expired  the link is gone
 *   signin   nobody to approve as (a pairing-only library without an admin session)
 */
import { escapeHtml } from "./admin/escape.js";
import { PAIR_TEXT } from "./device-pair-text.js";
import { tableLang } from "../meta/langs.js";
import { enrollPerHour } from "../helpers/envs.js";

const STYLE = `:root{color-scheme:light dark;--bg:#F2F1EE;--card:#fff;--ink:#16161A;--muted:#55555E;--line:#E2E0DA;--soft:#F2F1EE;--accent:#FFC23D;--bad:#982929;--good:#2E7D4F;font-family:'IBM Plex Sans KR',system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1C1C20;--ink:#F2F1EE;--muted:#A9A9B2;--line:#2E2E34;--soft:#26262B;--bad:#FF8A80;--good:#7BD69D}}
*{box-sizing:border-box}body{margin:0;min-height:100svh;background:var(--bg);color:var(--ink)}
.top{display:flex;align-items:center;gap:16px;max-width:1120px;margin:0 auto;padding:20px 32px}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;margin-right:auto}.brand .wm{font-family:'Baloo 2',sans-serif;font-weight:800;font-size:26px;letter-spacing:-.02em}.brand .dot{color:var(--accent)}
.who{font-size:15px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:8px 16px;margin:0;color:var(--muted)}.who strong{color:var(--ink)}
.top .back{color:var(--muted);font-size:15px;white-space:nowrap}
.wrap{max-width:1120px;margin:0 auto;padding:8px 32px 48px}
.intro{margin:0 0 24px}h1{font-size:30px;margin:0 0 8px}p{font-size:17px;line-height:1.6;color:var(--muted);margin:0 0 16px;word-break:keep-all}.intro p{margin:0}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:24px;align-items:start}
.panel{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px}
.panel h2{font-size:21px;margin:0 0 6px;display:flex;align-items:center;gap:10px}.panel h2 .count{font-size:15px;font-weight:600;color:var(--muted)}
.panel>p{font-size:16px}
.method{border:1px solid var(--line);border-radius:16px;padding:20px;margin:16px 0 0}.method h3{font-size:18px;margin:0 0 6px;display:flex;align-items:center;gap:8px}
.tag{font-size:13px;font-weight:700;background:var(--accent);color:#16161A;border-radius:999px;padding:2px 10px}
.method p{font-size:15px;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px;width:min(100%,520px);margin:24px auto}
.device-code{display:block;font:700 30px monospace;letter-spacing:3px;padding:18px;text-align:center;background:var(--soft);border-radius:12px;margin:20px 0}
.viewer{position:relative;border-radius:14px;overflow:hidden;background:#000;aspect-ratio:1;max-width:360px;margin:0 auto 12px}.viewer video{width:100%;height:100%;object-fit:cover;display:block}
.viewer::after{content:"";position:absolute;inset:18%;border:3px solid var(--accent);border-radius:16px;box-shadow:0 0 0 999px rgba(0,0,0,.35)}
.divider{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:15px;margin:18px 0 6px}.divider::before,.divider::after{content:"";flex:1;border-top:1px solid var(--line)}
label{display:block;font-size:16px;margin:14px 0 8px}label span{color:var(--muted)}
input{font:inherit;font-size:19px;width:100%;border:1px solid var(--line);border-radius:10px;padding:13px;background:var(--card);color:var(--ink)}
#code{text-align:center;letter-spacing:4px;font-family:monospace;text-transform:uppercase}
.hint{font-size:14px;margin:6px 0 0;color:var(--muted)}
button,.button{display:block;text-align:center;text-decoration:none;font:inherit;font-weight:700;font-size:18px;width:100%;border:0;border-radius:10px;padding:15px;background:var(--accent);color:#16161A;margin:16px 0 0;cursor:pointer}
button.ghost,.button.ghost{background:var(--soft);color:var(--ink)}button:disabled{opacity:.6;cursor:wait}
input:focus-visible,button:focus-visible,a:focus-visible,summary:focus-visible{outline:4px solid #0AB4E8;outline-offset:3px}
.ok{color:var(--good);margin:12px 0 0;font-size:16px}.ok:empty{display:none}
.list{list-style:none;margin:12px 0 0;padding:0}.list li{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--line)}
.list li:last-child{border-bottom:0}.list .info{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.list .info strong{font-size:17px;overflow-wrap:anywhere}
.list .meta{font-size:14px;color:var(--muted)}.list .empty{color:var(--muted);font-size:15px}
.ico{flex:none;width:44px;height:44px;border-radius:12px;background:var(--soft);display:grid;place-items:center;font:700 13px monospace;color:var(--muted)}
.acts{display:flex;gap:8px;flex:none}
button.small{width:auto;font-size:15px;padding:9px 14px;margin:0;background:var(--soft);color:var(--ink);flex:none}button.small.bad{color:var(--bad)}
.pill{display:inline-block;font-size:12px;font-weight:700;border-radius:999px;padding:1px 8px;background:var(--soft);color:var(--good);margin-left:6px;vertical-align:2px}
.sub{margin:24px 0 0;padding:20px 0 0;border-top:1px solid var(--line)}.sub h3{font-size:17px;margin:0}
details{margin:8px 0 0}summary{cursor:pointer;color:var(--muted);font-size:15px;padding:6px 0}
#error{color:var(--bad);margin:12px 0 0;font-size:16px}#error:empty{display:none}
.client-card{display:flex;align-items:center;gap:16px;padding:14px;margin:0 0 12px;border-radius:14px;background:var(--soft)}
.client-card img{width:56px;height:56px;border-radius:14px;flex:none;background:var(--card);object-fit:cover}
.client-card div{display:flex;flex-direction:column;gap:2px;min-width:0}.client-card strong{font-size:18px}.client-card .hint{font-weight:600;margin:0}
dialog{border:1px solid var(--line);border-radius:18px;padding:24px;background:var(--card);color:var(--ink);width:min(92vw,420px)}dialog::backdrop{background:rgba(0,0,0,.45)}
dialog p{color:var(--ink);margin:0 0 4px}dialog .row{display:flex;gap:10px;margin:18px 0 0}dialog .row button{margin:0}
[hidden]{display:none!important}
@media(max-width:880px){.grid{grid-template-columns:1fr}.top{padding:16px}.wrap{padding:4px 16px 32px}.panel{padding:22px}.card{padding:22px;margin:12px auto}h1{font-size:26px}}
@media(max-width:560px){.top{flex-wrap:wrap;gap:10px}.who{order:3;width:100%;border-radius:12px}.list li{flex-wrap:wrap}.acts{width:100%;justify-content:flex-end}}`;

function form(t, { withCode, code }) {
  return `<form id="approve" novalidate>
${withCode ? `<label for="code">${t.codeLabel}</label><input id="code" name="code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" placeholder="A1B2C3D4" required><p class="hint">${t.codeHint}</p>` : `<strong class="device-code">${escapeHtml(code)}</strong>`}
<label for="label">${t.nameLabel} <span>${t.optional}</span></label><input id="label" name="label" maxlength="64" placeholder="${t.namePlaceholder}" autocomplete="off">
<button type="submit">${t.approve}</button></form>`;
}

function clientMethod(t) {
  return `<div class="method" id="client"><h3>${t.clientTitle} <span class="tag">${t.recommended}</span></h3>
<div class="client-card"><img id="client-icon" src="/api/client/icon" alt="" width="56" height="56" decoding="async">
<div><strong>CookingFoil</strong><span class="hint" id="client-meta"></span></div></div>
<p>${t.clientLead}</p><button type="button" id="get-client">${t.clientGet}</button><p class="hint">${t.clientHint.replace("{n}", enrollPerHour)}</p></div>`;
}

function qrMethod(t) {
  return `<div class="method"><h3>${t.qrTitle}</h3><p>${t.lead}</p>
<div id="viewer" class="viewer" hidden><video id="video" playsinline muted></video></div>
<p id="camera-note" class="hint" hidden></p>
<button type="button" id="scan">${t.scan}</button>
<div class="divider">${t.or}</div>${form(t, { withCode: true })}<p id="status" class="ok" role="status"></p></div>`;
}

function mineSection(t) {
  return `<section class="panel" aria-labelledby="mine-title"><h2 id="mine-title">${t.mineTitle} <span class="count" id="mine-count"></span></h2>
<ul id="mine" class="list"><li class="empty">${t.mineEmpty}</li></ul>
<div class="sub" id="downloads" hidden><h3>${t.downloadsTitle}</h3><ul id="dl-live" class="list"></ul>
<details id="dl-ended-box" hidden><summary id="dl-ended-sum"></summary><ul id="dl-ended" class="list"></ul></details></div></section>`;
}

const ASK = `<dialog id="ask" aria-labelledby="ask-text"><p id="ask-text"></p><input id="ask-input" maxlength="64" autocomplete="off" aria-labelledby="ask-text" hidden>
<div class="row"><button type="button" class="ghost" id="ask-no"></button><button type="button" id="ask-ok"></button></div></dialog>`;

function body(view, t, { code, pairing = true, repair = null }) {
  switch (view) {
    case "done":
      return `<div class="card"><h1>${t.doneTitle}</h1><p>${t.doneBody}</p><a class="button ghost" href="/pair">${t.another}</a></div>`;
    case "expired":
      return `<div class="card"><h1>${t.expiredTitle}</h1><p>${t.expiredBody}</p><a class="button ghost" href="/pair">${t.another}</a></div>`;
    case "signin":
      return `<div class="card"><h1>${t.title}</h1><p>${t.signIn}</p><a class="button" href="/admin">${t.openAdmin}</a></div>`;
    case "confirm":
      return `<div class="card"><h1>${t.title}</h1>${repair ? `<p>${t[repair]}</p>` : ""}<p>${t.confirmLead}</p>${form(t, { withCode: false, code })}<p id="error" role="alert"></p></div>`;
    default:
      return `<div class="intro"><h1>${t.title}</h1><p>${t.pageLead}</p></div>
<div class="grid">${pairing ? `<section class="panel" aria-labelledby="connect-title"><h2 id="connect-title">${t.connectTitle}</h2><p>${t.connectLead}</p>${clientMethod(t)}${qrMethod(t)}<p id="error" role="alert"></p></section>` : `<p id="error" role="alert"></p>`}
${mineSection(t)}</div>${ASK}`;
  }
}

// Strings the browser script needs, escaped for an inline <script>.
function clientText(t) {
  const keys = ["scan", "stop", "aim", "noCamera", "cameraDenied", "wrongQr", "doneTitle", "doneBody", "another",
    "errNotFound", "errUsed", "errAuth", "errOther", "errNetwork", "expiredBody", "mineEmpty", "kindQr",
    "revoke", "revokeConfirm", "unnamed", "rename", "renamePrompt", "save", "lastSeen", "neverSeen", "canSend", "deviceCount", "endedDownloads", "codeIs",
    "kindClient", "clientWaiting", "clientUsed", "clientExpired", "clientRevoked", "errNoBuild", "clientCancelConfirm", "cancel", "keep", "clientGet", "clientPreparing", "clientStarted"];
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
    if(r.ok){stopCamera();if(token){showDone();return;}approveForm.reset();status.textContent=T.doneTitle+' '+T.doneBody;loadMine();return;}
    const j=await r.json().catch(()=>({}));error.textContent=j.code==='device-limit'&&j.error?j.error:MESSAGES[r.status]||T.errOther;}
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

// ── asking in the page (closes only by its buttons) ──
const askBox=document.getElementById('ask');
function ask(text,{value=null,ok=T.revoke,no=T.keep}={}){if(!askBox)return Promise.resolve(null);
  const input=document.getElementById('ask-input'),yes=document.getElementById('ask-ok'),nope=document.getElementById('ask-no');
  document.getElementById('ask-text').textContent=text;yes.textContent=ok;nope.textContent=no;
  input.hidden=value===null;input.value=value??'';
  return new Promise((resolve)=>{const done=(v)=>{yes.onclick=nope.onclick=askBox.oncancel=input.onkeydown=null;askBox.close();resolve(v);};
    yes.onclick=()=>done(value===null?true:input.value);nope.onclick=()=>done(null);askBox.oncancel=(e)=>{e.preventDefault();};
    input.onkeydown=(e)=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();done(input.value);}};
    askBox.showModal();(value===null?nope:input).focus();});}

// ── my devices ──
const mine=document.getElementById('mine');
const post=(url,body)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body||{})});
const when=(ms)=>ms?new Date(ms).toLocaleString(document.documentElement.lang,{dateStyle:'medium',timeStyle:'short'}):null;
const CLIENT_STATE={used:T.clientUsed,expired:T.clientExpired,revoked:T.clientRevoked};
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const small=(text,fn,bad)=>{const b=make('button','small'+(bad?' bad':''),text);b.type='button';b.addEventListener('click',()=>fn(b));return b;};
async function act(b,url,body){b.disabled=true;const r=await post(url,body).catch(()=>null);if(r&&r.ok){loadMine();return true;}b.disabled=false;error.textContent=T.errOther;return false;}
function clientRow(item){const li=make('li');const info=make('div','info');
  info.append(make('strong',null,T.kindClient+' · '+when(item.createdAt)),
    make('span','meta',item.state==='waiting'?T.clientWaiting.replace('{time}',when(item.expiresAt)):[CLIENT_STATE[item.state],item.code,item.state==='used'?when(item.usedAt):null].filter(Boolean).join(' · ')));
  li.append(info);
  if(item.state==='waiting')li.append(small(T.cancel,async(b)=>{if(await ask(T.clientCancelConfirm,{ok:T.cancel}))act(b,'/pair/api/clients/'+item.id+'/revoke');},true));
  return li;}
function deviceRow(item){const li=make('li');li.append(make('span','ico',(item.code||'').slice(0,4)));
  const info=make('div','info');const name=make('strong',null,item.label||T.unnamed);if(item.sends)name.append(make('span','pill',T.canSend));
  info.append(name,make('span','meta',[T.codeIs.replace('{code}',item.code||'—'),item.lastSeenAt?T.lastSeen.replace('{time}',when(item.lastSeenAt)):T.neverSeen].join(' · ')));
  const acts=make('div','acts');
  acts.append(small(T.rename,async(b)=>{const label=await ask(T.renamePrompt,{value:item.label||'',ok:T.save,no:T.cancel});if(label&&label.trim())act(b,'/pair/api/devices/label',{deviceKey:item.deviceKey,label});}),
    small(T.revoke,async(b)=>{if(await ask(T.revokeConfirm))act(b,'/pair/api/devices/revoke',{deviceKey:item.deviceKey});},true));
  li.append(info,acts);return li;}
async function loadMine(){if(!mine)return;try{const r=await fetch('/pair/api/mine',{credentials:'same-origin'});if(!r.ok)return;const d=await r.json();
  const devices=d.devices||[];
  mine.replaceChildren(...(devices.length?devices.map(deviceRow):[make('li','empty',T.mineEmpty)]));
  document.getElementById('mine-count').textContent=devices.length?T.deviceCount.replace('{n}',devices.length):'';
  const clients=d.clients||[],live=clients.filter((c)=>c.state==='waiting'),ended=clients.filter((c)=>c.state!=='waiting');
  document.getElementById('downloads').hidden=!clients.length;
  document.getElementById('dl-live').replaceChildren(...live.map(clientRow));
  document.getElementById('dl-ended-box').hidden=!ended.length;
  document.getElementById('dl-ended-sum').textContent=T.endedDownloads.replace('{n}',ended.length);
  document.getElementById('dl-ended').replaceChildren(...ended.map(clientRow));}catch{}}
// The client with this server and a one-hour connection key inside, as one zip.
const getClient=document.getElementById('get-client');
if(getClient)getClient.addEventListener('click',async()=>{getClient.disabled=true;getClient.setAttribute('aria-busy','true');getClient.textContent=T.clientPreparing;error.textContent='';let started=false;
  try{const r=await post('/pair/api/client-bundle');
    if(!r.ok){error.textContent=r.status===404?T.errNoBuild:T.errOther;return;}
    const name=((r.headers.get('Content-Disposition')||'').match(/filename="([^"]+)"/)||[])[1]||'CookingFoil.zip';
    const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);started=true;getClient.textContent=T.clientStarted;loadMine();}
  catch{error.textContent=T.errNetwork;}finally{getClient.removeAttribute('aria-busy');getClient.disabled=false;
    if(started)setTimeout(()=>{getClient.textContent=T.clientGet;},3000);else getClient.textContent=T.clientGet;}});
if(location.hash==='#client'&&getClient)getClient.scrollIntoView({block:'center'});
// The build on offer: its version and size beside the icon; no build, no card.
if(getClient)fetch('/api/client/latest',{credentials:'same-origin'}).then((r)=>r.ok?r.json():null).then((b)=>{
  if(!b){document.getElementById('client').hidden=true;return;}
  document.getElementById('client-meta').textContent='v'+b.version+' · '+(b.size/1048576).toFixed(1)+' MB';}).catch(()=>{});
const clientIcon=document.getElementById('client-icon');if(clientIcon)clientIcon.addEventListener('error',()=>{clientIcon.style.visibility='hidden';});
loadMine();
`;

/** `repair`: "repairSame" or "repairOther" when the console is already registered and asks to be paired again. */
export function devicePairPage({ view = "scan", lang = "en", code = "", approver = null, pairing = true, repair = null } = {}) {
  const shown = tableLang(PAIR_TEXT, lang);
  const t = PAIR_TEXT[shown];
  const interactive = view === "scan" || view === "confirm";
  const who = !approver ? "" : approver === "admin" ? `<p class="who">${t.asAdmin}</p>` : `<p class="who">${t.asUser.replace("{user}", `<strong>${escapeHtml(approver)}</strong>`)}</p>`;
  return `<!doctype html><html lang="${shown}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${t.title} · CookingFoil</title><link rel="icon" href="/assets/cookingfoil.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/fonts.css"><style>${STYLE}</style></head>
<body><header class="top"><a class="brand" href="/"><img src="/assets/cookingfoil.svg" alt="" width="36" height="36"><span class="wm">cookingfoil<span class="dot">.</span></span></a>${who}<a class="back" href="/">${t.back}</a></header>
<main class="wrap"><div class="content">${body(view, t, { code, pairing, repair })}</div></main>
${interactive ? `<script type="application/json" id="pair-text">${clientText(t)}</script><script>${SCRIPT}</script>` : ""}</body></html>`;
}
