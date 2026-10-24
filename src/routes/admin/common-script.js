/**
 * The script every admin page shares, inlined once per page (dashboard-script.js
 * on the still-whole pages, the split pages of the admin redesign on their own).
 *
 * Extracted verbatim from dashboard-script.js: the element/format helpers, the
 * icon button, the ask dialog, the toast, the API wrapper and the paged table.
 * Two guards were added for the split pages, which carry no ip or credential
 * dialog of their own: the ip-close wiring and the 401 handler must survive
 * those elements being absent.
 *
 * admInterval(fn, ms) is the redesign's timer: it stops while the tab is hidden
 * and lets go of the interval when the page goes away, so a page that is left
 * stops asking its API.
 */
export const COMMON_SCRIPT = /* js */ `
const $=(id)=>document.getElementById(id);
const fmt=(t)=>t?new Date(t).toLocaleString('ko-KR'):'—';
// Relative time in the page's own words: the same dictionary agoT reads.
const ago=(t)=>{if(!t)return '—';const s=Math.max(0,Math.round((Date.now()-t)/1000));
  if(s<60)return topFill('acc.ago.s',{n:s});if(s<3600)return topFill('acc.ago.m',{n:Math.round(s/60)});
  if(s<86400)return topFill('acc.ago.h',{n:Math.round(s/3600)});return topFill('acc.ago.d',{n:Math.round(s/86400)});};
const num=(n)=>Number(n||0).toLocaleString('ko-KR');
// ago in the page's language (top-i18n.js).
const agoT=(t)=>{if(!t)return '—';const s=Math.max(0,Math.round((Date.now()-t)/1000));
  return s<60?topFill('acc.ago.s',{n:s}):s<3600?topFill('acc.ago.m',{n:Math.round(s/60)}):s<86400?topFill('acc.ago.h',{n:Math.round(s/3600)}):topFill('acc.ago.d',{n:Math.round(s/86400)});};
// A last sign-in: when, relative with the exact time on hover, and how; its address opens the account's sign-ins.
function loginCell(at,method,ip,open){if(!at)return td('—','dim');
  const c=td();const s=el('span',agoT(at)+(method?' · '+topText('acc.method.'+method):''));s.title=fmt(at);c.append(s);
  if(open){c.append(el('br'),ipButton(ip||topText('acc.loginHistory'),'acc.loginHistory',open));}return c;}
function ipButton(txt,label,open){const b=el('button',txt,'ip-more');b.type='button';b.title=topText(label);b.setAttribute('aria-label',txt+' · '+topText(label));
  b.addEventListener('click',open);return b;}
// Where a console or an account connected from, in a dialog. Every value goes in as text.
function ipDialog(title,hint,rows){$('ip-title').textContent=title;$('ip-hint').textContent=hint;
  $('ip-list').replaceChildren(...(rows.length?rows:[el('p',topText('acc.noHistory'),'muted')]));$('ip-dialog').showModal();}
if($('ip-close'))$('ip-close').addEventListener('click',()=>$('ip-dialog').close());
async function openDeviceIps(a){
  try{const d=await api('/admin/api/access-history?device='+encodeURIComponent(a.deviceKey));
    ipDialog(topFill('acc.ipTitle',{name:a.label||a.code||a.deviceKey.slice(0,8)}),topText('acc.ipHint'),d.days.map((x)=>{
      const r=el('div',null,'ip-row');const ips=el('div',null,'ip-chips');
      for(const i of x.ips)ips.append(el('span',i.ip+' · '+topFill('acc.times',{n:i.n}),'ip'));
      if(x.other)ips.append(el('span',topFill('acc.otherIps',{n:x.other}),'muted'));
      r.append(el('b',x.day),ips);return r;}));}catch(err){toast(errText(err));}}
async function openLogins(owner,name){
  try{const d=await api('/admin/api/access-history?account='+encodeURIComponent(owner));
    ipDialog(topFill('acc.loginTitle',{name}),topText('acc.loginHint'),d.logins.map((x)=>{
      const r=el('div',null,'ip-row');const how=el('div',null,'ip-chips');how.append(el('span',topText('acc.method.'+x.method)),el('span',x.ip||'—','ip'));
      r.append(el('b',fmt(x.at)),how);return r;}));}catch(err){toast(errText(err));}}
function whenCell(at){const c=td(agoT(at),at?'':'dim');if(at)c.title=fmt(at);return c;}
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;}
function td(txt,cls){return el('td',txt,cls);}
// Row actions show an icon; on a wide screen the label hides and stays as the tooltip and accessible name.
const TRASH='<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
const PENCIL='<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>';
const CROSS='<path d="M6 6l12 12M18 6L6 18"/>';
const BAN='<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>';
const STAR='<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>';
const ROTATE='<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>';
const ICONS={'삭제':TRASH,'줄 삭제':TRASH,'폐기':TRASH,
  '편집':PENCIL,'이름':PENCIL,'이름 변경':PENCIL,
  '승인':'<path d="M5 12.5l4.5 4.5L19 7.5"/>','거절':CROSS,'취소':CROSS,'빼기':'<path d="M5 12h14"/>',
  '접근 키 회수':BAN,'사용 중지':BAN,'해제':BAN,
  '키 재발급':'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
  '재시도':ROTATE,'다시 시작':ROTATE,'되돌립니다':'<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  '복사':'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  '설명':'<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3"/>','지금 확인':ROTATE,
  '추천 버전입니다':STAR,'추천 버전으로 정합니다':STAR,
  '그림':'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>',
  '지금 다운로드':'<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  '패치 올리기':'<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>','세이브 올리기':'<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  'GitHub 연결':'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1 1"/>'};
function btn(txt,fn,cls){const b=el('button',null,cls);b.type='button';const icon=ICONS[txt];
  if(icon){b.classList.add('ib');b.title=txt;b.setAttribute('aria-label',txt);
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg>';b.append(el('span',txt));}
  else b.textContent=txt;
  b.addEventListener('click',fn);return b;}
// Asks in a dialog that looks like the rest of the page, instead of the browser's confirm().
// Removing, revoking and the like pass {danger:true}: their confirm button is red
// and the cancel button starts focused. The message itself may be any language.
function askDialog(msg,value,opts={}){const d=$('ask-dialog'),ok=$('ask-ok'),no=$('ask-no'),inp=$('ask-input');
  const typing=value!==undefined,danger=opts.danger===true;
  $('ask-text').textContent=msg;ok.className=danger?'danger-solid':'primary';inp.hidden=!typing;inp.value=typing?value:'';
  return new Promise((resolve)=>{const done=(v)=>{ok.onclick=no.onclick=d.oncancel=inp.onkeydown=null;d.close();resolve(v);};
    const yes=()=>done(typing?inp.value:true),nope=()=>done(typing?null:false);
    ok.onclick=yes;no.onclick=nope;d.oncancel=(e)=>{e.preventDefault();nope();};
    inp.onkeydown=(e)=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();yes();}};
    d.showModal();if(typing){inp.focus();inp.select();}else(danger?no:ok).focus();});}
const ask=(msg,opts)=>askDialog(msg,undefined,opts);
const askText=(msg,value='',opts)=>askDialog(msg,value,opts);
function pill(txt,kind){return el('span',txt,'pill'+(kind?' '+kind:''));}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2400);}
// table(mount,cols,rows,empty) is in grid.js.
function pagedTable(id,cols,items,row,empty,opts={}){
  table(id,cols,opts.slice?row(items):items.map(row),empty,{search:true,label:opts.label,placeholder:opts.placeholder});}
// Refusals the page acts on say themselves in the page's language (top-i18n.js).
const errText=(err)=>{const k=err.code&&('er.'+err.code);return (k&&topText(k))||err.message;};
async function api(url,opts={}){
  // The admin API answers its errors in the page's language (routes/admin/api-words.js).
  const init={headers:{Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'},...opts};
  if(opts.body!==undefined){init.headers['Content-Type']='application/json';init.body=JSON.stringify(opts.body);}
  const r=await fetch(url,init);
  // Signed out (or the first account just switched sign-in on): reload, which leads
  // to the sign-in page, but never while a new password is still on screen.
  if(r.status===401){const cred=$('cred-dialog');
    if(cred&&cred.open)cred.addEventListener('close',()=>location.reload(),{once:true});else location.reload();throw new Error('session');}
  const data=await r.json().catch(()=>({}));
  // A refusal the page acts on carries a stable code; older answers put theirs in error.
  if(!r.ok){const e=new Error(data.message||data.error||('HTTP '+r.status));e.code=data.code||data.error;throw e;}
  return data;}
// A poll that a hidden tab or a left page should not keep running.
// Three lifecycle bits: stopped (stop(): listeners removed, never again),
// pageHidden (pagehide: like hidden, but pageshow/BFCache is the only wake),
// and document.hidden (the tab's own visibility). An in-flight run always
// finishes; the finally block schedules the next tick only when no lifecycle
// bit paused or stopped the poll, so an async completion during pagehide
// cannot resurrect the timer. fn's rejection is the caller's business: the
// poll keeps going (the finally runs regardless of the promise's outcome).
function admInterval(fn,ms){
  let t=0,stopped=false,pageHidden=false,inflight=false;
  function held(){return stopped||pageHidden||document.hidden;}
  async function tick(){
    t=0;
    if(held())return;
    if(inflight){schedule();return;}
    inflight=true;
    try{await fn();}finally{inflight=false;if(!held())schedule();}}
  function schedule(){if(held())return;clearTimeout(t);t=setTimeout(tick,ms);}
  const onVis=()=>{if(document.hidden){clearTimeout(t);t=0;}else if(!stopped&&!pageHidden&&!t&&!inflight)schedule();};
  const onHide=()=>{pageHidden=true;clearTimeout(t);t=0;};
  const onShow=()=>{pageHidden=false;if(!stopped&&!document.hidden&&!t&&!inflight)schedule();};
  document.addEventListener('visibilitychange',onVis);
  addEventListener('pagehide',onHide);
  addEventListener('pageshow',onShow);
  if(!document.hidden)tick();
  return {stop(){stopped=true;clearTimeout(t);t=0;
    document.removeEventListener('visibilitychange',onVis);
    removeEventListener('pagehide',onHide);removeEventListener('pageshow',onShow);}};}

// Sub-tab bars inside a section: one area at a time, the address carries the
// choice. Works on the whole-page dashboard and on the split pages alike.
const SUBTABS={};
function subtabs(tab){const bar=$(tab+'-subtabs');if(!bar)return;
  const subs=[...bar.querySelectorAll('[data-sub]')].map((b)=>b.dataset.sub);
  if(!subs.length)return;
  const st={cur:subs[0],show(sub){if(!subs.includes(sub))return;st.cur=sub;
    for(const b of bar.querySelectorAll('[data-sub]'))b.setAttribute('aria-selected',String(b.dataset.sub===sub));
    for(const p of $('tab-'+tab)?.querySelectorAll('[data-sub-panel]')||[])p.hidden=p.dataset.subPanel!==sub;}};
  for(const b of bar.querySelectorAll('[data-sub]'))b.addEventListener('click',()=>{
    history.replaceState(null,'','#'+tab+'/'+b.dataset.sub);st.show(b.dataset.sub);});
  SUBTABS[tab]=st;}
`;