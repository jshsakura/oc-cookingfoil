import { top, topLabel } from "./top-i18n.js";
/**
 * The admin page's 임시 공유 tab: what signed-in users left in the share inbox,
 * newest first, with their files to download, 정리함 to set one aside and
 * delete. Talks to /admin/api/inbox.
 */

export const INBOX_HTML = `<section id="tab-inbox" hidden>
  <div class="hd"><h2 class="first" data-top="m.inbox">${top("m.inbox")}</h2>
    <div class="seg" id="ib-show" role="group" ${topLabel("ov.go")}>
      <button type="button" data-show="open" aria-pressed="true" class="active" data-top="ib.open">${top("ib.open")}</button>
      <button type="button" data-show="done" aria-pressed="false" data-top="ib.done">${top("ib.done")}</button>
      <button type="button" data-show="all" aria-pressed="false" data-top="t.total">${top("t.total")}</button>
    </div></div>
  <p class="muted">${top("ib.lead")}</p>
  <p class="muted" id="ib-usage"></p>
  <div class="ib-list" id="ib-list"></div>
</section>`;

export const INBOX_CSS = `
#tab-inbox .hd .seg{margin:22px 0 10px}
.ib-list{display:grid;gap:12px}
.ib-entry{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:14px 16px;display:grid;gap:10px;min-width:0}
.ib-entry.done{opacity:.7}
.ib-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.ib-head b{font-size:var(--fs-md)}
.ib-entry a{color:var(--text)}
.ib-entry .row-actions{display:flex;gap:6px;flex-wrap:wrap}
.ib-memo{margin:0;white-space:pre-line;overflow-wrap:anywhere;font-size:var(--fs-md);line-height:1.6}
.ib-entry ul{margin:0;padding:0;list-style:none;display:grid;gap:4px}
.ib-entry li{display:flex;justify-content:space-between;gap:12px;font-size:var(--fs-sm);min-width:0}
.ib-entry li a{overflow-wrap:anywhere;min-width:0}
.ib-entry li span{color:var(--muted);flex:none;font-variant-numeric:tabular-nums}
.ib-entry h4{margin:0 0 4px;font-size:var(--fs-xs);color:var(--muted);font-weight:700}
`;

export const INBOX_SCRIPT = /* js */ `
var ibShow='open'; // var: the first showTab() can run before this line
const ibSize=(n)=>{if(!n)return '0 B';const u=['B','KB','MB','GB','TB'];const i=Math.min(4,Math.floor(Math.log(n)/Math.log(1024)));return i?(n/1024**i).toFixed(1)+' '+u[i]:n+' B';};
function ibCard(e){const card=el('article',null,'ib-entry'+(e.done?' done':''));card.dataset.id=e.id;
  const head=el('div',null,'ib-head');const when=el('span',ago(Date.parse(e.at)),'muted');when.title=fmt(Date.parse(e.at));
  head.append(el('b',e.user),when,pill(topFill('ib.filesN',{n:e.files.length,size:ibSize(e.bytes)})));if(e.done)head.append(pill(topText('ib.done'),'on'));card.append(head);
  if(e.memo)card.append(el('p',e.memo,'ib-memo'));
  if(e.links.length){const box=el('div');box.append(el('h4',topText('ib.links')));const ul=el('ul');
    for(const u of e.links){const li=el('li');const a=el('a',u);a.href=u;a.target='_blank';a.rel='noopener noreferrer';li.append(a);ul.append(li);}box.append(ul);card.append(box);}
  if(e.files.length){const box=el('div');box.append(el('h4',topText('lo.colFile')));const ul=el('ul');
    for(const f of e.files){const li=el('li');const a=el('a',f.name);a.href=f.url;a.download='';li.append(a,el('span',ibSize(f.size)));ul.append(li);}box.append(ul);card.append(box);}
  const acts=el('div',null,'row-actions');
  acts.append(btn(topText(e.done?'ib.reopenBtn':'ib.doneBtn'),async()=>{try{await api('/admin/api/inbox/'+e.id+'/done',{method:'POST',body:{done:!e.done}});
    toast(topText(e.done?'ib.reopened':'ib.moved'));loadInbox();}catch(err){toast(err.message);}}));
  acts.append(tbtn('delete','pp.delete',async()=>{if(!await ask(topFill('ib.deleteAsk',{user:e.user}),{danger:true}))return;
    try{await api('/admin/api/inbox/'+e.id,{method:'DELETE'});toast(topText('pp.deleted'));loadInbox();}catch(err){toast(err.message);}},'danger'));
  card.append(acts);return card;}
async function loadInbox(){let d;try{d=await api('/admin/api/inbox?show='+ibShow);}catch(err){toast(err.message);return;}
  const list=$('ib-list');
  list.replaceChildren(...(d.entries.length?d.entries.map(ibCard):[el('div',topText(ibShow==='done'?'ib.emptyDone':'ib.none'),'empty')]));
  $('ib-usage').textContent=topFill(d.enabled?'ib.usageOn':'ib.usageOff',{used:ibSize(d.usage),quota:ibSize(d.quota),max:ibSize(d.maxBytes)});
  if(ibShow==='open')ibBadge(d.entries.length);}
(window.admRelabelHooks=window.admRelabelHooks||[]).push(()=>{if($('ib-list'))loadInbox();});
function ibBadge(n){const c=$('inbox-count');c.hidden=!n;c.textContent=n;}
$('ib-show').addEventListener('click',(e)=>{const b=e.target.closest('[data-show]');if(!b)return;ibShow=b.dataset.show;
  for(const x of $('ib-show').querySelectorAll('button')){const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));}loadInbox();});
api('/admin/api/inbox?show=open').then((d)=>ibBadge(d.entries.length),()=>{});
`;
