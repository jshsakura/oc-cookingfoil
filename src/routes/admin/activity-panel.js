/**
 * The activity menu in the admin header: what the server is doing right now
 * (tasks/activity.js), with a progress bar each, and what ended in the last
 * ten minutes. It listens on /admin/ws; while that is down it reads
 * /admin/api/activity every 15 seconds and tries the socket again with a backoff.
 *
 * The panels that used to poll on their own (conversion, retro art) read again
 * when a job of theirs steps or ends, and fall back to their timers while the
 * socket is down (`actLive`).
 *
 * A running job that can be stopped (`cancellable`) gets a stop button, which asks
 * first and then posts /admin/api/activity/:id/cancel.
 */
import { icon } from "../../views/icons.js";

export const ACTIVITY_CSS = /* css */ `
.hdr-right{display:flex;align-items:center;gap:8px}
.act-menu{position:relative}
.act-btn{position:relative}
.act-btn.busy{color:var(--accent);border-color:rgba(var(--accent-rgb),.55)}
.act-btn.busy::after{content:"";position:absolute;inset:-3px;border-radius:100px;border:2px solid transparent;border-top-color:var(--accent);animation:act-spin 1.1s linear infinite}
.act-count{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:100px;background:var(--accent);color:var(--accent-ink);font:700 11px/18px inherit;text-align:center}
.act-count[hidden]{display:none}
.act-pop{width:min(380px,calc(100vw - 32px));max-height:min(70vh,560px);overflow:auto;padding:10px 6px 8px;gap:0}
.act-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px 8px;font-size:13px}
.act-h.sub{margin-top:6px;padding-top:10px;border-top:1px solid var(--line)}
.act-live{color:var(--faint);font-size:12px;font-weight:600}
.act-live.on{color:var(--good)}
.act-list{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.act-row{display:grid;grid-template-columns:auto 1fr auto auto;gap:2px 10px;align-items:center;padding:8px 10px;border-radius:10px}
.act-row:hover{background:var(--sunk)}
.act-row .ic{grid-row:span 2;display:grid;place-items:center;width:26px;height:26px;border-radius:100px;background:var(--sunk);color:var(--muted)}
.act-row .ic .ico{width:14px;height:14px}
.act-row.running .ic{background:rgba(var(--accent-rgb),.16);color:var(--accent)}
.act-row.done .ic{background:rgba(var(--good-rgb),.14);color:var(--good)}
.act-row.failed .ic{background:rgba(var(--bad-rgb),.14);color:var(--bad)}
.act-row .t{font-weight:600;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.act-row .n{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.act-row .d{grid-column:2 / -1;color:var(--muted);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.act-row.failed .d{color:var(--bad)}
.act-bar{grid-column:2 / -1;position:relative;height:4px;margin-top:4px;border-radius:100px;background:var(--sunk);overflow:hidden}
.act-bar>i{position:absolute;inset:0 auto 0 0;width:0;border-radius:inherit;background:var(--accent);transition:width .4s ease}
.act-bar.ind>i{width:30%;animation:act-slide 1.4s ease-in-out infinite}
.act-row .act-stop{grid-column:4;grid-row:1;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;margin-left:2px;border-radius:100px;
  border:1px solid rgba(var(--bad-rgb),.55);background:rgba(var(--bad-rgb),.1);color:var(--bad);font-family:inherit;font-size:12.5px;font-weight:600;line-height:1;cursor:pointer}
.act-row .act-stop .ico{width:12px;height:12px}
.act-row .act-stop:hover{background:var(--bad);border-color:var(--bad);color:#fff}
.act-row .act-stop:focus-visible{outline:2px solid var(--bad);outline-offset:2px}
.act-empty{margin:0;padding:6px 10px 10px;color:var(--muted);font-size:13px}
.act-empty[hidden]{display:none}
@keyframes act-spin{to{transform:rotate(360deg)}}
@keyframes act-slide{from{left:-30%}to{left:100%}}
@media (prefers-reduced-motion:reduce){.act-btn.busy::after{animation:none}.act-bar.ind>i{animation:none;width:100%;opacity:.5}.act-bar>i{transition:none}}
`;

export const ACTIVITY_HTML = /* html */ `
  <div class="act-menu">
    <button class="icon-btn act-btn" id="act-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="act-pop" aria-label="서버 활동" title="서버 활동">${icon("activity")}<span class="act-count" id="act-count" hidden></span></button>
    <div class="pop-list act-pop" id="act-pop" role="dialog" aria-label="서버 활동" hidden>
      <div class="act-h"><b>지금 하는 일</b><span class="act-live" id="act-live">연결하고 있습니다</span></div>
      <ul class="act-list" id="act-running" aria-live="polite"></ul>
      <p class="act-empty" id="act-idle">지금은 하는 일이 없습니다.</p>
      <div class="act-h sub"><b>최근 10분</b></div>
      <ul class="act-list" id="act-recent"></ul>
      <p class="act-empty" id="act-none">최근에 끝난 일이 없습니다.</p>
    </div>
  </div>`;

export const ACTIVITY_SCRIPT = /* js */ `
// ── activity menu ──
var actLive=false;
let actWs=null,actRetry=1000,actPoll=null,actSnap={running:[],recent:[]},actTick=null;
const ACT_ICON={running:${JSON.stringify(icon("activity"))},done:${JSON.stringify(icon("check"))},failed:${JSON.stringify(icon("x"))},stopped:${JSON.stringify(icon("stop"))}};
const ACT_STOP=${JSON.stringify(icon("stop"))};
const actGb=(n)=>(n/1073741824).toFixed(n>=10737418240?0:1)+' GB';
function actDur(ms){const s=Math.max(0,Math.round(ms/1000));if(s<60)return s+'초';const m=Math.floor(s/60);if(m<60)return m+'분 '+(s%60)+'초';return Math.floor(m/60)+'시간 '+(m%60)+'분';}
function actAgo(t){const s=Math.round((Date.now()-t)/1000);return s<60?'방금':Math.floor(s/60)+'분 전';}
function actProgress(e){
  if(e.kind==='nsz')return e.total?Math.min(100,Math.round(e.current/e.total*100))+'% · '+actGb(e.current)+' / '+actGb(e.total):e.current?actGb(e.current):'';
  return e.total?num(e.current)+' / '+num(e.total):'';}
function actRow(e,live){
  const li=el('li',null,'act-row '+e.state);li.dataset.id=e.id;
  const ic=el('span',null,'ic');ic.innerHTML=ACT_ICON[e.state]||ACT_ICON.running;
  li.append(ic,el('span',e.title,'t'),el('span','','n'),el('span','','d'));
  if(live){const bar=el('div',null,'act-bar');bar.append(el('i'));li.append(bar);}
  return li;}
function actFillRunning(li,e){
  const p=actProgress(e);li.querySelector('.n').textContent=(p?p+' · ':'')+actDur(Date.now()-e.startedAt);
  li.querySelector('.d').textContent=e.detail||'';li.querySelector('.d').hidden=!e.detail;
  const bar=li.querySelector('.act-bar');const pct=e.total?Math.min(100,e.current/e.total*100):null;
  bar.classList.toggle('ind',pct==null);bar.firstChild.style.width=pct==null?'':pct+'%';
  let stop=li.querySelector('.act-stop');
  if(e.cancellable&&!stop){stop=el('button',null,'act-stop');stop.type='button';stop.innerHTML=ACT_STOP+'<span>중지</span>';
    stop.title='이 작업을 중지합니다';stop.addEventListener('click',(ev)=>{ev.stopPropagation();actCancel(e.id);});li.append(stop);}
  else if(!e.cancellable&&stop)stop.remove();
  bar.setAttribute('role','progressbar');bar.setAttribute('aria-label',e.title);if(pct!=null)bar.setAttribute('aria-valuenow',String(Math.round(pct)));else bar.removeAttribute('aria-valuenow');}
function actRender(){
  const {running,recent}=actSnap;
  const btnEl=$('act-btn');btnEl.classList.toggle('busy',running.length>0);
  $('act-count').hidden=!running.length;$('act-count').textContent=running.length;
  btnEl.title=running.length?'서버 활동: '+running.length+'개 진행 중':'서버 활동';
  // Running rows are kept by id, so a bar moves instead of being drawn again.
  const box=$('act-running');const keep=new Map([...box.children].map((li)=>[li.dataset.id,li]));
  // A row is moved only when its place changes: one taken out of the page, even for a moment, loses the click being pressed on it.
  const rows=running.map((e)=>{const li=keep.get(e.id)||actRow(e,true);keep.delete(e.id);actFillRunning(li,e);return li;});
  for(const li of keep.values())li.remove();
  rows.forEach((li,i)=>{if(box.children[i]!==li)box.insertBefore(li,box.children[i]||null);});
  $('act-idle').hidden=running.length>0;
  const rbox=$('act-recent');rbox.replaceChildren(...recent.map((e)=>{const li=actRow(e,false);
    li.querySelector('.n').textContent=actDur(e.ms)+' · '+actAgo(e.endedAt);
    const d=e.state==='failed'?(e.error||'실패했습니다'):e.state==='stopped'?'중지했습니다'+(e.result?' ('+e.result+')':''):(e.result||e.detail||'');li.querySelector('.d').textContent=d;li.querySelector('.d').hidden=!d;return li;}));
  $('act-none').hidden=recent.length>0;}
// The panels that follow a job read again when it steps or ends, at most every two seconds.
const actQ={};
function actSoon(key,fn){const q=actQ[key]||(actQ[key]={at:0,t:0});if(q.t)return;
  // The window starts when a read finishes, so a slow one never overlaps the next.
  q.t=setTimeout(async()=>{try{await fn();}finally{q.t=0;q.at=Date.now();}},Math.max(0,q.at+2000-Date.now()));}
const ACT_FOLLOW=[
  {kinds:['nsz'],when:()=>nzVisible(),run:()=>loadNsz()},
  {kinds:['retro-art'],when:()=>location.hash==='#retro',run:()=>loadRetroArt()},
  {kinds:['scan:games','sync'],ended:true,when:()=>location.hash==='#library',run:()=>loadLibrary()},
  {kinds:['scan:homebrew','homebrew-github'],ended:true,when:()=>location.hash==='#homebrew',run:()=>loadHomebrew()},
];
function actFollow(prev,next){
  // Ended: gone from running, or new in recent (a job that began and ended between two updates).
  const ids=new Set(next.running.map((e)=>e.id)),seen=new Set(prev.recent.map((e)=>e.id));
  const ended=[...prev.running.filter((e)=>!ids.has(e.id)),...next.recent.filter((e)=>!seen.has(e.id))].map((e)=>e.kind);
  const live=next.running.map((e)=>e.kind);
  for(const f of ACT_FOLLOW){
    const hit=f.kinds.some((k)=>ended.includes(k)||(!f.ended&&live.includes(k)));
    if(hit&&f.when())actSoon(f.kinds[0],f.run);}}
async function actCancel(id){if(!await ask('이 작업을 중지할까요?'))return;
  try{await api('/admin/api/activity/'+encodeURIComponent(id)+'/cancel',{method:'POST'});toast('작업을 중지합니다.');}
  catch(err){if(err.message!=='session')toast(err.message);}}
function actApply(snap){const prev=actSnap;actSnap={running:snap.running||[],recent:snap.recent||[]};actRender();actFollow(prev,actSnap);}
function actSetLive(on){actLive=on;const l=$('act-live');l.classList.toggle('on',on);l.textContent=on?'실시간':'15초마다 확인합니다';}
async function actPollOnce(){if(document.visibilityState!=='visible')return;
  // A poll answered after the socket came back is older than what the socket sent.
  try{const snap=await api('/admin/api/activity');if(!actLive)actApply(snap);}catch{/* the next poll tries again */}}
function actFallback(){if(actPoll)return;actPollOnce();actPoll=setInterval(actPollOnce,15000);}
function actConnect(){
  try{actWs=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/admin/ws');}
  catch{actSetLive(false);actFallback();setTimeout(actConnect,actRetry);actRetry=Math.min(actRetry*2,30000);return;}
  actWs.onopen=()=>{actSetLive(true);actRetry=1000;clearInterval(actPoll);actPoll=null;};
  actWs.onmessage=(ev)=>{let m;try{m=JSON.parse(ev.data);}catch{return;}if(m.type==='activity')actApply(m);};
  actWs.onclose=()=>{const was=actLive;actWs=null;actSetLive(false);actFallback();
    // The panels go back to their own timers while the socket is down.
    if(was){if(nzVisible())loadNsz();if(location.hash==='#retro')loadRetroArt();}
    setTimeout(actConnect,actRetry);actRetry=Math.min(actRetry*2,30000);};}
function setActOpen(open){$('act-pop').hidden=!open;$('act-btn').setAttribute('aria-expanded',String(open));
  clearInterval(actTick);actTick=open?setInterval(()=>{if(actSnap.running.length||actSnap.recent.length)actRender();},1000):null;
  if(open)actRender();}
$('act-btn').addEventListener('click',(e)=>{e.stopPropagation();setAcct(false);setActOpen($('act-pop').hidden);});
$('acct-btn').addEventListener('click',()=>setActOpen(false));
document.addEventListener('click',(e)=>{if(!$('act-pop').hidden&&!e.target.closest('.act-menu'))setActOpen(false);});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!$('act-pop').hidden){setActOpen(false);$('act-btn').focus();}});
actConnect();
`;
