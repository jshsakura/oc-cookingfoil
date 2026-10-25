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
import { top } from "./top-i18n.js";

export const NSZ_HTML = `<section id="tab-nsz" hidden>
  <div class="hd"><h2 class="first">NSZ 변환</h2>
    <div class="actions"><button type="button" id="nz-scan">라이브러리 검사</button><button type="button" class="primary" id="nz-toggle" disabled>시작</button></div></div>
  <p class="muted">게임 폴더의 .nsp 를 .nsz 로 압축하고 검증한 뒤 원본을 교체합니다. 콘솔이 다운로드하는 동안에는 새 파일을 시작하지 않고, 다운로드가 30초 동안 없으면 이어서 합니다.</p>
  <div class="nz-head">
    <div class="nz-state"><span class="pill nz-sk" id="nz-state">불러오고 있습니다</span><span class="muted" id="nz-note"></span></div>
    <div class="bar nz-overall" aria-hidden="true"><i id="nz-overall"></i></div>
    <p class="muted" id="nz-overall-t"></p>
    <div class="nz-kept" id="nz-kept" hidden><span class="muted" id="nz-kept-t"></span><button type="button" id="nz-purge">지금 비우기</button></div>
  </div>
  <div class="nz-cards" id="nz-cards">${'<div class="card nz-sk"><div class="v">0</div><div class="l">불러오고 있습니다</div></div>'.repeat(5)}</div>
  <div class="nz-active" id="nz-active"></div>
  <div class="hd nz-tools">
    <div class="seg" id="nz-filter" role="group" aria-label="보기">
      <button type="button" data-filter="all" class="active" aria-pressed="true">전체</button>
      <button type="button" data-filter="waiting" aria-pressed="false">대기</button>
      <button type="button" data-filter="running" aria-pressed="false">진행</button>
      <button type="button" data-filter="done" aria-pressed="false">완료</button>
      <button type="button" data-filter="failed" aria-pressed="false">실패</button>
    </div>
    <div class="actions"><button type="button" id="nz-clear">완료건 삭제</button><button type="button" class="primary" id="nz-run-sel" disabled>변환할 파일을 고릅니다</button></div>
  </div>
  <div class="nz-pick" id="nz-pick"><label class="nz-chk"><input type="checkbox" id="nz-pick-all">모두 선택</label></div>
  <div class="nz-list" id="nz-list">${'<div class="nz-row nz-skel"><i class="nz-ico nz-sk"></i><div class="nz-main"><b class="nz-sk">불러오고 있습니다</b><span class="nz-sk">파일 이름</span></div></div>'.repeat(6)}</div>
  <div class="nz-pager" id="nz-pager"></div>
  ${box("nsz-log", "변환 기록", `<p class="muted">${top("t.nz.logDesc")}</p>
  <input type="search" id="nz-log-q" placeholder="이름으로 찾습니다" aria-label="변환 기록에서 찾기">
  <div class="nz-list" id="nz-log"></div><div class="nz-pager" id="nz-log-pager" hidden></div>`)}
  ${box("nsz-settings", "변환 설정", `<p class="muted">바꾸면 바로 저장하고 다시 띄우지 않아도 적용합니다.</p>
  <div class="ss-list"><section class="ss-group" id="nz-settings"></section></div>`)}
</section>`;

export const NSZ_CSS = `
.nz-head{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px 18px;margin:6px 0 12px;display:grid;gap:10px}
.nz-state{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.nz-state .pill{font-size:13px;padding:4px 12px}
.nz-head p{margin:0}
.nz-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:14px}
.nz-cards .card{padding:14px 16px}.nz-cards .card .v{font-size:24px}
.nz-cards .card.bad .v{color:var(--bad)}.nz-cards .card.good .v{color:var(--good)}
.nz-active{display:grid;gap:10px;margin-bottom:6px}
.nz-run{display:grid;grid-template-columns:64px 1fr;gap:14px;align-items:center;background:var(--panel);border:1px solid rgba(var(--accent-rgb),.6);border-radius:18px;padding:14px 16px}
.nz-run .nz-ico{width:64px;height:64px;border-radius:14px}
.nz-run b{font-size:16px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nz-run .nz-file{color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nz-run .nz-meta{display:flex;gap:6px 14px;flex-wrap:wrap;color:var(--muted);font-size:12.5px;margin:6px 0;font-variant-numeric:tabular-nums}
.nz-bar{height:8px;border-radius:8px;background:var(--sunk);overflow:hidden;position:relative}
.nz-bar>i{display:block;height:100%;width:0;background:var(--accent);border-radius:8px;transition:width .4s}
.nz-bar.ind>i{width:30%;position:absolute;animation:nz-slide 1.4s ease-in-out infinite}
@keyframes nz-slide{from{left:-30%}to{left:100%}}
@keyframes nz-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.nz-sk{color:transparent!important;background:var(--sunk)!important;border-radius:8px;animation:nz-pulse 1.4s ease-in-out infinite}
.nz-tools{margin-top:16px}.nz-tools .seg{margin:6px 0}
.nz-list{display:grid;gap:8px;margin-top:8px}
.nz-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:12px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
.nz-row.running{border-color:rgba(var(--accent-rgb),.6)}
.nz-ico{width:40px;height:40px;border-radius:10px;background:var(--sunk);object-fit:cover;display:block;flex:none}
.nz-main{min-width:0;display:grid;gap:2px}
.nz-main b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.nz-main span{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nz-main .err{color:var(--bad);white-space:normal;overflow-wrap:anywhere}
.nz-info{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;font-size:12.5px;font-variant-numeric:tabular-nums;color:var(--muted)}
.nz-acts{display:flex;gap:6px}.nz-acts button{padding:6px 10px}
.nz-skel{grid-template-columns:40px 1fr}.nz-skel .nz-main span{width:60%}
.nz-lead{display:flex;align-items:center;gap:10px}
.nz-lead input,.nz-chk input{width:18px;height:18px;margin:0;accent-color:var(--accent)}.nz-cb-sp{width:18px;flex:none}
/* The select-all box sits right above the rows' boxes (row border 1px + padding 12px). */
.nz-pick{display:flex;align-items:center;margin-top:10px;padding-left:13px}.nz-pick[hidden],.nz-kept[hidden]{display:none}
.nz-chk{display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer}
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
.nz-tools .actions{width:100%}.nz-tools .actions button{flex:1}
}
@media (prefers-reduced-motion:reduce){.nz-sk,.nz-bar.ind>i{animation:none}.nz-bar>i{transition:none}}
`;

export const NSZ_SCRIPT = /* js */ `
var nzFilter='all',nzOffset=0,nzTimer=null,nzSettingsSig='',nzBusy=false,nzSel=new Set(),nzSkew=0,nzLogOff=0,nzLogQ='',nzLogSig='',nzLogTimer=null; // var: showTab() can run before this line
const NZ_LIMIT=50,NZ_POLL_MS=3000;
const nzSize=(n)=>{n=Number(n)||0;if(n<1024)return n+' B';const u=['KB','MB','GB','TB'];let i=-1;do{n/=1024;i++;}while(n>=1024&&i<3);return (n>=100?n.toFixed(0):n.toFixed(1))+' '+u[i];};
const nzTime=(ms)=>{const s=Math.max(0,Math.round(ms/1000));const h=Math.floor(s/3600),m=Math.floor(s/60)%60,x=s%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');};
const NZ_STATE={waiting:['대기',''],busy:['나중에','warn'],running:['진행 중','warn'],done:['완료','on'],failed:['실패','off'],skipped:['건너뜀','']};
const NZ_LEVELS=Array.from({length:22},(_,i)=>[String(i+1),(i+1)+(i===17?' (기본)':'')]);
const NZ_SETTINGS=[
  ['nszEnabled','bool','변환 사용','켜면 이 탭에서 대기열을 시작하고 멈출 수 있습니다. 끄면 진행 중인 변환을 멈추고 원본은 그대로 둡니다.'],
  ['nszAutoQueue','bool','새 파일 자동 추가','라이브러리에 새로 들어온 .nsp 를 대기열에 알아서 넣습니다. 시작해 두었다면 바로 변환합니다.'],
  ['nszLevel',NZ_LEVELS,'압축 수준','높을수록 작아지지만 오래 걸립니다.'],
  ['nszThreads',[1,32,'개'],'스레드','파일 하나를 압축할 때 쓰는 CPU 스레드 수입니다.'],
  ['nszWorkers',[['1','1개 (기본)'],['2','2개'],['3','3개']],'동시에 변환할 파일','늘리면 빨리 끝나지만 같은 디스크에서 다운로드하는 콘솔이 느려집니다.'],
  ['nszMinSizeMb',[1,1048576,'MB'],'최소 크기','이보다 작은 파일은 변환하지 않습니다.'],
  ['nszDiskFloorGb',[0,1048576,'GB'],'더 남길 공간',()=>topText('t.nz.floorDesc')],
  ['nszKeepHours',[0,168,'시간'],'원본 보관 시간',()=>topText('t.nz.keepHoursDesc')],
  ['nszKeepGb',[0,4096,'GB'],'원본 보관 한도',()=>topText('t.nz.keepGbDesc')],
  ['nszBlock','bool','블록 압축','블록 압축은 콘솔이 여러 코어로 풀 수 있게 하는 방식이며 지금 클라이언트는 솔리드와 속도 차이가 없으니 꺼 둡니다.'],
  ['nszXci','bool','XCI 도 XCZ 로 변환','XCI 파일도 XCZ 로 압축합니다.'],
];
function nzIcon(it,cls){if(!it.titleId){const i=el('i',null,'nz-ico'+(cls?' '+cls:''));return i;}
  const img=el('img',null,'nz-ico'+(cls?' '+cls:''));img.alt='';img.loading='lazy';img.src='/api/library/icon/'+it.titleId+'?size=sm';img.onerror=()=>{img.style.visibility='hidden';};return img;}
const nzName=(it)=>it.name||it.rel.split('/').pop().replace(/\\.(nsp|xci)$/i,'');
const nzFile=(it)=>it.rel.split('/').pop();
const nzPickable=()=>nzFilter==='all'||nzFilter==='waiting'||nzFilter==='failed';
const nzSelectable=(it)=>['waiting','busy','failed','skipped'].includes(it.state);
const nzLeft=(ms)=>{const m=Math.max(0,Math.ceil(ms/60000));return m<60?m+'분':Math.floor(m/60)+'시간'+(m%60?' '+(m%60)+'분':'');};
const nzKeepLeft=(it)=>it.keepUntil-(Date.now()+nzSkew);
// One run button. Ticked rows go first; with none ticked, 대기 runs the files waiting now and 실패 tries the failed ones again.
// Either way only those run, and files queued meanwhile wait.
let nzTabCount=0,nzOff=false;
const nzRunLabel=()=>nzSel.size?'선택한 '+num(nzSel.size)+'개 변환':nzFilter==='waiting'&&nzTabCount?'대기 '+num(nzTabCount)+'개 모두 변환':nzFilter==='failed'&&nzTabCount?'실패 '+num(nzTabCount)+'개 다시 변환':'변환할 파일을 고릅니다';
function nzSelUpdate(){const b=$('nz-run-sel');b.textContent=nzRunLabel();b.disabled=nzOff||!(nzSel.size||((nzFilter==='waiting'||nzFilter==='failed')&&nzTabCount));
  const boxes=[...$('nz-list').querySelectorAll('.nz-lead input')];$('nz-pick-all').checked=boxes.length>0&&boxes.every((c)=>c.checked);}
function nzProgress(it){return it.expectedBytes?Math.min(0.97,it.outBytes/it.expectedBytes):null;}
async function nzAct(url,opts,msg){if(nzBusy)return;nzBusy=true;try{const d=await api(url,opts);if(msg)toast(typeof msg==='function'?msg(d):msg);}catch(err){toast(err.message);}finally{nzBusy=false;}loadNsz();}
function nzRowSig(it){return [it.state,it.size,it.savedBytes,it.reason,it.name,it.titleId,it.state==='running'?Math.round(it.outBytes/1048576):0,it.keptAt?Math.ceil(nzKeepLeft(it)/60000):''].join('|');}
function nzLead(it){const lead=el('div',null,'nz-lead');
  if(nzPickable()){if(nzSelectable(it)){const c=el('input');c.type='checkbox';c.checked=nzSel.has(it.id);c.setAttribute('aria-label',nzName(it)+' 선택');
    c.addEventListener('change',()=>{if(c.checked)nzSel.add(it.id);else nzSel.delete(it.id);nzSelUpdate();});lead.append(c);}else lead.append(el('span',null,'nz-cb-sp'));}
  lead.append(nzIcon(it));return lead;}
function nzRow(it){const r=el('div',null,'nz-row '+it.state);r.dataset.id=it.id;r.dataset.sig=nzRowSig(it);
  const main=el('div',null,'nz-main');main.append(el('b',nzName(it)),el('span',nzFile(it)));
  if(it.reason&&it.state!=='done')main.append(el('span',it.reason,it.state==='failed'?'err':''));
  if(it.keptAt)main.append(el('span',topFill('t.nz.keptLeft',{left:nzLeft(nzKeepLeft(it))})));
  const info=el('div',null,'nz-info');const [label,kind]=NZ_STATE[it.state]||[it.state,''];info.append(pill(label,kind));
  info.append(el('span',nzSize(it.size)));
  if(it.state==='done')info.append(el('span','-'+nzSize(it.savedBytes)+' ('+Math.round(it.savedBytes/it.size*100)+'%)'));
  if(it.state==='running'){const p=nzProgress(it);info.append(el('span',p==null?nzSize(it.outBytes)+' 씀':Math.round(p*100)+'%'));}
  const acts=el('div',null,'nz-acts');
  if(it.state==='waiting'||it.state==='busy')acts.append(btn('위로',()=>nzAct('/admin/api/nsz/items/'+it.id+'/top',{method:'POST',body:{}},'맨 앞으로 옮겼습니다.')));
  if(it.state==='failed'||it.state==='skipped'||it.state==='busy')acts.append(btn('재시도',()=>nzAct('/admin/api/nsz/items/'+it.id+'/retry',{method:'POST',body:{}},'다시 대기열에 넣었습니다.')));
  acts.append(btn('빼기',async()=>{if(it.state==='running'&&!await ask(nzName(it)+' 의 변환을 멈추고 대기열에서 뺍니다. 원본은 그대로 둡니다.',{danger:true}))return;
    if(it.keptAt&&!await ask(topFill('t.nz.askRemoveKept',{name:nzName(it)}),{danger:true}))return;
    nzAct('/admin/api/nsz/items/'+it.id,{method:'DELETE'},'대기열에서 뺐습니다.');},'danger'));
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
  if(!items.length)list.append(el('div',nzFilter==='all'?'대기열이 비어 있습니다. 라이브러리 검사로 변환할 파일을 찾습니다.':'이 상태의 파일이 없습니다.','empty'));}
function nzRunCard(it){const c=el('article',null,'nz-run');c.dataset.id=it.id;
  const body=el('div');body.style.minWidth='0';const meta=el('div',null,'nz-meta');const bar=el('div',null,'nz-bar');bar.append(el('i'));
  body.append(el('b',nzName(it)),el('div',nzFile(it),'nz-file'),meta,bar);c.append(nzIcon(it),body);return c;}
function nzRenderActive(active){const box=$('nz-active');const keep=new Map([...box.children].map((c)=>[c.dataset.id,c]));
  for(const it of active){let c=keep.get(it.id);keep.delete(it.id);if(!c){c=nzRunCard(it);box.append(c);}
    const p=nzProgress(it);const bar=c.querySelector('.nz-bar');bar.classList.toggle('ind',p==null);bar.firstChild.style.width=p==null?'':Math.round(p*100)+'%';
    c.querySelector('.nz-meta').replaceChildren(el('span','원본 '+nzSize(it.size)),el('span','경과 '+nzTime(Date.now()-it.startedAt)),
      el('span',p==null?nzSize(it.outBytes)+' 썼습니다':Math.round(p*100)+'% · 예상 '+nzSize(it.expectedBytes)));}
  for(const c of keep.values())c.remove();}
function nzCards(t){const cards=[['대기',num(t.waiting+t.busy),nzSize(t.waitingBytes)],['진행',num(t.running),''],['완료',num(t.done),'',t.done?'good':''],['실패',num(t.failed+t.skipped),'',t.failed?'bad':''],['확보한 용량',nzSize(t.savedBytes),num(t.converted)+'개 변환',t.savedBytes?'good':'']];
  $('nz-cards').replaceChildren(...cards.map(([l,v,sub,cls])=>{const c=el('div',null,'card'+(cls?' '+cls:''));c.append(el('div',v,'v'),el('div',l+(sub?' · '+sub:''),'l'));return c;}));}
function nzHeader(d){const st=$('nz-state');st.classList.remove('nz-sk');
  const [label,kind]=d.status==='off'?['꺼짐','']:d.status==='running'?['실행 중','on']:d.status==='idle'?['쉬는 중','']:['일시정지','warn'];st.textContent=label;st.className='pill'+(kind?' '+kind:'');
  const tb=d.trash&&d.trash.bytes||0,kb=d.kept&&d.kept.bytes||0;
  const space={trash:nzSize(tb),kept:nzSize(kb)};
  const notes={disk:topText('t.nz.diskStop')+' '+topFill(tb&&kb?'t.nz.diskBoth':tb?'t.nz.diskTrash':kb?'t.nz.diskKept':'t.nz.diskNone',space),failures:'잇달아 실패해 멈췄습니다. 실패한 파일의 이유를 확인합니다.'};
  let note=d.status==='off'?'아래 설정에서 변환을 켭니다.':d.pausedReason?notes[d.pausedReason]||'':d.status==='running'?(d.waitingFor==='downloads'?'콘솔이 다운로드하고 있어 기다립니다. 30초 동안 다운로드가 없으면 다음 파일을 시작합니다.':d.active.length?'':'사용 중인 파일만 남아 잠시 뒤에 다시 확인합니다.'):d.status==='idle'?(d.totals.waiting+d.totals.busy?'시작을 누르면 대기열을 차례로 변환합니다.':'할 일이 없어 쉬고 있습니다.')+(d.autoQueue?' 새 게임이 들어오면 저절로 시작합니다.':''):'시작을 누르면 대기열을 차례로 변환합니다.';
  if(d.only&&d.status==='running')note='선택한 '+num(d.only)+'개만 변환합니다. '+note;
  if(!d.tool)note='nsz 를 찾지 못했습니다. 서버 이미지나 COOK_NSZ_BIN 을 확인합니다. '+note;$('nz-note').textContent=note;
  const tg=$('nz-toggle');tg.disabled=d.status==='off';tg.textContent=d.status==='running'?'일시정지':'시작';tg.className=d.status==='running'?'':'primary';
  const t=d.totals,doneN=t.done+t.failed+t.skipped,all=doneN+t.waiting+t.busy+t.running;
  nzTabCount=nzFilter==='waiting'?t.waiting+t.busy:nzFilter==='failed'?t.failed+t.skipped:0;nzOff=d.status==='off';nzSelUpdate();
  $('nz-overall').style.width=all?Math.round(doneN/all*100)+'%':'0';
  const k=d.kept||{};$('nz-kept').hidden=!k.count;
  if(k.count)$('nz-kept-t').textContent='보관 중인 원본 '+num(k.count)+'개 · '+nzSize(k.bytes)+(k.capBytes?' / 한도 '+nzSize(k.capBytes):'')+(k.nextAt?' · '+topFill('t.nz.oldest',{left:nzLeft(k.nextAt-k.now)}):'');
  $('nz-overall-t').textContent=all?'전체 '+num(all)+'개 중 '+num(doneN)+'개를 처리했습니다. 남은 크기는 '+nzSize(t.waitingBytes)+'입니다.':'대기열에 파일이 없습니다.';}
function nzPager(d){const p=$('nz-pager');p.hidden=d.total<=d.limit;if(p.hidden){p.replaceChildren();return;}
  const page=Math.floor(d.offset/d.limit)+1,pages=Math.ceil(d.total/d.limit);
  const prev=btn('이전',()=>{nzOffset=Math.max(0,nzOffset-NZ_LIMIT);loadNsz();});prev.disabled=page<=1;
  const next=btn('다음',()=>{nzOffset+=NZ_LIMIT;loadNsz();});next.disabled=page>=pages;
  p.replaceChildren(prev,el('span',page+' / '+pages+' 쪽 · '+num(d.total)+'개','muted'),next);}
// A label is text or, for a translated one, a function giving it in the page's language.
const nzWord=(w)=>typeof w==='function'?w():w;
const NZ_EVENT={converted:['변환','on'],'original-deleted':[()=>topText('t.nz.evOrig'),''],'original-unverified':[()=>topText('t.nz.evOrig'),''],failed:['실패','off'],restored:['되돌림','']}; // restored: lines written before 되돌리기 was dropped
const NZ_WHY={age:'보관 시간이 지났습니다.',cap:'보관 한도를 넘었습니다.',space:'변환할 공간이 모자랐습니다.',manual:()=>topText('t.nz.whyManual'),removed:'대기열에서 뺐습니다.',cleared:()=>topText('t.nz.whyCleared'),missing:'파일이 이미 없었습니다.',ticketless:()=>topText('t.nz.whyTicketless')};
function nzLogRow(e){const r=el('div',null,'nz-row nz-lrow');const main=el('div',null,'nz-main');
  main.append(el('b',e.name||String(e.rel||'').split('/').pop()),el('span',e.rel||''));
  if(e.reason)main.append(el('span',nzWord(NZ_WHY[e.reason])||e.reason,e.event==='failed'?'err':''));
  const info=el('div',null,'nz-info');const [label,kind]=NZ_EVENT[e.event]||[e.event,''];info.append(pill(nzWord(label),kind));
  if(e.event==='converted'&&e.sizeBefore&&e.sizeAfter)info.append(el('span',nzSize(e.sizeBefore)+' → '+nzSize(e.sizeAfter)+' (-'+Math.round((1-e.sizeAfter/e.sizeBefore)*100)+'%)'));
  else if(e.sizeBefore)info.append(el('span',nzSize(e.sizeBefore)));
  info.append(el('span',new Date(e.at).toLocaleString('ko-KR')));r.append(main,info);return r;}
async function loadNszLog(){let d;try{d=await api('/admin/api/nsz/log?offset='+nzLogOff+'&limit='+NZ_LIMIT+'&q='+encodeURIComponent(nzLogQ));}catch(err){toast(err.message);return;}
  $('nz-log').replaceChildren(...d.items.map(nzLogRow));
  if(!d.items.length)$('nz-log').append(el('div',nzLogQ?'찾는 이름의 기록이 없습니다.':'아직 기록이 없습니다.','empty'));
  const p=$('nz-log-pager');p.hidden=d.total<=d.limit;if(p.hidden){p.replaceChildren();return;}
  const page=Math.floor(d.offset/d.limit)+1,pages=Math.ceil(d.total/d.limit);
  const prev=btn('이전',()=>{nzLogOff=Math.max(0,nzLogOff-NZ_LIMIT);loadNszLog();});prev.disabled=page<=1;
  const next=btn('다음',()=>{nzLogOff+=NZ_LIMIT;loadNszLog();});next.disabled=page>=pages;
  p.replaceChildren(prev,el('span',page+' / '+pages+' 쪽 · '+num(d.total)+'개','muted'),next);}
async function nzSave(key,value){try{await api('/admin/api/server-settings',{method:'POST',body:{[key]:value}});toast('저장했습니다.');}catch(err){toast(err.message);nzSettingsSig='';}loadNsz();}
function nzControl(key,kind,s){
  if(kind==='bool'){const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=s.value===true;b.setAttribute('aria-label',key);
    b.addEventListener('change',()=>nzSave(key,b.checked));w.append(b,el('span'));return w;}
  if(typeof kind[0]==='number'){const [min,max,unit]=kind;const i=el('input');i.type='number';i.min=String(min);i.max=String(max);i.step='1';i.inputMode='numeric';i.value=String(s.value);i.setAttribute('aria-label',key);
    i.addEventListener('change',()=>{const v=Number(i.value);if(!Number.isInteger(v)||v<min||v>max){toast(min+'부터 '+max+'까지의 정수를 넣습니다.');i.value=String(s.value);return;}nzSave(key,v);});
    const w=el('span');w.style.cssText='display:flex;align-items:center;gap:8px;width:100%';w.append(i,el('span',unit,'muted'));return w;}
  const sel=el('select');sel.setAttribute('aria-label',key);for(const [v,t] of kind){const o=el('option',t);o.value=v;sel.append(o);}sel.value=String(s.value);
  sel.addEventListener('change',()=>nzSave(key,Number(sel.value)));return sel;}
/** Builds the rows once; later reads update each row's value and note, never the control being edited. */
function nzRenderSettings(settings){const box=$('nz-settings');const sig=JSON.stringify(settings);if(sig===nzSettingsSig)return;nzSettingsSig=sig;
  for(const [key,kind,label,desc] of NZ_SETTINGS){const s=settings[key];if(!s)continue;
    let r=box.querySelector('.ss-row[data-key="'+key+'"]');
    if(!r){r=el('div',null,'ss-row');r.dataset.key=key;const t=el('div');t.append(el('b',label),el('p',typeof desc==='function'?desc():desc));
      const c=el('div',null,'ss-ctl');c.append(nzControl(key,kind,s));r.append(t,c,el('div',null,'ss-src'));box.append(r);}
    const ctl=r.querySelector('input,select');
    if(ctl&&ctl!==document.activeElement){if(ctl.type==='checkbox')ctl.checked=s.value===true;else ctl.value=String(s.value);}
    const src=r.querySelector('.ss-src');src.replaceChildren();src.hidden=s.source!=='saved';
    if(s.source==='saved'){src.append('여기서 정한 값입니다.');src.append(btn('compose 값으로',()=>nzSave(key,null)));}}}
const nzVisible=()=>location.hash==='#nsz'&&document.visibilityState==='visible';
async function loadNsz(){clearTimeout(nzTimer);nzTimer=null;let d;
  try{d=await api('/admin/api/nsz?filter='+nzFilter+'&offset='+nzOffset+'&limit='+NZ_LIMIT);}catch(err){toast(err.message);return;}
  if(d.offset>0&&d.offset>=d.total){nzOffset=Math.max(0,Math.floor((d.total-1)/NZ_LIMIT)*NZ_LIMIT);return loadNsz();}
  if(d.kept)nzSkew=d.kept.now-Date.now();
  for(const it of d.items)if(!nzSelectable(it))nzSel.delete(it.id);
  nzHeader(d);nzCards(d.totals);nzRenderActive(d.active);nzPatch($('nz-list'),d.items);nzPager(d);nzRenderSettings(d.settings);
  // The log is read again only when something finished or was deleted.
  const t=d.totals,logSig=[t.done,t.failed,t.skipped,t.converted,d.kept&&d.kept.count,d.total].join('|');if(logSig!==nzLogSig){nzLogSig=logSig;loadNszLog();}
  // Read again only while someone is looking and the queue has something going; with the
  // activity socket up, its conversion job reads again instead (activity-panel.js).
  // Between files (a retry wait, the start delay) there is no job to follow, so the timer runs then too.
  if(nzVisible()&&d.status==='running'&&!nzTimer&&(!actLive||!(d.active||[]).length))nzTimer=setTimeout(loadNsz,NZ_POLL_MS);}
document.addEventListener('visibilitychange',()=>{if(nzVisible())loadNsz();});
$('nz-toggle').addEventListener('click',()=>{const on=$('nz-toggle').textContent==='일시정지';
  nzAct('/admin/api/nsz/'+(on?'pause':'start'),{method:'POST',body:{}},on?'일시정지했습니다. 진행 중이던 파일은 대기로 돌아갑니다.':'변환을 시작했습니다.');});
$('nz-scan').addEventListener('click',()=>nzAct('/admin/api/nsz/scan',{method:'POST',body:{}},(d)=>d.added?d.added+'개('+nzSize(d.bytes)+')를 대기열에 넣었습니다.':'새로 넣을 파일이 없습니다.'));
$('nz-clear').addEventListener('click',()=>nzAct('/admin/api/nsz/clear-finished',{method:'POST',body:{}},(d)=>d.removed?d.removed+'개를 목록에서 삭제했습니다.':'삭제할 것이 없습니다.'));
$('nz-pick-all').addEventListener('change',()=>{const on=$('nz-pick-all').checked;
  for(const c of $('nz-list').querySelectorAll('.nz-lead input')){c.checked=on;const id=c.closest('.nz-row').dataset.id;if(on)nzSel.add(id);else nzSel.delete(id);}nzSelUpdate();});
$('nz-run-sel').addEventListener('click',async()=>{const ids=[...nzSel];
  if(ids.length)return nzAct('/admin/api/nsz/run-selected',{method:'POST',body:{ids}},(d)=>{nzSel.clear();return '선택한 '+d.count+'개를 변환합니다.';});
  const f=nzFilter,word=f==='failed'?'실패한':'대기 중인';
  if(!await ask(word+' 파일 '+num(nzTabCount)+'개를 변환합니다. 그동안 새로 들어온 파일은 기다립니다.'))return;
  nzAct('/admin/api/nsz/run-filter',{method:'POST',body:{filter:f}},(d)=>word+' '+d.count+'개를 변환합니다.');});
$('nz-purge').addEventListener('click',async()=>{if(!await ask(topText('t.nz.askPurge'),{danger:true}))return;
  nzAct('/admin/api/nsz/purge-kept',{method:'POST',body:{}},(d)=>topFill('t.nz.purged',{n:d.removed,size:nzSize(d.bytes)}));});
$('nz-log-q').addEventListener('input',()=>{clearTimeout(nzLogTimer);nzLogTimer=setTimeout(()=>{nzLogQ=$('nz-log-q').value.trim();nzLogOff=0;loadNszLog();},250);});
$('nz-filter').addEventListener('click',(e)=>{const b=e.target.closest('[data-filter]');if(!b)return;nzFilter=b.dataset.filter;nzOffset=0;nzSel.clear();
  for(const x of $('nz-filter').querySelectorAll('button')){const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));}
  // Until the new rows arrive there is nothing to pick or run: a 모두 선택 click would untick itself and the run button would ask with the old tab's count.
  $('nz-list').replaceChildren();$('nz-pick').hidden=true;nzTabCount=0;nzSelUpdate();loadNsz();});
`;
