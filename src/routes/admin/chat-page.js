/**
 * The admin chat page, drawn like a chat app: a thin top row (conversation, new, settings), the
 * conversation filling the rest of the height, and the message box docked at the bottom. The
 * switch, the model form and deleting a conversation live in the sheet the gear opens. Talks to
 * /admin/api/chat (chat-api.js), /admin/api/integrations/chat (the model) and
 * /admin/api/server-settings (chatEnabled). Everything from the model or a tool goes in as text.
 */
import { icon } from "../../views/icons.js";
import { top, topLabel, topPh } from "./top-i18n.js";

/** The chat itself: the page puts it in a section, the floating widget in a panel. */
export const CHAT_INNER_HTML = /* html */ `  <div class="ch-top ch-col">
    <select id="ch-pick" ${topLabel("ch.conv")}></select>
    <button type="button" class="icon-btn" id="ch-new" ${topLabel("ch.new")}>${icon("plus")}</button>
    <button type="button" class="icon-btn" id="ch-gear" ${topLabel("ch.settings")}>${icon("sliders")}</button>
    <button type="button" class="icon-btn" id="ch-close" hidden ${topLabel("ch.close")}>${icon("x")}</button>
  </div>
  <div class="ch-log" id="ch-log" aria-live="polite"><div class="ch-col" id="ch-col"></div></div>
  <div class="ch-dock" id="ch-dock">
    <div class="ch-col">
      <div class="ch-pending" id="ch-pending" hidden>
        <b>${top("ch.pendingH")}</b>
        <p class="muted">${top("ch.lost")}</p>
        <div id="ch-pending-list"></div>
      </div>
      <form class="ch-card" id="ch-send">
        <textarea id="ch-text" rows="1" maxlength="8000" ${topPh("ch.placeholder")}></textarea>
        <button type="submit" class="primary ch-go" id="ch-go" ${topLabel("ch.send")}>${icon("send")}</button>
      </form>
    </div>
  </div>
  <dialog id="ch-sheet" class="ch-sheet" aria-labelledby="ch-sheet-h">
    <div class="ch-sheet-hd"><h3 id="ch-sheet-h">${top("ch.settings")}</h3>
      <button type="button" class="icon-btn" id="ch-sheet-x" ${topLabel("ch.close")}>${icon("x")}</button></div>
    <p class="muted">${top("ch.lead")}</p>
    <label class="ch-sw"><input type="checkbox" id="ch-on"><span>${top("ch.enabled")}</span></label>
    <form id="ch-form" class="ch-form">
      <h4>${top("ch.setupH")}</h4>
      <p class="muted">${top("ch.setupLead")}</p>
      <label>${top("ch.baseUrl")}<input id="ch-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://"></label>
      <label>${top("ch.model")}<input id="ch-model" type="text" autocomplete="off" spellcheck="false"></label>
      <label>${top("ch.apiKey")}<input id="ch-key" type="password" autocomplete="new-password"></label>
      <p class="muted" id="ch-keystate"></p>
      <p class="muted">${top("ch.keyMoves")}</p>
      <div class="actions"><button type="submit" class="primary">${top("fp.save")}</button></div>
    </form>
    <div class="ch-danger"><button type="button" class="danger" id="ch-del">${top("ch.delete")}</button></div>
  </dialog>`;

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
.ch-hello h3{margin:0;font-size:var(--fs-xl)}
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
.ch-err{color:var(--bad)}
.ch-dock{flex:none;padding-top:8px}
.ch-pending{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:10px 14px;margin-bottom:8px;max-height:34vh;overflow:auto}
.ch-pending p{margin:2px 0 6px}
.ch-card-ask{background:var(--sunk);border-radius:var(--r-xl);padding:10px 12px;margin:8px 0;display:grid;gap:8px}
.ch-card-ask pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-sm)}
.ch-card{display:flex;align-items:flex-end;gap:8px;background:var(--sunk);border:1px solid var(--line);border-radius:var(--r-2xl);padding:8px 8px 8px 16px}
.ch-card:focus-within{box-shadow:0 0 0 3px rgba(var(--accent-rgb),.45)}
.ch-card textarea{flex:1;min-width:0;box-sizing:border-box;border:0;outline:0;resize:none;background:transparent;color:var(--text);font:inherit;font-size:var(--fs-md);line-height:22px;padding:7px 0;max-height:none;overflow-y:hidden}
.ch-go{flex:none;display:grid;place-items:center;width:36px;height:36px;padding:0;border-radius:50%;border:0}
.ch-go .ico{width:18px;height:18px}
.ch-go:disabled{opacity:.45;cursor:default}
.ch-sheet{max-height:min(88dvh,760px);overflow:auto}
.ch-sheet-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;position:sticky;top:calc(-1 * var(--dlg-pad,24px));z-index:1;background:var(--panel);margin:calc(-1 * var(--dlg-pad,24px)) calc(-1 * var(--dlg-pad,24px)) 6px;padding:var(--dlg-pad,24px) var(--dlg-pad,24px) 8px}
.ch-sheet-hd h3{margin:0}
.ch-sw{display:flex;align-items:center;gap:10px;font-weight:var(--fw-bold);margin:10px 0}
.ch-form{display:grid;gap:10px;margin-top:6px}
.ch-form h4{margin:8px 0 0}
.ch-form label{display:grid;gap:4px;font-weight:var(--fw-bold)}
.ch-danger{margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
@media (max-width:640px){
.ch-sheet{width:100%;max-width:100%;margin:auto 0 0;box-sizing:border-box;border-radius:var(--r-2xl) var(--r-2xl) 0 0}
.ch-msg.me{max-width:92%}
}
`;

export const CHAT_SCRIPT = /* js */ `
const CH_ICON={send:${JSON.stringify(icon("send"))},stop:${JSON.stringify(icon("stop"))}};
let chConv=null,chAbort=null,chBusy=false,chState={enabled:false,ready:false};
const chCol=()=>$('ch-col');
function chScroll(){const l=$('ch-log');l.scrollTop=l.scrollHeight;}
// The section takes the height left under the header, also when a phone keyboard shrinks the screen.
function chFit(){const s=$('tab-chat');if(!s||s.hidden)return;const vh=(window.visualViewport&&window.visualViewport.height)||window.innerHeight;
  s.style.height=Math.max(320,vh-s.getBoundingClientRect().top-12)+'px';
  const d=$('ch-dock');document.documentElement.style.setProperty('--ch-dock',(d.hidden?0:d.offsetHeight)+'px');}
function chGrow(){const t=$('ch-text');t.style.height='auto';const cs=getComputedStyle(t),line=parseFloat(cs.lineHeight)||22,pad=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
  const max=line*8+pad;t.style.height=Math.min(t.scrollHeight,max)+'px';t.style.overflowY=t.scrollHeight>max?'auto':'hidden';chSendState();chFit();}
function chSendState(){const b=$('ch-go');b.disabled=!chBusy&&!$('ch-text').value.trim();}
function chIcon(){const b=$('ch-go');b.innerHTML=chBusy?CH_ICON.stop:CH_ICON.send;b.setAttribute('aria-label',topText(chBusy?'ch.stop':'ch.send'));}
function chEmpty(){const c=chCol();c.classList.add('ch-empty');c.replaceChildren();const h=el('div',null,'ch-hello');
  if(!chState.enabled||!chState.ready){h.append(el('p',topText('ch.isOff'),'muted'));
    const b=el('button',topText('ch.settings'),'primary');b.type='button';b.addEventListener('click',chOpenSheet);h.append(b);}
  else{h.append(el('h3',topText('ch.hello')));const chips=el('div',null,'ch-chips');
    for(const k of ['ch.ex1','ch.ex2','ch.ex3']){const b=el('button',topText(k),'ch-chip');b.type='button';b.setAttribute('data-noicon','');
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
function chPreview(p){try{return JSON.stringify(p,null,2);}catch{return String(p);}}
function chCard(a){const box=$('ch-pending-list');const c=el('div',null,'ch-card-ask');c.dataset.id=a.id;
  c.append(el('b',a.action||a.capId||a.tool||''),el('pre',chPreview(a.preview)));
  const row=el('div',null,'actions');
  const ok=el('button',topText('ch.approve'),'primary'),no=el('button',topText('ch.refuse'));ok.type=no.type='button';
  ok.addEventListener('click',()=>chDecide(a.id,true,c));no.addEventListener('click',()=>chDecide(a.id,false,c));
  row.append(ok,no);c.append(row);box.append(c);$('ch-pending').hidden=false;chFit();}
function chPendingGone(c){c.remove();if(!$('ch-pending-list').children.length)$('ch-pending').hidden=true;chFit();}
async function chDecide(id,approve,card){
  try{const r=await api('/admin/api/chat/decision',{method:'POST',body:{id,approve,conversation:chConv||undefined}});
    chPendingGone(card);
    if(r.status==='done')chNote(topText('ch.approved'));else if(r.status==='refused')chNote(topText('ch.refused'));
    else if(r.status==='denied')chNote(topText('ch.gone'));else chNote((r.error&&r.error.message)||topText('ch.gone'),'ch-err');
  }catch(err){toast(err.message);}}
async function chPickList(select,keepPending){
  const d=await api('/admin/api/chat');
  const pick=$('ch-pick');pick.replaceChildren(el('option',topText('ch.new')));pick.firstChild.value='';
  for(const c of d.conversations){const o=el('option',c.title||topText('ch.untitled'));o.value=c.id;pick.append(o);}
  pick.value=select&&d.conversations.some((c)=>c.id===select)?select:'';
  if(!keepPending){$('ch-pending-list').replaceChildren();$('ch-pending').hidden=true;
    for(const p of d.pending)chCard({...p,action:p.capId});}
  return d;}
async function chOpen(id){
  chConv=id||null;chEmpty();
  if(!id)return;
  try{const d=await api('/admin/api/chat?id='+encodeURIComponent(id));
    for(const m of d.messages){if(m.role==='user')chMsg('me',m.content);else if(m.role==='assistant'&&m.content)chMsg('bot',m.content);}
  }catch(err){toast(err.message);}}
function chBusyUi(on){chBusy=on;chIcon();chSendState();}
async function chSend(text){
  chMsg('me',text);let bot=null,botText='';chAbort=new AbortController();chBusyUi(true);
  try{
    const r=await fetch('/admin/api/chat',{method:'POST',signal:chAbort.signal,headers:{'Content-Type':'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'},body:JSON.stringify({message:text,conversation:chConv||undefined})});
    if(r.status===401){location.reload();return;}
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||('HTTP '+r.status));}
    const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
    for(;;){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
      let i;while((i=buf.indexOf('\\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line)continue;
        let e;try{e=JSON.parse(line);}catch{continue;}
        if(e.conversation&&!chConv){chConv=e.conversation;}
        if(e.type==='text'){if(!bot){bot=chMsg('bot','');botText='';}botText+=e.delta;chRender(bot,botText);chScroll();}
        else if(e.type==='tool_end'&&e.status!=='pending'&&e.status!=='requested'){bot=null;}
        else if(e.type==='tool_start'){bot=null;chNote(topFill('ch.tool',{name:e.action||e.name}));}
        else if(e.type==='approval'){chCard({id:e.id,action:e.action,preview:e.preview});}
        else if(e.type==='error'){chNote(topFill('ch.error',{msg:e.message||''}),'ch-err');}}}
  }catch(err){if(err.name!=='AbortError')chNote(topFill('ch.error',{msg:err.message}),'ch-err');}
  finally{chAbort=null;chBusyUi(false);}
  try{await chPickList(chConv,true);}catch{}}
async function chRefresh(){
  const [set,integ]=await Promise.all([api('/admin/api/server-settings'),api('/admin/api/integrations')]);
  chState.enabled=set.settings.chatEnabled?.value===true;
  const f=integ.chat?.fields||{};
  $('ch-url').value=f.baseUrl?.value||'';$('ch-model').value=f.model?.value||'';$('ch-key').value='';
  const keySet=f.apiKey?.set===true;$('ch-keystate').textContent=topText(keySet?'ch.keySet':'ch.keyNone');
  chState.ready=Boolean(f.baseUrl?.value&&f.model?.value&&keySet);
  $('ch-on').checked=chState.enabled;
  const live=chState.enabled&&chState.ready;
  $('ch-dock').hidden=!live;$('ch-pick').hidden=!live;$('ch-new').hidden=!live;
  if(live){await chPickList(chConv);if(!chConv)chEmpty();}else{chConv=null;chEmpty();}
  $('ch-del').disabled=!chConv;chFit();}
function chOpenSheet(){$('ch-del').disabled=!chConv;$('ch-sheet').showModal();}
function loadChat(){chIcon();chSendState();chFit();chRefresh().catch((err)=>toast(err.message));}
addEventListener('resize',chFit);if(window.visualViewport)window.visualViewport.addEventListener('resize',chFit);
$('ch-gear').addEventListener('click',chOpenSheet);
$('ch-sheet-x').addEventListener('click',()=>$('ch-sheet').close());
$('ch-sheet').addEventListener('click',(ev)=>{if(ev.target===$('ch-sheet'))$('ch-sheet').close();});
$('ch-on').addEventListener('change',async()=>{const want=$('ch-on').checked;
  try{if(want&&!chState.ready){$('ch-on').checked=false;toast(topText('ch.needSetup'));return;}
    await api('/admin/api/server-settings',{method:'POST',body:{chatEnabled:want}});await chRefresh();
  }catch(err){$('ch-on').checked=!want;toast(err.message);}});
$('ch-form').addEventListener('submit',async(ev)=>{ev.preventDefault();
  try{await api('/admin/api/integrations/chat',{method:'POST',body:{baseUrl:$('ch-url').value,model:$('ch-model').value,apiKey:$('ch-key').value}});
    toast(topText('ch.saved'));await chRefresh();}catch(err){toast(err.message);}});
$('ch-pick').addEventListener('change',()=>chOpen($('ch-pick').value));
$('ch-new').addEventListener('click',()=>{$('ch-pick').value='';chOpen(null);$('ch-text').focus();});
$('ch-del').addEventListener('click',async()=>{if(!chConv)return;
  if(!await ask(topText('ch.deleteAsk'),{danger:true}))return;
  try{await api('/admin/api/chat?id='+encodeURIComponent(chConv),{method:'DELETE'});toast(topText('ch.deleted'));chConv=null;chEmpty();await chPickList(null);$('ch-del').disabled=true;$('ch-sheet').close();}catch(err){toast(err.message);}});
$('ch-send').addEventListener('submit',(ev)=>{ev.preventDefault();
  if(chBusy){if(chAbort)chAbort.abort();return;}
  const t=$('ch-text').value.trim();if(!t)return;$('ch-text').value='';chGrow();chSend(t);});
$('ch-text').addEventListener('input',chGrow);
$('ch-text').addEventListener('keydown',(ev)=>{if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing){ev.preventDefault();if(!chBusy)$('ch-send').requestSubmit();}});
`;
