/**
 * The admin page's 변환 tab: the NSZ conversion queue like a media server's
 * transcode queue. A header with the state, start/pause and the totals, the
 * running files as cards with their progress, then the list in pages of 50
 * with filter chips and row actions, and the queue's settings. Talks to
 * /admin/api/nsz and saves settings through /admin/api/server-settings.
 *
 * While the tab is open in a visible window and the queue runs, the list is
 * read again every few seconds; only rows that changed are redrawn.
 */

export const NSZ_HTML = `<section id="tab-nsz" hidden>
  <div class="hd"><h2 class="first">NSZ 변환</h2>
    <div class="actions"><button type="button" id="nz-scan">라이브러리 검사</button><button type="button" id="nz-all">전체 변환</button><button type="button" class="primary" id="nz-toggle" disabled>시작</button></div></div>
  <p class="muted">게임 폴더의 .nsp 를 .nsz 로 압축하고 검증한 뒤 원본을 교체합니다. 콘솔이 다운로드하는 동안에는 새 파일을 시작하지 않고, 다운로드가 30초 동안 없으면 이어서 합니다.</p>
  <div class="nz-head">
    <div class="nz-state"><span class="pill nz-sk" id="nz-state">불러오고 있습니다</span><span class="muted" id="nz-note"></span></div>
    <div class="bar nz-overall" aria-hidden="true"><i id="nz-overall"></i></div>
    <p class="muted" id="nz-overall-t"></p>
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
    <div class="actions"><button type="button" id="nz-retry-all">실패 모두 재시도</button><button type="button" id="nz-clear">끝난 것 삭제</button></div>
  </div>
  <div class="nz-list" id="nz-list">${'<div class="nz-row nz-skel"><i class="nz-ico nz-sk"></i><div class="nz-main"><b class="nz-sk">불러오고 있습니다</b><span class="nz-sk">파일 이름</span></div></div>'.repeat(6)}</div>
  <div class="nz-pager" id="nz-pager"></div>
  <h2>변환 설정</h2>
  <p class="muted">바꾸면 바로 저장하고 다시 띄우지 않아도 적용합니다.</p>
  <div class="ss-list"><section class="ss-group" id="nz-settings"></section></div>
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
.nz-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto;gap:12px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
.nz-row.running{border-color:rgba(var(--accent-rgb),.6)}
.nz-ico{width:40px;height:40px;border-radius:10px;background:var(--sunk);object-fit:cover;display:block;flex:none}
.nz-main{min-width:0;display:grid;gap:2px}
.nz-main b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.nz-main span{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nz-main .err{color:var(--bad);white-space:normal;overflow-wrap:anywhere}
.nz-info{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;font-size:12.5px;font-variant-numeric:tabular-nums;color:var(--muted)}
.nz-acts{display:flex;gap:6px}.nz-acts button{padding:6px 10px}
.nz-skel{grid-template-columns:40px 1fr}.nz-skel .nz-main span{width:60%}
.nz-pager{display:flex;align-items:center;justify-content:center;gap:10px;margin:12px 0}
.nz-pager[hidden],#nz-settings .ss-src[hidden]{display:none}
#nz-settings .ss-row:first-child{border-top:0}
@media (max-width:640px){
.nz-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.nz-cards .card:last-child{grid-column:1/-1}
.nz-run{grid-template-columns:48px 1fr}.nz-run .nz-ico{width:48px;height:48px}
.nz-row{grid-template-columns:40px minmax(0,1fr)}.nz-info{grid-column:2;justify-content:flex-start}.nz-acts{grid-column:1/-1}.nz-acts button{flex:1}
.nz-tools .actions{width:100%}.nz-tools .actions button{flex:1}
}
@media (prefers-reduced-motion:reduce){.nz-sk,.nz-bar.ind>i{animation:none}.nz-bar>i{transition:none}}
`;

export const NSZ_SCRIPT = /* js */ `
var nzFilter='all',nzOffset=0,nzTimer=null,nzSettingsSig='',nzBusy=false; // var: showTab() can run before this line
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
  ['nszDiskFloorGb',[0,1048576,'GB'],'더 남길 공간','파일 하나를 변환할 때는 그 파일 크기만큼의 작업 공간이 있으면 시작합니다. 여기 넣은 만큼은 그와 별도로 늘 비워 둡니다. 0 이면 작업 공간만 확인합니다.'],
  ['nszBlock','bool','블록 압축','블록 압축은 콘솔이 여러 코어로 풀 수 있게 하는 방식이며 지금 클라이언트는 솔리드와 속도 차이가 없으니 꺼 둡니다.'],
  ['nszXci','bool','XCI 도 XCZ 로 변환','XCI 파일도 XCZ 로 압축합니다.'],
];
function nzIcon(it,cls){if(!it.titleId){const i=el('i',null,'nz-ico'+(cls?' '+cls:''));return i;}
  const img=el('img',null,'nz-ico'+(cls?' '+cls:''));img.alt='';img.loading='lazy';img.src='/api/shop/icon/'+it.titleId+'?size=sm';img.onerror=()=>{img.style.visibility='hidden';};return img;}
const nzName=(it)=>it.name||it.rel.split('/').pop().replace(/\\.(nsp|xci)$/i,'');
const nzFile=(it)=>it.rel.split('/').pop();
function nzProgress(it){return it.expectedBytes?Math.min(0.97,it.outBytes/it.expectedBytes):null;}
async function nzAct(url,opts,msg){if(nzBusy)return;nzBusy=true;try{const d=await api(url,opts);if(msg)toast(typeof msg==='function'?msg(d):msg);}catch(err){toast(err.message);}finally{nzBusy=false;}loadNsz();}
function nzRowSig(it){return [it.state,it.size,it.savedBytes,it.reason,it.name,it.titleId,it.state==='running'?Math.round(it.outBytes/1048576):0].join('|');}
function nzRow(it){const r=el('div',null,'nz-row '+it.state);r.dataset.id=it.id;r.dataset.sig=nzRowSig(it);
  const main=el('div',null,'nz-main');main.append(el('b',nzName(it)),el('span',nzFile(it)));
  if(it.reason&&it.state!=='done')main.append(el('span',it.reason,it.state==='failed'?'err':''));
  const info=el('div',null,'nz-info');const [label,kind]=NZ_STATE[it.state]||[it.state,''];info.append(pill(label,kind));
  info.append(el('span',nzSize(it.size)));
  if(it.state==='done')info.append(el('span','-'+nzSize(it.savedBytes)+' ('+Math.round(it.savedBytes/it.size*100)+'%)'));
  if(it.state==='running'){const p=nzProgress(it);info.append(el('span',p==null?nzSize(it.outBytes)+' 씀':Math.round(p*100)+'%'));}
  const acts=el('div',null,'nz-acts');
  if(it.state==='waiting'||it.state==='busy')acts.append(btn('위로',()=>nzAct('/admin/api/nsz/items/'+it.id+'/top',{method:'POST',body:{}},'맨 앞으로 옮겼습니다.')));
  if(it.state==='failed'||it.state==='skipped'||it.state==='busy')acts.append(btn('재시도',()=>nzAct('/admin/api/nsz/items/'+it.id+'/retry',{method:'POST',body:{}},'다시 대기열에 넣었습니다.')));
  acts.append(btn('빼기',async()=>{if(it.state==='running'&&!await ask(nzName(it)+' 의 변환을 멈추고 대기열에서 뺍니다. 원본은 그대로 둡니다.'))return;
    nzAct('/admin/api/nsz/items/'+it.id,{method:'DELETE'},'대기열에서 뺐습니다.');},'danger'));
  r.append(nzIcon(it),main,info,acts);return r;}
/** Puts the rows in order, keeping the nodes whose row did not change. */
function nzPatch(list,items){const old=new Map([...list.children].filter((c)=>c.dataset.id).map((c)=>[c.dataset.id,c]));
  for(const c of [...list.children])if(!c.dataset.id)c.remove();
  let at=list.firstChild;
  for(const it of items){let n=old.get(it.id);old.delete(it.id);
    if(!n||n.dataset.sig!==nzRowSig(it)){const fresh=nzRow(it);if(n){if(n===at)at=fresh;n.replaceWith(fresh);}n=fresh;}
    if(n===at)at=at.nextSibling;else list.insertBefore(n,at);}
  for(const n of old.values())n.remove();
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
  const notes={disk:'변환할 작업 공간이 모자라 멈췄습니다. 공간을 비운 뒤 시작합니다.',failures:'잇달아 실패해 멈췄습니다. 실패한 파일의 이유를 확인합니다.'};
  let note=d.status==='off'?'아래 설정에서 변환을 켭니다.':d.pausedReason?notes[d.pausedReason]||'':d.status==='running'?(d.waitingFor==='downloads'?'콘솔이 다운로드하고 있어 기다립니다. 30초 동안 다운로드가 없으면 다음 파일을 시작합니다.':d.active.length?'':'사용 중인 파일만 남아 잠시 뒤에 다시 확인합니다.'):d.status==='idle'?(d.totals.waiting+d.totals.busy?'시작을 누르면 대기열을 차례로 변환합니다.':'할 일이 없어 쉬고 있습니다.')+(d.autoQueue?' 새 게임이 들어오면 저절로 시작합니다.':''):'시작을 누르면 대기열을 차례로 변환합니다.';
  if(!d.tool)note='nsz 를 찾지 못했습니다. 서버 이미지나 COOK_NSZ_BIN 을 확인합니다. '+note;$('nz-note').textContent=note;
  const tg=$('nz-toggle');tg.disabled=d.status==='off';tg.textContent=d.status==='running'?'일시정지':'시작';tg.className=d.status==='running'?'':'primary';
  $('nz-all').disabled=d.status==='off';
  const t=d.totals,doneN=t.done+t.failed+t.skipped,all=doneN+t.waiting+t.busy+t.running;
  $('nz-overall').style.width=all?Math.round(doneN/all*100)+'%':'0';
  $('nz-overall-t').textContent=all?'전체 '+num(all)+'개 중 '+num(doneN)+'개를 처리했습니다. 남은 크기는 '+nzSize(t.waitingBytes)+'입니다.':'대기열에 파일이 없습니다.';}
function nzPager(d){const p=$('nz-pager');p.hidden=d.total<=d.limit;if(p.hidden){p.replaceChildren();return;}
  const page=Math.floor(d.offset/d.limit)+1,pages=Math.ceil(d.total/d.limit);
  const prev=btn('이전',()=>{nzOffset=Math.max(0,nzOffset-NZ_LIMIT);loadNsz();});prev.disabled=page<=1;
  const next=btn('다음',()=>{nzOffset+=NZ_LIMIT;loadNsz();});next.disabled=page>=pages;
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
    if(!r){r=el('div',null,'ss-row');r.dataset.key=key;const t=el('div');t.append(el('b',label),el('p',desc));
      const c=el('div',null,'ss-ctl');c.append(nzControl(key,kind,s));r.append(t,c,el('div',null,'ss-src'));box.append(r);}
    const ctl=r.querySelector('input,select');
    if(ctl&&ctl!==document.activeElement){if(ctl.type==='checkbox')ctl.checked=s.value===true;else ctl.value=String(s.value);}
    const src=r.querySelector('.ss-src');src.replaceChildren();src.hidden=s.source!=='saved';
    if(s.source==='saved'){src.append('여기서 정한 값입니다.');src.append(btn('compose 값으로',()=>nzSave(key,null)));}}}
const nzVisible=()=>location.hash==='#nsz'&&document.visibilityState==='visible';
async function loadNsz(){clearTimeout(nzTimer);nzTimer=null;let d;
  try{d=await api('/admin/api/nsz?filter='+nzFilter+'&offset='+nzOffset+'&limit='+NZ_LIMIT);}catch(err){toast(err.message);return;}
  if(d.offset>0&&d.offset>=d.total){nzOffset=Math.max(0,Math.floor((d.total-1)/NZ_LIMIT)*NZ_LIMIT);return loadNsz();}
  nzHeader(d);nzCards(d.totals);nzRenderActive(d.active);nzPatch($('nz-list'),d.items);nzPager(d);nzRenderSettings(d.settings);
  // Read again only while someone is looking and the queue has something going; with the
  // activity socket up, its conversion job reads again instead (activity-panel.js).
  // Between files (a retry wait, the start delay) there is no job to follow, so the timer runs then too.
  if(nzVisible()&&d.status==='running'&&!nzTimer&&(!actLive||!(d.active||[]).length))nzTimer=setTimeout(loadNsz,NZ_POLL_MS);}
document.addEventListener('visibilitychange',()=>{if(nzVisible())loadNsz();});
$('nz-toggle').addEventListener('click',()=>{const on=$('nz-toggle').textContent==='일시정지';
  nzAct('/admin/api/nsz/'+(on?'pause':'start'),{method:'POST',body:{}},on?'일시정지했습니다. 진행 중이던 파일은 대기로 돌아갑니다.':'변환을 시작했습니다.');});
$('nz-scan').addEventListener('click',()=>nzAct('/admin/api/nsz/scan',{method:'POST',body:{}},(d)=>d.added?d.added+'개('+nzSize(d.bytes)+')를 대기열에 넣었습니다.':'새로 넣을 파일이 없습니다.'));
$('nz-all').addEventListener('click',async()=>{let p;try{p=await api('/admin/api/nsz/preview');}catch(err){toast(err.message);return;}
  if(!p.files){toast('변환할 파일이 없습니다.');return;}
  if(!await ask('파일 '+num(p.files)+'개, '+nzSize(p.bytes)+'를 변환합니다. 콘솔이 다운로드하는 동안에는 기다렸다가 이어서 합니다. 시작합니다.'))return;
  nzAct('/admin/api/nsz/convert-all',{method:'POST',body:{}},'전체 변환을 시작했습니다.');});
$('nz-clear').addEventListener('click',()=>nzAct('/admin/api/nsz/clear-finished',{method:'POST',body:{}},(d)=>d.removed?d.removed+'개를 목록에서 삭제했습니다.':'삭제할 것이 없습니다.'));
$('nz-retry-all').addEventListener('click',()=>nzAct('/admin/api/nsz/items/all/retry',{method:'POST',body:{}},'실패한 파일을 다시 대기열에 넣었습니다.'));
$('nz-filter').addEventListener('click',(e)=>{const b=e.target.closest('[data-filter]');if(!b)return;nzFilter=b.dataset.filter;nzOffset=0;
  for(const x of $('nz-filter').querySelectorAll('button')){const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));}
  $('nz-list').replaceChildren();loadNsz();});
`;
