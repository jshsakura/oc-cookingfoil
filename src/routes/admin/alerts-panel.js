/**
 * The admin page's alerts tab: which Telegram bot and chat, which events, a
 * test message and what was told lately. Talks to /admin/api/alerts.
 */

import { icon } from "../../views/icons.js";
import { top, topHtml, topPh, topLabel } from "./top-i18n.js";

export const ALERTS_HTML = `<section id="tab-alerts" hidden>
  <h2 class="first">${top("m.alerts")}</h2>
  <p class="muted">${top("al.lede")}</p>
  <div class="al-status" id="al-status"><span class="al-dot"></span><div><strong>${top("loading")}</strong><span></span></div></div>
  <div class="subtabs hide-bar" id="alerts-subtabs" role="tablist" aria-label="알림 구역">
    <button type="button" role="tab" data-sub="setup" aria-selected="true">${icon("sliders")}설정</button>
    <button type="button" role="tab" data-sub="history" aria-selected="false">${icon("bell")}최근 알림</button>
  </div>
  <div data-sub-panel="setup">
  <form id="al-form" autocomplete="off">
    <h3>${top("al.connH")}</h3>
    <ol class="intg-steps">
      <li>${topHtml("al.s1")}</li>
      <li>${top("al.s2")}</li>
      <li>${top("al.s3")}</li>
    </ol>
    <div class="add">
      <input name="botToken" type="password" autocomplete="new-password" ${topPh("al.botTokenPh")} ${topLabel("al.botTokenPh")} maxlength="120">
      <input name="chatId" spellcheck="false" ${topPh("al.chatIdPh")} ${topLabel("al.chatIdPh")} maxlength="70">
      <button type="button" id="al-chats">${top("al.findChats")}</button>
    </div>
    <h3>${top("al.langH")}</h3>
    <div class="add"><select name="lang" ${topLabel("al.langH")}><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option></select></div>
    <h3>${top("al.eventsH")}</h3>
    <div class="al-events" id="al-events"></div>
    <h3>${top("al.approveH")}</h3>
    <label class="al-event"><input type="checkbox" name="buttons"><b>${top("al.buttonsT")}</b><small>${top("al.buttonsD")}</small></label>
    <p class="muted">${top("al.approversLede")}</p>
    <div class="add"><input name="approvers" spellcheck="false" ${topPh("al.approversPh")} ${topLabel("al.approversPh")} maxlength="300"></div>
    <div class="row" id="al-users"></div>
    <div class="row">
      <button class="primary" type="submit">${top("fp.save")}</button>
      <button type="button" id="al-test">${top("al.test")}</button>
      <button type="button" class="danger" id="al-clear">${top("pp.delete")}</button>
    </div>
    <p class="muted" id="al-msg"></p>
  </form>
  </div>
  <div data-sub-panel="history" hidden>
  <p class="muted">${top("al.historyLede")}</p>
  <div class="scroll" id="al-history" data-skel></div>
  </div>
</section>`;

export const ALERTS_CSS = `
.al-status{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:14px 16px;margin:12px 0 18px}
.al-status strong{display:block;font-size:var(--fs-md)}.al-status span:not(.al-dot){font-size:var(--fs-sm);color:var(--muted)}
.al-dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none}.al-status.on .al-dot{background:var(--good)}.al-status.bad .al-dot{background:var(--bad)}
#al-form h3{margin:18px 0 8px;font-size:var(--fs-md)}
#al-form .add{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;margin-bottom:6px}
#al-form .add input{flex:1 1 220px;min-width:0}
#al-form .add button{flex:none;white-space:nowrap}
#al-form .row{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;margin-top:14px}
#al-form .row:empty{display:none}
#al-form .row button{white-space:nowrap}
#al-msg:empty{display:none}#al-msg{margin-top:10px}
@media(max-width:640px){#al-form .add button,#al-form .row button{flex:1 1 auto}}
.al-events{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:14px}
.al-event{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:start;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:12px 14px;cursor:pointer}
.al-event input{margin-top:3px;width:18px;height:18px}.al-event b{font-size:var(--fs-md)}.al-event small{grid-column:2;color:var(--muted);font-size:var(--fs-xs);line-height:1.5}
.al-st{font-size:var(--fs-xs);font-weight:700;padding:2px 9px;border-radius:var(--r-pill);background:var(--sunk);color:var(--muted);white-space:nowrap}
.al-st.sent{color:var(--good)}.al-st.failed{color:var(--bad)}
`;

export const ALERTS_SCRIPT = /* js */ `
const AL_STATUS={sent:'al.st.sent',failed:'al.st.failed',held:'al.st.held',off:'al.st.off'};
let alData=null;
async function loadAlerts(){
  try{alData=await api('/admin/api/alerts');}catch(err){toast(err.message);return;}
  const d=alData,st=$('al-status');
  st.classList.toggle('on',d.configured&&d.bot!==null);st.classList.toggle('bad',d.bot===null);
  const [title,sub]=!d.tokenSet?[topText('al.offT'),topText('al.offS')]
    :d.bot===null?[topText('al.badTokenT'),topText('al.badTokenS')]
    :!d.chatId?[topText('al.noChatT'),topText('al.noChatS')]
    :[topText('al.onT'),(d.bot?topFill('al.botName',{bot:d.bot}):'')+topFill('al.onS',{chat:d.chatId,env:d.source==='env'?topText('al.envTag'):''})];
  st.querySelector('strong').textContent=title;st.querySelector('span:not(.al-dot)').textContent=sub;
  const f=$('al-form');f.botToken.value='';if(d.tokenSet)f.botToken.dataset.topPhTail='ig.storedSet';else delete f.botToken.dataset.topPhTail;f.botToken.placeholder=topText('al.botTokenPh')+(d.tokenSet?topText('ig.storedSet'):'');f.chatId.value=d.chatId||'';f.buttons.checked=d.buttons===true;f.lang.value=d.lang||'ko';f.approvers.value=(d.approvers||[]).join(',');
  // People the bot heard from lately; a click adds one to the list.
  $('al-users').replaceChildren(...(d.users||[]).length?[el('span',topText('al.usersLede'),'muted'),...d.users.map((u)=>btn(topFill('al.userBtn',{name:u.name||topText('al.noName'),id:u.id}),()=>{
    const ids=f.approvers.value.split(',').map((x)=>x.trim()).filter(Boolean);if(!ids.includes(u.id))f.approvers.value=[...ids,u.id].join(',');}))]:[]);
  $('al-events').replaceChildren(...d.events.map((e)=>{const l=el('label',null,'al-event');const b=document.createElement('input');b.type='checkbox';b.value=e.id;b.checked=e.on;
    l.append(b,el('b',e.label),el('small',e.desc));return l;}));
  const label=(id)=>(d.events.find((e)=>e.id===id)||{}).label||(id==='test'?topText('al.testEvent'):id);
  pagedTable('al-history',[topText('lg.colTime'),topText('al.colEvent'),topText('al.colText'),topText('al.colResult')],d.history,(h)=>{const tr=el('tr');const w=td(ago(h.at));w.title=fmt(h.at);
    const r=td();r.append(el('span',AL_STATUS[h.status]?topText(AL_STATUS[h.status]):h.status,'al-st '+h.status));if(h.detail)r.append(el('div',h.detail,'muted'));
    tr.append(w,td(label(h.event)),td(h.text),r);return tr;},topText('al.noHistory'),{label:topText('al.recent'),placeholder:topText('al.searchPh'),def:10});
}
$('al-form').addEventListener('submit',async(e)=>{e.preventDefault();const f=e.target;
  const events=[...$('al-events').querySelectorAll('input:checked')].map((b)=>b.value);
  try{await api('/admin/api/alerts',{method:'POST',body:{botToken:f.botToken.value.trim(),chatId:f.chatId.value.trim(),events,buttons:f.buttons.checked,lang:f.lang.value,approvers:f.approvers.value.split(',').map((x)=>x.trim()).filter(Boolean)}});$('al-msg').textContent='';toast(topText('pp.saved'));loadAlerts();}
  catch(err){$('al-msg').textContent=err.message;}});
$('al-test').addEventListener('click',async()=>{$('al-msg').textContent=topText('al.sending');
  try{const r=await api('/admin/api/alerts/test',{method:'POST',body:{}});$('al-msg').textContent=r.message;loadAlerts();}catch(err){$('al-msg').textContent=err.message;}});
$('al-chats').addEventListener('click',async()=>{$('al-msg').textContent=topText('ra.searching');const f=$('al-form');
  try{const r=await api('/admin/api/alerts/chats',{method:'POST',body:{botToken:f.botToken.value.trim()}});
    if(r.ok&&r.chats.length){f.chatId.value=r.chats[0].id;const list=r.chats.map((x)=>x.title?x.title+' ('+x.id+')':x.id).join(', ');
      $('al-msg').textContent=r.chats.length>1?topFill('al.manyChats',{list}):topFill('al.oneChat',{list});}
    else $('al-msg').textContent=r.message;}catch(err){$('al-msg').textContent=err.message;}});
$('al-clear').addEventListener('click',async()=>{if(!await ask(topText('al.askClear'),{danger:true}))return;
  try{await api('/admin/api/alerts/clear',{method:'POST',body:{}});toast(topText('pp.deleted'));loadAlerts();}catch(err){$('al-msg').textContent=err.message;}});
`;
