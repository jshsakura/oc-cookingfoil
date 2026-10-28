/**
 * The admin file browser: the "파일" tab of each library page (games, retro, homebrew, patches, saves),
 * locked to that page's folder, over /admin/api/files (files-api.js). The folder path as links, a table
 * whose header stays under the page header, and a bar at the bottom that holds the selection's actions
 * and the pager. The folder lives in the address (?tab=folder&path=), so back, reload and links land on it.
 * The move dialog still has a root picker, so a move can cross folders.
 * Everything is scoped under #fb so it never restyles the rest of the page.
 */
import { icon } from "../../views/icons.js";
import { top, topLabel, topPh } from "./top-i18n.js";

const ROOT_ICONS = { games: "grid", incoming: "inbox", retro: "joystick", homebrew: "package", patches: "puzzle", saves: "save" };

export const FILES_CSS = /* css */ `
#fb{display:flex;flex-direction:column;gap:12px}
#fb .fb-roots{display:flex;gap:6px;flex-wrap:wrap}
#fb .fb-roots button{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 14px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--panel);color:var(--muted);font-weight:700}
#fb .fb-roots button[aria-pressed="true"]{background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.55);color:var(--text)}
#fb .fb-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#fb .fb-crumb{flex:1 1 320px;display:flex;align-items:center;gap:2px;flex-wrap:wrap;min-width:0;margin:0;padding:0;list-style:none}
#fb .fb-crumb li{display:flex;align-items:center;gap:2px;min-width:0}
#fb .fb-crumb li+li::before{content:"/";color:var(--faint);padding:0 4px}
#fb .fb-crumb button{border:0;background:none;padding:4px 6px;border-radius:var(--r-sm);color:var(--muted);font-weight:700;max-width:28ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-crumb button:hover{color:var(--text);background:var(--sunk)}
#fb .fb-crumb li:last-child button{color:var(--text)}
#fb .fb-q{position:relative;flex:0 1 280px;display:flex}
#fb .fb-q .ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
#fb .fb-q input{width:100%;padding-left:36px}
#fb .fb-wrap{border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel);overflow:clip}
/* overflow:visible undoes the admin tables' overflow:hidden, which would pin the header row to the table instead of the window. */
#fb table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;overflow:visible}
/* A row scrolled into view (a focus, a find) lands below the pinned header row, not under it. */
html:has(#fb){scroll-padding-top:calc(var(--adm-hdr-h,0px) + 48px);scroll-padding-bottom:72px}
/* A file list stays a table on a phone: the admin page's narrow-screen cards (dashboard-page.js) would stack each cell. */
#fb table{display:table}#fb thead{display:table-header-group}#fb tbody{display:table-row-group}
#fb tr,#fb tr:first-child:has(th){display:table-row;background:none;border:0;border-radius:0;margin:0;padding:0}
#fb td{display:table-cell;width:auto}#fb td::before{content:none}
#fb thead th{position:sticky;top:var(--adm-hdr-h,0px);z-index:2;background:var(--panel);border-bottom:1px solid var(--line);padding:0 10px;height:42px;text-align:left;font-size:var(--fs-xs);font-weight:700;color:var(--muted);white-space:nowrap}
#fb thead th button{border:0;background:none;padding:6px 0;color:inherit;font:inherit;display:inline-flex;gap:4px;align-items:center}
#fb thead th button[aria-sort]{color:var(--text)}
#fb td{padding:0 10px;height:48px;border-bottom:1px solid var(--line2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
#fb tbody tr:last-child td{border-bottom:0}
#fb tbody tr:hover td{background:var(--sunk)}
#fb tbody tr[aria-selected="true"] td{background:rgba(var(--accent-rgb),.10)}
#fb .c-sel{width:44px;text-align:center}#fb .c-size{width:110px;text-align:right}#fb .c-mtime{width:180px}#fb .c-act{width:132px}
#fb .c-size,#fb .c-mtime{font-variant-numeric:tabular-nums;color:var(--muted)}
#fb th.c-size button{margin-left:auto}
#fb .fb-name{display:flex;align-items:center;gap:10px;min-width:0}
#fb .fb-name .ico{color:var(--muted)}#fb .fb-name .is-dir{color:var(--accent)}
#fb .fb-name button,#fb .fb-name span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-name button{border:0;background:none;padding:0;color:var(--text);font-weight:700;text-align:left}
#fb .fb-name button:hover{text-decoration:underline}
#fb .fb-act{display:flex;gap:6px;justify-content:flex-end}
#fb .fb-act button.ib{width:34px;height:34px;padding:0;position:relative}
#fb .fb-act button.ib>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#fb input[type=checkbox]{width:18px;height:18px;margin:0;accent-color:var(--accent)}
#fb .fb-empty{padding:48px 16px;text-align:center;color:var(--muted)}
/* The bar holds to the window's bottom edge while the list runs past it, and ends the list when it does not. */
#fb .fb-foot{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:-4px;
  padding:10px 14px;border:1px solid var(--line);border-radius:var(--r-lg);background:color-mix(in srgb,var(--panel) 92%,transparent);backdrop-filter:blur(8px);box-shadow:0 -4px 16px var(--shadow)}
#fb .fb-info{color:var(--muted);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
#fb .fb-foot[data-sel] .fb-info{color:var(--text);font-weight:700}
#fb .fb-sel-act{display:flex;gap:6px}#fb .fb-foot:not([data-sel]) .fb-sel-act{display:none}
#fb .fb-pager{margin-left:auto;display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
#fb .fb-pager[hidden]{display:none}
#fb .fb-pager button{width:36px;height:36px;padding:0;display:inline-flex;align-items:center;justify-content:center}
#fb .fb-note{margin:0;font-size:var(--fs-xs)}
/* Files dragged over the list: the list is the target, outlined, with what dropping does said on it. */
#fb .fb-wrap{position:relative}
#fb .fb-drop{display:none;position:absolute;inset:0;z-index:4;place-items:center;border:2px dashed var(--accent);border-radius:inherit;
  background:color-mix(in srgb,var(--panel) 86%,transparent);color:var(--text);font-weight:700;pointer-events:none}
#fb.dragging .fb-drop{display:grid}
#fb .fb-wrap:has(.fb-empty:not([hidden])){min-height:160px}
#fb .fb-up{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}
#fb .fb-up[hidden]{display:none}
#fb-file{display:none}
#fb-move{width:min(560px,calc(100vw - 32px))}
#fb-move .fb-m-crumb{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin:8px 0;color:var(--muted);font-size:var(--fs-sm)}
#fb-move .fb-m-crumb button{border:0;background:none;padding:2px 4px;color:var(--muted);font-weight:700}
#fb-move .fb-m-list{max-height:min(50vh,420px);overflow:auto;border:1px solid var(--line);border-radius:var(--r-lg);margin:0 0 12px;padding:4px}
#fb-move .fb-m-list button{display:flex;width:100%;align-items:center;gap:8px;border:0;background:none;padding:9px 10px;border-radius:var(--r-md);text-align:left;color:var(--text)}
#fb-move .fb-m-list button:hover{background:var(--sunk)}
#fb-move .fb-m-list .ico{color:var(--accent)}
#fb-move .fb-m-list p{margin:12px;color:var(--muted)}
/* A phone's top bar has no fixed height, so the header row scrolls with the table there. */
@media (max-width:899px){#fb thead th{position:static}}
@media (max-width:760px){
  #fb .c-mtime{display:none}#fb .c-size{width:84px}#fb .c-act{width:88px}
  #fb .fb-act .fb-dl{display:none}
  #fb .fb-q{flex:1 1 100%}
}
@media (prefers-reduced-motion:reduce){#fb *{transition:none!important}}
`;

/** Where a page puts its file browser; the split page swaps the marker for FOLDER_HTML (ids stay unique). */
export const FOLDER_MARK = "<!--folder-->";

export const FOLDER_HTML = `<div id="fb">
  <div class="fb-bar">
    <ol class="fb-crumb" id="fb-crumb" ${topLabel("fb.crumbLabel")}></ol>
    <label class="fb-q">${icon("search")}<input type="search" id="fb-q" autocomplete="off" spellcheck="false" maxlength="200" ${topPh("fb.qPh")} ${topLabel("fb.qPh")}></label>
    <button type="button" id="fb-mkdir">${icon("plus")}${top("fb.newFolder")}</button>
    <button type="button" id="fb-upload">${icon("upload")}${top("fb.upload")}</button>
    <input type="file" id="fb-file" multiple tabindex="-1" aria-hidden="true">
  </div>
  <div class="fb-wrap"><table>
    <thead><tr>
      <th class="c-sel"><input type="checkbox" id="fb-all" ${topLabel("fb.selectAll")}></th>
      <th class="c-name"><button type="button" data-sort="name">${top("fb.colName")}</button></th>
      <th class="c-size"><button type="button" data-sort="size">${top("fb.colSize")}</button></th>
      <th class="c-mtime"><button type="button" data-sort="mtime">${top("fb.colMtime")}</button></th>
      <th class="c-act"></th>
    </tr></thead>
    <tbody id="fb-rows"></tbody>
  </table><div class="fb-empty" id="fb-empty" hidden></div><div class="fb-drop" aria-hidden="true">${top("fb.dropHere")}</div></div>
  <p class="muted fb-note">${top("fb.note")}</p>
  <div class="fb-foot" id="fb-foot">
    <span class="fb-info" id="fb-info" aria-live="polite"></span>
    <span class="fb-up" id="fb-up" aria-live="polite" hidden></span>
    <div class="fb-sel-act">
      <button type="button" id="fb-move-btn">${top("fb.move")}</button>
      <button type="button" id="fb-trash-btn" class="danger">${top("fb.trash")}</button>
      <button type="button" id="fb-clear">${top("fb.clear")}</button>
    </div>
    <nav class="fb-pager" id="fb-pager" hidden>
      <button type="button" id="fb-prev" ${topLabel("fb.prev")}>${icon("chevleft")}</button>
      <span id="fb-page"></span>
      <button type="button" id="fb-next" ${topLabel("fb.next")}>${icon("chevright")}</button>
    </nav>
  </div>
</div>
<dialog id="fb-move" aria-labelledby="fb-m-title">
  <h3 id="fb-m-title">${top("fb.moveTitle")}</h3>
  <div class="fb-roots" id="fb-m-roots" role="group" ${topLabel("fb.rootsLabel")}></div>
  <div class="fb-m-crumb" id="fb-m-crumb"></div>
  <div class="fb-m-list" id="fb-m-list"></div>
  <div class="dialog-actions"><button type="button" id="fb-m-no">${top("fb.cancel")}</button><button type="button" class="primary" id="fb-m-ok">${top("fb.moveHere")}</button></div>
</dialog>`;

export const FILES_SCRIPT = /* js */ `
const FB_ICON=${JSON.stringify({ dir: icon("folder", "ico is-dir"), file: icon("file"), up: icon("chevleft"), ...Object.fromEntries(Object.entries(ROOT_ICONS).map(([k, v]) => [k, icon(v)])) })};
const FB_PER=100;
const fb={roots:[],root:'',path:'',page:1,sort:'name',order:'asc',q:'',sel:new Set(),seq:0,data:null,timer:null};
const fbSize=(n)=>{if(n==null)return '';const u=['B','KB','MB','GB','TB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++;}return (i?v.toFixed(v<10?1:0):String(v))+' '+u[i];};
const fbDate=(ms)=>ms?new Date(ms).toLocaleString(loc(),{dateStyle:'medium',timeStyle:'short'}):'';
const fbRootName=(k)=>topText('fb.root.'+k);
function fbUrl(){const u=new URL(location.href);u.searchParams.delete('root');u.searchParams.delete('view');u.searchParams.set('tab','folder');
  if(fb.path)u.searchParams.set('path',fb.path);else u.searchParams.delete('path');return u.pathname+u.search+u.hash;}
function fbGo(root,path,{push=true}={}){fb.root=root;fb.path=path||'';fb.page=1;fb.q='';$('fb-q').value='';fb.sel.clear();
  if(push&&location.pathname+location.search+location.hash!==fbUrl())history.pushState(null,'',fbUrl());fbLoad();}
function fbRootButtons(mount,current,pick){mount.replaceChildren();for(const r of fb.roots){const b=el('button');b.type='button';
  b.innerHTML=FB_ICON[r.key]||'';b.append(el('span',fbRootName(r.key)));b.setAttribute('aria-pressed',String(r.key===current));
  b.addEventListener('click',()=>pick(r.key));mount.append(b);}}
function fbCrumb(mount,root,path,go){mount.replaceChildren();const parts=path?path.split('/'):[];
  const add=(label,to)=>{const li=el('li');const b=el('button',label);b.type='button';b.title=label;b.addEventListener('click',()=>go(to));li.append(b);mount.append(li);};
  add(fbRootName(root),'');parts.forEach((p,i)=>add(p,parts.slice(0,i+1).join('/')));}
function fbSortHeads(){for(const b of document.querySelectorAll('#fb thead [data-sort]')){const on=b.dataset.sort===fb.sort;
  if(on)b.setAttribute('aria-sort',fb.order==='asc'?'ascending':'descending');else b.removeAttribute('aria-sort');
  b.dataset.arrow=on?(fb.order==='asc'?'▲':'▼'):'';const t=b.querySelector('[data-top]');b.replaceChildren(t||b.firstChild);if(on)b.append(el('span',fb.order==='asc'?'▲':'▼'));}}
function fbRow(f){const tr=el('tr');tr.dataset.rel=f.rel;tr.setAttribute('aria-selected',String(fb.sel.has(f.rel)));
  const cs=td(null,'c-sel');const cb=el('input');cb.type='checkbox';cb.checked=fb.sel.has(f.rel);cb.setAttribute('aria-label',topFill('fb.selectRow',{name:f.name}));
  cb.addEventListener('change',()=>{if(cb.checked)fb.sel.add(f.rel);else fb.sel.delete(f.rel);tr.setAttribute('aria-selected',String(cb.checked));fbFoot();});cs.append(cb);
  const cn=td(null,'c-name');const n=el('div',null,'fb-name');const ic=el('span');ic.innerHTML=f.type==='dir'?FB_ICON.dir:FB_ICON.file;n.append(ic.firstChild);
  if(f.type==='dir'){const b=el('button',f.name);b.type='button';b.title=f.name;b.addEventListener('click',()=>fbGo(fb.root,f.rel));n.append(b);}
  else{const s=el('span',f.name);s.title=f.name;n.append(s);}cn.append(n);
  const ca=td(null,'c-act');const act=el('div',null,'fb-act');
  act.append(tbtn('rename','fb.rename',()=>fbRename(f)));
  if(f.type==='file'){const d=tbtn('download','fb.download',()=>{location.href='/admin/api/files/download?'+new URLSearchParams({root:fb.root,path:f.rel});});d.classList.add('fb-dl');act.append(d);}
  act.append(tbtn('delete','fb.trash',()=>fbTrash([f.rel]),'danger'));ca.append(act);
  tr.append(cs,cn,td(fbSize(f.size),'c-size'),td(fbDate(f.mtime),'c-mtime'),ca);return tr;}
function fbFoot(){const d=fb.data;const foot=$('fb-foot');const n=fb.sel.size;
  if(n)foot.dataset.sel='';else delete foot.dataset.sel;
  $('fb-info').textContent=n?topFill('fb.selected',{n:num(n)}):d?topFill('fb.counts',{dirs:num(d.counts.dirs),files:num(d.counts.files)}):'';
  const rows=[...document.querySelectorAll('#fb-rows tr')];const all=$('fb-all');
  all.checked=rows.length>0&&rows.every((r)=>fb.sel.has(r.dataset.rel));all.indeterminate=!all.checked&&rows.some((r)=>fb.sel.has(r.dataset.rel));
  const pg=$('fb-pager');pg.hidden=!d||d.pages<=1;if(d){$('fb-page').textContent=topFill('fb.pageOf',{page:num(d.page),pages:num(d.pages)});$('fb-prev').disabled=d.page<=1;$('fb-next').disabled=d.page>=d.pages;}}
async function fbLoad(){if(!fb.root)return;const n=++fb.seq;
  const qs=new URLSearchParams({root:fb.root,path:fb.path,page:String(fb.page),perPage:String(FB_PER),sort:fb.sort,order:fb.order});if(fb.q)qs.set('q',fb.q);
  fbCrumb($('fb-crumb'),fb.root,fb.path,(to)=>fbGo(fb.root,to));fbSortHeads();
  let d;try{d=await api('/admin/api/files/list?'+qs);}catch(err){if(n!==fb.seq)return;
    // A folder that is gone (moved elsewhere, a stale link) leads back to the top of its storage.
    if(err.code==='not-found'&&fb.path){toast(err.message);fbGo(fb.root,'',{push:false});history.replaceState(null,'',fbUrl());return;}
    fb.data=null;$('fb-rows').replaceChildren();const e=$('fb-empty');e.hidden=false;e.textContent=topFill('fb.loadFail',{msg:err.message});fbFoot();return;}
  if(n!==fb.seq)return;fb.data=d;fb.page=d.page;
  const live=new Set(d.items.map((f)=>f.rel));for(const r of [...fb.sel])if(!live.has(r))fb.sel.delete(r);
  $('fb-rows').replaceChildren(...d.items.map(fbRow));
  const e=$('fb-empty');e.hidden=d.items.length>0;e.textContent=fb.q?topText('fb.noMatch'):topText('fb.empty');fbFoot();}
async function fbRename(f){const name=await askText(topText('fb.renameAsk'),f.name);if(name==null||!name.trim()||name.trim()===f.name)return;
  try{await api('/admin/api/files/rename',{method:'POST',body:{root:fb.root,path:f.rel,name:name.trim()}});fb.sel.delete(f.rel);toast(topText('fb.renamed'));fbLoad();}catch(err){toast(err.message);}}
async function fbTrash(rels){if(!rels.length)return;
  if(!await ask(topFill('fb.askTrash',{n:num(rels.length)}),{danger:true}))return;
  try{const out=await api('/admin/api/files/trash',{method:'POST',body:{root:fb.root,paths:rels}});for(const r of rels)fb.sel.delete(r);
    toast(topFill('fb.trashed',{n:num(out.files.length)}));fbLoad();}catch(err){toast(err.message);}}
async function fbMkdir(){const name=await askText(topText('fb.newFolderAsk'),'');if(name==null||!name.trim())return;
  try{await api('/admin/api/files/mkdir',{method:'POST',body:{root:fb.root,path:fb.path,name:name.trim()}});toast(topText('fb.made'));fbLoad();}catch(err){toast(err.message);}}
// Upload into the open folder: files dropped on the list (a dropped folder keeps its shape) or picked with the
// button go up one at a time in pieces (chunkUpload, common-script.js) and land where the list was when they were
// dropped. A name the folder already has is skipped before a byte goes up; nothing is ever overwritten.
const fbu={busy:false,queue:[],done:0,total:0,placed:0,skipped:0};
async function fbEntries(entry,prefix,out){
  if(entry.isFile){out.push({file:await new Promise((ok,no)=>entry.file(ok,no)),rel:prefix+entry.name});return;}
  if(!entry.isDirectory)return;const reader=entry.createReader();
  for(;;){const batch=await new Promise((ok,no)=>reader.readEntries(ok,no));if(!batch.length)break;
    for(const e of batch)await fbEntries(e,prefix+entry.name+'/',out);}}
async function fbDropped(dt){const out=[];const entries=[];
  for(const it of dt.items||[]){if(it.kind!=='file')continue;const e=it.webkitGetAsEntry&&it.webkitGetAsEntry();if(e)entries.push(e);else{const f=it.getAsFile();if(f)out.push({file:f,rel:f.name});}}
  for(const e of entries)await fbEntries(e,'',out);
  if(!out.length&&dt.files)for(const f of dt.files)out.push({file:f,rel:f.name});
  return out;}
function fbUpShow(pct){const s=$('fb-up');if(!fbu.busy){s.hidden=true;return;}
  s.hidden=false;s.textContent=topFill('fb.uploading',{n:num(fbu.done+1),t:num(fbu.total),p:String(Math.floor(pct*100))});}
function fbUpload(items){if(!items.length||!fb.root)return;const at={root:fb.root,path:fb.path};
  for(const it of items)fbu.queue.push({...it,...at});fbu.total+=items.length;if(!fbu.busy)fbUpRun();}
async function fbUpRun(){fbu.busy=true;
  while(fbu.queue.length){const it=fbu.queue.shift();fbUpShow(0);
    const start={url:'/admin/api/files/upload/chunks',body:{root:it.root,path:it.path,rel:it.rel,size:it.file.size,lastModified:it.file.lastModified}};
    const r=await chunkUpload(null,it.file,(n)=>fbUpShow(it.file.size?n/it.file.size:1),start);
    if(r.status===200){const f=await chunkCall('POST','/admin/api/files/upload',JSON.stringify({root:it.root,path:it.path,items:[{id:r.id,rel:it.rel}]}),'application/json');
      if(f.status===200){fbu.placed+=f.d.placed.length;fbu.skipped+=f.d.skipped.length;}
      else toast(topFill('fb.upFail',{name:it.rel,msg:f.d.error||String(f.status)}));}
    else if(r.status===409&&r.d.code==='exists')fbu.skipped++;
    else toast(topFill('fb.upFail',{name:it.rel,msg:r.d?.error||topText('u.rNet')}));
    fbu.done++;
    if(it.root===fb.root&&it.path===fb.path&&!fbu.queue.length)fbLoad();}
  const msg=fbu.skipped?topFill('fb.upSome',{n:num(fbu.placed),s:num(fbu.skipped)}):topFill('fb.uploaded',{n:num(fbu.placed)});
  if(fbu.placed||fbu.skipped)toast(msg);
  Object.assign(fbu,{busy:false,done:0,total:0,placed:0,skipped:0});fbUpShow(0);}
// A page left while files go up asks first; what was sent waits a day and the same file picks up where it stopped.
window.addEventListener('beforeunload',(e)=>{if(fbu.busy){e.preventDefault();e.returnValue='';}});
{let depth=0;const wrap=document.querySelector('#fb .fb-wrap');const has=(e)=>[...(e.dataTransfer?.types||[])].includes('Files');
  wrap.addEventListener('dragenter',(e)=>{if(!has(e))return;e.preventDefault();depth++;$('fb').classList.add('dragging');});
  wrap.addEventListener('dragover',(e)=>{if(!has(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
  wrap.addEventListener('dragleave',()=>{if(--depth<=0){depth=0;$('fb').classList.remove('dragging');}});
  wrap.addEventListener('drop',async(e)=>{if(!has(e))return;e.preventDefault();depth=0;$('fb').classList.remove('dragging');fbUpload(await fbDropped(e.dataTransfer));});}
$('fb-upload').addEventListener('click',()=>$('fb-file').click());
$('fb-file').addEventListener('change',(e)=>{const files=[...e.target.files];e.target.value='';fbUpload(files.map((f)=>({file:f,rel:f.name})));});
// The move dialog walks folders only, starting where the list is; "Move here" takes the selection there.
const fbm={root:'',path:'',seq:0};
async function fbMoveLoad(){const n=++fbm.seq;const list=$('fb-m-list');
  fbRootButtons($('fb-m-roots'),fbm.root,(k)=>{fbm.root=k;fbm.path='';fbMoveLoad();});
  const c=$('fb-m-crumb');c.replaceChildren();const parts=fbm.path?fbm.path.split('/'):[];
  const add=(label,to)=>{if(c.childNodes.length)c.append(el('span','/'));const b=el('button',label);b.type='button';b.addEventListener('click',()=>{fbm.path=to;fbMoveLoad();});c.append(b);};
  add(fbRootName(fbm.root),'');parts.forEach((p,i)=>add(p,parts.slice(0,i+1).join('/')));
  let d;try{d=await api('/admin/api/files/list?'+new URLSearchParams({root:fbm.root,path:fbm.path,perPage:'500'}));}catch(err){if(n===fbm.seq)list.replaceChildren(el('p',err.message));return;}
  if(n!==fbm.seq)return;const dirs=d.items.filter((f)=>f.type==='dir'&&!(fbm.root===fb.root&&fb.sel.has(f.rel)));
  list.replaceChildren(...dirs.map((f)=>{const b=el('button');b.type='button';b.innerHTML=FB_ICON.dir;b.append(el('span',f.name));b.addEventListener('click',()=>{fbm.path=f.rel;fbMoveLoad();});return b;}));
  if(!dirs.length)list.append(el('p',topText('fb.empty')));}
function fbMove(){const rels=[...fb.sel];if(!rels.length)return;fbm.root=fb.root;fbm.path=fb.path;const dlg=$('fb-move');
  const done=()=>{$('fb-m-ok').onclick=$('fb-m-no').onclick=null;dlg.close();};
  $('fb-m-no').onclick=done;
  $('fb-m-ok').onclick=async()=>{const to={root:fbm.root,path:fbm.path};done();
    try{const out=await api('/admin/api/files/move',{method:'POST',body:{root:fb.root,paths:rels,toRoot:to.root,toPath:to.path}});
      for(const m of out.moved)fb.sel.delete(m.from);
      toast(out.skipped.length?topFill('fb.movedSome',{moved:num(out.moved.length),skipped:num(out.skipped.length)}):topFill('fb.moved',{n:num(out.moved.length)}));fbLoad();}
    catch(err){toast(err.message);}};
  dlg.showModal();fbMoveLoad();}
$('fb-all').addEventListener('change',(e)=>{for(const r of document.querySelectorAll('#fb-rows tr')){if(e.target.checked)fb.sel.add(r.dataset.rel);else fb.sel.delete(r.dataset.rel);
  r.setAttribute('aria-selected',String(e.target.checked));const cb=r.querySelector('input[type=checkbox]');if(cb)cb.checked=e.target.checked;}fbFoot();});
for(const b of document.querySelectorAll('#fb thead [data-sort]'))b.addEventListener('click',()=>{const s=b.dataset.sort;
  if(fb.sort===s)fb.order=fb.order==='asc'?'desc':'asc';else{fb.sort=s;fb.order=s==='name'?'asc':'desc';}fb.page=1;fbLoad();});
$('fb-q').addEventListener('input',()=>{clearTimeout(fb.timer);fb.timer=setTimeout(()=>{const q=$('fb-q').value.trim();if(q===fb.q)return;fb.q=q;fb.page=1;fbLoad();},250);});
$('fb-mkdir').addEventListener('click',fbMkdir);
$('fb-move-btn').addEventListener('click',fbMove);
$('fb-trash-btn').addEventListener('click',()=>fbTrash([...fb.sel]));
$('fb-clear').addEventListener('click',()=>{fb.sel.clear();for(const r of document.querySelectorAll('#fb-rows tr')){r.setAttribute('aria-selected','false');const cb=r.querySelector('input[type=checkbox]');if(cb)cb.checked=false;}fbFoot();});
$('fb-prev').addEventListener('click',()=>{if(fb.page>1){fb.page--;fbLoad();window.scrollTo({top:0});}});
$('fb-next').addEventListener('click',()=>{if(fb.data&&fb.page<fb.data.pages){fb.page++;fbLoad();window.scrollTo({top:0});}});
window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);if(fb.root&&p.get('tab')==='folder')fbGo(fb.root,p.get('path')||'',{push:false});});
// Esc clears the selection; Delete sends it to the trash. Neither fires while typing or in a dialog.
document.addEventListener('keydown',(e)=>{if(e.target.closest('input,textarea,select,dialog'))return;
  if(e.key==='Escape'&&fb.sel.size)$('fb-clear').click();else if(e.key==='Delete'&&fb.sel.size)fbTrash([...fb.sel]);});
// The page's own folder is the only root here; the roots list is for the move dialog's picker.
async function fbOpen(root){
  if(!fb.root&&!fb.booting){fb.booting=true;
    try{fb.roots=(await api('/admin/api/files/roots')).roots;}catch(err){fb.booting=false;toast(err.message);return;}
    const p=new URLSearchParams(location.search);fb.booting=false;
    fbGo(root,p.get('tab')==='folder'?p.get('path')||'':'',{push:false});}
  if(fb.root)history.replaceState(null,'',fbUrl());}
// A page's tab row with the "파일" tab: opening it starts the browser, leaving it clears the folder from the address.
function fbTabs(tab,root){subtabs(tab);const st=SUBTABS[tab];if(!st)return;const show=st.show;
  st.show=(sub)=>{show(sub);if(sub==='folder')fbOpen(root);};
  st.show(location.hash.split('/')[1]||st.cur);}
// A language switch redraws the path, the dates and the counts.
function fbRelabel(){if(typeof fb==='undefined')return;if(!fb.root)return;fbLoad();}
`;
