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

// 제안 (/admin/api/library/suggestions): what was found, why, what is recommended, and the files a person may drop.
export const LIBRARY_SUGGEST_HTML = `  <h2 class="first">${top("sg.tab")}</h2>
  <p class="muted">${top("sg.lead")}</p>
  <p class="muted" id="sg-state"></p>
  <div id="sg-list" data-skel></div>`;

export const LIBRARY_FILES_CSS = /* css */ `
#sg-list .sg-item{border:1px solid var(--line);border-radius:var(--r-lg);padding:12px 14px;margin:0 0 10px}
#sg-list .sg-item h3{margin:0 0 4px;font-size:var(--fs-sm)}
#sg-list .sg-item p{margin:2px 0;font-size:var(--fs-sm);overflow-wrap:anywhere}
#sg-list .sg-files{margin:6px 0 0;padding:0;list-style:none;font-size:var(--fs-xs);color:var(--faint);overflow-wrap:anywhere}
#sg-list .sg-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#lv-list .lv-why{display:inline-flex;align-items:center;gap:6px;max-width:100%}
#lv-list .lv-why-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#lv-cards button.card{font:inherit;color:inherit;text-align:left;cursor:pointer}
#lv-cards button.card[aria-pressed="true"]{background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.55)}
`;

export const LIBRARY_FILES_SCRIPT = /* js */ `
// A verdict card is also the list's filter: a link with ?check=damaged opens on the damaged files alone.
let lvData=null;
const lvCheck=()=>{const v=new URLSearchParams(location.search).get('check');return ['damaged','suspect','modified','misnamed'].includes(v)?v:'';};
// A hash mismatch may still install, so it is counted and listed apart from the files that surely fail.
const lvKind=(f)=>f.verdict==='damaged'&&f.reason==='hash-mismatch'?'suspect':f.verdict;
function lvPick(v){const next=new URL(location.href);if(v&&v!==lvCheck())next.searchParams.set('check',v);else next.searchParams.delete('check');
  history.replaceState(null,'',next);lvShow();}
async function lvLoad(){let d;try{d=await api('/admin/api/library/verify');}catch(err){toast(err.message);return;}
  lvData=d;lvShow();}
function lvShow(){const d=lvData;if(!d)return;
  const c=d.counts||{};const cards=$('lv-cards');cards.replaceChildren();const only=lvCheck();
  const card=(l,v,cls,pick)=>{const e=el(pick?'button':'div',null,'card'+(cls?' '+cls:''));e.append(el('div',num(v),'v'),el('div',l,'l'));
    if(pick){e.type='button';e.setAttribute('aria-pressed',String(only===pick));e.addEventListener('click',()=>lvPick(pick));}return e;};
  cards.append(card(topText('lv.ok'),c.ok||0),card(topText('lv.v.modified'),c.modified||0,'','modified'),card(topText('lv.v.damaged'),(c.damaged||0)-(c.suspect||0),(c.damaged||0)>(c.suspect||0)?'alert':'','damaged'),card(topText('lv.v.suspect'),c.suspect||0,'','suspect'),card(topText('lv.unchecked'),c.unchecked||0),card(topText('lv.v.misnamed'),c.misnamed||0,'','misnamed'));
  $('lv-state').textContent=((d.status&&topText('lv.s.'+d.status))||'')+(d.current?' ('+d.current.path+')':'')+'. '+topFill('lv.pending',{n:num(d.pending),h:num(d.hashPending)});
  table('lv-list',[topText('lo.colFile'),topText('lv.colResult'),topText('lo.colReason'),''],(d.flagged||[]).filter((f)=>!only||lvKind(f)===only).map((f)=>{const tr=el('tr');const n=td();n.append(el('b',f.path.split('/').pop()));n.append(el('div',f.path,'muted'));
    const again=btn(topText('lv.recheck'),()=>lvRecheck(f));again.setAttribute('aria-label',topFill('lv.recheckAria',{path:f.path}));const a=td();a.append(again);
    tr.append(n,td(f.label||(f.verdict&&topText('lv.v.'+f.verdict))||f.verdict),lvReason(f),a);return tr;}),topText('lv.none'));}
// The reason on one line; the help the server wrote in the admin's language opens beside it, over the table, on hover, focus or tap.
function lvReason(f){const c=td();const text=(f.help&&f.help.title)||((f.reason&&topText('lv.r.'+f.reason))||f.reason||'—')+(f.contentId?'. '+topFill('lv.contentId',{id:f.contentId}):'');
  const w=el('span',null,'lv-why');w.append(el('span',text,'lv-why-t'));
  if(f.help){const b=el('button',null,'lv-tip');b.type='button';b.innerHTML=LV_INFO;b.setAttribute('aria-label',f.help.title);
    b.addEventListener('mouseenter',()=>lvTipShow(b,f.help));b.addEventListener('mouseleave',lvTipHide);
    b.addEventListener('focus',()=>lvTipShow(b,f.help));b.addEventListener('blur',lvTipHide);
    b.addEventListener('click',(e)=>{e.stopPropagation();lvTip&&lvTip.owner===b&&!lvTip.hidden?lvTipHide():lvTipShow(b,f.help);});
    w.append(b);}
  c.append(w);return c;}
async function lvRecheck(f){try{await api('/admin/api/library/verify/recheck',{method:'POST',body:{rel:f.path}});toast(topText('lv.rechecking'));lvLoad();}catch(err){toast(err.message);}}
const SG_FILES_SHOWN=5;
async function sgLoad(){let d;try{d=await api('/admin/api/library/suggestions');}catch(err){toast(err.message);return;}
  const list=$('sg-list');list.removeAttribute('data-skel');
  $('sg-state').textContent=d.kept?topFill('sg.keptN',{n:num(d.kept)}):'';
  if(!d.items.length){list.replaceChildren(el('p',topText('sg.none'),'muted'));return;}
  list.replaceChildren(...d.items.map(sgItem));}
function sgItem(f){const box=el('section',null,'sg-item');const k='sg.c.'+f.code;
  box.append(el('h3',topFill(k+'.t',f.vars)),el('p',topFill(k+'.why',f.vars)),el('p',topFill('sg.rec',{text:topFill(k+'.rec',f.vars)}),'muted'));
  const files=el('ul',null,'sg-files');for(const x of f.files.slice(0,SG_FILES_SHOWN))files.append(el('li',x.rel));
  if(f.files.length>SG_FILES_SHOWN)files.append(el('li',topFill('sg.more',{n:num(f.files.length-SG_FILES_SHOWN)})));box.append(files);
  const acts=el('div',null,'sg-acts');
  for(const d of f.drops){const b=btn(topFill('sg.drop',{ext:d.ext}),()=>sgDrop(f,d));if(d.recommended)b.classList.add('primary');acts.append(b);}
  acts.append(btn(topText('sg.keep'),()=>sgKeep(f)));box.append(acts);return box;}
// A drop goes through the file browser's trash, after the files are shown; the notice takes it back.
async function sgDrop(f,d){if(!await ask(topFill('sg.askDrop',{files:d.rels.join('\\n')}),{danger:true}))return;
  try{const out=await api('/admin/api/files/trash',{method:'POST',body:{root:f.root,paths:d.rels}});
    toast(topFill('fb.trashed',{n:num(out.files.length)}));const t=$('toast');const b=el('button',topText('fb.undo'),'toast-act');b.type='button';
    b.addEventListener('click',async()=>{t.classList.remove('show');try{await api('/admin/api/trash/restore',{method:'POST',body:{ids:out.restore}});toast(topText('fb.undone'));sgLoad();}catch(err){toast(err.message);}});
    t.append(b);clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),7000);sgLoad();}
  catch(err){toast(err.message);}}
async function sgKeep(f){try{await api('/admin/api/library/suggestions/keep',{method:'POST',body:{id:f.id}});toast(topText('sg.kept'));sgLoad();}catch(err){toast(err.message);}}
$('lv-hash-all').addEventListener('click',async()=>{
  if(!await ask(topText('lv.hashAsk')))return;
  try{const r=await api('/admin/api/library/verify/hash-all',{method:'POST',body:{}});toast(topFill('lv.queued',{n:num(r.queued)}));lvLoad();}catch(err){toast(err.message);}});
`;
