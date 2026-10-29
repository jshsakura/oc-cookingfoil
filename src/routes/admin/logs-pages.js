/**
 * The admin records pages: downloads, client logs and blocks/denials.
 *
 * Stage B of the admin redesign: each of these is a page of its own
 * (/admin/logs/downloads, /admin/logs/clients, /admin/logs/security) that
 * carries only its own markup and script, and the still-whole dashboard
 * inlines the very same LOGS_SCRIPT for its logs tab, so there is one owner
 * for the behaviour. The security page reads /admin/api/stats like the
 * dashboard does, renders the two tables it owns, refreshes on its own
 * visibility-aware timer and updates the sidebar's lock badge.
 */
import { box } from "./boxes.js";
import { top } from "./top-i18n.js";
import { icon } from "../../views/icons.js";

export const LOGS_CSS = /* css */ `
.logs-view{display:grid;grid-template-columns:minmax(200px,280px) 1fr;gap:12px;margin-bottom:8px}
/* The page scrolls the log; the file list stays beside it under the header. */
.logs-list{display:grid;gap:8px;align-content:start;position:sticky;top:calc(var(--adm-hdr-h, 0px) + 16px);max-height:calc(100vh - var(--adm-hdr-h, 0px) - 32px);overflow:auto}
.logs-list details{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:10px 12px}
.logs-list summary{cursor:pointer;font-weight:700;display:flex;justify-content:space-between;gap:8px}
.logs-list summary span{color:var(--muted);font-weight:var(--fw);font-size:var(--fs-xs)}
.logs-list button{display:flex;width:100%;justify-content:space-between;margin-top:6px;padding:7px 10px;font-weight:var(--fw)}
.logs-list button[aria-pressed="true"]{background:rgba(var(--accent-rgb),.14)}
.logs-body{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);overflow:hidden;display:flex;flex-direction:column}
.logs-head{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--muted);font-size:var(--fs-sm);display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.logs-body pre{margin:0;padding:14px;min-height:220px;overflow-x:auto;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
.logs-view{align-items:stretch}
.logs-list summary{align-items:center}.logs-list summary>b{display:grid;gap:1px;min-width:0;font-weight:700}
.logs-list summary>b small{font:500 11px ui-monospace,monospace;color:var(--muted);letter-spacing:.02em}
.logs-list button{gap:10px}.logs-list button span{white-space:nowrap;font-variant-numeric:tabular-nums}
.logs-list summary span{white-space:nowrap}
.logs-body{min-height:320px}
.logs-body pre{flex:1}.logs-body pre[hidden],.logs-head[hidden]{display:none}
.logs-empty{flex:1;display:grid;place-content:center;justify-items:center;gap:6px;padding:30px 20px;text-align:center;color:var(--muted)}
.logs-empty b{color:var(--text);font-size:var(--fs-md)}.logs-empty span{font-size:var(--fs-sm)}
.logs-empty[hidden]{display:none}.logs-empty-ico{width:38px;height:38px;color:var(--faint);stroke-width:1.5;margin-bottom:4px}
#bug-reports table{width:100%}#bug-reports td,#bug-reports th{white-space:nowrap}#bug-reports td:nth-child(3){white-space:normal}
.rk{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:var(--r-pill);font-weight:var(--fw-bold);font-size:var(--fs-sm);color:var(--muted);font-variant-numeric:tabular-nums}
.rk.r1{background:var(--medal-1);color:var(--medal-1-ink)}.rk.r2{background:var(--medal-2);color:var(--medal-2-ink)}.rk.r3{background:var(--medal-3);color:var(--medal-3-ink)}
.rk-key{display:block;font:500 11px ui-monospace,monospace;color:var(--muted)}
@media (max-width:640px){.logs-view{grid-template-columns:1fr}.logs-list{position:static;max-height:none}}
`;

/** The client-logs area: bug report ranking plus the per-console viewer. */
export const LOGS_CLIENT_HTML = /* html */ `
<div class="hd"><h2 class="first">${top("lg.clientH")}</h2><button type="button" id="cl-refresh">${top("lg.refresh")}</button></div>
<p class="muted">${top("lg.clientLead")}</p>
${box("bug-reports", top("lg.bugH"), `<p class="muted">${top("lg.bugLead")}</p>
<div class="scroll" id="bug-reports" data-skel></div>`, { level: "h3", open: true })}
<h3 class="sub-h">${top("lg.byConsole")}</h3>
<div class="logs-view">
  <div class="logs-list" id="cl-list"></div>
  <div class="logs-body">
    <div class="logs-head" id="cl-head" hidden></div>
    <div class="logs-empty" id="cl-empty">${icon("log", "ico logs-empty-ico")}<b>${top("lg.pickEmpty")}</b><span>${top("lg.pickHint")}</span></div>
    <pre id="cl-text" tabindex="0" hidden></pre>
  </div>
</div>
`;

/** The blocks and denials area: locked IPs and refused requests. */
export const LOGS_SECURITY_HTML = /* html */ `
<div class="hd"><h2 class="first">${top("lg.lockH")}</h2><button type="button" id="unlock-all">${top("lg.unlockAll")}</button></div>
<div class="scroll" id="lockouts" data-skel></div>
<div class="hd"><h2>${top("m.deny")}</h2><button type="button" id="clrdeny">${top("lg.denyClear")}</button></div>
<p class="muted">${top("lg.denyLead")}</p>
<div class="scroll" id="denials" data-skel></div>
`;

export const LOGS_SCRIPT = /* js */ `
const kb=(n)=>n<1024?n+' B':(n/1024).toFixed(1)+' KB';
// Today shows the time alone, any other day month.day and time: short enough for one line.
function fmtShort(t){if(!t)return '—';const d=new Date(t),n=new Date();
  const hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return d.toDateString()===n.toDateString()?hm:(d.getMonth()+1)+'.'+d.getDate()+' '+hm;}
let logsSub='xfer';
function logsShowSub(sub){logsSub=sub;
  for(const b of document.querySelectorAll('#logs-subtabs [data-lsub]'))b.setAttribute('aria-selected',String(b.dataset.lsub===sub));
  for(const p of document.querySelectorAll('#tab-logs [data-logs-panel]'))p.hidden=p.dataset.logsPanel!==sub;}
for(const b of document.querySelectorAll('#logs-subtabs [data-lsub]'))b.addEventListener('click',()=>logsShowSub(b.dataset.lsub));
async function loadClientLogs(){
  const d=await api('/admin/api/client-logs');const box=$('cl-list');box.replaceChildren();
  pagedTable('bug-reports',[topText('lg.rank'),topText('lg.user'),topText('lg.console'),topText('lg.sent'),topText('lg.last')],(d.bugReports||[]).map((r,i)=>({...r,rank:i+1})),(r)=>{const tr=el('tr');
    const rk=td();rk.append(el('span',String(r.rank),'rk'+(r.rank<=3?' r'+r.rank:'')));
    const dev=td();dev.append(el('span',r.label||r.prefix,r.label?'':'ip'));if(r.label)dev.append(el('span',r.prefix,'rk-key'));
    tr.append(rk,td(r.owner||'—',r.owner?'':'dim'),dev,td(topFill('lg.times',{n:num(r.count)})),td(ago(r.last)));
    tr.lastChild.title=fmt(r.last);return tr;},topText('lg.bugEmpty'),{label:topText('lg.bugLabel'),placeholder:topText('lg.bugPh'),def:10});
  if(!(d.consoles||[]).length){box.append(el('div',topText('lg.noLogs'),'empty'));return;}
  for(const [i,c] of d.consoles.entries()){const det=el('details');det.open=i===0;
    const sum=el('summary');const name=el('b',c.label||c.prefix);
    // Several consoles can share one name (the auto-registered one): the key's first characters tell them apart.
    if(c.label)name.append(el('small',c.prefix));
    sum.append(name,el('span',topFill('lg.files',{n:c.files.length})));det.append(sum);
    for(const f of c.files){const b=btn('',()=>openLog(c,f,b));b.dataset.noicon='1';const t=el('span',fmtShort(f.at));t.title=fmt(f.at);b.append(t,el('span',kb(f.size),'muted'));det.append(b);}
    box.append(det);}}
async function openLog(c,f,button){
  for(const b of document.querySelectorAll('#cl-list button'))b.setAttribute('aria-pressed',String(b===button));
  const head=$('cl-head');head.hidden=false;$('cl-empty').hidden=true;$('cl-text').hidden=false;
  head.textContent=(c.label?c.label+' · ':'')+c.prefix+' · '+fmt(f.at);
  const r=await fetch('/admin/api/client-logs/'+c.prefix+'/'+encodeURIComponent(f.name));
  $('cl-text').textContent=r.ok?await r.text():topText('lg.readFail');}
if($('cl-refresh'))$('cl-refresh').addEventListener('click',loadClientLogs);
const DENY_KO={
  'rate-limited':'lg.deny.rate-limited',
  'ip-locked':'lg.deny.ip-locked',
  'probe':'lg.deny.probe',
  'bad-credentials':'lg.deny.bad-credentials',
  'no-device-key':'lg.deny.no-device-key',
  'device-not-approved':'lg.deny.device-not-approved',
  'device-bad-access-key':'lg.deny.device-bad-access-key',
  'admin-no-session':'lg.deny.admin-no-session',
  'admin-bad-totp':'lg.deny.admin-bad-totp',
};
function renderSecurity(d){
  const locks=d.lockouts||[];const lockedNow=new Set(locks.map((l)=>l.ip));
  $('lock-count').hidden=!locks.length;$('lock-count').textContent=locks.length;
  $('unlock-all').disabled=!locks.length;
  pagedTable('lockouts',[topText('lg.colIp'),topText('lg.colReason'),topText('lg.colTime'),topText('lg.colUntil'),''],locks,(l)=>{const tr=el('tr');
    tr.append(ipCell(l.ip),td(l.reason||'—'),td(fmt(l.lockedAt)),td(l.until?fmt(l.until):topText('lg.untilManual')));
    const act=td();act.append(tbtn('unlock','lg.release',()=>unlock(l.ip)));tr.append(act);return tr;},topText('lg.lockEmpty'),{label:topText('lg.lockH'),placeholder:topText('lg.lockPh')});
  pagedTable('denials',[topText('lg.colTime'),topText('lg.colReason'),topText('lg.colClient'),topText('lg.colPath'),topText('lg.colIp')],d.denials?.recent||[],(x)=>{const tr=el('tr');
    const w=td(ago(x.at));w.title=fmt(x.at);tr.append(w);
    const dk=DENY_KO[x.reason];const [label,hint]=dk?[topText(dk),topText(dk+'D')]:[x.reason,x.hint||''];
    const r=td();r.append(pill(label,'warn'));if(x.status)r.append(' ',pill(String(x.status)));
    // A lock that has since been lifted is history, not a live block.
    if(x.reason==='ip-locked'&&!lockedNow.has(x.ip))r.append(' ',pill(topText('lg.lifted')));
    if(hint)r.append(el('div',hint,'muted'));tr.append(r);
    tr.append(td([x.version&&'v'+x.version,x.ua].filter(Boolean).join(' · ')||'—'),td(x.path||'—','ip'),ipCell(x.ip));return tr;},topText('lg.denyEmpty'),{label:topText('lg.denyH'),placeholder:topText('lg.denyPh')});}
async function unlock(ip){if(!await ask(topFill('lg.unlockAsk',{ip})))return;
  try{await api('/admin/api/unlock',{method:'POST',body:{ip}});toast(topText('lg.unlocked'));secReload();}catch(err){toast(err.message);}}
if($('unlock-all'))$('unlock-all').addEventListener('click',async()=>{if(!await ask(topText('lg.unlockAllAsk')))return;
  try{const r=await api('/admin/api/unlock',{method:'POST',body:{ip:'all'}});toast(topFill('lg.unlockedN',{n:r.unlocked}));secReload();}catch(err){toast(err.message);}});
if($('clrdeny'))$('clrdeny').addEventListener('click',async()=>{if(!await ask(topText('lg.denyClearAsk'),{danger:true}))return;
  try{await api('/admin/api/denials/clear',{method:'POST',body:{}});secReload();}catch(err){toast(err.message);}});
// The whole dashboard refreshes through loadStats; the security page stands alone.
function secReload(){if(typeof loadStats==='function')loadStats();else loadSecurity();}
async function loadSecurity(){
  try{const d=await api('/admin/api/stats');renderSecurity(d);}catch(err){toast(errText(err));}}
`;
