/**
 * The library tab's file check (/admin/api/library/verify): counts by verdict, the modified
 * and damaged files with 다시 검사, and 전체 해시 검사. The check only informs.
 * Finding and deleting game files lives in the file browser (library-browser-panel.js);
 * GET/POST /admin/api/library/files stay for tokens and older clients.
 */

import { top } from "./top-i18n.js";

export const LIBRARY_VERIFY_HTML = `  <div class="hd"><h2 class="first">${top("lb.colCheck")}</h2><button type="button" id="lv-hash-all">${top("lv.hashAll")}</button></div>
  <p class="muted">${top("lv.lead")}</p>
  <p class="muted" id="lv-state"></p>
  <div class="cards" id="lv-cards"></div>
  <div class="scroll" id="lv-list" data-skel></div>`;

export const LIBRARY_FILES_CSS = /* css */ `
#lv-list .lv-why{display:inline-flex;align-items:center;gap:6px;max-width:100%}
#lv-list .lv-why-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#lv-list .lv-tip{flex:none;display:inline-grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:help}
#lv-list .lv-tip:hover,#lv-list .lv-tip:focus-visible{background:var(--sunk);color:var(--text)}
#lv-list .lv-tip svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lv-pop{position:fixed;z-index:60;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel);color:var(--text);box-shadow:0 10px 30px var(--shadow);font-size:var(--fs-sm);line-height:1.55;pointer-events:none}
.lv-pop b{display:block;margin-bottom:6px;font-size:var(--fs-sm)}
.lv-pop p{margin:0 0 6px;color:var(--muted)}
.lv-pop p:last-child{margin-bottom:0}
#lv-cards button.card{font:inherit;color:inherit;text-align:left;cursor:pointer}
#lv-cards button.card[aria-pressed="true"]{background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.55)}
`;

export const LIBRARY_FILES_SCRIPT = /* js */ `
// A verdict card is also the list's filter: a link with ?check=damaged opens on the damaged files alone.
let lvData=null;
const lvCheck=()=>{const v=new URLSearchParams(location.search).get('check');return ['damaged','modified','misnamed'].includes(v)?v:'';};
function lvPick(v){const next=new URL(location.href);if(v&&v!==lvCheck())next.searchParams.set('check',v);else next.searchParams.delete('check');
  history.replaceState(null,'',next);lvShow();}
async function lvLoad(){let d;try{d=await api('/admin/api/library/verify');}catch(err){toast(err.message);return;}
  lvData=d;lvShow();}
function lvShow(){const d=lvData;if(!d)return;
  const c=d.counts||{};const cards=$('lv-cards');cards.replaceChildren();const only=lvCheck();
  const card=(l,v,cls,pick)=>{const e=el(pick?'button':'div',null,'card'+(cls?' '+cls:''));e.append(el('div',num(v),'v'),el('div',l,'l'));
    if(pick){e.type='button';e.setAttribute('aria-pressed',String(only===pick));e.addEventListener('click',()=>lvPick(pick));}return e;};
  cards.append(card(topText('lv.ok'),c.ok||0),card(topText('lv.v.modified'),c.modified||0,'','modified'),card(topText('lv.v.damaged'),c.damaged||0,c.damaged?'alert':'','damaged'),card(topText('lv.unchecked'),c.unchecked||0),card(topText('lv.v.misnamed'),c.misnamed||0,'','misnamed'));
  $('lv-state').textContent=((d.status&&topText('lv.s.'+d.status))||'')+(d.current?' ('+d.current.path+')':'')+'. '+topFill('lv.pending',{n:num(d.pending),h:num(d.hashPending)});
  table('lv-list',[topText('lo.colFile'),topText('lv.colResult'),topText('lo.colReason'),''],(d.flagged||[]).filter((f)=>!only||f.verdict===only).map((f)=>{const tr=el('tr');const n=td();n.append(el('b',f.path.split('/').pop()));n.append(el('div',f.path,'muted'));
    const again=btn(topText('lv.recheck'),()=>lvRecheck(f));again.setAttribute('aria-label',topFill('lv.recheckAria',{path:f.path}));const a=td();a.append(again);
    tr.append(n,td(f.label||(f.verdict&&topText('lv.v.'+f.verdict))||f.verdict),lvReason(f),a);return tr;}),topText('lv.none'));}
// The reason on one line; the help the server wrote in the admin's language opens beside it, over the table, on hover, focus or tap.
const LV_INFO='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
function lvReason(f){const c=td();const text=(f.help&&f.help.title)||((f.reason&&topText('lv.r.'+f.reason))||f.reason||'—')+(f.contentId?'. '+topFill('lv.contentId',{id:f.contentId}):'');
  const w=el('span',null,'lv-why');w.append(el('span',text,'lv-why-t'));
  if(f.help){const b=el('button',null,'lv-tip');b.type='button';b.innerHTML=LV_INFO;b.setAttribute('aria-label',f.help.title);
    b.addEventListener('mouseenter',()=>lvTipShow(b,f.help));b.addEventListener('mouseleave',lvTipHide);
    b.addEventListener('focus',()=>lvTipShow(b,f.help));b.addEventListener('blur',lvTipHide);
    b.addEventListener('click',(e)=>{e.stopPropagation();lvTip&&lvTip.owner===b&&!lvTip.hidden?lvTipHide():lvTipShow(b,f.help);});
    w.append(b);}
  c.append(w);return c;}
let lvTip=null;
function lvTipShow(owner,help){
  if(!lvTip){lvTip=el('div',null,'lv-pop');lvTip.setAttribute('role','tooltip');lvTip.id='lv-pop';document.body.append(lvTip);
    document.addEventListener('click',(e)=>{if(!lvTip.contains(e.target))lvTipHide();});
    document.addEventListener('keydown',(e)=>{if(e.key==='Escape')lvTipHide();});
    window.addEventListener('scroll',lvTipHide,true);}
  lvTip.replaceChildren(el('b',help.title));for(const para of help.body.split('\\n\\n'))lvTip.append(el('p',para));
  lvTip.owner=owner;owner.setAttribute('aria-describedby','lv-pop');lvTip.hidden=false;
  const r=owner.getBoundingClientRect(),gap=8,vw=document.documentElement.clientWidth,vh=window.innerHeight;
  const w=Math.min(380,vw-24);lvTip.style.width=w+'px';
  const h=lvTip.offsetHeight;const below=r.bottom+gap+h<=vh-12;
  lvTip.style.top=Math.max(12,below?r.bottom+gap:r.top-gap-h)+'px';
  lvTip.style.left=Math.min(Math.max(12,r.left+r.width/2-w/2),vw-w-12)+'px';}
function lvTipHide(){if(!lvTip||lvTip.hidden)return;lvTip.hidden=true;lvTip.owner&&lvTip.owner.removeAttribute('aria-describedby');}
async function lvRecheck(f){try{await api('/admin/api/library/verify/recheck',{method:'POST',body:{rel:f.path}});toast(topText('lv.rechecking'));lvLoad();}catch(err){toast(err.message);}}
$('lv-hash-all').addEventListener('click',async()=>{
  if(!await ask(topText('lv.hashAsk')))return;
  try{const r=await api('/admin/api/library/verify/hash-all',{method:'POST',body:{}});toast(topFill('lv.queued',{n:num(r.queued)}));lvLoad();}catch(err){toast(err.message);}});
`;
