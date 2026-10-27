/**
 * The admin page's 변환 tab: the NSZ conversion queue like a media server's
 * transcode queue. A header with the state, start/pause and the totals, the
 * running files as cards with their progress, then the list in pages of 50
 * with filter chips and row actions, and the queue's settings. Talks to
 * /admin/api/nsz and saves settings through /admin/api/server-settings.
 *
 * While the tab is open in a visible window and the queue runs, the list is
 * read again every few seconds; only rows that changed are redrawn.
 *
 * Waiting and failed rows can be ticked and run by themselves; with none ticked, the 대기 tab runs
 * every file waiting now and the 실패 tab tries every failed one again (one run button). A done
 * row whose original is still kept says when it goes, the header says how much
 * is kept, and 변환 기록 pages through the conversion log with a name search.
 */

import { box } from "./boxes.js";
import { TOP_WORDS, top } from "./top-i18n.js";

const ko = (key) => `${TOP_WORDS.ko[key]}`;

export const NSZ_HTML = `<section id="tab-nsz" hidden>
  <div class="hd"><h2 class="first">${top("nz.title")}</h2>
    <div class="actions"><button type="button" id="nz-scan">${top("nz.scan")}</button><button type="button" class="primary" id="nz-toggle" disabled>${top("nz.start")}</button></div></div>
  <p class="muted">${top("nz.lede")}</p>
  <div class="nz-head">
    <div class="nz-state"><span class="pill nz-sk" id="nz-state">${top("loading")}</span><span class="muted" id="nz-note"></span></div>
    <div class="bar nz-overall" aria-hidden="true"><i id="nz-overall"></i></div>
    <p class="muted" id="nz-overall-t"></p>
    <div class="nz-kept" id="nz-kept" hidden><span class="muted" id="nz-kept-t"></span><button type="button" id="nz-purge">${top("nz.purge")}</button></div>
  </div>
  <div class="nz-cards" id="nz-cards">${`<div class="card nz-sk"><div class="v">0</div><div class="l">${top("loading")}</div></div>`.repeat(5)}</div>
  <div class="nz-active" id="nz-active"></div>
  <div class="hd nz-tools">
    <div class="subtabs hide-bar" id="nz-filter" role="tablist" data-top-label="nz.filterAria" aria-label="${ko("nz.filterAria")}">
      <button type="button" data-filter="all" role="tab" aria-selected="true">${top("t.total")}</button>
      <button type="button" data-filter="waiting" role="tab" aria-selected="false">${top("pp.waiting")}</button>
      <button type="button" data-filter="running" role="tab" aria-selected="false">${top("nz.running")}</button>
      <button type="button" data-filter="done" role="tab" aria-selected="false">${top("nz.done")}</button>
      <button type="button" data-filter="failed" role="tab" aria-selected="false">${top("ss.fail")}</button>
    </div>
    <div class="actions"><button type="button" id="nz-clear">${top("nz.clearDone")}</button><button type="button" class="primary" id="nz-run-sel" disabled>${top("nz.runPick")}</button></div>
  </div>
  <div class="nz-pick" id="nz-pick"><label class="nz-chk"><input type="checkbox" id="nz-pick-all">${top("t.selectAll")}</label></div>
  <div class="nz-list" id="nz-list">${`<div class="nz-row nz-skel"><i class="nz-ico nz-sk"></i><div class="nz-main"><b class="nz-sk">${top("loading")}</b><span class="nz-sk">${top("lo.colFile")}</span></div></div>`.repeat(6)}</div>
  <div class="nz-pager" id="nz-pager"></div>
  ${box("nsz-log", top("nz.logTitle"), `<p class="muted">${top("t.nz.logDesc")}</p>
  <input type="search" id="nz-log-q" data-top-ph="nz.logPh" placeholder="${ko("nz.logPh")}" data-top-label="nz.logAria" aria-label="${ko("nz.logAria")}">
  <div class="nz-list" id="nz-log"></div><div class="nz-pager" id="nz-log-pager" hidden></div>`)}
  ${box("nsz-settings", top("nz.settingsTitle"), `<p class="muted">${top("nz.settingsLede")}</p>
  <div class="ss-list"><section class="ss-group" id="nz-settings"></section></div>`)}
</section>`;

export const NSZ_CSS = `
.nz-head{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:16px 18px;margin:6px 0 12px;display:grid;gap:10px}
.nz-state{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.nz-state .pill{font-size:var(--fs-sm);padding:4px 12px}
.nz-head p{margin:0}
.nz-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:14px}
.nz-cards .card{padding:14px 16px}.nz-cards .card .v{font-size:var(--fs-2xl)}
.nz-cards .card.bad .v{color:var(--bad)}.nz-cards .card.good .v{color:var(--good)}
.nz-active{display:grid;gap:10px;margin-bottom:6px}
.nz-run{display:grid;grid-template-columns:64px 1fr;gap:14px;align-items:center;background:var(--panel);border:1px solid rgba(var(--accent-rgb),.6);border-radius:var(--r-2xl);padding:14px 16px}
.nz-run .nz-ico{width:64px;height:64px;border-radius:var(--r-xl)}
.nz-run b{font-size:var(--fs-lg);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nz-run .nz-file{color:var(--muted);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nz-run .nz-meta{display:flex;gap:6px 14px;flex-wrap:wrap;color:var(--muted);font-size:var(--fs-xs);margin:6px 0;font-variant-numeric:tabular-nums}
.nz-bar{height:8px;border-radius:var(--r-sm);background:var(--sunk);overflow:hidden;position:relative}
.nz-bar>i{display:block;height:100%;width:0;background:var(--accent);border-radius:var(--r-sm);transition:width .4s}
.nz-bar.ind>i{width:30%;position:absolute;animation:nz-slide 1.4s ease-in-out infinite}
@keyframes nz-slide{from{left:-30%}to{left:100%}}
@keyframes nz-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.nz-sk{color:transparent!important;background:var(--sunk)!important;border-radius:var(--r-sm);animation:nz-pulse 1.4s ease-in-out infinite}
.nz-tools{margin-top:16px}.nz-tools .subtabs{margin:6px 0 12px}
.nz-list{display:grid;gap:8px;margin-top:8px}
.nz-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:12px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:10px 12px}
.nz-row.running{border-color:rgba(var(--accent-rgb),.6)}
.nz-ico{width:40px;height:40px;border-radius:var(--r-md);background:var(--sunk);object-fit:cover;display:block;flex:none}
.nz-main{min-width:0;display:grid;gap:2px}
.nz-main b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-md)}
.nz-main span{color:var(--muted);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nz-main .err{color:var(--bad);white-space:normal;overflow-wrap:anywhere}
.nz-info{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;font-size:var(--fs-xs);font-variant-numeric:tabular-nums;color:var(--muted)}
.nz-acts{display:flex;gap:6px}.nz-acts button{padding:6px 10px}
.nz-skel{grid-template-columns:40px 1fr}.nz-skel .nz-main span{width:60%}
.nz-lead{display:flex;align-items:center;gap:10px}
.nz-lead input,.nz-chk input{width:18px;height:18px;margin:0;accent-color:var(--accent)}.nz-cb-sp{width:18px;flex:none}
/* The select-all box sits right above the rows' boxes (row border 1px + padding 12px). */
.nz-pick{display:flex;align-items:center;margin-top:10px;padding-left:13px}.nz-pick[hidden],.nz-kept[hidden]{display:none}
.nz-chk{display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);cursor:pointer}
.nz-kept{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
#box-nsz-log{margin-top:16px}#nz-log-q{width:100%;margin:4px 0 8px}
.nz-lrow{grid-template-columns:minmax(0,1fr) auto}
.nz-pager{display:flex;align-items:center;justify-content:center;gap:10px;margin:12px 0}
.nz-pager[hidden],#nz-settings .ss-src[hidden]{display:none}
#nz-settings .ss-row:first-child{border-top:0}
@media (max-width:640px){
.nz-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.nz-cards .card:last-child{grid-column:1/-1}
.nz-run{grid-template-columns:48px 1fr}.nz-run .nz-ico{width:48px;height:48px}
.nz-row{grid-template-columns:auto minmax(0,1fr)}.nz-lrow{grid-template-columns:minmax(0,1fr)}.nz-lrow .nz-info{grid-column:1}.nz-info{grid-column:2;justify-content:flex-start}.nz-acts{grid-column:1/-1}.nz-acts button{flex:1}
.nz-tools .actions{width:100%;flex-wrap:nowrap}.nz-tools .actions button{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
}
@media (prefers-reduced-motion:reduce){.nz-sk,.nz-bar.ind>i{animation:none}.nz-bar>i{transition:none}}
`;

export const NSZ_SCRIPT = /* js */ `
var nzFilter='all',nzOffset=0,nzTimer=null,nzSettingsSig='',nzBusy=false,nzSel=new Set(),nzSkew=0,nzLogOff=0,nzLogQ='',nzLogSig='',nzLogTimer=null,nzData=null,nzLogData=null; // var: showTab() can run before this line
const NZ_LIMIT=50,NZ_POLL_MS=3000;
const nzSize=(n)=>{n=Number(n)||0;if(n<1024)return n+' B';const u=['KB','MB','GB','TB'];let i=-1;do{n/=1024;i++;}while(n>=1024&&i<3);return (n>=100?n.toFixed(0):n.toFixed(1))+' '+u[i];};
const nzTime=(ms)=>{const s=Math.max(0,Math.round(ms/1000));const h=Math.floor(s/3600),m=Math.floor(s/60)%60,x=s%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');};
const NZ_STATE={waiting:[()=>topText('pp.waiting'),''],busy:[()=>topText('nz.stLater'),'warn'],running:[()=>topText('nz.stRunning'),'warn'],done:[()=>topText('nz.done'),'on'],failed:[()=>topText('ss.fail'),'off'],skipped:[()=>topText('nz.skipped'),'']};
const NZ_LEVELS=Array.from({length:22},(_,i)=>[String(i+1),()=>topFill(i===17?'ss.nCountDef':'ss.nCount',{n:i+1})]);
const NZ_SETTINGS=[
  ['nszEnabled','bool',()=>topText('nz.f.enabled'),()=>topText('nz.f.enabledD')],
  ['nszAutoQueue','bool',()=>topText('nz.f.autoQueue'),()=>topText('nz.f.autoQueueD')],
  ['nszLevel',NZ_LEVELS,()=>topText('nz.f.level'),()=>topText('nz.f.levelD')],
  ['nszThreads',[1,32,()=>topText('nz.unitCount')],()=>topText('nz.f.threads'),()=>topText('nz.f.threadsD')],
  ['nszWorkers',[['1',()=>topFill('ss.nCountDef',{n:1})],['2',()=>topFill('ss.nCount',{n:2})],['3',()=>topFill('ss.nCount',{n:3})]],()=>topText('nz.f.workers'),()=>topText('nz.f.workersD')],
  ['nszMinSizeMb',[1,1048576,'MB'],()=>topText('nz.f.minSize'),()=>topText('nz.f.minSizeD')],
  ['nszDiskFloorGb',[0,1048576,'GB'],()=>topText('nz.f.diskFloor'),()=>topText('t.nz.floorDesc')],
  ['nszKeepHours',[0,168,()=>topText('nz.unitHours')],()=>topText('nz.f.keepHours'),()=>topText('t.nz.keepHoursDesc')],
  ['nszKeepGb',[0,4096,'GB'],()=>topText('nz.f.keepGb'),()=>topText('t.nz.keepGbDesc')],
  ['nszBlock','bool',()=>topText('nz.f.block'),()=>topText('nz.f.blockD')],
  ['nszXci','bool',()=>topText('nz.f.xci'),()=>topText('nz.f.xciD')],
];
function nzIcon(it,cls){if(!it.titleId){const i=el('i',null,'nz-ico'+(cls?' '+cls:''));return i;}
  const img=el('img',null,'nz-ico'+(cls?' '+cls:''));img.alt='';img.loading='lazy';img.src='/api/library/icon/'+it.titleId+'?size=sm';img.onerror=()=>{img.style.visibility='hidden';};return img;}
const nzName=(it)=>it.name||it.rel.split('/').pop().replace(/\\.(nsp|xci)$/i,'');
const nzFile=(it)=>it.rel.split('/').pop();
const nzPickable=()=>nzFilter==='all'||nzFilter==='waiting'||nzFilter==='failed';
const nzSelectable=(it)=>['waiting','busy','failed','skipped'].includes(it.state);
const nzLeft=(ms)=>{const m=Math.max(0,Math.ceil(ms/60000));const h=Math.floor(m/60);return m<60?topFill('nz.minN',{m}):m%60?topFill('nz.hourMinN',{h,m:m%60}):topFill('nz.hourN',{h});};
const nzKeepLeft=(it)=>it.keepUntil-(Date.now()+nzSkew);
// One run button. Ticked rows go first; with none ticked, 대기 runs the files waiting now and 실패 tries the failed ones again.
// Either way only those run, and files queued meanwhile wait.
let nzTabCount=0,nzOff=false;
const nzRunLabel=()=>nzSel.size?topFill('nz.runSel',{n:num(nzSel.size)}):nzFilter==='waiting'&&nzTabCount?topFill('nz.runWaitingAll',{n:num(nzTabCount)}):nzFilter==='failed'&&nzTabCount?topFill('nz.runFailedAll',{n:num(nzTabCount)}):topText('nz.runPick');
function nzSelUpdate(){const b=$('nz-run-sel');b.textContent=nzRunLabel();b.disabled=nzOff||!(nzSel.size||((nzFilter==='waiting'||nzFilter==='failed')&&nzTabCount));
  const boxes=[...$('nz-list').querySelectorAll('.nz-lead input')];$('nz-pick-all').checked=boxes.length>0&&boxes.every((c)=>c.checked);}
function nzProgress(it){return it.expectedBytes?Math.min(0.97,it.outBytes/it.expectedBytes):null;}
async function nzAct(url,opts,msg){if(nzBusy)return;nzBusy=true;try{const d=await api(url,opts);if(msg)toast(typeof msg==='function'?msg(d):msg);}catch(err){toast(err.message);}finally{nzBusy=false;}loadNsz();}
function nzRowSig(it){return [adminLang,it.state,it.size,it.savedBytes,it.reason,it.name,it.titleId,it.state==='running'?Math.round(it.outBytes/1048576):0,it.keptAt?Math.ceil(nzKeepLeft(it)/60000):''].join('|');}
function nzLead(it){const lead=el('div',null,'nz-lead');
  if(nzPickable()){if(nzSelectable(it)){const c=el('input');c.type='checkbox';c.checked=nzSel.has(it.id);c.setAttribute('aria-label',topFill('nz.pickAria',{name:nzName(it)}));
    c.addEventListener('change',()=>{if(c.checked)nzSel.add(it.id);else nzSel.delete(it.id);nzSelUpdate();});lead.append(c);}else lead.append(el('span',null,'nz-cb-sp'));}
  lead.append(nzIcon(it));return lead;}
function nzRow(it){const r=el('div',null,'nz-row '+it.state);r.dataset.id=it.id;r.dataset.sig=nzRowSig(it);
  const main=el('div',null,'nz-main');main.append(el('b',nzName(it)),el('span',nzFile(it)));
  if(it.reason&&it.state!=='done')main.append(el('span',it.reason,it.state==='failed'?'err':''));
  if(it.keptAt)main.append(el('span',topFill('t.nz.keptLeft',{left:nzLeft(nzKeepLeft(it))})));
  const info=el('div',null,'nz-info');const [label,kind]=NZ_STATE[it.state]||[it.state,''];info.append(pill(nzWord(label),kind));
  info.append(el('span',nzSize(it.size)));
  if(it.state==='done')info.append(el('span','-'+nzSize(it.savedBytes)+' ('+Math.round(it.savedBytes/it.size*100)+'%)'));
  if(it.state==='running'){const p=nzProgress(it);info.append(el('span',p==null?topFill('nz.wrote',{size:nzSize(it.outBytes)}):Math.round(p*100)+'%'));}
  const acts=el('div',null,'nz-acts');
  if(it.state==='waiting'||it.state==='busy')acts.append(tbtn('top','nz.top',()=>nzAct('/admin/api/nsz/items/'+it.id+'/top',{method:'POST',body:{}},topText('nz.movedTop'))));
  if(it.state==='failed'||it.state==='skipped'||it.state==='busy')acts.append(tbtn('retry','nz.retry',()=>nzAct('/admin/api/nsz/items/'+it.id+'/retry',{method:'POST',body:{}},topText('nz.requeued'))));
  acts.append(tbtn('remove','fp.remove',async()=>{if(it.state==='running'&&!await ask(topFill('nz.askStopRemove',{name:nzName(it)}),{danger:true}))return;
    if(it.keptAt&&!await ask(topFill('t.nz.askRemoveKept',{name:nzName(it)}),{danger:true}))return;
    nzAct('/admin/api/nsz/items/'+it.id,{method:'DELETE'},topText('nz.removed'));},'danger'));
  r.append(nzLead(it),main,info,acts);return r;}
/** Puts the rows in order, keeping the nodes whose row did not change. */
function nzPatch(list,items){const old=new Map([...list.children].filter((c)=>c.dataset.id).map((c)=>[c.dataset.id,c]));
  for(const c of [...list.children])if(!c.dataset.id)c.remove();
  let at=list.firstChild;
  for(const it of items){let n=old.get(it.id);old.delete(it.id);
    if(!n||n.dataset.sig!==nzRowSig(it)){const fresh=nzRow(it);if(n){if(n===at)at=fresh;n.replaceWith(fresh);}n=fresh;}
    if(n===at)at=at.nextSibling;else list.insertBefore(n,at);}
  for(const n of old.values())n.remove();
  $('nz-pick').hidden=!nzPickable()||!items.some(nzSelectable);$('nz-run-sel').hidden=$('nz-pick').hidden;nzSelUpdate();
  if(!items.length)list.append(el('div',nzFilter==='all'?topText('nz.empty'):topText('nz.noneInFilter'),'empty'));}
function nzRunCard(it){const c=el('article',null,'nz-run');c.dataset.id=it.id;
  const body=el('div');body.style.minWidth='0';const meta=el('div',null,'nz-meta');const bar=el('div',null,'nz-bar');bar.append(el('i'));
  body.append(el('b',nzName(it)),el('div',nzFile(it),'nz-file'),meta,bar);c.append(nzIcon(it),body);return c;}
function nzRenderActive(active){const box=$('nz-active');const keep=new Map([...box.children].map((c)=>[c.dataset.id,c]));
  for(const it of active){let c=keep.get(it.id);keep.delete(it.id);if(!c){c=nzRunCard(it);box.append(c);}
    const p=nzProgress(it);const bar=c.querySelector('.nz-bar');bar.classList.toggle('ind',p==null);bar.firstChild.style.width=p==null?'':Math.round(p*100)+'%';
    const original=el('span');original.append(el('span',topText('rpt.original')),document.createTextNode(' '+nzSize(it.size)));
    c.querySelector('.nz-meta').replaceChildren(original,el('span',topFill('nz.elapsed',{t:nzTime(Date.now()-it.startedAt)})),
      el('span',p==null?topFill('nz.wrote',{size:nzSize(it.outBytes)}):topFill('nz.pctEta',{p:Math.round(p*100),size:nzSize(it.expectedBytes)})));}
  for(const c of keep.values())c.remove();}
function nzCards(t){const cards=[[topText('pp.waiting'),num(t.waiting+t.busy),nzSize(t.waitingBytes)],[topText('nz.running'),num(t.running),''],[topText('nz.done'),num(t.done),'',t.done?'good':''],[topText('ss.fail'),num(t.failed+t.skipped),'',t.failed?'bad':''],[topText('nz.savedSpace'),nzSize(t.savedBytes),topFill('nz.convertedN',{n:num(t.converted)}),t.savedBytes?'good':'']];
  $('nz-cards').replaceChildren(...cards.map(([l,v,sub,cls])=>{const c=el('div',null,'card'+(cls?' '+cls:''));c.append(el('div',v,'v'),el('div',l+(sub?' · '+sub:''),'l'));return c;}));}
function nzHeader(d){const st=$('nz-state');st.classList.remove('nz-sk');
  const [label,kind]=d.status==='off'?[topText('ov.off'),'']:d.status==='running'?[()=>topText('nz.stRun'),'on']:d.status==='idle'?[()=>topText('nz.stIdle'),'']:[()=>topText('nz.pause'),'warn'];st.textContent=nzWord(label);st.className='pill'+(kind?' '+kind:'');
  const tb=d.trash&&d.trash.bytes||0,kb=d.kept&&d.kept.bytes||0;
  const space={trash:nzSize(tb),kept:nzSize(kb)};
  const notes={disk:topText('t.nz.diskStop')+' '+topFill(tb&&kb?'t.nz.diskBoth':tb?'t.nz.diskTrash':kb?'t.nz.diskKept':'t.nz.diskNone',space),failures:()=>topText('nz.noteFailures')};
  let note=d.status==='off'?topText('nz.noteOff'):d.pausedReason?nzWord(notes[d.pausedReason])||'':d.status==='running'?(d.waitingFor==='downloads'?topText('nz.noteWaiting'):d.active.length?'':topText('nz.noteBusyFiles')):d.status==='idle'?((d.totals.waiting+d.totals.busy?topText('nz.noteStart'):topText('nz.noteIdle'))+(d.autoQueue?topText('nz.noteAuto'):'')):topText('nz.noteStart');
  if(d.only&&d.status==='running')note=topFill('nz.onlyN',{n:num(d.only)})+' '+note;
  if(!d.tool)note=topText('nz.noTool')+' '+note;$('nz-note').textContent=note;
  const tg=$('nz-toggle');tg.disabled=d.status==='off';tg.textContent=d.status==='running'?topText('nz.pause'):topText('nz.start');tg.dataset.running=String(d.status==='running');tg.className=d.status==='running'?'':'primary';
  const t=d.totals,doneN=t.done+t.failed+t.skipped,all=doneN+t.waiting+t.busy+t.running;
  nzTabCount=nzFilter==='waiting'?t.waiting+t.busy:nzFilter==='failed'?t.failed+t.skipped:0;nzOff=d.status==='off';nzSelUpdate();
  $('nz-overall').style.width=all?Math.round(doneN/all*100)+'%':'0';
  const k=d.kept||{};$('nz-kept').hidden=!k.count;
  if(k.count)$('nz-kept-t').textContent=topFill('nz.keptLine',{n:num(k.count),size:nzSize(k.bytes)})+(k.capBytes?topFill('nz.keptCap',{size:nzSize(k.capBytes)}):'')+(k.nextAt?' · '+topFill('t.nz.oldest',{left:nzLeft(k.nextAt-k.now)}):'');
  $('nz-overall-t').textContent=all?topFill('nz.overallLine',{all:num(all),done:num(doneN),size:nzSize(t.waitingBytes)}):topText('nz.queueEmpty');}
function nzPager(d){const p=$('nz-pager');p.hidden=d.total<=d.limit;if(p.hidden){p.replaceChildren();return;}
  const page=Math.floor(d.offset/d.limit)+1,pages=Math.ceil(d.total/d.limit);
  const prev=btn(topText('fp.prev'),()=>{nzOffset=Math.max(0,nzOffset-NZ_LIMIT);loadNsz();});prev.disabled=page<=1;
  const next=btn(topText('fp.next'),()=>{nzOffset+=NZ_LIMIT;loadNsz();});next.disabled=page>=pages;
  p.replaceChildren(prev,el('span',topFill('nz.pagerLine',{page,pages,n:num(d.total)}),'muted'),next);}
// A label is text or, for a translated one, a function giving it in the page's language.
const nzWord=(w)=>typeof w==='function'?w():w;
const NZ_EVENT={converted:[()=>topText('s.nsz'),'on'],'original-deleted':[()=>topText('t.nz.evOrig'),''],'original-unverified':[()=>topText('t.nz.evOrig'),''],failed:[()=>topText('ss.fail'),'off'],restored:[()=>topText('nz.restored'),'']}; // restored: lines written before 되돌리기 was dropped
const NZ_WHY={age:()=>topText('nz.whyAge'),cap:()=>topText('nz.whyCap'),space:()=>topText('nz.whySpace'),manual:()=>topText('t.nz.whyManual'),removed:()=>topText('nz.whyRemoved'),cleared:()=>topText('t.nz.whyCleared'),missing:()=>topText('nz.whyMissing'),ticketless:()=>topText('t.nz.whyTicketless')};
function nzLogRow(e){const r=el('div',null,'nz-row nz-lrow');const main=el('div',null,'nz-main');
  main.append(el('b',e.name||String(e.rel||'').split('/').pop()),el('span',e.rel||''));
  if(e.reason)main.append(el('span',nzWord(NZ_WHY[e.reason])||e.reason,e.event==='failed'?'err':''));
  const info=el('div',null,'nz-info');const [label,kind]=NZ_EVENT[e.event]||[e.event,''];info.append(pill(nzWord(label),kind));
  if(e.event==='converted'&&e.sizeBefore&&e.sizeAfter)info.append(el('span',nzSize(e.sizeBefore)+' → '+nzSize(e.sizeAfter)+' (-'+Math.round((1-e.sizeAfter/e.sizeBefore)*100)+'%)'));
  else if(e.sizeBefore)info.append(el('span',nzSize(e.sizeBefore)));
  info.append(el('span',fmt(e.at)));r.append(main,info);return r;}
async function loadNszLog(){let d;try{d=await api('/admin/api/nsz/log?offset='+nzLogOff+'&limit='+NZ_LIMIT+'&q='+encodeURIComponent(nzLogQ));}catch(err){toast(err.message);return;}
  nzLogData=d;nzRenderLog(d);}
function nzRenderLog(d){
  $('nz-log').replaceChildren(...d.items.map(nzLogRow));
  if(!d.items.length)$('nz-log').append(el('div',nzLogQ?topText('nz.logNoMatch'):topText('nz.logEmpty'),'empty'));
  const p=$('nz-log-pager');p.hidden=d.total<=d.limit;if(p.hidden){p.replaceChildren();return;}
  const page=Math.floor(d.offset/d.limit)+1,pages=Math.ceil(d.total/d.limit);
  const prev=btn(topText('fp.prev'),()=>{nzLogOff=Math.max(0,nzLogOff-NZ_LIMIT);loadNszLog();});prev.disabled=page<=1;
  const next=btn(topText('fp.next'),()=>{nzLogOff+=NZ_LIMIT;loadNszLog();});next.disabled=page>=pages;
  p.replaceChildren(prev,el('span',topFill('nz.pagerLine',{page,pages,n:num(d.total)}),'muted'),next);}
async function nzSave(key,value){try{await api('/admin/api/server-settings',{method:'POST',body:{[key]:value}});toast(topText('pp.saved'));}catch(err){toast(err.message);nzSettingsSig='';}loadNsz();}
function nzControl(key,kind,s){
  if(kind==='bool'){const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=s.value===true;b.setAttribute('aria-label',key);
    b.addEventListener('change',()=>nzSave(key,b.checked));w.append(b,el('span'));return w;}
  if(typeof kind[0]==='number'){const [min,max,unit]=kind;const i=el('input');i.type='number';i.min=String(min);i.max=String(max);i.step='1';i.inputMode='numeric';i.value=String(s.value);i.setAttribute('aria-label',key);
    i.addEventListener('change',()=>{const v=Number(i.value);if(!Number.isInteger(v)||v<min||v>max){toast(topFill('nz.intRange',{min,max}));i.value=String(s.value);return;}nzSave(key,v);});
    const w=el('span');w.style.cssText='display:flex;align-items:center;gap:8px;width:100%';w.append(i,el('span',nzWord(unit),'muted'));return w;}
  const sel=el('select');sel.setAttribute('aria-label',key);for(const [v,t] of kind){const o=el('option',nzWord(t));o.value=v;sel.append(o);}sel.value=String(s.value);
  sel.addEventListener('change',()=>nzSave(key,Number(sel.value)));return sel;}
/** Builds the rows once; later reads update each row's value and note, never the control being edited. */
function nzRenderSettings(settings){const box=$('nz-settings');const sig=JSON.stringify(settings);if(sig===nzSettingsSig)return;nzSettingsSig=sig;
  for(const [key,kind,label,desc] of NZ_SETTINGS){const s=settings[key];if(!s)continue;
    let r=box.querySelector('.ss-row[data-key="'+key+'"]');
    if(!r){r=el('div',null,'ss-row');r.dataset.key=key;const t=el('div');t.append(el('b',nzWord(label)),el('p',nzWord(desc)));
      const c=el('div',null,'ss-ctl');c.append(nzControl(key,kind,s));r.append(t,c,el('div',null,'ss-src'));box.append(r);}
    const ctl=r.querySelector('input,select');
    if(ctl&&ctl!==document.activeElement){if(ctl.type==='checkbox')ctl.checked=s.value===true;else ctl.value=String(s.value);}
    const src=r.querySelector('.ss-src');src.replaceChildren();src.hidden=s.source!=='saved';
    if(s.source==='saved'){src.append(topText('nz.srcHere'));src.append(tbtn('restore','ss.srcRevertBtn',()=>nzSave(key,null)));}}}
const nzVisible=()=>location.hash==='#nsz'&&document.visibilityState==='visible';
async function loadNsz(){clearTimeout(nzTimer);nzTimer=null;let d;
  try{d=await api('/admin/api/nsz?filter='+nzFilter+'&offset='+nzOffset+'&limit='+NZ_LIMIT);}catch(err){toast(err.message);return;}
  if(d.offset>0&&d.offset>=d.total){nzOffset=Math.max(0,Math.floor((d.total-1)/NZ_LIMIT)*NZ_LIMIT);return loadNsz();}
  if(d.kept)nzSkew=d.kept.now-Date.now();
  for(const it of d.items)if(!nzSelectable(it))nzSel.delete(it.id);
  nzData=d;nzHeader(d);nzCards(d.totals);nzRenderActive(d.active);nzPatch($('nz-list'),d.items);nzPager(d);nzRenderSettings(d.settings);
  // The log is read again only when something finished or was deleted.
  const t=d.totals,logSig=[t.done,t.failed,t.skipped,t.converted,d.kept&&d.kept.count,d.total].join('|');if(logSig!==nzLogSig){nzLogSig=logSig;loadNszLog();}
  // Read again only while someone is looking and the queue has something going; with the
  // activity socket up, its conversion job reads again instead (activity-panel.js).
  // Between files (a retry wait, the start delay) there is no job to follow, so the timer runs then too.
  if(nzVisible()&&d.status==='running'&&!nzTimer&&(!actLive||!(d.active||[]).length))nzTimer=setTimeout(loadNsz,NZ_POLL_MS);}
function nzRelabel(){if(!nzData)return;
  nzHeader(nzData);nzCards(nzData.totals);nzRenderActive(nzData.active);nzPatch($('nz-list'),nzData.items);nzPager(nzData);
  if(nzLogData)nzRenderLog(nzLogData);}
document.addEventListener('visibilitychange',()=>{if(nzVisible())loadNsz();});
$('nz-toggle').addEventListener('click',()=>{const on=$('nz-toggle').dataset.running==='true';
  nzAct('/admin/api/nsz/'+(on?'pause':'start'),{method:'POST',body:{}},on?topText('nz.paused'):topText('nz.started'));});
$('nz-scan').addEventListener('click',()=>nzAct('/admin/api/nsz/scan',{method:'POST',body:{}},(d)=>d.added?topFill('nz.scanAdded',{n:d.added,size:nzSize(d.bytes)}):topText('nz.scanNone')));
$('nz-clear').addEventListener('click',()=>nzAct('/admin/api/nsz/clear-finished',{method:'POST',body:{}},(d)=>d.removed?topFill('nz.clearedN',{n:d.removed}):topText('nz.clearNone')));
$('nz-pick-all').addEventListener('change',()=>{const on=$('nz-pick-all').checked;
  for(const c of $('nz-list').querySelectorAll('.nz-lead input')){c.checked=on;const id=c.closest('.nz-row').dataset.id;if(on)nzSel.add(id);else nzSel.delete(id);}nzSelUpdate();});
$('nz-run-sel').addEventListener('click',async()=>{const ids=[...nzSel];
  if(ids.length)return nzAct('/admin/api/nsz/run-selected',{method:'POST',body:{ids}},(d)=>{nzSel.clear();return topFill('nz.runSelGo',{n:d.count});});
  const f=nzFilter,word=f==='failed'?topText('nz.wordFailed'):topText('nz.wordWaiting');
  if(!await ask(topFill('nz.askRunFilter',{word,n:num(nzTabCount)})))return;
  nzAct('/admin/api/nsz/run-filter',{method:'POST',body:{filter:f}},(d)=>topFill('nz.runFilterGo',{word,n:d.count}));});
$('nz-purge').addEventListener('click',async()=>{if(!await ask(topText('t.nz.askPurge'),{danger:true}))return;
  nzAct('/admin/api/nsz/purge-kept',{method:'POST',body:{}},(d)=>topFill('t.nz.purged',{n:d.removed,size:nzSize(d.bytes)}));});
$('nz-log-q').addEventListener('input',()=>{clearTimeout(nzLogTimer);nzLogTimer=setTimeout(()=>{nzLogQ=$('nz-log-q').value.trim();nzLogOff=0;loadNszLog();},250);});
$('nz-filter').addEventListener('click',(e)=>{const b=e.target.closest('[data-filter]');if(!b)return;nzFilter=b.dataset.filter;nzOffset=0;nzSel.clear();
  for(const x of $('nz-filter').querySelectorAll('button'))x.setAttribute('aria-selected',String(x===b));
  // Until the new rows arrive there is nothing to pick or run: a 모두 선택 click would untick itself and the run button would ask with the old tab's count.
  $('nz-list').replaceChildren();$('nz-pick').hidden=true;nzTabCount=0;nzSelUpdate();loadNsz();});
`;
