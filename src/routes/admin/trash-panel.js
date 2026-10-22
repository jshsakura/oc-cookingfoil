/**
 * The admin page's 휴지통 tab: everything the server moved into a library
 * folder's trash, as cards with what it was, where it came from, when, why and
 * by whom, its size and age; the totals per folder; restoring one or many; and
 * emptying, the one permanent delete, after the person types a word. Below it
 * the operations journal, where a move between library folders can be undone.
 * Talks to /admin/api/trash (trash-api.js). Words come from trash-words.js in
 * the language the top area uses.
 */

import { box } from "./boxes.js";
import { top } from "./top-i18n.js";

export const TRASH_HTML = `<section id="tab-trash" hidden>
  <div class="hd"><h2 class="first">${top("s.trash")}</h2>
    <div class="actions"><button type="button" class="danger" id="tr-empty-all">${top("t.emptyAll")}</button></div></div>
  <p class="muted">${top("t.lead")}</p>
  <p class="tr-old" id="tr-old" hidden></p>
  <div class="tr-cards" id="tr-cards"></div>
  <div class="hd tr-tools">
    <label class="tr-chk"><input type="checkbox" id="tr-pick-all">${top("t.selectAll")}</label>
    <div class="actions"><button type="button" id="tr-restore-sel" disabled>${top("t.restoreSel")}</button><button type="button" class="danger" id="tr-empty-sel" disabled>${top("t.emptySel")}</button></div>
  </div>
  <div class="tr-list" id="tr-list"></div>
  ${box("trash-journal", top("t.jTitle"), `<p class="muted">${top("t.jLead")}</p><div class="tr-list" id="tr-journal"></div>`)}
</section>`;

export const TRASH_CSS = `
.tr-old{background:rgba(var(--accent-rgb),.1);border:1px solid rgba(var(--accent-rgb),.4);border-radius:14px;padding:10px 14px;margin:6px 0 12px}
.tr-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:8px 0 14px}
.tr-cards .card{padding:12px 14px}.tr-cards .card .v{font-size:20px}
.tr-tools{align-items:center;margin-bottom:8px}
.tr-chk{display:inline-flex;align-items:center;gap:8px;font-weight:600}
.tr-list{display:grid;gap:10px}
.tr-row{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:start;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px 14px}
.tr-row.old{border-color:rgba(var(--accent-rgb),.6)}
.tr-main{display:grid;gap:3px;min-width:0}
.tr-main b{overflow-wrap:anywhere}
.tr-main span{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.tr-main .err{color:var(--bad)}
.tr-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13px}
.tr-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
@media (max-width:640px){.tr-row{grid-template-columns:auto 1fr}.tr-act{grid-column:1/-1;justify-content:flex-start}}
`;

export const TRASH_SCRIPT = /* js */ `
const trT=(k,v)=>{let s=topText('t.'+k);if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
const trSize=(n)=>{n=Number(n)||0;if(n<1024)return n+' B';const u=['KB','MB','GB','TB'];let i=-1;do{n/=1024;i++;}while(n>=1024&&i<3);return (n>=100?n.toFixed(0):n.toFixed(1))+' '+u[i];};
let trData=null,trJournal=null;const trSel=new Set();
const trRoot=(k)=>topWords[adminLang]['t.root.'+k]?trT('root.'+k):k;
const trAction=(a)=>{const k=String(a||'').startsWith('nsz-kept')?'nsz-kept':a;return topWords.ko['t.a.'+k]?trT('a.'+k):trT('a.other');};
const trBy=(b)=>!b?trT('byNone'):b.type==='token'?trT('byToken',{name:b.name}):b.type==='job'?trT('byJob',{name:b.name}):trT('byAdmin',{name:b.name});
const trWhen=(t)=>t?new Date(t).toLocaleString(adminLang==='ko'?'ko-KR':adminLang):'';
function trSelUpdate(){const n=trSel.size;$('tr-restore-sel').disabled=!n;$('tr-empty-sel').disabled=!n;
  const all=trData?trData.items.length:0;$('tr-pick-all').checked=!!all&&n===all;$('tr-empty-all').disabled=!all;}
function trRow(e){const r=el('div',null,'tr-row'+(trData&&e.ageDays>=trData.noticeDays?' old':''));r.dataset.id=e.id;
  const c=el('input');c.type='checkbox';c.checked=trSel.has(e.id);c.setAttribute('aria-label',trT('pick',{name:e.name||e.items[0]?.rel||e.entry}));
  c.addEventListener('change',()=>{if(c.checked)trSel.add(e.id);else trSel.delete(e.id);trSelUpdate();});
  const main=el('div',null,'tr-main');main.append(el('b',e.name||String(e.items[0]?.rel||'').split('/').pop()||e.entry));
  for(const it of e.items.slice(0,5))main.append(el('span',trT('from',{path:trRoot(e.root)+' / '+it.rel})));
  if(e.items.length>5)main.append(el('span','+'+(e.items.length-5)));
  const meta=el('div',null,'tr-meta');meta.append(pill(trAction(e.action)),pill(trRoot(e.root)),el('span',trSize(e.size)),el('span',trT('age',{n:e.ageDays})),el('span',trT('at',{when:trWhen(e.trashedAt)})),el('span',trBy(e.by)));
  main.append(meta);
  if(e.missing)main.append(el('span',trT('missing',{n:e.missing}),'err'));
  const act=el('div',null,'tr-act');act.append(btn(trT('restore'),()=>trRestore([e.id])),btn(trT('emptyOne'),()=>trEmpty([e.id]),'danger'));
  r.append(c,main,act);return r;}
function trCards(d){const cards=[[trT('total'),trSize(d.total.bytes),trT('count',{n:num(d.total.count)})],
    ...Object.entries(d.roots).map(([k,v])=>[trRoot(k),trSize(v.bytes),trT('count',{n:num(v.count)})])];
  $('tr-cards').replaceChildren(...cards.map(([l,v,sub])=>{const c=el('div',null,'card');c.append(el('div',v,'v'),el('div',l+' · '+sub,'l'));return c;}));}
function trRender(){if(!trData)return;const d=trData;trCards(d);
  const o=$('tr-old');o.hidden=!d.old.count;if(d.old.count)o.textContent=trT('old',{days:d.noticeDays,n:num(d.old.count),size:trSize(d.old.bytes)});
  for(const id of [...trSel])if(!d.items.some((e)=>e.id===id))trSel.delete(id);
  $('tr-list').replaceChildren(...(d.items.length?d.items.map(trRow):[el('p',trT('none'),'muted')]));trSelUpdate();trJournalRender();}
function trJournalRender(){if(!trJournal)return;const box=$('tr-journal');
  if(!trJournal.items.length){box.replaceChildren(el('p',trT('jNone'),'muted'));return;}
  box.replaceChildren(...trJournal.items.map((o)=>{const r=el('div',null,'tr-row');const main=el('div',null,'tr-main');
    main.append(el('b',topWords.ko['t.j.'+o.action]?trT('j.'+o.action):o.action),el('span',trRoot(o.fromRoot)+' / '+o.from+'  →  '+trRoot(o.toRoot)+' / '+o.to));
    const meta=el('div',null,'tr-meta');meta.append(el('span',trWhen(o.at)),el('span',trBy(o.by)));
    if(!o.undoable&&o.reason)meta.append(pill(topWords.ko['t.r.'+o.reason]?trT('r.'+o.reason):o.reason));main.append(meta);
    const act=el('div',null,'tr-act');if(o.undoable)act.append(btn(trT('undo'),()=>trUndo(o)));
    r.append(el('span'),main,act);return r;}));}
async function loadTrash(){try{[trData,trJournal]=await Promise.all([api('/admin/api/trash'),api('/admin/api/trash/journal?limit=100')]);trRender();}
  catch(err){if(err.message!=='session')toast(trT('loadFail',{err:err.message}));}}
async function trRestore(ids){if(!ids.length)return toast(trT('pickFirst'));
  try{const d=await api('/admin/api/trash/restore',{method:'POST',body:{ids}});ids.forEach((id)=>trSel.delete(id));
    const renamed=d.restored.flatMap((r)=>r.renamed||[]).map((x)=>x.to.split('/').pop());
    let msg=trT('restored',{n:d.restored.length});if(renamed.length)msg+=' '+trT('renamed',{names:renamed.join(', ')});
    if(d.failed.length)msg+=' '+trT('failed',{n:d.failed.length,why:d.failed[0].error});toast(msg);}
  catch(err){toast(err.message);}loadTrash();}
async function trEmpty(ids){const all=ids==='all';const picked=all?trData.items:trData.items.filter((e)=>ids.includes(e.id));
  if(!picked.length)return toast(trT('pickFirst'));
  const word=trT('word');const typed=await askText(trT('askEmpty',{n:num(picked.length),size:trSize(picked.reduce((n,e)=>n+e.size,0)),word}),'');
  if(typed==null)return;if(typed.trim()!==word)return toast(trT('typedWrong'));
  try{const d=await api('/admin/api/trash/empty',{method:'POST',body:all?{all:true,confirm:'empty'}:{ids,confirm:'empty'}});
    picked.forEach((e)=>trSel.delete(e.id));toast(trT('emptied',{n:num(d.removed),size:trSize(d.bytes)}));}
  catch(err){toast(err.message);}loadTrash();}
async function trUndo(o){if(!await ask(trT('undoAsk',{to:o.to,from:o.from})))return;
  try{await api('/admin/api/trash/undo',{method:'POST',body:{id:o.id}});toast(trT('undoneToast'));}catch(err){toast(err.message);}loadTrash();}
$('tr-pick-all').addEventListener('change',()=>{const on=$('tr-pick-all').checked;trSel.clear();if(on&&trData)for(const e of trData.items)trSel.add(e.id);
  for(const c of $('tr-list').querySelectorAll('.tr-row>input'))c.checked=on;trSelUpdate();});
$('tr-restore-sel').addEventListener('click',()=>trRestore([...trSel]));
$('tr-empty-sel').addEventListener('click',()=>trEmpty([...trSel]));
$('tr-empty-all').addEventListener('click',()=>trEmpty('all'));
`;
