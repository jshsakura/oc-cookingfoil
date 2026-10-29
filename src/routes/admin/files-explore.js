/**
 * The file browser's desktop explorer habits, on top of files-panel.js (same script, same `fb` state):
 * back, forward and up buttons over the tab's own steps, an address you can type (a click on the path's
 * empty space, or Ctrl+L), a search through every folder below, type-to-find on the rows, cut, copy and
 * paste (Ctrl+X, C, V), Ctrl+Z over this tab's own steps, a properties dialog (Alt+Enter), an icon view
 * with image thumbnails, and a box drawn on the list's empty space to pick rows.
 */
export const EXPLORE_CSS = /* css */ `
#fb .fb-nav,#fb .fb-views{display:flex;gap:4px}
#fb .fb-nav .ib,#fb .fb-views .ib{width:38px;height:38px;padding:0;display:inline-flex;align-items:center;justify-content:center}
#fb .fb-upb .ico{transform:rotate(90deg)}
#fb .fb-views .ib[aria-pressed="true"]{background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.55);color:var(--text)}
#fb .fb-crumb{cursor:text;min-height:38px;border-radius:var(--r-md)}
#fb .fb-crumb:hover{background:var(--sunk)}
#fb .fb-crumb[hidden],#fb .fb-addr[hidden]{display:none}
#fb .fb-addr{flex:1 1 320px;min-width:0}
#fb .fb-deep{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:var(--fs-sm);white-space:nowrap}
#fb .fb-where{flex:0 1 auto;color:var(--faint);font-size:var(--fs-xs)}
#fb tbody tr.fb-cut td{opacity:.45}
#fb .fb-thumb{width:20px;height:20px;object-fit:cover;border-radius:var(--r-sm);flex:none}
.fb-lasso{position:fixed;z-index:50;border:1px solid var(--accent);background:rgba(var(--accent-rgb),.12);pointer-events:none}
.fb-lasso[hidden]{display:none}
#fb-props{width:min(480px,calc(100vw - 32px))}
#fb-props h3{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb-props .fb-p-list{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 16px;margin:12px 0}
#fb-props dt{color:var(--muted)}#fb-props dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
/* The icon view: the same rows laid out as tiles, the name under a large icon or the image itself. */
#fb.grid thead{display:none}
#fb.grid table{display:block}
#fb.grid tbody{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:8px;padding:10px}
#fb.grid tbody tr{display:flex;flex-direction:column;position:relative;border-radius:var(--r-lg);padding:12px 8px 10px}
#fb.grid tbody tr:hover{background:var(--sunk)}
#fb.grid tbody tr[aria-selected="true"]{background:rgba(var(--accent-rgb),.14)}
#fb.grid td{display:block;height:auto;border:0;padding:0;background:none!important;overflow:visible;white-space:normal}
#fb.grid td.c-size,#fb.grid td.c-mtime,#fb.grid td.c-act{display:none}
#fb.grid td.c-sel{position:absolute;top:6px;left:6px;width:auto;opacity:0;z-index:1}
#fb.grid tr:hover td.c-sel,#fb.grid tr[aria-selected="true"] td.c-sel{opacity:1}
#fb.grid .fb-name{flex-direction:column;gap:8px;text-align:center}
#fb.grid .fb-name>.ico{width:72px;height:72px}
#fb.grid .fb-gicon{width:120px;height:120px;flex:0 0 120px;border-radius:var(--r-lg)}
#fb.grid .fb-thumb{width:100%;height:120px;object-fit:contain;background:var(--sunk);border-radius:var(--r-md)}
#fb.grid .fb-name button,#fb.grid .fb-name span{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;max-width:100%;overflow-wrap:anywhere;text-align:center}
@media (max-width:760px){#fb .fb-views,#fb .fb-deep{order:1}#fb.grid tbody{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}#fb.grid .fb-gicon{width:88px;height:88px;flex-basis:88px}}
`;

export const EXPLORE_SCRIPT = /* js */ `
function fbNav(){$('fb-back').disabled=fb.hi<=0;$('fb-fwd').disabled=fb.hi>=fb.hmax;$('fb-upb').disabled=!fb.path;}
$('fb-back').addEventListener('click',()=>{if(fb.hi>0)history.back();});
$('fb-fwd').addEventListener('click',()=>{if(fb.hi<fb.hmax)history.forward();});
$('fb-upb').addEventListener('click',fbParent);
// The path turns into a text box to type a folder into; Enter goes there, Esc or leaving it puts the path back.
function fbAddrOpen(){const a=$('fb-addr');a.value='/'+fb.path;$('fb-crumb').hidden=true;a.hidden=false;a.focus();a.select();}
function fbAddrClose(){$('fb-addr').hidden=true;$('fb-crumb').hidden=false;}
$('fb-crumb').addEventListener('click',(e)=>{if(!e.target.closest('button'))fbAddrOpen();});
$('fb-addr').addEventListener('keydown',(e)=>{if(e.key==='Escape'){e.preventDefault();fbAddrClose();}
  else if(e.key==='Enter'){e.preventDefault();const to=$('fb-addr').value.split('/').map((p)=>p.trim()).filter(Boolean).join('/');fbAddrClose();fbGo(fb.root,to);}});
$('fb-addr').addEventListener('blur',fbAddrClose);
$('fb-deep').addEventListener('change',(e)=>{fb.deep=e.target.checked;if(fb.q){fbLoad();}});
// Letters typed on a row go to the first name that starts with them; one letter again steps to the next such name.
const fbType={buf:'',t:0};
$('fb-rows').addEventListener('keydown',(e)=>{if(e.target.tagName!=='TR'||e.key.length!==1||e.key===' '||e.ctrlKey||e.metaKey||e.altKey)return;
  e.preventDefault();clearTimeout(fbType.t);fbType.buf+=e.key.toLowerCase();fbType.t=setTimeout(()=>{fbType.buf='';},800);
  const items=fb.data?.items||[];const i=items.findIndex((f)=>f.rel===fb.focus);
  const one=[...fbType.buf].every((c)=>c===fbType.buf[0]);const want=one?fbType.buf[0]:fbType.buf;const from=one?i+1:Math.max(i,0);
  const hit=[...items.slice(from),...items.slice(0,from)].find((f)=>f.name.toLowerCase().startsWith(want));
  if(hit){fbPick(hit.rel);fbFocusRow();}});
// Cut, copy and paste. A cut is a move when it is pasted (the rows stay dimmed until then); a copy is made on the
// server, checked against the original, and a name the folder has gets a number.
const fbClipped=(rel)=>fb.clip?.mode==='cut'&&fb.clip.root===fb.root&&fb.clip.rels.includes(rel);
function fbClip(mode){const rels=[...fb.sel];if(!rels.length)return;fb.clip={mode,root:fb.root,rels};
  for(const r of document.querySelectorAll('#fb-rows tr'))r.classList.toggle('fb-cut',fbClipped(r.dataset.rel));
  toast(topFill(mode==='cut'?'fb.clipCut':'fb.clipCopy',{n:num(rels.length)}));}
async function fbPaste(){const c=fb.clip;if(!c)return;const to={root:fb.root,path:fb.path};
  if(c.mode==='cut'){fb.clip=null;await fbMoveTo(c.rels,to.root,to.path,c.root);return;}
  try{const out=await fbCopyRun({root:c.root,paths:c.rels,toRoot:to.root,toPath:to.path});
    if(out.copied.length)fbUndoPush({trash:{root:to.root,paths:out.copied.map((x)=>x.to)}});
    toast(out.skipped.length?topFill('fb.copiedSome',{n:num(out.copied.length),s:num(out.skipped.length)}):topFill('fb.copied',{n:num(out.copied.length)}));fbLoad();}
  catch(err){toast(err.message);}}
// Ctrl+Z takes back this tab's steps, newest first: a move or rename through the journal, a trash out of the
// trash, a new folder or a copy into the trash. The trash page keeps every step, from any tab.
const FB_UNDO_MAX=30;
function fbUndoPush(step){const journal=(step.journal||[]).filter(Boolean);
  if(step.journal&&!journal.length)return;if(step.restore&&!step.restore.length)return;
  fb.undos.push({...step,journal});if(fb.undos.length>FB_UNDO_MAX)fb.undos.shift();}
// Every part of a step is tried even when one fails (a file changed since), and the first refusal is said.
async function fbUndo(){const step=fb.undos.pop();if(!step){toast(topText('fb.undoNone'));return;}
  const calls=[...[...step.journal].reverse().map((id)=>['/admin/api/trash/undo',{id}])];
  if(step.restore)calls.push(['/admin/api/trash/restore',{ids:step.restore}]);if(step.trash)calls.push(['/admin/api/files/trash',step.trash]);
  let fail=null;for(const [url,body] of calls){try{await api(url,{method:'POST',body});}catch(err){fail??=err;}}
  toast(fail?topFill('fb.undoFail',{msg:fail.message}):topText('fb.undone'));fbLoad();}
// Properties of the pick, or of the open folder when nothing is picked: sizes and counts go through every folder.
async function fbProps(){const rels=fb.sel.size?[...fb.sel]:null;const one=rels?.length===1?fbItem(rels[0]):null;
  const dlg=$('fb-props');const list=$('fb-p-list');const lead=rels?rels[0]:fb.path;
  const at=lead.split('/').slice(0,-1);const folderOnly=!rels||one?.type==='dir';
  $('fb-p-title').textContent=one?one.name:rels?topFill('fb.p.many',{n:num(rels.length)}):(fb.path.split('/').pop()||fbRootName(fb.root));
  const base=[];if(one)base.push(['fb.p.kind',one.type==='dir'?topText('fb.p.dir'):(one.ext?one.ext.toUpperCase()+' ':'')+topText('fb.p.file')]);
  base.push(['fb.p.where',[fbRootName(fb.root),...at].join(' / ')]);
  const put=(pairs)=>list.replaceChildren(...pairs.flatMap(([k,v])=>[el('dt',topText(k)),el('dd',v)]));
  put([...base,['fb.p.size',topText('fb.p.counting')]]);if(!dlg.open)dlg.showModal();
  try{const r=await api('/admin/api/files/info',{method:'POST',body:{root:fb.root,paths:rels||[fb.path]}});if(!dlg.open)return;
    const rows=[...base,['fb.p.size',topFill('fb.p.bytes',{size:fbSize(r.bytes),bytes:num(r.bytes)})]];
    if(one?.type!=='file')rows.push(['fb.p.holds',topFill('fb.p.holdsVal',{files:num(r.files),dirs:num(Math.max(0,r.dirs-(folderOnly?1:0)))})]);
    rows.push(['fb.p.mtime',fbDate(one?one.mtime:r.newest)]);if(r.cut)rows.push(['fb.p.note',topText('fb.p.cut')]);put(rows);}
  catch(err){if(dlg.open)put([...base,['fb.p.size',err.message]]);}}
$('fb-p-ok').addEventListener('click',()=>$('fb-props').close());
$('fb-props').addEventListener('close',()=>fbFocusRow());
// The icon view is remembered per browser. Images show themselves as tiles once they scroll near the window.
const fbGrid=()=>$('fb').classList.contains('grid');
const fbCols=()=>fbGrid()?getComputedStyle($('fb-rows')).gridTemplateColumns.split(' ').length||1:1;
function fbSetView(grid){$('fb').classList.toggle('grid',grid);$('fb-v-list').setAttribute('aria-pressed',String(!grid));$('fb-v-grid').setAttribute('aria-pressed',String(grid));
  try{localStorage.setItem('fb.view',grid?'grid':'list');}catch{}fbThumbs();}
$('fb-v-list').addEventListener('click',()=>fbSetView(false));$('fb-v-grid').addEventListener('click',()=>fbSetView(true));
const FB_THUMB_MAX=4*1048576,FB_THUMB_KEEP=300;const fbThumbUrls=new Map();
const fbThumbSeen=new IntersectionObserver((seen)=>{for(const it of seen)if(it.isIntersecting){fbThumbSeen.unobserve(it.target);fbThumbLoad(it.target);}},{rootMargin:'200px'});
function fbThumbs(){fbThumbSeen.disconnect();if(!fbGrid())return;
  for(const tr of document.querySelectorAll('#fb-rows tr')){const f=fbItem(tr.dataset.rel);if(f&&fbKind(f)==='image'&&f.size<=FB_THUMB_MAX&&!tr.querySelector('.fb-thumb'))fbThumbSeen.observe(tr);}}
async function fbThumbLoad(tr){const f=fbItem(tr.dataset.rel);if(!f)return;const key=fb.root+'|'+f.rel+'|'+f.mtime;let url=fbThumbUrls.get(key);
  if(!url){try{const r=await fetch('/admin/api/files/download?'+new URLSearchParams({root:fb.root,path:f.rel}));if(!r.ok)return;url=URL.createObjectURL(await r.blob());}catch{return;}
    fbThumbUrls.set(key,url);if(fbThumbUrls.size>FB_THUMB_KEEP){const [k,u]=fbThumbUrls.entries().next().value;URL.revokeObjectURL(u);fbThumbUrls.delete(k);}}
  const ic=tr.isConnected&&tr.querySelector('.fb-name>.ico');if(!ic)return;const img=el('img');img.className='fb-thumb';img.alt='';img.src=url;ic.replaceWith(img);}
{let v=null;try{v=localStorage.getItem('fb.view');}catch{}if(v==='grid')fbSetView(true);}
// A drag that starts on the list's empty space draws a box and picks the rows it touches (Ctrl or Shift adds to the
// pick); a plain click there lets the pick go.
{let start=null,base=null,drew=false;const box=$('fb-lasso');const wrap=document.querySelector('#fb .fb-wrap');
  const off=(e)=>e.target.closest('#fb-rows tr,thead,button,input,a,#fb-menu');
  wrap.addEventListener('pointerdown',(e)=>{if(e.button!==0||e.pointerType==='touch'||off(e))return;e.preventDefault();
    start={x:e.clientX,y:e.clientY};base=e.ctrlKey||e.metaKey||e.shiftKey?new Set(fb.sel):new Set();drew=false;});
  addEventListener('pointermove',(e)=>{if(!start)return;const x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY),w=Math.abs(e.clientX-start.x),h=Math.abs(e.clientY-start.y);
    if(!drew&&w+h<6)return;drew=true;box.hidden=false;Object.assign(box.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
    fb.sel=new Set(base);for(const tr of document.querySelectorAll('#fb-rows tr')){const r=tr.getBoundingClientRect();if(r.right>x&&r.left<x+w&&r.bottom>y&&r.top<y+h)fb.sel.add(tr.dataset.rel);}
    fbPaint();});
  addEventListener('pointerup',()=>{if(!start)return;start=null;box.hidden=true;
    if(!drew&&base&&!base.size&&fb.sel.size){fb.sel.clear();fb.anchor=null;fbPaint();}});}
// The rest of the explorer keys, anywhere on the open file tab and never while typing or in a dialog.
document.addEventListener('keydown',(e)=>{if(!$('fb')?.offsetParent||e.target.closest('input,textarea,select,dialog'))return;
  const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();const texty=!getSelection().isCollapsed;
  if(mod&&k==='c'&&fb.sel.size&&!texty){e.preventDefault();fbClip('copy');}
  else if(mod&&k==='x'&&fb.sel.size&&!texty){e.preventDefault();fbClip('cut');}
  else if(mod&&k==='v'&&fb.clip){e.preventDefault();fbPaste();}
  else if(mod&&k==='z'&&!e.shiftKey){e.preventDefault();fbUndo();}
  else if(mod&&k==='l'){e.preventDefault();fbAddrOpen();}
  else if(e.altKey&&e.key==='Enter'){e.preventDefault();fbProps();}});
`;
