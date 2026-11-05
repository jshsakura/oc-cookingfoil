/**
 * The file browser's desktop explorer habits, on top of files-panel.js (same script, same `fb` state):
 * back, forward and up buttons over the tab's own steps, an address you can type (a click on the path's
 * empty space, or Ctrl+L), a search through every folder below, type-to-find on the rows, cut, copy and
 * paste (Ctrl+X, C, V), Ctrl+Z over this tab's own steps, a properties dialog (Alt+Enter), an icon view
 * with image thumbnails, and a box drawn on the list's empty space to pick rows.
 */
export const EXPLORE_CSS = /* css */ `
#fb .fb-nav{display:flex;gap:4px}
/* List or grid is one choice and the two panes are two switches: each pair sits in its own sunken box. */
#fb .fb-views{display:flex;gap:8px}
#fb .fb-seg{display:inline-flex;gap:2px;padding:3px;background:var(--sunk);border:1px solid var(--line);border-radius:var(--r-lg)}
#fb .fb-nav .ib{width:38px;height:38px;padding:0;display:inline-flex;align-items:center;justify-content:center}
#fb .fb-seg .ib{width:32px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--r-md);background:none;color:var(--muted)}
#fb .fb-seg .ib[aria-pressed="true"]{background:var(--panel);color:var(--text);box-shadow:0 1px 3px var(--shadow),0 0 0 1px var(--line2)}
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
#fb-props .fb-p-box{display:grid;gap:12px}#fb-props .fb-p-box:empty{display:none}
#fb-props .fb-p-list{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 16px;margin:16px 0}
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
@media (max-width:760px),(hover:none){#fb.grid td.c-sel{opacity:1}}
@media (max-width:760px){#fb .fb-views,#fb .fb-deep{order:1}#fb.grid td.c-sel{top:0;left:0;padding:8px}#fb.grid tbody{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}#fb.grid .fb-gicon{width:88px;height:88px;flex-basis:88px}}
`;

export const EXPLORE_SCRIPT = /* js */ `
function fbNav(){$('fb-back').disabled=fb.hi<=0;$('fb-fwd').disabled=fb.hi>=fb.hmax;$('fb-upb').disabled=!fb.path;}
$('fb-back').addEventListener('click',()=>{if(fb.hi>0)history.back();});
$('fb-fwd').addEventListener('click',()=>{if(fb.hi<fb.hmax)history.forward();});
$('fb-upb').addEventListener('click',fbParent);
// The path turns into a text box to type a folder into; Enter goes there, Esc or leaving it puts the path back.
function fbAddrOpen(){const a=$('fb-addr');a.value=[fbRootName(fb.root),...(fb.path?[fb.path]:[])].join('/');$('fb-crumb').hidden=true;$('fb-addr-btn').hidden=true;a.hidden=false;a.focus();a.select();}
function fbAddrClose(){$('fb-addr').hidden=true;$('fb-crumb').hidden=false;$('fb-addr-btn').hidden=false;}
$('fb-crumb').addEventListener('click',(e)=>{if(!e.target.closest('button'))fbAddrOpen();});
$('fb-addr-btn').addEventListener('click',fbAddrOpen);
$('fb-addr').addEventListener('keydown',(e)=>{if(e.key==='Escape'){e.preventDefault();fbAddrClose();}
  else if(e.key==='Enter'){e.preventDefault();const parts=$('fb-addr').value.split('/').map((p)=>p.trim()).filter(Boolean);
    // The address starts with the storage's own name; typing another one's goes there.
    const root=fb.roots.find((r)=>fbRootName(r.key)===parts[0]);if(root)parts.shift();fbAddrClose();fbGo(root?root.key:fb.root,parts.join('/'));}});
$('fb-addr').addEventListener('blur',fbAddrClose);
$('fb-deep').addEventListener('change',(e)=>{fb.deep=e.target.checked;if(fb.q){fbLoad();}});
// Letters typed on a row go to the first name that starts with them; one letter again steps to the next such name.
// A space once a name is under way belongs to the name; before that it picks the row.
const fbType={buf:'',t:0};
$('fb-rows').addEventListener('keydown',(e)=>{if(e.target.tagName!=='TR'||e.key.length!==1||(e.key===' '&&!fb.typing)||e.ctrlKey||e.metaKey||e.altKey)return;
  e.preventDefault();clearTimeout(fbType.t);fbType.buf+=e.key.toLowerCase();fb.typing=true;fbType.t=setTimeout(()=>{fbType.buf='';fb.typing=false;},800);
  const items=fb.data?.items||[];const i=items.findIndex((f)=>f.rel===fb.focus);
  const one=[...fbType.buf].every((c)=>c===fbType.buf[0]);const want=one?fbType.buf[0]:fbType.buf;const from=one?i+1:Math.max(i,0);
  const hit=[...items.slice(from),...items.slice(0,from)].find((f)=>f.name.toLowerCase().startsWith(want));
  if(hit){fbPick(hit.rel);fbFocusRow();}});
// Cut, copy and paste. A cut is a move when it is pasted (the rows stay dimmed until then); a copy is made on the
// server, checked against the original, and a name the folder has gets a number.
const fbClipped=(rel)=>fb.clip?.mode==='cut'&&fb.clip.root===fb.root&&fb.clip.rels.includes(rel);
// What was cut or copied stays through a move to another page of this tab, or a phone could not carry it there.
const FB_CLIP_KEY='fb.clip';
function fbClipSet(c){fb.clip=c;try{if(c)sessionStorage.setItem(FB_CLIP_KEY,JSON.stringify(c));else sessionStorage.removeItem(FB_CLIP_KEY);}catch{}
  fbCmds();for(const r of document.querySelectorAll('#fb-rows tr'))r.classList.toggle('fb-cut',fbClipped(r.dataset.rel));}
try{const c=JSON.parse(sessionStorage.getItem(FB_CLIP_KEY));if(['cut','copy'].includes(c?.mode)&&typeof c.root==='string'&&Array.isArray(c.rels))fb.clip=c;}catch{}
function fbClipDrop(){fbClipSet(null);fbPickBar();}
function fbClip(mode){const rels=[...fb.sel];if(!rels.length)return;fbClipSet({mode,root:fb.root,rels});
  // On a phone a held pick turns taps into picks, and the next tap has to walk to where this goes.
  if(fbPhone()){fb.sel.clear();fb.anchor=null;fbPaint();}
  const phone=fbPhone();toast(topFill(mode==='cut'?(phone?'fb.clipCutTap':'fb.clipCut'):(phone?'fb.clipCopyTap':'fb.clipCopy'),{n:num(rels.length)}));}
async function fbPaste(){const c=fb.clip;if(!c)return;const to={root:fb.root,path:fb.path};
  // What was cut or copied stays through a move to another storage, so landing there is said first.
  if(c.root!==to.root&&!await ask(topFill(c.mode==='cut'?'fb.pasteMoveAsk':'fb.pasteCopyAsk',{n:num(c.rels.length),from:fbRootName(c.root),to:fbRootName(to.root)})))return;
  if(c.mode==='cut'){fbClipSet(null);await fbMoveTo(c.rels,to.root,to.path,c.root);return;}
  await fbCopyTo(c.rels,c.root,to);}
async function fbCopyTo(rels,root,to){
  try{const out=await fbStep(()=>fbCopyRun({root,paths:rels,toRoot:to.root,toPath:to.path}),async(o)=>{const paths=o.copied.map((x)=>x.to);
      return paths.length?{trash:{root:to.root,paths},held:await fbHolds(to.root,paths).catch(()=>null)}:null;});
    const why=fbRefusal(out.skipped);if(!out.copied.length&&why){toast(why);fbLoad();return;}
    const msg=(out.skipped.length?topFill('fb.copiedSome',{n:num(out.copied.length),s:num(out.skipped.length)}):topFill('fb.copied',{n:num(out.copied.length)}))+(why?' '+why:'');
    const note=fbNotes(out.notes);
    if(out.copied.length)fbToastUndo(note?msg+'. '+note:msg,note?FB_NOTE_TOAST_MS:FB_UNDO_TOAST_MS);else toast(msg);fbLoad();}
  catch(err){toast(err.message);}}
// Ctrl+Z takes back this tab's steps, newest first: a move or rename through the journal, a trash out of the
// trash, a new folder or a copy into the trash. The trash page keeps every step, from any tab.
const FB_UNDO_MAX=30;
function fbUndoPush(step,{redoing=false}={}){const journal=(step.journal||[]).filter(Boolean);
  if(step.journal&&!journal.length)return false;if(step.restore&&!step.restore.length)return false;
  // Doing something new ends the line of what could be done again, as it does everywhere.
  if(!redoing)fb.redos=[];
  fb.undos.push({...step,journal});if(fb.undos.length>FB_UNDO_MAX)fb.undos.shift();fbCmds();return true;}
const fbPost=(what,body)=>()=>api('/admin/api/files/'+what,{method:'POST',body});
// One step: its call, and how the answer becomes something to undo. Keeping both is what lets Ctrl+Y make the same call again.
async function fbStep(run,step){const out=await run();const s=await step(out);if(s)fbUndoPush({...s,again:{run,step}});return out;}
async function fbRedo(){const again=fb.redos.pop();if(!again){toast(topText('fb.redoNone'));return;}
  try{const s=await again.step(await again.run());toast(topText(s&&fbUndoPush({...s,again},{redoing:true})?'fb.redone':'fb.redoNone'));}
  catch(err){toast(topFill('fb.redoFail',{msg:err.message}));}fbLoad();}
const fbHolds=(root,paths)=>api('/admin/api/files/info',{method:'POST',body:{root,paths}}).then((r)=>r.files);
// Every part of a step is tried even when one fails (a file changed since), and the first refusal is said.
// A new folder, a copy or an upload goes to the trash only as it was made: a file added since would go with it unasked.
// An upload taken back is sent up again out of the trash, where it waits, without the bytes; what it replaced goes back there first.
function fbUpAgain(root,paths,ids,replaced){const body=(b)=>({method:'POST',body:b});
  return {run:async()=>{const old=replaced?(await api('/admin/api/files/trash',body({root,paths}))).restore:null;await api('/admin/api/trash/restore',body({ids}));return old;},
    step:(old)=>({trash:{root,paths},held:paths.length,redoUp:true,...(old?{restore:old}:{})})};}
async function fbUndo(){const step=fb.undos.pop();if(!step){toast(topText('fb.undoNone'));return;}
  if(step.held!=null){let now;try{now=await fbHolds(step.trash.root,step.trash.paths);}catch(err){toast(topFill('fb.undoFail',{msg:err.message}));fbLoad();return;}
    if(now!==step.held){toast(topText('fb.undoKept'));fbLoad();return;}}
  const calls=[...[...step.journal].reverse().map((id)=>['/admin/api/trash/undo',{id}])];
  // Trash first: a replaced file comes back to the name the upload took.
  if(step.trash)calls.push(['/admin/api/files/trash',step.trash]);if(step.restore)calls.push(['/admin/api/trash/restore',{ids:step.restore}]);
  let fail=null,trashed=null;for(const [url,body] of calls){try{const r=await api(url,{method:'POST',body});if(body===step.trash)trashed=r.restore;}catch(err){fail??=err;}}
  if(!fail&&step.redoUp&&trashed?.length)fb.redos.push(fbUpAgain(step.trash.root,step.trash.paths,trashed,!!step.restore));else if(!fail&&step.again)fb.redos.push(step.again);
  toast(fail?topFill('fb.undoFail',{msg:fail.message}):topText('fb.undone'));
  // Standing inside what just went: step out of it, or the list reports the folder missing over this notice.
  const gone=!fail&&step.trash?.root===fb.root&&step.trash.paths.find((p)=>fb.path===p||fb.path.startsWith(p+'/'));
  if(gone){fbGo(fb.root,gone.split('/').slice(0,-1).join('/'),{push:false});history.replaceState({fbi:fb.hi},'',fbUrl());}else fbLoad();}
// Properties of the pick, or of the open folder when nothing is picked: sizes and counts go through every folder.
async function fbProps(){const rels=fb.sel.size?[...fb.sel]:null;const one=rels?.length===1?fbItem(rels[0]):null;
  const dlg=$('fb-props');const list=$('fb-p-list');const lead=rels?rels[0]:fb.path;
  const at=lead.split('/').slice(0,-1);const folderOnly=!rels||one?.type==='dir';
  $('fb-p-title').textContent=one?topText('fb.props'):rels?topFill('fb.p.many',{n:num(rels.length)}):(fb.path.split('/').pop()||fbRootName(fb.root));
  const base=[];if(one)base.push(['fb.p.kind',one.type==='dir'?topText('fb.p.dir'):(one.ext?one.ext.toUpperCase()+' ':'')+topText('fb.p.file')]);
  base.push(['fb.p.where',[fbRootName(fb.root),...at].join(' / ')]);if(one)base.push(...fbFacts(one));
  // One item says what it is as the details pane does, which a phone has no room for.
  const low=$('fb-p-low');if(one){const {head,top}=fbSideTop(one);$('fb-p-top').replaceChildren(...top);low.replaceChildren(...fbWhy(one));fbSideMeta(low,one,head);}else{$('fb-p-top').replaceChildren();low.replaceChildren();}
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
// One picture is fetched once, for the grid and the details pane alike.
async function fbBlobUrl(f){const key=fb.root+'|'+f.rel+'|'+f.mtime;let url=fbThumbUrls.get(key);if(url)return url;
  try{const r=await fetch('/admin/api/files/download?'+new URLSearchParams({root:fb.root,path:f.rel}));if(!r.ok)return null;url=URL.createObjectURL(await r.blob());}catch{return null;}
  fbThumbUrls.set(key,url);if(fbThumbUrls.size>FB_THUMB_KEEP){const [k,u]=fbThumbUrls.entries().next().value;URL.revokeObjectURL(u);fbThumbUrls.delete(k);}
  return url;}
async function fbThumbLoad(tr){const f=fbItem(tr.dataset.rel);if(!f)return;const url=await fbBlobUrl(f);if(!url)return;
  const ic=tr.isConnected&&tr.querySelector('.fb-name>.ico');if(!ic)return;const img=el('img');img.className='fb-thumb';img.alt='';img.src=url;ic.replaceWith(img);}
{let v=null;try{v=localStorage.getItem('fb.view');}catch{}if(v==='grid')fbSetView(true);}
// A drag that starts on the list's empty space draws a box and picks the rows it touches (Ctrl or Shift adds to the
// pick); a plain click there lets the pick go.
{let start=null,base=null,drew=false;const box=$('fb-lasso');const wrap=$('fb-main');
  const off=(e)=>e.target.closest('#fb-rows tr,thead,button,input,a,#fb-menu');
  wrap.addEventListener('pointerdown',(e)=>{if(e.button!==0||e.pointerType==='touch'||off(e))return;
    // The list's own scrollbar is not empty space.
    const r=wrap.getBoundingClientRect();if(e.clientX>=r.left+wrap.clientWidth||e.clientY>=r.top+wrap.clientHeight)return;e.preventDefault();
    start={x:e.clientX,y:e.clientY};base=e.ctrlKey||e.metaKey||e.shiftKey?new Set(fb.sel):new Set();drew=false;});
  addEventListener('pointermove',(e)=>{if(!start)return;const x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY),w=Math.abs(e.clientX-start.x),h=Math.abs(e.clientY-start.y);
    if(!drew&&w+h<6)return;drew=true;box.hidden=false;Object.assign(box.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
    fb.sel=new Set(base);for(const tr of document.querySelectorAll('#fb-rows tr')){const r=tr.getBoundingClientRect();if(r.right>x&&r.left<x+w&&r.bottom>y&&r.top<y+h)fb.sel.add(tr.dataset.rel);}
    fbPaint();});
  addEventListener('pointerup',()=>{if(!start)return;start=null;box.hidden=true;
    if(!drew&&base&&!base.size&&fb.sel.size){fb.sel.clear();fb.anchor=null;fbPaint();}});}
// The rest of the explorer keys, anywhere on the open file tab and never while typing or in a dialog.
document.addEventListener('keydown',(e)=>{if(!$('fb')?.offsetParent||e.target.closest(FB_NOT_KEYS))return;
  const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();const texty=!getSelection().isCollapsed;
  if(mod&&k==='c'&&fb.sel.size&&!texty){e.preventDefault();fbClip('copy');}
  else if(mod&&k==='x'&&fb.sel.size&&!texty){e.preventDefault();fbClip('cut');}
  else if(mod&&k==='v'&&fb.clip){e.preventDefault();fbPaste();}
  else if(mod&&k==='z'&&!e.shiftKey){e.preventDefault();fbUndo();}
  else if(mod&&(k==='y'||(k==='z'&&e.shiftKey))){e.preventDefault();fbRedo();}
  else if(mod&&k==='l'){e.preventDefault();fbAddrOpen();}
  else if(e.altKey&&e.key==='Enter'){e.preventDefault();fbProps();}});
`;
