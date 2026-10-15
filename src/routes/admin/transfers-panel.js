/**
 * The 다운로드 기록 section at the top of the admin page's logs tab: how fast
 * each download went and which way it came in (터널, 전용 주소, 집 안, 기타).
 * Cards sum up the last 24 hours per route; the table lists transfers still
 * running first, with their live speed, then finished ones. While the section
 * is on screen it reads /admin/api/transfers every few seconds and replaces
 * only the rows that changed.
 */

export const TRANSFERS_HTML = `
  <div class="hd"><h2 class="first">다운로드 기록</h2>
    <div class="seg" id="xf-routes" role="group" aria-label="경로">
      <button type="button" data-route="" aria-pressed="true" class="active">전체</button>
      <button type="button" data-route="tunnel" aria-pressed="false">터널</button>
      <button type="button" data-route="direct" aria-pressed="false">전용 주소</button>
      <button type="button" data-route="lan" aria-pressed="false">집 안</button>
      <button type="button" data-route="other" aria-pressed="false">기타</button>
    </div></div>
  <p class="muted">기기가 받은 게임과 패치, 홈브류, 세이브, 레트로 파일입니다. 같은 파일을 여러 연결로 나눠 받은 것은 한 줄로 묶고, 요청이 <span id="xf-quiet">20</span>초 동안 없으면 끝난 것으로 봅니다. 속도는 실제로 보낸 양을 받는 동안의 시간으로 나눈 값입니다.</p>
  <div class="cards xf-cards" id="xf-cards"></div>
  <div class="note warn" id="xf-slow" hidden></div>
  <div class="scroll"><table class="xf-table" id="xf-table" aria-label="다운로드 기록"></table></div>
  <p class="muted" id="xf-foot"></p>`;

export const TRANSFERS_CSS = `
.xf-cards .card .v{font-size:24px}
.xf-cards .card .s{color:var(--muted);font-size:12px;margin-top:2px;font-variant-numeric:tabular-nums}
.xf-cards .card.slow{border-color:rgba(var(--warn-rgb),.6)}.xf-cards .card.slow .v{color:var(--warn)}
.xf-cards .card.fast .v{color:var(--good)}
#tab-logs .hd .seg{flex-wrap:wrap}
.xf-table td{font-variant-numeric:tabular-nums}
.xf-table td.xf-name{max-width:280px;overflow-wrap:anywhere}
.xf-table td .sub{display:block;color:var(--muted);font-size:12px}
.xf-table tr.live td{background:rgba(var(--accent-rgb),.06)}
.xf-table .xf-client{max-width:180px;overflow-wrap:anywhere;color:var(--muted);font-size:12px}
.xf-skel span{display:block;height:12px;width:70%;border-radius:6px;background:var(--sunk);animation:xf-pulse 1.2s ease-in-out infinite}
@keyframes xf-pulse{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.xf-skel span{animation:none}}
@media (max-width:640px){.xf-table td.xf-name,.xf-table .xf-client{max-width:none}}
`;

export const TRANSFERS_SCRIPT = /* js */ `
// var: showTab() can run before this part of the script.
var xfRoute='',xfTimer=null,xfRowsById=new Map(),xfLoaded=false,xfBusy=false;
const XF_ROUTE={tunnel:'터널',direct:'전용 주소',lan:'집 안',other:'기타'};
const XF_PILL={tunnel:'warn',direct:'on',lan:'on',other:''};
const XF_COLS=['시각','기기·계정','파일','크기','받은 양','속도','경로','연결','클라이언트'];
const xfSize=(n)=>{if(n==null)return '—';if(n>=1e9)return (n/1e9).toFixed(2)+' GB';if(n>=1e6)return (n/1e6).toFixed(1)+' MB';return Math.round(n/1e3)+' KB';};
const xfSpeed=(v)=>v==null?'—':v.toFixed(1)+' MB/s';
const xfWhen=(t)=>new Date(t).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
function xfHead(){const t=$('xf-table');if(t.rows.length&&t.rows[0].dataset.head)return t;t.replaceChildren();
  const hr=el('tr');hr.dataset.head='1';for(const c of XF_COLS)hr.append(el('th',c));t.append(hr);return t;}
function xfSkeleton(){const t=xfHead();for(let i=0;i<4;i++){const tr=el('tr',null,'xf-skel');
  for(const c of XF_COLS){const cell=td();cell.dataset.label=c;cell.append(el('span'));tr.append(cell);}t.append(tr);}}
// One box per cell, so on a phone the value and its note stay together beside the label.
function xfCell(tr,label,main,sub,cls){const c=td(null,cls);c.dataset.label=label;const box=el('div');
  if(main instanceof Node)box.append(main);else box.append(document.createTextNode(main));if(sub)box.append(el('span',sub,'sub'));c.append(box);tr.append(c);return c;}
function xfSig(r,live){return JSON.stringify([live,r.endedAt,r.bytes,r.mbps,r.peakConnections,r.inflight,r.requests,r.complete,r.fileSize,r.file.name,r.who.label]);}
function xfRow(r,live){const tr=el('tr',null,live?'live':'');tr.dataset.id=r.id;
  xfCell(tr,'시각',live?pill('받는 중','on'):xfWhen(r.endedAt),live?ago(r.startedAt)+' 시작':null);
  const where=(r.remote&&r.remote.scope==='private'?'집 안에서':'밖에서')+(r.remote&&r.remote.country?' · '+r.remote.country:'');
  const who=xfCell(tr,'기기·계정',r.who.label,where);if(r.who.kind==='ip')who.classList.add('ip');
  const name=xfCell(tr,'파일',r.file.name,null,'xf-name');name.title=r.file.path||r.file.name;
  xfCell(tr,'크기',xfSize(r.fileSize));
  xfCell(tr,'받은 양',xfSize(r.bytes),r.complete?'전체':(live?null:'일부'));
  xfCell(tr,'속도',xfSpeed(r.mbps),r.requests?'요청 '+num(r.requests)+'개':null);
  xfCell(tr,'경로',pill(XF_ROUTE[r.route]||r.route,XF_PILL[r.route]));
  xfCell(tr,'연결',String(r.peakConnections||0),live?'지금 '+(r.inflight||0)+'개':'최대');
  xfCell(tr,'클라이언트',r.client||'—',null,'xf-client');
  tr.dataset.sig=xfSig(r,live);return tr;}
function xfRender(d){const t=xfHead();const list=[...d.active.map((r)=>[r,true]),...d.recent.map((r)=>[r,false])];
  for(const tr of [...t.querySelectorAll('tr.xf-skel,tr.xf-empty')])tr.remove();
  const keep=new Set();let at=1;
  for(const [r,live] of list){keep.add(r.id);let tr=xfRowsById.get(r.id);const sig=xfSig(r,live);
    if(!tr||tr.dataset.sig!==sig){const next=xfRow(r,live);if(tr)tr.replaceWith(next);tr=next;xfRowsById.set(r.id,tr);}
    if(t.rows[at]!==tr)t.insertBefore(tr,t.rows[at]||null);at++;}
  for(const [id,tr] of xfRowsById)if(!keep.has(id)){tr.remove();xfRowsById.delete(id);}
  if(!list.length){const tr=el('tr',null,'xf-empty');const c=td(xfRoute?XF_ROUTE[xfRoute]+' 경로로 받은 기록이 없습니다.':'아직 받은 기록이 없습니다.','dim');
    c.colSpan=XF_COLS.length;c.dataset.label='';tr.append(c);t.append(tr);}
  $('xf-foot').textContent=d.total>d.recent.length?'최근 '+num(d.recent.length)+'개만 보입니다. 서버에는 '+num(d.total)+'개가 남아 있습니다.':'';
  $('xf-quiet').textContent=d.quietSeconds;}
function xfCards(s){const box=$('xf-cards');box.replaceChildren();
  const fast=Math.max(s.direct.medianMbps||0,s.lan.medianMbps||0);
  const slowTunnel=s.tunnel.medianMbps!=null&&fast>0&&fast>=s.tunnel.medianMbps*2;
  for(const k of ['tunnel','direct','lan','other']){const v=s[k];if(k==='other'&&!v.count)continue;
    const c=el('div',null,'card'+(k==='tunnel'&&slowTunnel?' slow':'')+(slowTunnel&&k!=='tunnel'&&v.medianMbps===fast?' fast':''));
    c.append(el('div',xfSpeed(v.medianMbps),'v'),el('div',XF_ROUTE[k]+' · 지난 24시간 중앙값','l'),
      el('div',v.count?num(v.count)+'건 · 최고 '+xfSpeed(v.bestMbps):'받은 기록이 없습니다','s'));box.append(c);}
  const slow=$('xf-slow');slow.hidden=!slowTunnel;
  if(slowTunnel){const via=(s.direct.medianMbps||0)>=(s.lan.medianMbps||0)?'전용 주소':'집 안';
    slow.textContent='터널로 받는 속도가 '+via+'보다 느립니다. 지난 24시간 중앙값이 터널 '+xfSpeed(s.tunnel.medianMbps)+', '+via+' '+xfSpeed(fast)+'입니다.';}}
async function xfLoad(){if(xfBusy)return;xfBusy=true;
  try{const d=await api('/admin/api/transfers?limit=200'+(xfRoute?'&route='+xfRoute:''));xfCards(d.summary);xfRender(d);xfLoaded=true;}
  catch(err){if(!xfLoaded)toast(err.message);}finally{xfBusy=false;}}
function xfVisible(){return !$('tab-logs').hidden&&document.visibilityState==='visible';}
function xfOpen(){if(!xfLoaded&&!$('xf-table').rows.length)xfSkeleton();xfLoad();
  if(!xfTimer)xfTimer=setInterval(()=>{if(xfVisible())xfLoad();else{clearInterval(xfTimer);xfTimer=null;}},3000);}
document.addEventListener('visibilitychange',()=>{if(xfVisible())xfOpen();});
$('xf-routes').addEventListener('click',(e)=>{const b=e.target.closest('[data-route]');if(!b)return;xfRoute=b.dataset.route;
  for(const x of $('xf-routes').querySelectorAll('button')){const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));}
  xfLoad();});
`;
