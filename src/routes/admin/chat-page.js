/**
 * The chat, drawn like a chat app: a thin top row (the assistant's name, conversation, context
 * meter, new, settings), the conversation filling the rest of the height, and the message box
 * docked at the bottom. Two builds of the same markup and script:
 *   admin  the admin page and its floating widget. Talks to /admin/api/chat (chat-api.js),
 *          /admin/api/integrations/chat (the model) and /admin/api/server-settings (chatEnabled and
 *          the persona); the switch, the model and persona forms and deleting a conversation live in
 *          the sheet the gear opens, and waiting calls carry approve and refuse.
 *   web    the floating chat on the web page (landing.html), for any signed-in person. Talks to
 *          /api/chat with the page's CSRF token; no settings sheet, and a request shows that it
 *          waits for an admin.
 * Everything from the model or a tool goes in as text.
 *
 * Files (the paperclip, a drop on the chat, or a paste) go into the share inbox first: /api/inbox
 * for a person, /admin/api/chat/attach for the admin. The message then carries one line per file
 * (name, size, where it is in the inbox); the model never gets the file.
 */
import { icon } from "../../views/icons.js";
import { top, topLabel, topPh } from "./top-i18n.js";
import { CHAT_WORDS } from "./chat-words.js";
import { MESSAGE_MAX } from "../../chat/service.js";

// How each build names its words: the admin page's data-top swap, or the web page's data-i18n.
const ADMIN_WORDS = { text: top, label: topLabel, ph: topPh };
const WEB_WORDS = {
  text: (k) => `<span data-i18n="${k}">${CHAT_WORDS.ko[k]}</span>`,
  label: (k) => `data-i18n-label="${k}" aria-label="${CHAT_WORDS.ko[k]}"`,
  ph: (k) => `data-i18n-ph="${k}" placeholder="${CHAT_WORDS.ko[k]}"`,
};

const SHEET_HTML = /* html */ `
  <dialog id="ch-sheet" class="ch-sheet" aria-labelledby="ch-sheet-h">
    <div class="ch-sheet-hd"><h3 id="ch-sheet-h">${top("ch.settings")}</h3>
      <button type="button" class="icon-btn" id="ch-sheet-x" ${topLabel("ch.close")}>${icon("x")}</button></div>
    <p class="muted">${top("ch.lead")}</p>
    <label class="ch-sw"><input type="checkbox" id="ch-on"><span>${top("ch.enabled")}</span></label>
    <form id="ch-form" class="ch-form">
      <h4>${top("ch.setupH")}</h4>
      <p class="muted">${top("ch.setupLead")}</p>
      <label>${top("ch.baseUrl")}<input id="ch-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://api.z.ai/api/coding/paas/v4"></label>
      <label>${top("ch.model")}<input id="ch-model" type="text" autocomplete="off" spellcheck="false" placeholder="glm-4.6"></label>
      <label>${top("ch.apiKey")}<input id="ch-key" type="password" autocomplete="new-password"></label>
      <p class="muted ch-hint">${top("ch.keyMoves")}</p>
      <div class="actions"><button type="submit" class="primary">${top("fp.save")}</button></div>
    </form>
    <form id="ch-persona-form" class="ch-form">
      <h4>${top("ch.personaH")}</h4>
      <p class="muted">${top("ch.personaLead")}</p>
      <label>${top("ch.name")}<input id="ch-name-in" type="text" maxlength="24" autocomplete="off"></label>
      <label>${top("ch.persona")}<textarea id="ch-persona-in" rows="5" maxlength="600"></textarea></label>
      <label>${top("ch.window")}<input id="ch-window-in" type="number" min="4096" max="2000000" step="1024"></label>
      <div class="actions"><button type="submit" class="primary">${top("fp.save")}</button></div>
    </form>
    <div class="ch-danger"><button type="button" class="danger" id="ch-del">${top("ch.delete")}</button></div>
  </dialog>`;

/** The chat's markup for one build: the page puts it in a section, the floating widget in a panel. */
export function chatInnerHtml({ web = false } = {}) {
  const w = web ? WEB_WORDS : ADMIN_WORDS;
  return /* html */ `  <div class="ch-top ch-col">
    <span class="ch-ai" id="ch-name" role="img">${icon("sparkle")}</span>
    <select id="ch-pick" ${w.label("ch.conv")}></select>
    <button type="button" class="ch-ctx" id="ch-ctx" hidden><span id="ch-ctx-pct"></span></button>
    <button type="button" class="icon-btn" id="ch-new" ${w.label("ch.new")}>${icon("plus")}</button>
    ${web ? "" : `<button type="button" class="icon-btn" id="ch-gear" ${w.label("ch.settings")}>${icon("sliders")}</button>`}
    <button type="button" class="icon-btn" id="ch-close" hidden ${w.label("ch.close")}>${icon("x")}</button>
  </div>
  <div class="ch-log" id="ch-log" aria-live="polite"><div class="ch-col" id="ch-col"></div></div>
  <div class="ch-dock" id="ch-dock">
    <div class="ch-col">
      <div class="ch-pending" id="ch-pending" hidden>
        <b>${w.text("ch.pendingH")}</b>
        <p class="muted">${w.text("ch.lost")}</p>
        <div id="ch-pending-list"></div>
      </div>
      <div class="ch-files" id="ch-files" hidden></div>
      <div class="ch-up" id="ch-up" hidden><span class="ch-up-bar"><i id="ch-up-fill"></i></span><span id="ch-up-txt"></span></div>
      <form class="ch-card" id="ch-send">
        <button type="button" class="icon-btn ch-clip" id="ch-clip" ${w.label("ch.attach")}>${icon("paperclip")}</button>
        <input type="file" id="ch-file" multiple hidden>
        <textarea id="ch-text" rows="1" maxlength="${MESSAGE_MAX}" ${w.ph("ch.placeholder")}></textarea>
        <span class="ch-count" id="ch-count" hidden></span>
        <button type="submit" class="primary ch-go" id="ch-go" ${w.label("ch.send")}>${icon("send")}</button>
      </form>
    </div>
  </div>${web ? "" : SHEET_HTML}`;
}

export const CHAT_INNER_HTML = chatInnerHtml();

export const CHAT_HTML = /* html */ `<section id="tab-chat" hidden>
${CHAT_INNER_HTML}
</section>`;

export const CHAT_CSS = /* css */ `
/* The page is one screen: the section takes the height left under the header and the log scrolls inside it. */
.wrap:has(#tab-chat){padding-bottom:12px}
#tab-chat{display:flex;flex-direction:column;min-height:320px;height:calc(100dvh - 140px)}
#tab-chat[hidden]{display:none}
/* A control with a display of its own would otherwise ignore the hidden attribute. */
#tab-chat [hidden],.ch-widget [hidden]{display:none!important}
.ch-top{display:flex;gap:8px;align-items:center;flex:none;padding-bottom:10px}
.ch-top select{flex:1;min-width:0}
.ch-log{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.ch-col{width:100%;max-width:760px;margin:0 auto;box-sizing:border-box}
/* The toast clears the message box here instead of covering it. */
body:has(#tab-chat) .toast{bottom:calc(var(--ch-dock,0px) + 28px)}
#ch-col{display:grid;gap:14px;align-content:start;padding:8px 0 16px}
#ch-col.ch-empty{min-height:100%;align-content:center;justify-items:center;text-align:center}
.ch-hello{display:grid;gap:16px;justify-items:center}
.ch-hello h3{display:grid;gap:8px;margin:0;max-width:30em;line-height:1.5;text-wrap:balance;word-break:keep-all}
.ch-hi{font-size:var(--fs-xl,var(--fs-lg))}
.ch-sub{font-size:var(--fs-md);font-weight:400;color:var(--muted)}
.ch-ai{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,rgba(var(--accent-rgb),.28),rgba(var(--accent-rgb),.08));color:var(--accent)}
.ch-ai .ico{width:16px;height:16px}
/* The conversation picker reads as a pill, not the browser's plain box. */
.ch-top select{appearance:none;-webkit-appearance:none;height:40px;padding:0 36px 0 16px;border:1px solid var(--line);border-radius:var(--r-pill);background:var(--sunk) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 12px center;color:var(--text);font:inherit;font-weight:var(--fw-bold);text-overflow:ellipsis;cursor:pointer}
.ch-top select:hover{background-color:var(--panel)}
.ch-top select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* The context meter: how full the model's context is for this conversation; a click compacts it. */
.ch-ctx{--p:0;position:relative;flex:none;display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:conic-gradient(var(--accent) calc(var(--p) * 1%),var(--sunk) 0);cursor:pointer;color:var(--text);font:inherit;font-size:var(--fs-2xs);font-weight:var(--fw-bold);line-height:1}
.ch-ctx::before{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--bg)}
.ch-ctx span{position:relative}
.ch-ctx.full{background:conic-gradient(var(--bad) calc(var(--p) * 1%),var(--sunk) 0)}
.ch-ctx.full span{color:var(--bad)}
.ch-count{flex:none;align-self:center;color:var(--muted);font-size:var(--fs-sm)}
.ch-count.over{color:var(--bad)}
.ch-mark{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:var(--fs-sm)}
.ch-mark::before,.ch-mark::after{content:"";flex:1;border-top:1px dashed var(--line)}
.ch-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.ch-chip{border:0;border-radius:var(--r-pill);background:var(--sunk);color:var(--text);font:inherit;font-size:var(--fs-sm);padding:9px 14px;cursor:pointer}
.ch-chip:hover{background:var(--panel)}
.ch-body{overflow-wrap:anywhere;line-height:1.6}
.ch-body.plain{white-space:pre-wrap}
.ch-body p{margin:0 0 8px}
.ch-body ul,.ch-body ol{margin:0 0 8px;padding-left:22px}
.ch-body pre{margin:0 0 8px;padding:8px 10px;background:var(--sunk);border-radius:var(--r-lg);overflow:auto;white-space:pre}
.ch-body code{font-family:ui-monospace,monospace;font-size:.92em}
.ch-msg.me{justify-self:end;max-width:85%;background:rgba(var(--accent-rgb),.12);border-radius:var(--r-2xl);padding:8px 14px}
.ch-msg.me .ch-body p:last-child{margin-bottom:0}
.ch-note{color:var(--muted);font-size:var(--fs-sm)}
.ch-cards{display:grid;gap:8px}
.ch-gcard{display:grid;grid-template-columns:56px minmax(0,1fr);gap:4px 12px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:10px}
.ch-gcard img,.ch-gcard .ch-noimg{width:56px;height:56px;border-radius:var(--r-md);object-fit:cover;background:var(--sunk)}
.ch-gcard .ch-gname{font-weight:var(--fw-bold);overflow-wrap:anywhere}
.ch-gcard .ch-gmeta{color:var(--muted);font-size:var(--fs-sm)}
@media (min-width:641px){.ch-gcard{grid-template-columns:56px minmax(0,1fr) auto}.ch-gcard .ch-gact:not(.ch-pickrow){grid-column:auto;margin-top:0}}
.ch-gtags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.ch-tag{border-radius:var(--r-pill);background:rgba(var(--accent-rgb),.14);padding:1px 8px;font-size:var(--fs-sm)}
.ch-gact{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px}
.ch-gact .ch-x{width:28px;height:28px;padding:0;display:grid;place-items:center;border:0;background:transparent;cursor:pointer;color:var(--muted)}
.ch-gact .ch-x .ico{width:14px;height:14px}
.ch-err{color:var(--bad)}
.ch-dock{flex:none;padding-top:8px}
.ch-pending{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:10px 14px;margin-bottom:8px;max-height:34vh;overflow:auto}
.ch-pending p{margin:2px 0 6px}
.ch-card-ask{background:var(--sunk);border-radius:var(--r-xl);padding:10px 12px;margin:8px 0;display:grid;gap:8px}
.ch-card-ask pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-sm)}
.ch-card{display:flex;align-items:flex-end;gap:8px;background:var(--sunk);border:1px solid var(--line);border-radius:var(--r-2xl);padding:8px}
.ch-clip{flex:none;width:36px;height:36px;padding:0;display:grid;place-items:center;line-height:0;border:0;border-radius:50%;background:transparent;color:var(--muted)}
.ch-clip:hover{background:var(--panel);color:var(--text)}
.ch-clip .ico,.ch-go .ico{display:block;width:18px;height:18px}
.ch-files{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.ch-file{display:inline-flex;align-items:center;gap:6px;max-width:100%;background:var(--sunk);border-radius:var(--r-pill);padding:4px 6px 4px 12px;font-size:var(--fs-sm)}
.ch-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ch-file button{flex:none;width:24px;height:24px;padding:0;border:0;background:transparent;display:grid;place-items:center;cursor:pointer;color:var(--muted)}
.ch-file button .ico{width:14px;height:14px}
.ch-up{display:flex;align-items:center;gap:10px;margin-bottom:6px;color:var(--muted);font-size:var(--fs-sm)}
.ch-up-bar{flex:1;height:6px;border-radius:var(--r-pill);background:var(--sunk);overflow:hidden}
.ch-up-bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.ch-drop{outline:2px dashed var(--accent);outline-offset:-6px}
.ch-card:focus-within{box-shadow:0 0 0 3px rgba(var(--accent-rgb),.45)}
.ch-card textarea{flex:1;min-width:0;box-sizing:border-box;border:0;outline:0;resize:none;background:transparent;color:var(--text);font:inherit;font-size:var(--fs-md);line-height:22px;padding:7px 0;max-height:none;overflow-y:hidden}
.ch-go{flex:none;display:grid;place-items:center;line-height:0;width:36px;height:36px;padding:0;border-radius:50%;border:0}
/* The paper plane's weight sits up and to the right; a pixel back puts it in the middle of the circle. */
.ch-go .ico{transform:translate(-1px,1px)}
.ch-go:disabled{opacity:.45;cursor:default}
.ch-sheet{max-height:min(88dvh,760px);overflow:auto}
.ch-sheet-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;position:sticky;top:calc(-1 * var(--dlg-pad,24px));z-index:1;background:var(--panel);margin:calc(-1 * var(--dlg-pad,24px)) calc(-1 * var(--dlg-pad,24px)) 6px;padding:var(--dlg-pad,24px) var(--dlg-pad,24px) 8px}
.ch-sheet-hd h3{margin:0}
.ch-sw{display:flex;align-items:center;gap:10px;font-weight:var(--fw-bold);margin:10px 0}
.ch-form{display:grid;gap:10px;margin-top:6px}
.ch-form h4{margin:8px 0 0}
.ch-form label{display:grid;gap:4px;font-weight:var(--fw-bold)}
.ch-form p{margin:0}
.ch-form .ch-hint{margin-top:-4px;font-size:var(--fs-sm)}
/* The assistant is writing: three dots in its own row until the first words or the end of the turn. */
.ch-typing{display:flex;gap:5px;align-items:center;height:22px}
.ch-typing i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:ch-dot 1.2s infinite ease-in-out}
.ch-typing i:nth-child(2){animation-delay:.15s}
.ch-typing i:nth-child(3){animation-delay:.3s}
.ch-wait{margin-left:6px;color:var(--muted);font-size:var(--fs-sm)}
@keyframes ch-dot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}
@media (prefers-reduced-motion:reduce){.ch-typing i{animation:none;opacity:.6}}
.ch-danger{margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
@media (max-width:640px){
.ch-sheet{width:100%;max-width:100%;margin:auto 0 0;box-sizing:border-box;border-radius:var(--r-2xl) var(--r-2xl) 0 0}
.ch-msg.me{max-width:92%}
}
`;

// The web page has no admin helpers; these stand in for el, api, topText, topFill and the language.
const WEB_SHIMS = /* js */ `
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const topText=(k)=>t(k);
const topFill=(k,v)=>String(t(k)).replace(/\\{(\\w+)\\}/g,(m,x)=>v[x]!=null?String(v[x]):m);
const chLang=()=>lang;
const chWriteHeaders=()=>({'X-CSRF-Token':(session&&session.csrf)||''});
async function api(url,o={}){const method=o.method||'GET';
  const r=await fetch(url,{method,headers:{Accept:'application/json',...(o.body?{'Content-Type':'application/json'}:{}),...(method==='GET'?{}:chWriteHeaders())},body:o.body?JSON.stringify(o.body):undefined});
  const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||('HTTP '+r.status));e.status=r.status;throw e;}return d;}
`;

/** The chat's script for one build (see the top of this file). */
export function chatScript({ web = false } = {}) {
  const body = /* js */ `
const CH_ADMIN=${web ? "false" : "true"},CH_API='${web ? "/api/chat" : "/admin/api/chat"}',CH_MAX=${MESSAGE_MAX};
${web ? "" : "const chLang=()=>typeof adminLang==='string'?adminLang:'ko';const chWriteHeaders=()=>({});"}
const CH_ATTACH='${web ? "/api/inbox" : "/admin/api/chat/attach"}';
const CH_ICON={send:${JSON.stringify(icon("send"))},stop:${JSON.stringify(icon("stop"))},x:${JSON.stringify(icon("x"))}};
let chConv=null,chAbort=null,chBusy=false,chState={enabled:false,ready:false,name:''};
let chFiles=[],chUp=false; // files already in the inbox, waiting to go with the next message; an upload running
const chCol=()=>$('ch-col');
function chScroll(){const l=$('ch-log');l.scrollTop=l.scrollHeight;}
// The section takes the height left under the header, also when a phone keyboard shrinks the screen.
function chFit(){const s=$('tab-chat');if(!s||s.hidden)return;const vh=(window.visualViewport&&window.visualViewport.height)||window.innerHeight;
  s.style.height=Math.max(320,vh-s.getBoundingClientRect().top-12)+'px';
  const d=$('ch-dock');document.documentElement.style.setProperty('--ch-dock',(d.hidden?0:d.offsetHeight)+'px');}
function chCount(){const n=$('ch-text').value.length,c=$('ch-count');c.hidden=n<CH_MAX*0.8;c.textContent=n+'/'+CH_MAX;c.classList.toggle('over',n>CH_MAX);
  if(n>CH_MAX)c.title=topFill('ch.tooLong',{max:CH_MAX});}
function chGrow(){const t=$('ch-text');t.style.height='auto';const cs=getComputedStyle(t),line=parseFloat(cs.lineHeight)||22,pad=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
  const max=line*8+pad;t.style.height=Math.min(t.scrollHeight,max)+'px';t.style.overflowY=t.scrollHeight>max?'auto':'hidden';chCount();chSendState();chFit();}
function chSendState(){const b=$('ch-go'),v=$('ch-text').value;b.disabled=!chBusy&&(chUp||(!v.trim()&&!chFiles.length)||v.length>CH_MAX);}
function chSize(n){const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return (i?n.toFixed(1):String(n))+' '+u[i];}
function chChips(){const box=$('ch-files');box.replaceChildren();
  chFiles.forEach((f,i)=>{const c=el('span',null,'ch-file');c.append(el('span',f.name+' · '+chSize(f.size)));
    const x=el('button');x.type='button';x.innerHTML=CH_ICON.x;x.setAttribute('aria-label',topText('ch.unattach'));
    x.addEventListener('click',()=>{chFiles.splice(i,1);chChips();});c.append(x);box.append(c);});
  box.hidden=!chFiles.length;chSendState();chFit();}
function chUpShow(pct){const u=$('ch-up');u.hidden=pct===null;if(pct===null){chFit();return;}
  $('ch-up-fill').style.width=pct+'%';$('ch-up-txt').textContent=topFill('ch.uploading',{pct});chFit();}
// What the message says about each file: the inbox entry and its name there, never the file itself.
function chFileLines(){return chFiles.map((f)=>topText('ch.attachTag')+' '+f.name+' ('+chSize(f.size)+') inbox/'+f.id+'/'+f.name).join('\\n');}
const chStamp=()=>new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\\..*$/,'');
// A pasted screenshot comes as image.png or with no name; it is named for when it was pasted.
function chPasteName(f,i){if(f.name&&!/^image\\.\\w+$/i.test(f.name))return f;
  const ext=(f.type.split('/')[1]||'bin').replace(/[^a-z0-9]/gi,'');return new File([f],'paste-'+chStamp()+(i?'-'+i:'')+'.'+ext,{type:f.type});}
function chUpload(list){const files=[...list].filter(Boolean);if(!files.length||chUp)return;
  const fd=new FormData();for(const f of files)fd.append('files',f,f.name);
  chUp=true;chSendState();chUpShow(0);
  const x=new XMLHttpRequest();x.open('POST',CH_ATTACH);
  for(const [k,v] of Object.entries({Accept:'application/json','Accept-Language':chLang(),...chWriteHeaders()}))x.setRequestHeader(k,v);
  x.upload.onprogress=(e)=>{if(e.lengthComputable)chUpShow(Math.round(e.loaded/e.total*100));};
  const end=(err)=>{chUp=false;chUpShow(null);if(err)chNote(topFill('ch.attachFail',{msg:err}),'ch-err');chSendState();};
  x.onload=()=>{let d={};try{d=JSON.parse(x.responseText||'{}');}catch{}
    if(x.status===401&&!CH_ADMIN){location.reload();return;}
    if(x.status!==201)return end(d.error||('HTTP '+x.status));
    for(const it of d.items||[])chFiles.push({id:d.id,name:it.name,size:it.size});chChips();end(null);};
  x.onerror=()=>end('network');
  x.send(fd);}
function chIcon(){const b=$('ch-go');b.innerHTML=chBusy?CH_ICON.stop:CH_ICON.send;b.setAttribute('aria-label',topText(chBusy?'ch.stop':'ch.send'));}
function chName(){return chState.name||topText('ch.defaultName');}
function chShowName(){const n=$('ch-name');n.title=topText('m.chat');n.setAttribute('aria-label',topText('m.chat'));}
// How full the model's context is: a thin bar that turns red near the point where the chat compacts by itself.
function chCtx(c){const b=$('ch-ctx');const used=c&&Number(c.used)||0,win=c&&Number(c.window)||0;
  if(!used||!win||!chConv){b.hidden=true;return;}
  const pct=Math.min(100,Math.round(used/win*100));b.style.setProperty('--p',pct);$('ch-ctx-pct').textContent=pct+'%';b.classList.toggle('full',pct>=80);
  const label=topFill('ch.ctx',{pct});b.setAttribute('aria-label',label);b.title=label;b.hidden=false;}
// One of the greetings, drawn each time an empty chat opens, so the opening line is not always the same.
const CH_GREETS=['ch.greet','ch.greet2','ch.greet3','ch.greet4','ch.greet5','ch.greet6'];
let chLastGreet=-1;
function chGreetKey(){let i;do{i=Math.floor(Math.random()*CH_GREETS.length);}while(i===chLastGreet);chLastGreet=i;return CH_GREETS[i];}
function chEmpty(){const c=chCol();c.classList.add('ch-empty');c.replaceChildren();const h=el('div',null,'ch-hello');chCtx(null);
  if(!chState.enabled||!chState.ready){h.append(el('p',topText('ch.isOff'),'muted'));
    if(CH_ADMIN){const b=el('button',topText('ch.settings'),'primary');b.type='button';b.addEventListener('click',chOpenSheet);h.append(b);}}
  else{const g=topText(chGreetKey()),cut=g.search(/[.。!！]/),hi=el('h3'),fill=(t)=>t.split('{name}').join(chName());
    hi.append(el('span',fill(cut<0?g:g.slice(0,cut+1)),'ch-hi'));if(cut>=0&&g.slice(cut+1).trim())hi.append(' ',el('span',fill(g.slice(cut+1).trim()),'ch-sub'));h.append(hi);const chips=el('div',null,'ch-chips');
    const marks=CH_ADMIN?['🔎','📊','✅','⚙️']:['🎮','💝','🕹️','🛠️'];
    for(const [i,k] of(CH_ADMIN?['ch.ex1','ch.ex2','ch.ex3','ch.ex4']:['ch.uex1','ch.uex2','ch.uex3','ch.uex4']).entries()){const b=el('button',marks[i]+' '+topText(k),'ch-chip');b.type='button';b.setAttribute('data-noicon','');
      b.addEventListener('click',()=>{const t=$('ch-text');t.value=topText(k);chGrow();t.focus();});chips.append(b);}
    h.append(chips);}
  c.append(h);}
function chLeaveEmpty(){const c=chCol();if(c.classList.contains('ch-empty')){c.classList.remove('ch-empty');c.replaceChildren();}}
const CH_BT=String.fromCharCode(96),CH_FENCE=CH_BT+CH_BT+CH_BT;
// Bold and inline code only; everything else stays text. Nodes are built, never parsed from HTML.
function chInline(parent,s){let i=0;
  while(i<s.length){const b=s.indexOf('**',i),c=s.indexOf(CH_BT,i);let n=-1,k=null;
    if(b>=0&&(c<0||b<c)){n=b;k='b';}else if(c>=0){n=c;k='c';}
    if(n<0){parent.append(s.slice(i));return;}
    const mark=k==='b'?'**':CH_BT,end=s.indexOf(mark,n+mark.length);
    if(end<0){parent.append(s.slice(i));return;}
    if(n>i)parent.append(s.slice(i,n));
    parent.append(el(k==='b'?'strong':'code',s.slice(n+mark.length,end)));i=end+mark.length;}}
// Paragraphs, bullet and numbered lists, fenced code. A fence still open (the answer is streaming) shows as code.
function chRender(box,text){box.replaceChildren();let list=null,code=null;
  for(const line of text.split('\\n')){
    if(line.trim().startsWith(CH_FENCE)){if(code){box.append(code);code=null;}else{code=el('pre');list=null;}continue;}
    if(code){code.textContent+=(code.dataset.n?'\\n':'')+line;code.dataset.n='1';continue;}
    const m=/^\\s*([-*]|\\d+\\.)\\s+(.*)$/.exec(line);
    if(m){const tag=/\\d/.test(m[1])?'ol':'ul';if(!list||list.tagName.toLowerCase()!==tag){list=el(tag);box.append(list);}
      const li=el('li');chInline(li,m[2]);list.append(li);continue;}
    list=null;if(!line.trim())continue;
    const p=el('p');chInline(p,line);box.append(p);}
  if(code)box.append(code);}
function chMsg(who,text){chLeaveEmpty();
  const d=el('div',null,'ch-msg'+(who==='me'?' me':''));
  const body=el('div',null,'ch-body'+(who==='me'?' plain':''));if(who==='me')body.textContent=text;else chRender(body,text);d.append(body);chCol().append(d);chScroll();return body;}
function chNote(text,cls){chLeaveEmpty();chCol().append(el('div',text,'ch-note'+(cls?' '+cls:'')));chScroll();}
let chDots=null;
// Kept as the last row while the model has not written yet, so a tool note goes above it. Beside the dots a short
// phrase says what is going on, changing every few seconds so a long wait reads as progress; what is running picks the set.
const CH_WAIT={think:'ch.wThink',look:'ch.wLook',pick:'ch.wPick',send:'ch.wSend'};
const CH_WAIT_OF={games_search:'look',game_get:'look',retro_games_search:'look',retro_game_get:'look',games_show:'look',games_recommend:'pick',my_send:'send'};
let chWaitKind='think',chWaitLast='',chWaitTimer=null,chWaitText=null;
function chWaitPhrase(){const list=topText(CH_WAIT[chWaitKind]).split('|');let p;
  do{p=list[Math.floor(Math.random()*list.length)];}while(list.length>1&&p===chWaitLast);chWaitLast=p;return p;}
function chWaitShow(){if(chWaitText)chWaitText.textContent=chWaitPhrase();}
function chTypingOff(){if(chWaitTimer){clearInterval(chWaitTimer);chWaitTimer=null;}if(chDots){chDots.remove();chDots=null;chWaitText=null;}}
function chTypingOn(kind){chLeaveEmpty();
  if(kind&&kind!==chWaitKind){chWaitKind=kind;chWaitLast='';}
  if(!chDots){chDots=el('div',null,'ch-typing');chDots.setAttribute('role','status');chDots.setAttribute('aria-label',topText('ch.typing'));
    chDots.append(el('i'),el('i'),el('i'));chWaitText=el('span',null,'ch-wait');chWaitText.setAttribute('aria-hidden','true');chDots.append(chWaitText);
    chWaitShow();chWaitTimer=setInterval(chWaitShow,2800);}
  else if(kind)chWaitShow();
  chCol().append(chDots);chScroll();}
function chMark(){chLeaveEmpty();chCol().append(el('div',topText('ch.compacted'),'ch-mark'));chScroll();}
// What a person is told about a request, phrased for what approving it does.
const CH_REQ={change:'ch.req_change',register:'ch.req_register'};
function chReqText(kind){return topText(CH_REQ[kind]||'ch.requested');}
function chPreview(p){try{return JSON.stringify(p,null,2);}catch{return String(p);}}
function chCard(a){const box=$('ch-pending-list');if(box.querySelector('[data-id="'+CSS.escape(a.id)+'"]'))return;
  const c=el('div',null,'ch-card-ask');c.dataset.id=a.id;
  c.append(el('b',a.action||a.capId||a.tool||''));
  if(a.by)c.append(el('span',topFill('ch.by',{name:a.by}),'muted'));
  c.append(el('pre',chPreview(a.preview)));
  if(CH_ADMIN){const row=el('div',null,'actions');
    const ok=el('button',topText('ch.approve'),'primary'),no=el('button',topText('ch.refuse'));ok.type=no.type='button';
    ok.addEventListener('click',()=>chDecide(a.id,true,c));no.addEventListener('click',()=>chDecide(a.id,false,c));
    row.append(ok,no);c.append(row);}
  else c.append(el('span',chReqText(a.kind),'muted'));
  box.append(c);$('ch-pending').hidden=false;chFit();}
function chPendingGone(c){c.remove();if(!$('ch-pending-list').children.length)$('ch-pending').hidden=true;chFit();}
async function chDecide(id,approve,card){
  try{const r=await api(CH_API+'/decision',{method:'POST',body:{id,approve,conversation:chConv||undefined}});
    chPendingGone(card);
    if(r.status==='done')chNote(topText('ch.approved'));else if(r.status==='refused')chNote(topText('ch.refused'));
    else if(r.status==='denied')chNote(topText('ch.gone'));else chNote((r.error&&r.error.message)||topText('ch.gone'),'ch-err');
  }catch(err){toast(err.message);}}
async function chPickList(select,keepPending){
  const d=await api(CH_API);
  chState.name=d.name||'';chShowName();
  const pick=$('ch-pick');pick.replaceChildren(el('option','✨ '+topText('ch.new')));pick.firstChild.value='';
  for(const c of d.conversations){const o=el('option','💬 '+(c.title||topText('ch.untitled')));o.value=c.id;pick.append(o);}
  pick.value=select&&d.conversations.some((c)=>c.id===select)?select:'';
  if(!keepPending){$('ch-pending-list').replaceChildren();$('ch-pending').hidden=true;
    for(const p of d.pending)chCard({...p,action:p.capId});}
  return d;}
const CH_NOTES={approved:'ch.adminApproved',refused:'ch.adminRefused',failed:'ch.adminFailed'};
async function chOpen(id){
  chConv=id||null;chEmpty();
  if(!id)return;
  try{const d=await api(CH_API+'?id='+encodeURIComponent(id));
    for(const m of d.messages){if(m.role==='user')chMsg('me',m.content);else if(m.role==='assistant'&&m.content)chMsg('bot',m.content);
      else if(m.role==='tool'&&m.cards)chCards(m.cards);else if(m.compact)chMark();else if(m.note&&CH_NOTES[m.note])chNote(topText(CH_NOTES[m.note]));}
    chCtx(d.context);
  }catch(err){toast(err.message);}}
function chBusyUi(on){chBusy=on;chIcon();chSendState();}
async function chCompact(){if(!chConv||chBusy)return;chBusyUi(true);chNote(topText('ch.compacting'));
  try{chCtx(await api(CH_API+'/compact',{method:'POST',body:{conversation:chConv}}));chMark();}
  catch(err){chNote(topFill('ch.error',{msg:err.message}),'ch-err');}
  finally{chBusyUi(false);}}
// Game cards: drawn from the fields the server built (chat/cards.js), all as text. The button queues the game for
// one of the person's own consoles through CH_API/send, which the server checks again.
let chDevices=null;
async function chConsoles(){if(chDevices)return chDevices;
  try{chDevices=(await api(CH_API+'/consoles')).consoles;}catch{return [];}return chDevices;}
async function chAddTo(c,code,btn){btn.disabled=true;
  try{const r=await api(CH_API+'/send',{method:'POST',body:{game:c.id,device:code}});
    toast(topFill(r.existing?'ch.cardAlready':'ch.cardAdded',{name:r.label}));}
  catch(err){toast(topFill('ch.cardFail',{msg:err.message}));}
  finally{btn.disabled=false;}}
function chPickConsole(c,act,btn,list){const box=act.parentNode;box.querySelector('.ch-pickrow')?.remove();
  const row=el('div',null,'ch-gact ch-pickrow');row.style.margin='0';row.append(el('span',topText('ch.cardPick'),'muted'));
  for(const d of list){const b=el('button',d.label,'ch-chip');b.type='button';b.addEventListener('click',()=>{row.remove();chAddTo(c,d.code,btn);});row.append(b);}
  const x=el('button',null,'ch-x');x.type='button';x.setAttribute('aria-label',topText('ch.close'));x.innerHTML=CH_ICON.x;x.addEventListener('click',()=>row.remove());row.append(x);
  box.append(row);chScroll();}
function chGameCard(c){const box=el('div',null,'ch-gcard');
  if(c.icon){const img=el('img');img.alt='';img.loading='lazy';img.width=img.height=56;img.src=c.icon;box.append(img);}else box.append(el('div',null,'ch-noimg'));
  const info=el('div');info.append(el('div',c.name,'ch-gname'));
  info.append(el('div',[c.platform,c.size?chSize(c.size):''].filter(Boolean).join(' · '),'ch-gmeta'));
  const tags=el('div',null,'ch-gtags');
  if(c.korean&&c.korean.patch)tags.append(el('span',topText('ch.cardKoPatch'),'ch-tag'));
  if(c.korean&&c.korean.ui)tags.append(el('span',topText('ch.cardKoUi'),'ch-tag'));
  if(tags.childElementCount)info.append(tags);
  box.append(info);
  if(c.sendable){const act=el('div',null,'ch-gact');const add=el('button',topText('ch.cardAdd'));add.type='button';
    add.addEventListener('click',async()=>{const list=await chConsoles();
      if(!list.length){toast(topText('ch.cardNoDevice'));return;}
      if(list.length===1){chAddTo(c,list[0].code,add);return;}
      chPickConsole(c,act,add,list);});
    act.append(add);box.append(act);}
  return box;}
function chCards(cards){if(!Array.isArray(cards)||!cards.length)return;chLeaveEmpty();
  const w=el('div',null,'ch-cards');for(const c of cards)w.append(chGameCard(c));chCol().append(w);chScroll();}
async function chSend(text){
  chMsg('me',text);let bot=null,botText='';chAbort=new AbortController();chBusyUi(true);chTypingOn('think');
  try{
    const r=await fetch(CH_API,{method:'POST',signal:chAbort.signal,headers:{'Content-Type':'application/json','Accept-Language':chLang(),...chWriteHeaders()},body:JSON.stringify({message:text,conversation:chConv||undefined})});
    if(r.status===401){location.reload();return;}
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.code==='too_long'?topFill('ch.tooLong',{max:CH_MAX}):(e.error||('HTTP '+r.status)));}
    const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
    for(;;){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
      let i;while((i=buf.indexOf('\\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line)continue;
        let e;try{e=JSON.parse(line);}catch{continue;}
        if(e.conversation&&!chConv){chConv=e.conversation;}
        if(e.type==='text'){chTypingOff();if(!bot){bot=chMsg('bot','');botText='';}botText+=e.delta;chRender(bot,botText);chScroll();}
        else if(e.type==='tool_end'&&e.status!=='pending'&&e.status!=='requested'){bot=null;}
        else if(e.type==='tool_start'){bot=null;chNote(topFill('ch.tool',{name:e.action||e.name}));chTypingOn(CH_WAIT_OF[e.action]||'think');}
        else if(e.type==='cards'){chCards(e.cards);}
        else if(e.type==='approval'){chCard({id:e.id,action:e.action,preview:e.preview,kind:e.kind});if(!CH_ADMIN||e.status==='requested')chNote(chReqText(e.kind));}
        else if(e.type==='compacting'){chNote(topText('ch.compacting'));}
        else if(e.type==='context'){chCtx(e);if(e.compacted)chMark();}
        else if(e.type==='error'){chTypingOff();chNote(topFill('ch.error',{msg:e.message||''}),'ch-err');}
        if(chDots)chTypingOn();}}
  }catch(err){if(err.name!=='AbortError')chNote(topFill('ch.error',{msg:err.message}),'ch-err');}
  finally{chTypingOff();chAbort=null;chBusyUi(false);}
  try{await chPickList(chConv,true);}catch{}}
async function chRefresh(){
  if(!CH_ADMIN){
    try{const d=await api(CH_API);chState.enabled=true;chState.ready=d.configured===true;}catch{chState.enabled=false;chState.ready=false;}}
  else{
    const [set,integ]=await Promise.all([api('/admin/api/server-settings'),api('/admin/api/integrations')]);
    chState.enabled=set.settings.chatEnabled?.value===true;
    const f=integ.chat?.fields||{};
    $('ch-url').value=f.baseUrl?.value||'';$('ch-model').value=f.model?.value||'';$('ch-key').value='';
    const keySet=f.apiKey?.set===true;$('ch-key').placeholder=topText(keySet?'ch.keySet':'ch.keyNone');
    chState.ready=Boolean(f.baseUrl?.value&&f.model?.value&&keySet);
    $('ch-on').checked=chState.enabled;
    $('ch-name-in').value=set.settings.chatName?.value||'';$('ch-persona-in').value=set.settings.chatPersona?.value||'';
    $('ch-window-in').value=set.settings.chatContextTokens?.value||'';
    chState.name=set.settings.chatName?.value||'';}
  chShowName();
  const live=chState.enabled&&chState.ready;
  $('ch-dock').hidden=!live;$('ch-pick').hidden=!live;$('ch-new').hidden=!live;
  if(live){await chPickList(chConv);if(!chConv)chEmpty();}else{chConv=null;chEmpty();}
  if(CH_ADMIN)$('ch-del').disabled=!chConv;chFit();}
function chOpenSheet(){if(!CH_ADMIN)return;$('ch-del').disabled=!chConv;$('ch-sheet').showModal();}
function loadChat(){chIcon();chSendState();chFit();chRefresh().catch((err)=>toast(err.message));}
addEventListener('resize',chFit);if(window.visualViewport)window.visualViewport.addEventListener('resize',chFit);
if(CH_ADMIN){
$('ch-gear').addEventListener('click',chOpenSheet);
$('ch-sheet-x').addEventListener('click',()=>$('ch-sheet').close());
$('ch-on').addEventListener('change',async()=>{const want=$('ch-on').checked;
  try{if(want&&!chState.ready){$('ch-on').checked=false;toast(topText('ch.needSetup'));return;}
    await api('/admin/api/server-settings',{method:'POST',body:{chatEnabled:want}});await chRefresh();
  }catch(err){$('ch-on').checked=!want;toast(err.message);}});
$('ch-form').addEventListener('submit',async(ev)=>{ev.preventDefault();
  try{await api('/admin/api/integrations/chat',{method:'POST',body:{baseUrl:$('ch-url').value,model:$('ch-model').value,apiKey:$('ch-key').value}});
    toast(topText('ch.saved'));await chRefresh();}catch(err){toast(err.message);}});
$('ch-persona-form').addEventListener('submit',async(ev)=>{ev.preventDefault();const win=$('ch-window-in').value.trim();
  try{await api('/admin/api/server-settings',{method:'POST',body:{chatName:$('ch-name-in').value,chatPersona:$('ch-persona-in').value,chatContextTokens:win?win:null}});
    toast(topText('ch.saved'));await chRefresh();if(chConv)await chOpen(chConv);}catch(err){toast(err.message);}});
$('ch-del').addEventListener('click',async()=>{if(!chConv)return;
  if(!await ask(topText('ch.deleteAsk'),{danger:true}))return;
  try{await api(CH_API+'?id='+encodeURIComponent(chConv),{method:'DELETE'});toast(topText('ch.deleted'));chConv=null;chEmpty();await chPickList(null);$('ch-del').disabled=true;$('ch-sheet').close();}catch(err){toast(err.message);}});
}
$('ch-ctx').addEventListener('click',chCompact);
$('ch-pick').addEventListener('change',()=>chOpen($('ch-pick').value));
$('ch-new').addEventListener('click',()=>{$('ch-pick').value='';chOpen(null);$('ch-text').focus();});
$('ch-send').addEventListener('submit',(ev)=>{ev.preventDefault();
  if(chBusy){if(chAbort)chAbort.abort();return;}
  if(chUp)return;
  const typed=$('ch-text').value.trim(),files=chFileLines();
  const t=files&&typed?files+'\\n'+typed:files||typed;if(!t)return;
  if(t.length>CH_MAX){chNote(topFill('ch.tooLong',{max:CH_MAX}),'ch-err');return;}
  $('ch-text').value='';chFiles=[];chChips();chGrow();chSend(t);});
$('ch-clip').addEventListener('click',()=>$('ch-file').click());
$('ch-file').addEventListener('change',()=>{const f=[...$('ch-file').files];$('ch-file').value='';chUpload(f);});
$('ch-text').addEventListener('paste',(ev)=>{const items=[...((ev.clipboardData&&ev.clipboardData.items)||[])].filter((i)=>i.kind==='file');
  const files=items.map((i)=>i.getAsFile()).filter(Boolean);if(!files.length)return;
  ev.preventDefault();chUpload(files.map(chPasteName));});
{const zone=$('ch-log').parentElement,hasFiles=(e)=>[...((e.dataTransfer&&e.dataTransfer.types)||[])].includes('Files');
  zone.addEventListener('dragover',(e)=>{if(!hasFiles(e)||$('ch-dock').hidden)return;e.preventDefault();zone.classList.add('ch-drop');});
  zone.addEventListener('dragleave',(e)=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('ch-drop');});
  zone.addEventListener('drop',(e)=>{if(!hasFiles(e))return;e.preventDefault();zone.classList.remove('ch-drop');if(!$('ch-dock').hidden)chUpload(e.dataTransfer.files);});}
$('ch-text').addEventListener('input',chGrow);
$('ch-text').addEventListener('keydown',(ev)=>{if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing){ev.preventDefault();if(!chBusy)$('ch-send').requestSubmit();}});
`;
  return web ? `${WEB_SHIMS}${body}` : body;
}

export const CHAT_SCRIPT = chatScript();
