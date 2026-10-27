/**
 * The admin chat page: the switch and the model setup on top, then the conversation. Talks to
 * /admin/api/chat (chat-api.js), /admin/api/integrations/chat (the model) and
 * /admin/api/server-settings (chatEnabled). Everything from the model or a tool goes in as text.
 */
import { top, topLabel, topPh } from "./top-i18n.js";

export const CHAT_HTML = /* html */ `<section id="tab-chat" hidden>
  <div class="hd"><h2 class="first">${top("m.chat")}</h2>
    <div class="actions"><button type="button" id="ch-switch"></button></div></div>
  <p class="muted">${top("ch.lead")}</p>
  <details class="ch-setup" id="ch-setup"><summary>${top("ch.setupH")}</summary>
    <form id="ch-form" class="ch-form">
      <p class="muted">${top("ch.setupLead")}</p>
      <label>${top("ch.baseUrl")}<input id="ch-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://"></label>
      <label>${top("ch.model")}<input id="ch-model" type="text" autocomplete="off" spellcheck="false"></label>
      <label>${top("ch.apiKey")}<input id="ch-key" type="password" autocomplete="new-password"></label>
      <p class="muted" id="ch-keystate"></p>
      <p class="muted">${top("ch.keyMoves")}</p>
      <div class="actions"><button type="submit" class="primary">${top("fp.save")}</button></div>
    </form>
  </details>
  <p class="ch-off" id="ch-off" hidden>${top("ch.isOff")}</p>
  <div id="ch-main" hidden>
    <div class="ch-bar">
      <select id="ch-pick" ${topLabel("ch.conv")}></select>
      <button type="button" id="ch-new">${top("ch.new")}</button>
      <button type="button" class="danger" id="ch-del">${top("ch.delete")}</button>
    </div>
    <div class="ch-log" id="ch-log" aria-live="polite"></div>
    <div class="ch-pending" id="ch-pending" hidden>
      <h3>${top("ch.pendingH")}</h3>
      <p class="muted">${top("ch.lost")}</p>
      <div id="ch-pending-list"></div>
    </div>
    <form class="ch-input" id="ch-send">
      <textarea id="ch-text" rows="1" maxlength="8000" ${topPh("ch.placeholder")}></textarea>
      <button type="submit" class="primary" id="ch-go">${top("ch.send")}</button>
      <button type="button" id="ch-stop" hidden>${top("ch.stop")}</button>
    </form>
  </div>
</section>`;

export const CHAT_CSS = /* css */ `
.ch-setup{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:10px 14px;margin:10px 0}
.ch-setup summary{cursor:pointer;font-weight:var(--fw-bold)}
.ch-form{display:grid;gap:10px;margin-top:10px;max-width:560px}
.ch-form label{display:grid;gap:4px;font-weight:var(--fw-bold)}
.ch-off{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:10px 14px}
.ch-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
.ch-bar select{flex:1;min-width:160px;max-width:420px}
.ch-log{display:grid;gap:10px;align-content:start;min-height:240px;max-height:60vh;overflow:auto;padding:12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl)}
.ch-msg{display:grid;gap:2px;max-width:min(760px,100%)}
.ch-msg b{color:var(--muted);font-size:var(--fs-sm)}
.ch-body{overflow-wrap:anywhere}
.ch-body.plain{white-space:pre-wrap}
.ch-body p{margin:0 0 6px}
.ch-body ul,.ch-body ol{margin:0 0 6px;padding-left:22px}
.ch-body pre{margin:0 0 6px;padding:8px 10px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-xl);overflow:auto;white-space:pre}
.ch-body code{font-family:ui-monospace,monospace;font-size:.92em}
.ch-msg.me{justify-self:end}
.ch-msg.me .ch-body{background:rgba(var(--accent-rgb),.12);border-radius:var(--r-xl);padding:8px 12px}
.ch-note{color:var(--muted);font-size:var(--fs-sm)}
.ch-err{color:var(--bad)}
.ch-pending{margin:12px 0}
.ch-pending h3{margin:0 0 4px}
.ch-card{background:var(--panel);border:1px solid rgba(var(--accent-rgb),.6);border-radius:var(--r-2xl);padding:10px 14px;margin:8px 0;display:grid;gap:8px}
.ch-card pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-sm)}
.ch-input{display:flex;gap:8px;align-items:stretch;margin-top:10px}
.ch-input textarea{flex:1;min-height:40px;box-sizing:border-box;resize:vertical;padding:9px 14px;border-radius:var(--r-lg);border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:var(--fs-md);line-height:20px}
.ch-input textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(var(--accent-rgb),.45)}
.ch-input button{align-self:stretch}
`;

export const CHAT_SCRIPT = /* js */ `
let chConv=null,chAbort=null,chBusy=false,chState={enabled:false,configured:false};
const chLog=()=>$('ch-log');
function chScroll(){const l=chLog();l.scrollTop=l.scrollHeight;}
function chClear(){chLog().replaceChildren(el('p',topText('ch.empty'),'ch-note'));}
const BT=String.fromCharCode(96),FENCE=BT+BT+BT;
// Bold and inline code only; everything else stays text. Nodes are built, never parsed from HTML.
function chInline(parent,s){let i=0;
  while(i<s.length){const b=s.indexOf('**',i),c=s.indexOf(BT,i);let n=-1,k=null;
    if(b>=0&&(c<0||b<c)){n=b;k='b';}else if(c>=0){n=c;k='c';}
    if(n<0){parent.append(s.slice(i));return;}
    const mark=k==='b'?'**':BT,end=s.indexOf(mark,n+mark.length);
    if(end<0){parent.append(s.slice(i));return;}
    if(n>i)parent.append(s.slice(i,n));
    parent.append(el(k==='b'?'strong':'code',s.slice(n+mark.length,end)));i=end+mark.length;}}
// Paragraphs, bullet and numbered lists, fenced code. A fence still open (the answer is streaming) shows as code.
function chRender(box,text){box.replaceChildren();let list=null,code=null;
  for(const line of text.split('\\n')){
    if(line.trim().startsWith(FENCE)){if(code){box.append(code);code=null;}else{code=el('pre');list=null;}continue;}
    if(code){code.textContent+=(code.dataset.n?'\\n':'')+line;code.dataset.n='1';continue;}
    const m=/^\\s*([-*]|\\d+\\.)\\s+(.*)$/.exec(line);
    if(m){const tag=/\\d/.test(m[1])?'ol':'ul';if(!list||list.tagName.toLowerCase()!==tag){list=el(tag);box.append(list);}
      const li=el('li');chInline(li,m[2]);list.append(li);continue;}
    list=null;if(!line.trim())continue;
    const p=el('p');chInline(p,line);box.append(p);}
  if(code)box.append(code);}
function chMsg(who,text){const l=chLog();if(l.firstChild&&l.firstChild.classList.contains('ch-note')&&l.children.length===1)l.replaceChildren();
  const d=el('div',null,'ch-msg'+(who==='me'?' me':''));d.append(el('b',topText(who==='me'?'ch.you':'ch.bot')));
  const body=el('div',null,'ch-body'+(who==='me'?' plain':''));if(who==='me')body.textContent=text;else chRender(body,text);d.append(body);l.append(d);chScroll();return body;}
function chNote(text,cls){const l=chLog();l.append(el('div',text,'ch-note'+(cls?' '+cls:'')));chScroll();}
function chPreview(p){try{return JSON.stringify(p,null,2);}catch{return String(p);}}
function chCard(a){const box=$('ch-pending-list');const c=el('div',null,'ch-card');c.dataset.id=a.id;
  c.append(el('b',a.action||a.capId||a.tool||''),el('pre',chPreview(a.preview)));
  const row=el('div',null,'actions');
  const ok=el('button',topText('ch.approve'),'primary'),no=el('button',topText('ch.refuse'));ok.type=no.type='button';
  ok.addEventListener('click',()=>chDecide(a.id,true,c));no.addEventListener('click',()=>chDecide(a.id,false,c));
  row.append(ok,no);c.append(row);box.append(c);$('ch-pending').hidden=false;}
function chPendingGone(c){c.remove();if(!$('ch-pending-list').children.length)$('ch-pending').hidden=true;}
async function chDecide(id,approve,card){
  try{const r=await api('/admin/api/chat/decision',{method:'POST',body:{id,approve,conversation:chConv||undefined}});
    chPendingGone(card);
    if(r.status==='done')chNote(topText('ch.approved'));else if(r.status==='refused')chNote(topText('ch.refused'));
    else if(r.status==='denied')chNote(topText('ch.gone'));else chNote(r.error?.message||topText('ch.gone'),'ch-err');
  }catch(err){toast(err.message);}}
async function chPickList(select,keepPending){
  const d=await api('/admin/api/chat');chState.configured=d.configured;
  const pick=$('ch-pick');pick.replaceChildren(el('option',topText('ch.new')));pick.firstChild.value='';
  for(const c of d.conversations){const o=el('option',c.title||topText('ch.untitled'));o.value=c.id;pick.append(o);}
  pick.value=select&&d.conversations.some((c)=>c.id===select)?select:'';
  if(!keepPending){$('ch-pending-list').replaceChildren();$('ch-pending').hidden=true;
    for(const p of d.pending)chCard({...p,action:p.capId});}
  return d;}
async function chOpen(id){
  chConv=id||null;chClear();
  if(!id)return;
  try{const d=await api('/admin/api/chat?id='+encodeURIComponent(id));
    for(const m of d.messages){if(m.role==='user')chMsg('me',m.content);else if(m.role==='assistant'&&m.content)chMsg('bot',m.content);}
  }catch(err){toast(err.message);}}
function chBusyUi(on){chBusy=on;$('ch-go').hidden=on;$('ch-stop').hidden=!on;$('ch-text').disabled=on;}
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
  const ready=Boolean(f.baseUrl?.value&&f.model?.value&&keySet);
  $('ch-switch').textContent=topText(chState.enabled?'ch.turnOff':'ch.turnOn');
  $('ch-setup').open=!ready;
  $('ch-off').hidden=chState.enabled;$('ch-main').hidden=!chState.enabled;
  if(chState.enabled){await chPickList(chConv);if(!chConv)chClear();}}
function loadChat(){chRefresh().catch((err)=>toast(err.message));}
$('ch-switch').addEventListener('click',async()=>{
  try{if(!chState.enabled){const integ=await api('/admin/api/integrations');const f=integ.chat?.fields||{};
      if(!(f.baseUrl?.value&&f.model?.value&&f.apiKey?.set)){toast(topText('ch.needSetup'));$('ch-setup').open=true;return;}}
    await api('/admin/api/server-settings',{method:'POST',body:{chatEnabled:!chState.enabled}});await chRefresh();
  }catch(err){toast(err.message);}});
$('ch-form').addEventListener('submit',async(ev)=>{ev.preventDefault();
  try{await api('/admin/api/integrations/chat',{method:'POST',body:{baseUrl:$('ch-url').value,model:$('ch-model').value,apiKey:$('ch-key').value}});
    toast(topText('ch.saved'));await chRefresh();}catch(err){toast(err.message);}});
$('ch-pick').addEventListener('change',()=>chOpen($('ch-pick').value));
$('ch-new').addEventListener('click',()=>{$('ch-pick').value='';chOpen(null);});
$('ch-del').addEventListener('click',async()=>{if(!chConv)return;
  if(!await ask(topText('ch.deleteAsk'),{danger:true}))return;
  try{await api('/admin/api/chat?id='+encodeURIComponent(chConv),{method:'DELETE'});toast(topText('ch.deleted'));chConv=null;chClear();await chPickList(null);}catch(err){toast(err.message);}});
$('ch-send').addEventListener('submit',(ev)=>{ev.preventDefault();if(chBusy)return;const t=$('ch-text').value.trim();if(!t)return;$('ch-text').value='';chSend(t);});
$('ch-text').addEventListener('keydown',(ev)=>{if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing){ev.preventDefault();$('ch-send').requestSubmit();}});
$('ch-stop').addEventListener('click',()=>{if(chAbort)chAbort.abort();});
`;
