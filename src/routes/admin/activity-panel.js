/**
 * The shared account and activity menu on the shop and admin pages: what the server is doing right now
 * (tasks/activity.js), with a progress bar each, and what ended in the last
 * ten minutes. The shop uses /ws/library; the admin page listens on /admin/ws.
 * While the admin socket is down it reads
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
.activity-account{position:relative}
.activity-account>.pop-list{width:min(440px,calc(100vw - 24px));min-width:0;max-height:min(80dvh,760px);overflow:auto}
.activity-account .ico,.act-board .ico{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.activity-account [hidden]{display:none!important}
.activity-account .account-links{display:grid;gap:2px}
.activity-account .pop-list *{white-space:normal}
@media (max-width:640px){.top-row,.wrap>header{position:relative}.acct-menu.activity-account{position:static}.activity-account>.pop-list{width:min(440px,100%)}}
.act-btn{position:relative}
.act-btn img.acct-avatar{width:30px;height:30px;border-radius:50%;object-fit:cover;display:block}
.act-btn:has(img.acct-avatar){padding:0;overflow:visible}
.act-btn.busy{color:var(--accent);border-color:rgba(var(--accent-rgb),.55)}
.act-btn.busy::after{content:"";position:absolute;inset:-3px;border-radius:100px;border:2px solid transparent;border-top-color:var(--accent);animation:act-spin 1.1s linear infinite}
.act-count{position:absolute;top:-5px;right:-5px;display:grid;place-items:center;box-sizing:border-box;min-width:18px;height:18px;padding:0 5px;border-radius:100px;background:var(--accent);color:var(--accent-ink);font-family:inherit;font-size:11px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.act-count[hidden]{display:none}
.act-pop{max-height:min(45dvh,420px);overflow:auto;padding:10px 0 4px;margin-top:6px;border-top:1px solid var(--line)}
.act-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px 8px;font-size:13px}
.act-h.sub{margin-top:6px;padding-top:10px;border-top:1px solid var(--line)}
/* In the account menu the rules run edge to edge across the menu's 6px padding; the content stays where it was. */
.activity-account .pop-list .menu-sep{margin:4px -6px}
.activity-account .act-pop{margin:6px -6px 0;padding:10px 6px 4px}
.activity-account .act-h.sub{margin:6px -6px 0;padding:10px 16px 8px}
.act-live{color:var(--faint);font-size:12px;font-weight:600}
.act-live.on{color:var(--good)}
.act-list{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.act-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:4px 8px;align-items:center;padding:8px 10px;border-radius:10px}
.act-row:hover{background:var(--sunk)}
.act-row .ic{grid-column:1;grid-row:1 / span 3;display:grid;place-items:center;width:26px;height:26px;border-radius:100px;background:var(--sunk);color:var(--muted)}
.act-row .ic .ico{width:14px;height:14px}
.act-row.running .ic{background:rgba(var(--accent-rgb),.16);color:var(--accent)}
.act-row.done .ic{background:rgba(var(--good-rgb),.14);color:var(--good)}
.act-row.failed .ic{background:rgba(var(--bad-rgb),.14);color:var(--bad)}
.act-row .t{grid-column:2;grid-row:1;font-weight:600;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:normal;overflow-wrap:anywhere}
.act-row .n{grid-column:2 / -1;grid-row:2;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:normal;overflow-wrap:anywhere;text-align:left}
.act-row .d{grid-column:2 / -1;grid-row:3;color:var(--muted);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:normal;overflow-wrap:anywhere}
.act-row.failed .d{color:var(--bad)}
.act-bar{grid-column:2 / -1;grid-row:4;position:relative;height:4px;margin-top:4px;border-radius:100px;background:var(--sunk);overflow:hidden}
.act-bar>i{position:absolute;inset:0 auto 0 0;width:0;border-radius:inherit;background:var(--accent);transition:width .4s ease}
.act-bar.ind>i{width:30%;animation:act-slide 1.4s ease-in-out infinite}
.act-row .act-stop{grid-column:3;grid-row:1;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;margin-left:2px;border-radius:100px;
  border:1px solid rgba(var(--bad-rgb),.55);background:rgba(var(--bad-rgb),.1);color:var(--bad);font-family:inherit;font-size:12.5px;font-weight:600;line-height:1;cursor:pointer}
.act-row .act-stop .ico{width:12px;height:12px}
.act-row .act-stop:hover{background:var(--bad);border-color:var(--bad);color:#fff}
.act-row .act-stop:focus-visible{outline:2px solid var(--bad);outline-offset:2px}
.act-empty{margin:0;padding:6px 10px 10px;color:var(--muted);font-size:13px}
.act-empty[hidden]{display:none}
.act-board{margin-top:10px;padding:10px 6px 4px;border-radius:14px;background:var(--sunk)}
.act-board[hidden]{display:none}
.act-board .act-h{padding-top:0}
.act-board .act-row:hover{background:transparent}
@keyframes act-spin{to{transform:rotate(360deg)}}
@keyframes act-slide{from{left:-30%}to{left:100%}}
@media (prefers-reduced-motion:reduce){.act-btn.busy::after{animation:none}.act-bar.ind>i{animation:none;width:100%;opacity:.5}.act-bar>i{transition:none}}
`;

export const ACTIVITY_BUTTON_HTML = `${icon("account")}<span class="act-count" id="act-count" hidden></span>`;

// The shop's stats panel lists the running tasks too, for every signed-in account; it is hidden while nothing runs.
export const ACTIVITY_BOARD_HTML = /* html */ `
    <section class="act-board" id="act-board" role="region" aria-labelledby="act-board-heading" hidden>
      <div class="act-h"><b id="act-board-heading">지금 하는 일</b></div>
      <ul class="act-list" id="act-board-list"></ul>
    </section>`;

export const ACTIVITY_HTML = /* html */ `
    <section class="act-pop" id="act-pop" role="region" aria-label="서버 활동">
      <div class="act-h"><b id="act-heading">지금 하는 일</b><span class="act-live" id="act-live">연결하고 있습니다</span></div>
      <ul class="act-list" id="act-running" aria-live="polite"></ul>
      <p class="act-empty" id="act-idle">지금은 하는 일이 없습니다.</p>
      <div class="act-h sub"><b id="act-recent-heading">최근 10분</b></div>
      <ul class="act-list" id="act-recent"></ul>
      <p class="act-empty" id="act-none">최근에 끝난 일이 없습니다.</p>
    </section>`;

const ACTIVITY_WORDS = {
  ko: { label: "서버 활동", menu: "계정 메뉴 및 서버 활동", heading: "지금 하는 일", recent: "최근 10분", idle: "지금은 하는 일이 없습니다.", none: "최근에 끝난 일이 없습니다.", live: "실시간", polling: "15초마다 확인합니다", stop: "중지", confirm: "이 작업을 중지할까요?", stopping: "작업을 중지합니다.", stopped: "중지했습니다", failed: "실패했습니다", now: "방금", seconds: "초", minutes: "분", hours: "시간", ago: "분 전" },
  en: { label: "Server activity", menu: "Account menu and server activity", heading: "Running now", recent: "Last 10 minutes", idle: "No tasks are running.", none: "No recently completed tasks.", live: "Live", polling: "Checking every 15 seconds", stop: "Stop", confirm: "Stop this task?", stopping: "Stopping the task.", stopped: "Stopped", failed: "Failed", now: "Just now", seconds: "s", minutes: "m", hours: "h", ago: "m ago" },
  ja: { label: "サーバーの動作", menu: "アカウントメニューとサーバーの動作", heading: "実行中", recent: "直近10分", idle: "実行中の作業はありません。", none: "最近完了した作業はありません。", live: "リアルタイム", polling: "15秒ごとに確認", stop: "停止", confirm: "この作業を停止しますか？", stopping: "作業を停止します。", stopped: "停止しました", failed: "失敗しました", now: "たった今", seconds: "秒", minutes: "分", hours: "時間", ago: "分前" },
  zh: { label: "服务器活动", menu: "账户菜单与服务器活动", heading: "正在运行", recent: "最近10分钟", idle: "目前没有正在运行的任务。", none: "最近没有已完成的任务。", live: "实时", polling: "每15秒检查一次", stop: "停止", confirm: "停止此任务？", stopping: "正在停止任务。", stopped: "已停止", failed: "失败", now: "刚刚", seconds: "秒", minutes: "分", hours: "小时", ago: "分钟前" },
};

const ADMIN_FOLLOW_SCRIPT = /* js */ `const ACT_FOLLOW=[
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
`;

const ADMIN_CHANNEL_SCRIPT = /* js */ `function actConnect(){
  try{actWs=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/admin/ws');}
  catch{actSetLive(false);actFallback();setTimeout(actConnect,actRetry);actRetry=Math.min(actRetry*2,30000);return;}
  actWs.onopen=()=>{actSetLive(true);actRetry=1000;clearInterval(actPoll);actPoll=null;};
  actWs.onmessage=(ev)=>{let m;try{m=JSON.parse(ev.data);}catch{return;}if(m.type==='activity')actApply(m);};
  actWs.onclose=()=>{const was=actLive;actWs=null;actSetLive(false);actFallback();
    // The panels go back to their own timers while the socket is down.
    if(was){if(nzVisible())loadNsz();if(location.hash==='#retro')loadRetroArt();}
    setTimeout(actConnect,actRetry);actRetry=Math.min(actRetry*2,30000);};}
`;

export function activityScript({ web = false } = {}) {
  return /* js */ `
// ── activity menu ──
var actLive=false;
let actCanCancel=${web ? "false" : "true"};
const actWords=${JSON.stringify(ACTIVITY_WORDS)};
const actText=(key)=>actWords[${web ? "lang" : "adminLang"}]?.[key]||actWords.en[key];
const actApi=${web ? "(url,init)=>fetch(url,init).then(async(r)=>{if(!r.ok){const e=new Error(\"HTTP \"+r.status);e.status=r.status;throw e;}return r.json();})" : "api"};
const actEl=${web ? "(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}" : "el"};
const actNum=${web ? "(n)=>Number(n).toLocaleString(lang)" : "num"};
let actWs=null,actRetry=1000,actPoll=null,actSnap={running:[],recent:[]},actTick=null,actBoardTick=null;
const ACT_ICON={running:${JSON.stringify(icon("activity"))},done:${JSON.stringify(icon("check"))},failed:${JSON.stringify(icon("x"))},stopped:${JSON.stringify(icon("stop"))}};
const ACT_STOP=${JSON.stringify(icon("stop"))};
const actGb=(n)=>(n/1073741824).toFixed(n>=10737418240?0:1)+' GB';
function actDur(ms){const s=Math.max(0,Math.round(ms/1000));if(s<60)return s+actText('seconds');const m=Math.floor(s/60);if(m<60)return m+actText('minutes')+' '+(s%60)+actText('seconds');return Math.floor(m/60)+actText('hours')+' '+(m%60)+actText('minutes');}
function actAgo(t){const s=Math.round((Date.now()-t)/1000);return s<60?actText('now'):Math.floor(s/60)+actText('ago');}
function actProgress(e){
  if(e.kind==='nsz')return e.total?Math.min(100,Math.round(e.current/e.total*100))+'% · '+actGb(e.current)+' / '+actGb(e.total):e.current?actGb(e.current):'';
  return e.total?actNum(e.current)+' / '+actNum(e.total):'';}
function actRow(e,live){
  const li=actEl('li',null,'act-row '+e.state);li.dataset.id=e.id;
  const ic=actEl('span',null,'ic');ic.innerHTML=ACT_ICON[e.state]||ACT_ICON.running;
  li.append(ic,actEl('span',e.title,'t'),actEl('span','','n'),actEl('span','','d'));
  if(live){const bar=actEl('div',null,'act-bar');bar.append(actEl('i'));li.append(bar);}
  return li;}
function actFillRunning(li,e){
  const p=actProgress(e);li.querySelector('.n').textContent=(p?p+' · ':'')+actDur(Date.now()-e.startedAt);
  li.querySelector('.d').textContent=e.detail||'';li.querySelector('.d').hidden=!e.detail;
  const bar=li.querySelector('.act-bar');const pct=e.total?Math.min(100,e.current/e.total*100):null;
  bar.classList.toggle('ind',pct==null);bar.firstChild.style.width=pct==null?'':pct+'%';
  let stop=li.querySelector('.act-stop');
  if(actCanCancel&&e.cancellable&&!stop){stop=actEl('button',null,'act-stop');stop.type='button';stop.innerHTML=ACT_STOP;stop.append(actEl('span',actText('stop')));
    stop.title=actText('stop');stop.addEventListener('click',(ev)=>{ev.stopPropagation();actCancel(e.id);});li.append(stop);}
  else if((!actCanCancel||!e.cancellable)&&stop){stop.remove();stop=null;}
  if(stop){stop.querySelector('span').textContent=actText('stop');stop.title=actText('stop');}
  bar.setAttribute('role','progressbar');bar.setAttribute('aria-label',e.title);if(pct!=null)bar.setAttribute('aria-valuenow',String(Math.round(pct)));else bar.removeAttribute('aria-valuenow');}
// Running rows are kept by id, so a bar moves instead of being drawn again.
function actSyncRunning(box,running){const keep=new Map([...box.children].map((li)=>[li.dataset.id,li]));
  // A row is moved only when its place changes: one taken out of the page, even for a moment, loses the click being pressed on it.
  const rows=running.map((e)=>{const li=keep.get(e.id)||actRow(e,true);keep.delete(e.id);actFillRunning(li,e);return li;});
  for(const li of keep.values())li.remove();
  rows.forEach((li,i)=>{if(box.children[i]!==li)box.insertBefore(li,box.children[i]||null);});}
function actRender(){
  const {running,recent}=actSnap;
  const btnEl=$('acct-btn');btnEl.classList.toggle('busy',running.length>0);
  $('act-count').hidden=!running.length;$('act-count').textContent=running.length;
  btnEl.title=actText('menu')+(running.length?' ('+running.length+')':'');btnEl.setAttribute('aria-label',btnEl.title);$('acct-list').setAttribute('aria-label',actText('menu'));
  $('act-pop').setAttribute('aria-label',actText('label'));$('act-heading').textContent=actText('heading');$('act-recent-heading').textContent=actText('recent');$('act-idle').textContent=actText('idle');$('act-none').textContent=actText('none');
  actSyncRunning($('act-running'),running);
  const board=$('act-board');
  if(board){board.hidden=!running.length;$('act-board-heading').textContent=actText('heading');actSyncRunning($('act-board-list'),running);
    // The board's times move while it shows something; the menu keeps its own timer while open.
    if(running.length&&!actBoardTick)actBoardTick=setInterval(()=>{if(!actTick)actRender();},1000);
    else if(!running.length&&actBoardTick){clearInterval(actBoardTick);actBoardTick=null;}}
  $('act-idle').hidden=running.length>0;
  const rbox=$('act-recent');rbox.replaceChildren(...recent.map((e)=>{const li=actRow(e,false);
    li.querySelector('.n').textContent=actDur(e.ms)+' · '+actAgo(e.endedAt);
    const d=e.state==='failed'?(e.error||actText('failed')):e.state==='stopped'?actText('stopped')+(e.result?' ('+e.result+')':''):(e.result||e.detail||'');li.querySelector('.d').textContent=d;li.querySelector('.d').hidden=!d;return li;}));
  $('act-none').hidden=recent.length>0;}
// The panels that follow a job read again when it steps or ends, at most every two seconds.
const actQ={};
function actSoon(key,fn){const q=actQ[key]||(actQ[key]={at:0,t:0});if(q.t)return;
  // The window starts when a read finishes, so a slow one never overlaps the next.
  q.t=setTimeout(async()=>{try{await fn();}finally{q.t=0;q.at=Date.now();}},Math.max(0,q.at+2000-Date.now()));}
${web ? "function actFollow() {}" : ADMIN_FOLLOW_SCRIPT}
async function actCancel(id){if(!actCanCancel)return;if(!await ${web ? "confirmAsk({text:actText('confirm'),title:actText('stop'),action:actText('stop')})" : "ask(actText('confirm'))"})return;
  try{await actApi('/admin/api/activity/'+encodeURIComponent(id)+'/cancel',{method:'POST'});toast(actText('stopping'));}
  catch(err){if(err.message!=='session')toast(err.message);}}
function actApply(snap){const prev=actSnap;actSnap={running:snap.running||[],recent:snap.recent||[]};actRender();actFollow(prev,actSnap);}
function actSetLive(on){actLive=on;const l=$('act-live');l.classList.toggle('on',on);l.textContent=actText(on?'live':'polling');}
async function actPollOnce(){if(document.visibilityState!=='visible')return;
  // A poll answered after the socket came back is older than what the socket sent.
  try{const snap=await actApi('${web ? '/api/activity' : '/admin/api/activity'}');if(!actLive)actApply(snap);}catch{/* the next poll tries again */}}
function actFallback(){if(actPoll)return;actPollOnce();actPoll=setInterval(actPollOnce,15000);}
${web ? "" : ADMIN_CHANNEL_SCRIPT}
function actSetOpenState(open){
  clearInterval(actTick);actTick=open?setInterval(()=>{if(actSnap.running.length||actSnap.recent.length)actRender();},1000):null;
  if(open)actRender();}
const activityMenu={apply:actApply,setLive(on){actSetLive(on);if(on){clearInterval(actPoll);actPoll=null;}else actFallback();},setOpen:actSetOpenState,relabel(){actRender();actSetLive(actLive);},async permissions(me){
  if(me&&!me.admin)return;
  try{const r=await fetch('/admin/api/activity/access',{headers:{Accept:'application/json'}});actCanCancel=r.ok&&Boolean((await r.json()).canCancel);actRender();}catch{}
}};
// A signed-in Google account wears its Gravatar on the account button; with none, the icon stays.
// The last picture is remembered in this browser and put on at once, so a reload doesn't show the
// plain icon first and swap it a moment later; the account's answer then confirms or clears it.
const ACCT_AVATAR_KEY='cf.acct-avatar';
let acctIcon=null;
function acctPut(url){const b=document.getElementById('acct-btn');if(!b)return;
  acctIcon??=b.querySelector('svg');const cur=b.querySelector('img.acct-avatar');
  if(!url){if(cur&&acctIcon)cur.replaceWith(acctIcon);return;}
  if(cur){if(cur.getAttribute('src')!==url)cur.src=url;return;}
  if(!acctIcon)return;
  const img=new Image();img.className='acct-avatar';img.alt='';img.referrerPolicy='no-referrer';img.decoding='async';
  img.onerror=()=>{if(img.isConnected&&acctIcon)img.replaceWith(acctIcon);};
  img.src=url;acctIcon.replaceWith(img);}
function acctAvatar(url){
  try{if(url)localStorage.setItem(ACCT_AVATAR_KEY,url);else localStorage.removeItem(ACCT_AVATAR_KEY);}catch{}
  acctPut(url||null);}
try{acctPut(localStorage.getItem(ACCT_AVATAR_KEY));}catch{}
actRender();actSetLive(false);
${web ? "actFallback();" : "actConnect();"}
`;
}

export const ACTIVITY_SCRIPT = activityScript();
