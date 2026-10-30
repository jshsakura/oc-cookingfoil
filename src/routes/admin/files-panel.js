/**
 * The admin file browser: the "파일" tab of each library page (games, retro, homebrew, patches, saves),
 * locked to that page's folder, over /admin/api/files (files-api.js). The folder path as links, a table
 * whose header stays under the page header, and a bar at the bottom that holds the selection's actions
 * and the pager. The folder lives in the address (?tab=folder&path=), so back, reload and links land on it.
 * The move dialog still has a root picker, so a move can cross folders. Rows pick like a desktop file
 * manager: a click picks one, Ctrl or Cmd adds, Shift takes a range, a double click or Enter opens, the
 * arrows walk the list, and a right click (or the menu key) opens a menu of what the pick allows. Rows dragged
 * onto a folder or the path move there; a pick or a folder comes down as one zip; images and text open in a preview.
 * Everything is scoped under #fb so it never restyles the rest of the page.
 */
import { icon } from "../../views/icons.js";
import { top, topLabel, topPh } from "./top-i18n.js";
import { EXPLORE_CSS, EXPLORE_SCRIPT } from "./files-explore.js";
import { LIBRARY_CSS, LIBRARY_SCRIPT } from "./files-library.js";

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
#fb tbody tr{cursor:default}
#fb tbody tr:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
#fb-menu{position:fixed;z-index:60;min-width:200px;max-width:calc(100vw - 16px);padding:4px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel);box-shadow:0 10px 28px var(--shadow);display:flex;flex-direction:column}
#fb-menu[hidden]{display:none}
#fb-menu button{display:flex;align-items:center;gap:10px;border:0;background:none;padding:9px 12px;border-radius:var(--r-md);text-align:left;color:var(--text);font-weight:var(--fw-bold);white-space:nowrap}
#fb-menu button:hover,#fb-menu button:focus-visible{background:var(--sunk);outline:0}
#fb-menu button .ico{color:var(--muted)}
#fb-menu button[data-danger]{color:var(--bad)}#fb-menu button[data-danger] .ico{color:var(--bad)}
#fb-menu .fb-m-head{margin:4px 12px 2px;font-size:var(--fs-xs)}
#fb .c-sel{width:44px;text-align:center}#fb .c-size{width:110px;text-align:right}#fb .c-mtime{width:180px}#fb .c-act{width:132px}
#fb .c-size,#fb .c-mtime{font-variant-numeric:tabular-nums;color:var(--muted)}
#fb th.c-size button{margin-left:auto}
#fb .fb-name{display:flex;align-items:center;gap:10px;min-width:0}
#fb .fb-name .ico{color:var(--muted)}#fb .fb-name .is-dir{color:var(--accent)}
#fb .fb-name button,#fb .fb-name span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-name button{border:0;background:none;padding:0;color:var(--text);font-weight:700;text-align:left}
#fb .fb-name button:hover{text-decoration:underline}
#fb .fb-id{flex:0 0 auto;color:var(--faint);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
#fb tr.fb-skel td{height:52px;padding:0 16px}
#fb tr.fb-skel span{display:block;height:12px;width:42%;border-radius:var(--r-xs);background:var(--line);animation:fb-skel 1s ease-in-out infinite alternate}
#fb tr.fb-skel:nth-child(3n+2) span{width:30%}#fb tr.fb-skel:nth-child(3n) span{width:55%}
@keyframes fb-skel{to{opacity:.35}}
@media (prefers-reduced-motion:reduce){#fb tr.fb-skel span{animation:none}}
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
#fb .fb-note{margin:0;font-size:var(--fs-xs)}
/* Files dragged over the list: the list is the target, outlined, with what dropping does said on it. */
#fb .fb-wrap{position:relative}
#fb .fb-drop{display:none;position:absolute;inset:0;z-index:4;place-items:center;border:2px dashed var(--accent);border-radius:inherit;
  background:color-mix(in srgb,var(--panel) 86%,transparent);color:var(--text);font-weight:700;pointer-events:none}
#fb.dragging .fb-drop{display:grid}
#fb .fb-wrap:has(.fb-empty:not([hidden])){min-height:160px}
#fb-file,#fb-dir{display:none}
/* The upload panel takes the bar's full width while files go up: a head line, then one row per file. */
#fb .fb-upl{flex:1 1 100%;order:-1;display:flex;flex-direction:column;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--line2)}
#fb .fb-upl[hidden]{display:none}
#fb .fb-u-head{display:flex;align-items:center;gap:8px}
#fb .fb-u-fold{flex:1;min-width:0;display:flex;align-items:center;gap:8px;border:0;background:none;padding:4px 0;text-align:left;color:var(--text)}
#fb .fb-u-fold .ico{transition:transform .15s;color:var(--muted)}#fb .fb-u-fold[aria-expanded="true"] .ico{transform:rotate(90deg)}
#fb .fb-up{font-weight:var(--fw-bold);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-u-list{list-style:none;margin:0;padding:0;max-height:min(30vh,240px);overflow:auto;display:flex;flex-direction:column}
#fb .fb-u-list[hidden]{display:none}
#fb .fb-u-list li{display:grid;grid-template-columns:minmax(0,1fr) 120px 140px 30px;align-items:center;gap:10px;padding:3px 0;font-size:var(--fs-sm)}
#fb .fb-u-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-u-list progress{width:100%;height:6px;accent-color:var(--accent)}
#fb .fb-u-st{color:var(--muted);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-u-list li[data-state="done"] .fb-u-st{color:var(--good)}#fb .fb-u-list li[data-state="fail"] .fb-u-st{color:var(--bad)}
#fb .fb-u-list button.ib{width:28px;height:28px;padding:0}
/* A folder row or a step of the path that rows dragged from the list would move into. */
#fb tbody tr.fb-target td{background:rgba(var(--accent-rgb),.18)}
#fb .fb-crumb button.fb-target{background:rgba(var(--accent-rgb),.18);color:var(--text)}
#fb tbody tr[draggable="true"]{-webkit-user-drag:element}
#fb-view{width:min(960px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:none;flex-direction:column;gap:10px}
#fb-view[open]{display:flex}
#fb-view .fb-v-head{display:flex;align-items:center;gap:6px}
#fb-view h3{flex:1;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb-view .ib{width:36px;height:36px;padding:0;display:inline-flex;align-items:center;justify-content:center}
#fb-view .fb-v-body{min-height:120px;overflow:auto;display:grid;place-items:center;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--sunk)}
#fb-view .fb-v-body img{max-width:100%;max-height:calc(100vh - 200px);object-fit:contain}
#fb-view .fb-v-body pre{place-self:stretch;margin:0;padding:12px 14px;font-size:var(--fs-sm);white-space:pre-wrap;word-break:break-all;max-height:calc(100vh - 200px);overflow:auto}
#fb-view .fb-v-note{margin:0;font-size:var(--fs-xs)}
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
  #fb .fb-u-list li{grid-template-columns:minmax(0,1fr) 64px 30px}#fb .fb-u-list progress{display:none}
}
@media (prefers-reduced-motion:reduce){#fb *{transition:none!important}}
${EXPLORE_CSS}
${LIBRARY_CSS}
`;

/** Where a page puts its file browser; the split page swaps the marker for FOLDER_HTML (ids stay unique). */
export const FOLDER_MARK = "<!--folder-->";

export const FOLDER_HTML = `<div id="fb">
  <div class="fb-bar">
    <div class="fb-nav" role="group">
      <button type="button" class="ib" id="fb-back" ${topLabel("fb.back")} disabled>${icon("chevleft")}</button>
      <button type="button" class="ib" id="fb-fwd" ${topLabel("fb.forward")} disabled>${icon("chevright")}</button>
      <button type="button" class="ib fb-upb" id="fb-upb" ${topLabel("fb.up")} disabled>${icon("chevleft")}</button>
    </div>
    <ol class="fb-crumb" id="fb-crumb" ${topLabel("fb.crumbLabel")}></ol>
    <input type="text" class="fb-addr" id="fb-addr" hidden autocomplete="off" spellcheck="false" ${topLabel("fb.crumbLabel")}>
    <label class="fb-q">${icon("search")}<input type="search" id="fb-q" autocomplete="off" spellcheck="false" maxlength="200" ${topPh("fb.qPh")} ${topLabel("fb.qPh")}></label>
    <label class="fb-deep"><input type="checkbox" id="fb-deep">${top("fb.deep")}</label>
    <div class="fb-views">
      <div class="fb-seg" role="group">
        <button type="button" class="ib" id="fb-v-list" aria-pressed="true" ${topLabel("fb.viewList")}>${icon("log")}</button>
        <button type="button" class="ib" id="fb-v-grid" aria-pressed="false" ${topLabel("fb.viewGrid")}>${icon("grid")}</button>
      </div>
      <div class="fb-seg" role="group">
        <button type="button" class="ib" id="fb-t-tree" aria-pressed="false" ${topLabel("fb.tree")}>${icon("folder")}</button>
        <button type="button" class="ib" id="fb-t-side" aria-pressed="false" ${topLabel("fb.side")}>${icon("info")}</button>
      </div>
    </div>
    <button type="button" id="fb-mkdir">${icon("plus")}${top("fb.newFolder")}</button>
    <button type="button" id="fb-upload">${icon("upload")}${top("fb.upload")}</button>
    <input type="file" id="fb-file" multiple tabindex="-1" aria-hidden="true">
    <input type="file" id="fb-dir" webkitdirectory multiple tabindex="-1" aria-hidden="true">
  </div>
  <div class="fb-body">
  <nav class="fb-tree" id="fb-tree" ${topLabel("fb.tree")}></nav>
  <div class="fb-main" id="fb-main">
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
  <div class="fb-more" id="fb-more"></div>
  </div>
  <aside class="fb-side" id="fb-side" ${topLabel("fb.side")} aria-live="polite"></aside>
  </div>
  <div id="fb-menu" role="menu" hidden ${topLabel("fb.menu")}></div>
  <p class="muted fb-note">${top("fb.note")}</p>
  <div class="fb-foot" id="fb-foot">
    <span class="fb-info" id="fb-info" aria-live="polite"></span>
    <section class="fb-upl" id="fb-upl" hidden ${topLabel("fb.upPanel")}>
      <div class="fb-u-head">
        <button type="button" class="fb-u-fold" id="fb-up-fold" aria-expanded="true" aria-controls="fb-u-list">${icon("chevright")}<span class="fb-up" id="fb-up" aria-live="polite"></span></button>
        <button type="button" id="fb-up-stop">${top("fb.upStopAll")}</button>
        <button type="button" id="fb-up-close" hidden>${top("fb.close")}</button>
      </div>
      <ol class="fb-u-list" id="fb-u-list"></ol>
    </section>
    <div class="fb-sel-act">
      <button type="button" id="fb-zip-btn">${icon("download")}${top("fb.zip")}</button>
      <button type="button" id="fb-move-btn">${top("fb.move")}</button>
      <button type="button" id="fb-trash-btn" class="danger">${top("fb.trash")}</button>
      <button type="button" id="fb-clear">${top("fb.clear")}</button>
    </div>
    <span class="fb-job" id="fb-job" hidden><progress max="100" value="0"></progress><span aria-live="polite"></span></span>
  </div>
</div>
<dialog id="fb-view" aria-labelledby="fb-v-title">
  <div class="fb-v-head">
    <h3 id="fb-v-title"></h3>
    <button type="button" class="ib" id="fb-v-prev" ${topLabel("fb.prevFile")}>${icon("chevleft")}</button>
    <button type="button" class="ib" id="fb-v-next" ${topLabel("fb.nextFile")}>${icon("chevright")}</button>
    <button type="button" class="ib" id="fb-v-dl" ${topLabel("fb.download")}>${icon("download")}</button>
    <button type="button" class="ib" id="fb-v-x" ${topLabel("fb.close")}>${icon("x")}</button>
  </div>
  <div class="fb-v-body" id="fb-v-body"></div>
  <p class="muted fb-v-note" id="fb-v-note" hidden></p>
</dialog>
<dialog id="fb-props" aria-labelledby="fb-p-title">
  <h3 id="fb-p-title"></h3>
  <dl class="fb-p-list" id="fb-p-list"></dl>
  <div class="dialog-actions"><button type="button" class="primary" id="fb-p-ok">${top("fb.close")}</button></div>
</dialog>
<div class="fb-lasso" id="fb-lasso" hidden></div>
<dialog id="fb-move" aria-labelledby="fb-m-title">
  <h3 id="fb-m-title">${top("fb.moveTitle")}</h3>
  <div class="fb-roots" id="fb-m-roots" role="group" ${topLabel("fb.rootsLabel")}></div>
  <div class="fb-m-crumb" id="fb-m-crumb"></div>
  <div class="fb-m-list" id="fb-m-list"></div>
  <div class="dialog-actions"><button type="button" id="fb-m-no">${top("fb.cancel")}</button><button type="button" class="primary" id="fb-m-ok">${top("fb.moveHere")}</button></div>
</dialog>`;

export const FILES_SCRIPT = /* js */ `
const FB_ICON=${JSON.stringify({ dir: icon("folder", "ico is-dir"), file: icon("file"), up: icon("chevleft"), chev: icon("chevright"), open: icon("folder"), download: icon("download"), share: icon("send"), rename: icon("tag"), move: icon("chevright"), trash: icon("trash"), mkdir: icon("plus"), upload: icon("upload"), stop: icon("x"), zip: icon("package"), view: icon("image"), cut: icon("arrowright"), copy: icon("copy"), paste: icon("inbox"), undo: icon("undo"), props: icon("info"), ...Object.fromEntries(Object.entries(ROOT_ICONS).map(([k, v]) => [k, icon(v)])) })};
const FB_PER=100;
const FB_SKEL_MS=120;
const FB_MAX_PAGES=5;
const fb={roots:[],root:'',path:'',sort:'mtime',order:'desc',q:'',sel:new Set(),anchor:null,focus:null,drag:null,hi:0,hmax:0,deep:false,clip:null,undos:[],seq:0,data:null,timer:null};
const fbSize=(n)=>{if(n==null)return '';const u=['B','KB','MB','GB','TB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++;}return (i?v.toFixed(v<10?1:0):String(v))+' '+u[i];};
const fbDate=(ms)=>ms?new Date(ms).toLocaleString(loc(),{dateStyle:'medium',timeStyle:'short'}):'';
const fbRootName=(k)=>topText('fb.root.'+k);
function fbUrl(){const u=new URL(location.href);u.searchParams.delete('root');u.searchParams.delete('view');u.searchParams.set('tab','folder');
  if(fb.path)u.searchParams.set('path',fb.path);else u.searchParams.delete('path');return u.pathname+u.search+u.hash;}
function fbGo(root,path,{push=true}={}){fb.root=root;fb.path=path||'';fb.q='';$('fb-q').value='';fb.sel.clear();fb.anchor=fb.focus=null;
  if(push&&location.pathname+location.search+location.hash!==fbUrl()){fb.hi++;fb.hmax=fb.hi;history.pushState({fbi:fb.hi},'',fbUrl());}fbLoad();}
function fbRootButtons(mount,current,pick){mount.replaceChildren();for(const r of fb.roots){const b=el('button');b.type='button';
  b.innerHTML=FB_ICON[r.key]||'';b.append(el('span',fbRootName(r.key)));b.setAttribute('aria-pressed',String(r.key===current));
  b.addEventListener('click',()=>pick(r.key));mount.append(b);}}
function fbCrumb(mount,root,path,go){mount.replaceChildren();const parts=path?path.split('/'):[];
  const add=(label,to)=>{const li=el('li');const b=el('button',label);b.type='button';b.title=label;b.addEventListener('click',()=>go(to));
    if(to!==path)fbDropTarget(b,()=>to);li.append(b);mount.append(li);};
  add(fbRootName(root),'');parts.forEach((p,i)=>add(p,parts.slice(0,i+1).join('/')));}
function fbSortHeads(){for(const b of document.querySelectorAll('#fb thead [data-sort]')){const on=b.dataset.sort===fb.sort;
  if(on)b.setAttribute('aria-sort',fb.order==='asc'?'ascending':'descending');else b.removeAttribute('aria-sort');
  b.dataset.arrow=on?(fb.order==='asc'?'▲':'▼'):'';const t=b.querySelector('[data-top]');b.replaceChildren(t||b.firstChild);if(on)b.append(el('span',fb.order==='asc'?'▲':'▼'));}}
function fbRow(f){const tr=el('tr');tr.dataset.rel=f.rel;tr.setAttribute('aria-selected',String(fb.sel.has(f.rel)));tr.tabIndex=f.rel===fb.focus?0:-1;
  const cs=td(null,'c-sel');const cb=el('input');cb.type='checkbox';cb.checked=fb.sel.has(f.rel);cb.setAttribute('aria-label',topFill('fb.selectRow',{name:f.name}));
  cb.addEventListener('change',()=>{if(cb.checked)fb.sel.add(f.rel);else fb.sel.delete(f.rel);fb.anchor=fb.focus=f.rel;fbPaint();});cs.append(cb);
  const onControl=(e)=>e.target.closest('button,input,a');
  // Shift and double clicks pick rows; without this they would also select the text under the pointer.
  tr.addEventListener('mousedown',(e)=>{if(!onControl(e)&&(e.shiftKey||e.detail>1))e.preventDefault();});
  tr.addEventListener('click',(e)=>{if(!onControl(e))fbPick(f.rel,{add:e.ctrlKey||e.metaKey,range:e.shiftKey});});
  tr.addEventListener('dblclick',(e)=>{if(!onControl(e))fbActivate(f);});
  tr.addEventListener('contextmenu',(e)=>{e.preventDefault();if(!fb.sel.has(f.rel))fbPick(f.rel);fbMenu(e.clientX,e.clientY);});
  tr.draggable=true;tr.addEventListener('dragstart',(e)=>fbDragStart(e,f.rel));
  if(f.type==='dir')fbDropTarget(tr,()=>!fb.drag?.includes(f.rel)&&f.rel);
  const cn=td(null,'c-name');const n=el('div',null,'fb-name');const ic=el('span');ic.innerHTML=f.type==='dir'?FB_ICON.dir:FB_ICON.file;n.append(ic.firstChild);
  // A title id folder reads as its game, the id beside it; a file keeps its own name first.
  if(f.type==='dir'){const b=el('button',f.title||f.name);b.type='button';b.title=f.title?f.title+' ('+f.name+')':f.name;b.addEventListener('click',()=>fbGo(fb.root,f.rel));n.append(b);if(f.title)n.append(el('span',f.name,'fb-id'));}
  else{const s=el('span',f.name);s.title=f.name;n.append(s);if(f.title)n.append(el('span',f.title,'fb-where'));}
  // A search through folders below names where each find is.
  const at=f.rel.split('/').slice(0,-1).join('/');if(fb.data?.deep&&at!==fb.path){const w=el('span',at,'fb-where');w.title=at;n.append(w);}
  fbDecorate(n,f);cn.append(n);if(fbClipped(f.rel))tr.classList.add('fb-cut');
  const ca=td(null,'c-act');const act=el('div',null,'fb-act');
  act.append(tbtn('rename','fb.rename',()=>fbRename(f)));
  if(f.type==='file'){const d=tbtn('download','fb.download',()=>fbDownload(f));d.classList.add('fb-dl');act.append(d);}
  act.append(tbtn('delete','fb.trash',()=>fbTrash([f.rel]),'danger'));ca.append(act);
  tr.append(cs,cn,td(f.type==='dir'?fbDirSize(f):fbSize(f.size),'c-size'),td(fbDate(f.mtime),'c-mtime'),ca);return tr;}
const fbRels=()=>fb.data?fb.data.items.map((f)=>f.rel):[];
const fbItem=(rel)=>fb.data?.items.find((f)=>f.rel===rel);
function fbDownload(f){location.href='/admin/api/files/download?'+new URLSearchParams({root:fb.root,path:f.rel});}
function fbActivate(f){if(f.type==='dir')fbGo(fb.root,f.rel);else if(fbKind(f))fbView(f);else fbDownload(f);}
function fbParent(){if(fb.path)fbGo(fb.root,fb.path.split('/').slice(0,-1).join('/'));}
// The rows show fb.sel and the one focusable row (fb.focus); every pick goes through here.
function fbPaint(){for(const r of document.querySelectorAll('#fb-rows tr')){const on=fb.sel.has(r.dataset.rel);
    r.setAttribute('aria-selected',String(on));r.tabIndex=r.dataset.rel===fb.focus?0:-1;const cb=r.querySelector('input[type=checkbox]');if(cb)cb.checked=on;}
  fbFoot();}
function fbPick(rel,{add=false,range=false}={}){const rels=fbRels();
  if(range&&fb.anchor&&rels.includes(fb.anchor)){const a=rels.indexOf(fb.anchor),b=rels.indexOf(rel);if(!add)fb.sel.clear();
    for(const r of rels.slice(Math.min(a,b),Math.max(a,b)+1))fb.sel.add(r);}
  else if(add){if(fb.sel.has(rel))fb.sel.delete(rel);else fb.sel.add(rel);fb.anchor=rel;}
  else{fb.sel.clear();fb.sel.add(rel);fb.anchor=rel;}
  fb.focus=rel;fbPaint();}
function fbFocusRow(){for(const r of document.querySelectorAll('#fb-rows tr'))if(r.dataset.rel===fb.focus){r.focus();r.scrollIntoView({block:'nearest'});return;}}
function fbFoot(){const d=fb.data;const foot=$('fb-foot');const n=fb.sel.size;
  if(n)foot.dataset.sel='';else delete foot.dataset.sel;
  $('fb-info').textContent=n?topFill('fb.selected',{n:num(n)}):d?topFill('fb.counts',{dirs:num(d.counts.dirs),files:num(d.counts.files)}):'';
  const rows=[...document.querySelectorAll('#fb-rows tr')];const all=$('fb-all');
  all.checked=rows.length>0&&rows.every((r)=>fb.sel.has(r.dataset.rel));all.indeterminate=!all.checked&&rows.some((r)=>fb.sel.has(r.dataset.rel));
  if(!n&&d&&d.items.length<d.total)$('fb-info').textContent+=' · '+topFill('fb.shown',{shown:num(d.items.length)});
  fbSide();}
// Placeholder rows while another folder, page or search loads; a refresh of the same view keeps its rows.
function fbSkel(){$('fb-empty').hidden=true;$('fb-rows').replaceChildren(...Array.from({length:8},()=>{const tr=el('tr',null,'fb-skel');const c=td(null);c.colSpan=5;c.append(el('span'));tr.append(c);return tr;}));}
// The first page; the rest come as the list scrolls (fbMore).
// A refresh of the same view asks for as many rows as were shown, so the list does not shrink under the reader.
async function fbLoad(){if(!fb.root)return;const n=++fb.seq;fb.moreBusy=false;
  const qs=new URLSearchParams({root:fb.root,path:fb.path,sort:fb.sort,order:fb.order});if(fb.q)qs.set('q',fb.q);if(fb.q&&fb.deep)qs.set('deep','1');
  fbNav();fbCrumb($('fb-crumb'),fb.root,fb.path,(to)=>fbGo(fb.root,to));fbSortHeads();
  const view=fb.root+'|'+qs;const pages=view===fb.view&&fb.data?Math.min(FB_MAX_PAGES,Math.max(1,fb.data.page)):1;
  qs.set('page','1');qs.set('perPage',String(FB_PER*pages));const skel=view!==fb.view?setTimeout(()=>{if(n===fb.seq)fbSkel();},FB_SKEL_MS):null;
  let d;try{d=await api('/admin/api/files/list?'+qs);}catch(err){clearTimeout(skel);if(n!==fb.seq)return;
    // A folder that is gone (moved elsewhere, a stale link) leads back to the top of its storage.
    if(err.code==='not-found'&&fb.path){toast(err.message);fbGo(fb.root,'',{push:false});history.replaceState({fbi:fb.hi},'',fbUrl());return;}
    fb.data=null;$('fb-rows').replaceChildren();const e=$('fb-empty');e.hidden=false;e.textContent=topFill('fb.loadFail',{msg:err.message});fbFoot();return;}
  clearTimeout(skel);if(n!==fb.seq)return;d.page=pages;d.pages=Math.max(1,Math.ceil(d.total/FB_PER));fb.data=d;fb.view=view;
  const live=new Set(d.items.map((f)=>f.rel));for(const r of [...fb.sel])if(!live.has(r))fb.sel.delete(r);
  if(!live.has(fb.focus))fb.focus=d.items[0]?.rel??null;if(!live.has(fb.anchor))fb.anchor=null;
  $('fb-rows').replaceChildren(...d.items.map(fbRow));
  const e=$('fb-empty');e.hidden=d.items.length>0;e.textContent=fb.q?topText('fb.noMatch'):topText('fb.empty');fbFoot();
  if(d.cut)toast(topText('fb.deepCut'));fbThumbs();fbTreeSync();fbSizeRows(d.items);}
async function fbRename(f){const name=await askText(topText('fb.renameAsk'),f.name);if(name==null||!name.trim()||name.trim()===f.name)return;
  try{const out=await api('/admin/api/files/rename',{method:'POST',body:{root:fb.root,path:f.rel,name:name.trim()}});fb.sel.delete(f.rel);
    fbUndoPush({journal:[out.undo]});toast(topText('fb.renamed'));fbLoad();}catch(err){toast(err.message);}}
async function fbTrash(rels){if(!rels.length)return;
  if(!await ask(topFill('fb.askTrash',{n:num(rels.length)}),{danger:true}))return;
  try{const out=await api('/admin/api/files/trash',{method:'POST',body:{root:fb.root,paths:rels}});for(const r of rels)fb.sel.delete(r);
    fbUndoPush({restore:out.restore});toast(topFill('fb.trashed',{n:num(out.files.length)}));fbLoad();}catch(err){toast(err.message);}}
async function fbMkdir(){const name=await askText(topText('fb.newFolderAsk'),'');if(name==null||!name.trim())return;
  try{const out=await api('/admin/api/files/mkdir',{method:'POST',body:{root:fb.root,path:fb.path,name:name.trim()}});
    fbUndoPush({trash:{root:out.root,paths:[out.rel]}});toast(topText('fb.made'));fbLoad();}catch(err){toast(err.message);}}
// Upload into the open folder: files dropped on the list (a dropped folder keeps its shape) or picked with the
// buttons go up one at a time in pieces (chunkUpload, common-script.js) and land where the list was when they were
// picked. A name the folder already has is skipped before a byte goes up; nothing is ever overwritten. The panel in
// the bottom bar lists every file with its progress and a stop button; a stopped file sent again picks up where it was.
const fbu={busy:false,items:[],placed:0,skipped:0};
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
const FB_UP_LIVE=new Set(['wait','up']);
function fbUpItem(it){const li=el('li');li.dataset.state=it.state;
  const name=el('span',it.rel,'fb-u-name');name.title=it.rel;const bar=el('progress');bar.max=1;bar.value=0;
  const st=el('span','','fb-u-st');const stop=el('button');stop.type='button';stop.className='ib';stop.innerHTML=FB_ICON.stop;
  stop.setAttribute('aria-label',topFill('fb.upStop',{name:it.rel}));stop.addEventListener('click',()=>fbUpStop(it));
  li.append(name,bar,st,stop);it.li=li;it.bar=bar;it.st=st;fbUpPaint(it);return li;}
function fbUpPaint(it){const li=it.li;if(!li)return;li.dataset.state=it.state;it.bar.value=it.file.size?it.sent/it.file.size:it.state==='done'?1:0;
  it.st.textContent=it.state==='up'?Math.floor(it.bar.value*100)+'%':it.state==='fail'?it.msg:topText('fb.st.'+it.state);
  it.st.title=it.st.textContent;li.querySelector('button').hidden=!FB_UP_LIVE.has(it.state);}
// The panel's head line: how far the whole batch is, and the buttons that fit (stop all while busy, close after).
function fbUpShow(){const box=$('fb-upl');const all=fbu.items;box.hidden=!all.length;if(!all.length)return;
  const bytes=all.reduce((a,it)=>a+it.file.size,0)||1,sent=all.reduce((a,it)=>a+(it.state==='done'?it.file.size:it.sent),0);
  const finished=all.filter((it)=>!FB_UP_LIVE.has(it.state)).length;
  $('fb-up').textContent=fbu.busy?topFill('fb.uploading',{n:num(Math.min(finished+1,all.length)),t:num(all.length),p:String(Math.floor(sent/bytes*100))}):topFill('fb.upDone',{n:num(finished)});
  $('fb-up-stop').hidden=!fbu.busy;$('fb-up-close').hidden=fbu.busy;}
function fbUpload(items){if(!items.length||!fb.root)return;const at={root:fb.root,path:fb.path};
  const list=$('fb-u-list');
  for(const x of items){const it={...x,...at,state:'wait',sent:0,ctl:new AbortController()};fbu.items.push(it);list.append(fbUpItem(it));}
  fbUpShow();if(!fbu.busy)fbUpRun();}
function fbUpStop(it){if(!FB_UP_LIVE.has(it.state))return;it.state='stop';it.ctl.abort();fbUpPaint(it);fbUpShow();}
async function fbUpOne(it){
  const start={url:'/admin/api/files/upload/chunks',body:{root:it.root,path:it.path,rel:it.rel,size:it.file.size,lastModified:it.file.lastModified}};
  const r=await chunkUpload(null,it.file,(n)=>{it.sent=n;fbUpPaint(it);fbUpShow();},start,it.ctl.signal);
  if(it.state==='stop')return;
  if(r.status===409&&r.d.code==='exists'){it.state='skip';fbu.skipped++;return;}
  if(r.status!==200){it.state='fail';it.msg=r.d?.error||topText('u.rNet');return;}
  const f=await chunkCall('POST','/admin/api/files/upload',JSON.stringify({root:it.root,path:it.path,items:[{id:r.id,rel:it.rel}]}),'application/json');
  if(f.status!==200){it.state='fail';it.msg=f.d.error||String(f.status);return;}
  fbu.placed+=f.d.placed.length;fbu.skipped+=f.d.skipped.length;it.state=f.d.placed.length?'done':'skip';it.to=f.d.placed[0];}
async function fbUpRun(){fbu.busy=true;fbUpShow();let it;
  while((it=fbu.items.find((x)=>x.state==='wait'))){it.state='up';fbUpPaint(it);
    await fbUpOne(it);fbUpPaint(it);fbUpShow();
    if(it.root===fb.root&&it.path===fb.path&&!fbu.items.some((x)=>x.state==='wait'))fbLoad();}
  if(fbu.placed||fbu.skipped)toast(fbu.skipped?topFill('fb.upSome',{n:num(fbu.placed),s:num(fbu.skipped)}):topFill('fb.uploaded',{n:num(fbu.placed)}));
  const whole=fbu.placed?fbu.items.filter((x)=>x.root==='incoming'&&x.state==='done'&&x.to).map((x)=>x.to):[];
  Object.assign(fbu,{busy:false,placed:0,skipped:0});fbUpShow();
  if(whole.length)fbSortBox(whole.slice(-500));}
// What went up into the drop box is whole already, so it is sorted now instead of at the next timed sweep.
async function fbSortBox(whole){try{const d=await api('/admin/api/library/organize/sweep',{method:'POST',body:{whole}});
  if(d.moved)toast(topText('lo.moved').split('{n}').join(num(d.moved)));if(fb.root==='incoming')fbLoad();}catch(err){toast(err.message);}}
$('fb-up-stop').addEventListener('click',()=>{for(const it of fbu.items)fbUpStop(it);});
$('fb-up-close').addEventListener('click',()=>{fbu.items=[];$('fb-u-list').replaceChildren();fbUpShow();});
$('fb-up-fold').addEventListener('click',(e)=>{const b=e.currentTarget;const open=b.getAttribute('aria-expanded')!=='true';
  b.setAttribute('aria-expanded',String(open));$('fb-u-list').hidden=!open;});
// A page left while files go up asks first; what was sent waits a day and the same file picks up where it stopped.
window.addEventListener('beforeunload',(e)=>{if(fbu.busy){e.preventDefault();e.returnValue='';}});
// Files dropped anywhere on the page go up into the open folder; a folder keeps its shape.
{let depth=0;const wrap=document;const has=(e)=>$('fb').offsetParent!==null&&[...(e.dataTransfer?.types||[])].includes('Files');
  wrap.addEventListener('dragenter',(e)=>{if(!has(e))return;e.preventDefault();depth++;$('fb').classList.add('dragging');});
  wrap.addEventListener('dragover',(e)=>{if(!has(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
  wrap.addEventListener('dragleave',()=>{if(--depth<=0){depth=0;$('fb').classList.remove('dragging');}});
  wrap.addEventListener('drop',async(e)=>{if(!has(e))return;e.preventDefault();depth=0;$('fb').classList.remove('dragging');fbUpload(await fbDropped(e.dataTransfer));});}
$('fb-upload').addEventListener('click',()=>$('fb-file').click());
// A picked folder names each file under it (webkitRelativePath), so the folder lands with its shape like a dropped one.
for(const id of ['fb-file','fb-dir'])$(id).addEventListener('change',(e)=>{const files=[...e.target.files];e.target.value='';
  fbUpload(files.map((f)=>({file:f,rel:f.webkitRelativePath||f.name})));});
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
  $('fb-m-ok').onclick=()=>{const to={root:fbm.root,path:fbm.path};done();fbMoveTo(rels,to.root,to.path);};
  dlg.showModal();fbMoveLoad();}
async function fbMoveTo(rels,toRoot,toPath,fromRoot=fb.root){
  try{const out=await api('/admin/api/files/move',{method:'POST',body:{root:fromRoot,paths:rels,toRoot,toPath}});
    for(const m of out.moved)fb.sel.delete(m.from);fbUndoPush({journal:out.moved.map((m)=>m.undo)});
    toast(out.skipped.length?topFill('fb.movedSome',{moved:num(out.moved.length),skipped:num(out.skipped.length)}):topFill('fb.moved',{n:num(out.moved.length)}));fbLoad();}
  catch(err){toast(err.message);}}
// Rows dragged onto a folder row or a step of the path move there, the whole pick when the dragged row is in it.
// Only the list's own drags count: files dragged in from the desktop are uploads (the list's drop handlers).
const FB_DRAG='application/x-cookingfoil-files';
function fbDragStart(e,rel){if(!fb.sel.has(rel))fbPick(rel);fb.drag=[...fb.sel];
  e.dataTransfer.setData(FB_DRAG,JSON.stringify({root:fb.root,paths:fb.drag}));e.dataTransfer.effectAllowed='copyMove';
  // One file dragged out of the window onto the desktop downloads there (Chromium's DownloadURL).
  const f=fb.drag.length===1&&fbItem(fb.drag[0]);
  if(f&&f.type==='file')e.dataTransfer.setData('DownloadURL','application/octet-stream:'+f.name+':'+location.origin+'/admin/api/files/download?'+new URLSearchParams({root:fb.root,path:f.rel}));}
function fbDropTarget(node,dest){const ours=(e)=>fb.drag&&[...e.dataTransfer.types].includes(FB_DRAG)&&dest()!==false;
  node.addEventListener('dragover',(e)=>{if(!ours(e))return;e.preventDefault();e.dataTransfer.dropEffect='move';node.classList.add('fb-target');});
  node.addEventListener('dragleave',()=>node.classList.remove('fb-target'));
  node.addEventListener('drop',(e)=>{node.classList.remove('fb-target');if(!ours(e))return;e.preventDefault();e.stopPropagation();
    const rels=fb.drag;fb.drag=null;fbMoveTo(rels,fb.root,dest());});}
document.addEventListener('dragend',()=>{fb.drag=null;for(const n of document.querySelectorAll('#fb .fb-target'))n.classList.remove('fb-target');});
// Several items, or a folder, come down as one zip: the server gets the list, the browser's own download takes the file.
async function fbZip(rels){if(!rels.length)return;toast(topText('fb.zipping'));
  try{const out=await api('/admin/api/files/zip',{method:'POST',body:{root:fb.root,paths:rels}});location.href=out.url;}catch(err){toast(err.message);}}
// A look at an image or the start of a text file without leaving the list. The bytes come through the download
// address into a blob, so nothing of the file is ever served as a page of this site; text is shown as text.
const FB_VIEW={image:new Set(['png','jpg','jpeg','gif','webp','bmp','avif','svg','ico']),
  text:new Set(['txt','md','json','jsonc','json5','ini','cfg','conf','log','xml','yml','yaml','csv','nfo','toml','lua','js','css','html','sh','py','bat','srt','cht','lst'])};
const FB_VIEW_MAX={image:32*1048576,text:262144};
const fbKind=(f)=>f.type==='file'&&(FB_VIEW.image.has(f.ext)?'image':FB_VIEW.text.has(f.ext)?'text':null);
const fbv={f:null,url:null,seq:0};
function fbViewList(){return fb.data?fb.data.items.filter((x)=>fbKind(x)&&(fbKind(x)!=='image'||x.size<=FB_VIEW_MAX.image)):[];}
async function fbView(f){const dlg=$('fb-view');const n=++fbv.seq;fbv.f=f;const kind=fbKind(f);
  $('fb-v-title').textContent=f.name;$('fb-v-title').title=f.name;const body=$('fb-v-body');const note=$('fb-v-note');note.hidden=true;
  const list=fbViewList(),i=list.findIndex((x)=>x.rel===f.rel);$('fb-v-prev').disabled=i<=0;$('fb-v-next').disabled=i<0||i>=list.length-1;
  if(!dlg.open)dlg.showModal();body.replaceChildren(el('p',topText('fb.viewLoading'),'muted'));
  if(kind==='image'&&f.size>FB_VIEW_MAX.image){body.replaceChildren(el('p',topText('fb.viewBig'),'muted'));return;}
  const qs=new URLSearchParams({root:fb.root,path:f.rel});const headers=kind==='text'?{Range:'bytes=0-'+(FB_VIEW_MAX.text-1)}:{};
  let blob;try{const r=await fetch('/admin/api/files/download?'+qs,{headers});
    if(!r.ok){let msg=String(r.status);try{msg=(await r.json()).error||msg;}catch{}throw new Error(msg);}blob=await r.blob();}
  catch(err){if(n===fbv.seq)body.replaceChildren(el('p',topFill('fb.viewFail',{msg:err.message}),'muted'));return;}
  if(n!==fbv.seq)return;fbViewFree();
  if(kind==='image'){fbv.url=URL.createObjectURL(blob);const img=el('img');img.alt=f.name;img.src=fbv.url;body.replaceChildren(img);return;}
  body.replaceChildren(el('pre',new TextDecoder().decode(await blob.arrayBuffer())));
  if(f.size>FB_VIEW_MAX.text){note.hidden=false;note.textContent=topFill('fb.viewCut',{size:fbSize(FB_VIEW_MAX.text)});}}
function fbViewFree(){if(fbv.url)URL.revokeObjectURL(fbv.url);fbv.url=null;}
function fbViewStep(d){const list=fbViewList();const i=list.findIndex((x)=>x.rel===fbv.f?.rel);const to=list[i+d];if(to){fbPick(to.rel);fbView(to);}}
$('fb-v-prev').addEventListener('click',()=>fbViewStep(-1));$('fb-v-next').addEventListener('click',()=>fbViewStep(1));
$('fb-v-dl').addEventListener('click',()=>{if(fbv.f)fbDownload(fbv.f);});$('fb-v-x').addEventListener('click',()=>$('fb-view').close());
$('fb-view').addEventListener('keydown',(e)=>{if(e.key==='ArrowLeft'){e.preventDefault();fbViewStep(-1);}else if(e.key==='ArrowRight'){e.preventDefault();fbViewStep(1);}});
$('fb-view').addEventListener('close',()=>{fbv.seq++;fbViewFree();$('fb-v-body').replaceChildren();fbFocusRow();});
function fbAll(on){for(const rel of fbRels()){if(on)fb.sel.add(rel);else fb.sel.delete(rel);}fbPaint();}
$('fb-all').addEventListener('change',(e)=>fbAll(e.target.checked));
for(const b of document.querySelectorAll('#fb thead [data-sort]'))b.addEventListener('click',()=>{const s=b.dataset.sort;
  if(fb.sort===s)fb.order=fb.order==='asc'?'desc':'asc';else{fb.sort=s;fb.order=s==='name'?'asc':'desc';}fbLoad();});
$('fb-q').addEventListener('input',()=>{clearTimeout(fb.timer);fb.timer=setTimeout(()=>{const q=$('fb-q').value.trim();if(q===fb.q)return;fb.q=q;fbLoad();},250);});
$('fb-mkdir').addEventListener('click',fbMkdir);
$('fb-move-btn').addEventListener('click',fbMove);
$('fb-zip-btn').addEventListener('click',()=>fbZip([...fb.sel]));
$('fb-trash-btn').addEventListener('click',()=>fbTrash([...fb.sel]));
$('fb-clear').addEventListener('click',()=>{fb.sel.clear();fb.anchor=null;fbPaint();});
window.addEventListener('popstate',(e)=>{const p=new URLSearchParams(location.search);fb.hi=e.state?.fbi??0;
  if(fb.root&&p.get('tab')==='folder')fbGo(fb.root,p.get('path')||'',{push:false});});
// On a focused row: the arrows, Home and End walk the list (Shift stretches the pick, Ctrl or Cmd only moves),
// Space toggles, Enter opens, F2 renames, and the menu key or Shift+F10 opens the menu.
$('fb-rows').addEventListener('keydown',(e)=>{const tr=e.target;if(tr.tagName!=='TR')return;
  const rels=fbRels(),i=rels.indexOf(tr.dataset.rel),f=fbItem(tr.dataset.rel);
  const walk=(j)=>{const rel=rels[Math.max(0,Math.min(rels.length-1,j))];if(rel==null)return;
    if(e.shiftKey)fbPick(rel,{range:true,add:e.ctrlKey||e.metaKey});else if(e.ctrlKey||e.metaKey){fb.focus=rel;fbPaint();}else fbPick(rel);fbFocusRow();};
  const step=fbCols();
  if(e.key==='ArrowDown')walk(i+step);else if(e.key==='ArrowUp'&&!e.altKey)walk(i-step);
  else if(step>1&&e.key==='ArrowRight')walk(i+1);else if(step>1&&e.key==='ArrowLeft')walk(i-1);else if(e.key==='Home')walk(0);else if(e.key==='End')walk(rels.length-1);
  else if(e.key===' ')fbPick(tr.dataset.rel,{add:true});else if(e.key==='Enter'&&f)fbActivate(f);else if(e.key==='F2'&&f)fbRename(f);
  else if(e.key==='ContextMenu'||(e.key==='F10'&&e.shiftKey)){if(!fb.sel.has(tr.dataset.rel))fbPick(tr.dataset.rel);const r=tr.getBoundingClientRect();fbMenu(r.left+48,r.bottom-8);}
  else return;
  e.preventDefault();});
// Anywhere on the open file tab: Esc clears the pick, Delete trashes it, Ctrl or Cmd+A picks the page, Backspace or
// Alt+Up goes to the parent folder. None fires while typing or in a dialog.
document.addEventListener('keydown',(e)=>{if(!$('fb')?.offsetParent||e.target.closest('input,textarea,select,dialog'))return;
  if(e.key==='Escape'&&fb.sel.size)$('fb-clear').click();else if(e.key==='Delete'&&fb.sel.size)fbTrash([...fb.sel]);
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&fbRels().length){e.preventDefault();fbAll(true);}
  else if(e.key==='Backspace'||(e.altKey&&e.key==='ArrowUp')){if(fb.path){e.preventDefault();fbParent();}}});
// The menu for a right click: on rows it holds what the pick allows, on the empty part of the list a new folder
// and an upload. It closes on a pick, Esc, a click elsewhere, a scroll or a resize, and gives focus back.
// It lives on the body: a page panel that is a containing block (a transform, a filter) would offset a fixed menu by its own place.
document.body.append($('fb-menu'));
function fbMenu(x,y){const m=$('fb-menu');const rels=[...fb.sel];const one=rels.length===1?fbItem(rels[0]):null;
  const items=[];const add=(key,ic,fn,danger)=>items.push({key,ic,fn,danger});
  if(rels.length){
    if(one?.type==='dir')add('fb.open','open',()=>fbActivate(one));
    if(one&&fbKind(one))add('fb.view','view',()=>fbView(one));
    if(one?.type==='file')add('fb.download','download',()=>fbDownload(one));
    else add('fb.zip','zip',()=>fbZip(rels));
    add('fb.cut','cut',()=>fbClip('cut'));add('fb.copy','copy',()=>fbClip('copy'));
    if(one)add('fb.rename','rename',()=>fbRename(one));
    add('fb.move','move',fbMove);add('fb.trash','trash',()=>fbTrash(rels),true);add('fb.props','props',fbProps);}
  else{add('fb.newFolder','mkdir',fbMkdir);add('fb.upload','upload',()=>$('fb-file').click());add('fb.uploadDir','open',()=>$('fb-dir').click());
    if(fb.clip)add('fb.paste','paste',fbPaste);if(fb.undos.length)add('fb.undo','undo',fbUndo);add('fb.props','props',fbProps);}
  const back=document.activeElement;
  m.replaceChildren(...items.map((it,i)=>{const b=el('button');b.type='button';b.setAttribute('role','menuitem');b.tabIndex=i?-1:0;
    b.innerHTML=FB_ICON[it.ic]||'';b.append(el('span',topText(it.key)));if(it.danger)b.dataset.danger='';
    b.addEventListener('click',()=>{fbMenuClose(false);it.fn();});return b;}));
  if(rels.length>1)m.prepend(el('p',topFill('fb.selected',{n:num(rels.length)}),'muted fb-m-head'));
  // clientWidth and clientHeight leave out the scrollbars, which innerWidth and innerHeight would let the menu sit under.
  m.hidden=false;m._at=performance.now();const r=m.getBoundingClientRect();const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
  m.style.left=Math.max(8,Math.min(x,vw-r.width-8))+'px';m.style.top=Math.max(8,Math.min(y,vh-r.height-8))+'px';
  m.querySelector('button')?.focus({preventScroll:true});m._back=back;}
function fbMenuClose(refocus=true){const m=$('fb-menu');if(m.hidden)return;m.hidden=true;if(refocus&&m._back?.isConnected)m._back.focus({preventScroll:true});m._back=null;}
$('fb-menu').addEventListener('keydown',(e)=>{const bs=[...$('fb-menu').querySelectorAll('button')];const i=bs.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();bs[(i+(e.key==='ArrowDown'?1:-1)+bs.length)%bs.length]?.focus({preventScroll:true});}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();bs[e.key==='Home'?0:bs.length-1]?.focus({preventScroll:true});}
  else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();fbMenuClose();}});
document.addEventListener('pointerdown',(e)=>{if(!e.target.closest('#fb-menu'))fbMenuClose(false);},true);
// A scroll closes the menu, but not the one the opening itself sets off (the bar changing height as the pick clears).
const FB_MENU_SETTLE_MS=250;
addEventListener('scroll',(e)=>{if(e.target.closest?.('#fb-menu')||performance.now()-($('fb-menu')._at||0)<FB_MENU_SETTLE_MS)return;fbMenuClose(false);},true);addEventListener('resize',()=>fbMenuClose(false));
document.querySelector('#fb .fb-wrap').addEventListener('contextmenu',(e)=>{if(e.target.closest('#fb-rows tr,#fb-menu'))return;
  e.preventDefault();fb.sel.clear();fb.anchor=null;fbPaint();fbMenu(e.clientX,e.clientY);});
// The page's own folder is the only root here; the roots list is for the move dialog's picker.
async function fbOpen(root){
  if(!fb.root&&!fb.booting){fb.booting=true;
    try{fb.roots=(await api('/admin/api/files/roots')).roots;}catch(err){fb.booting=false;toast(err.message);return;}
    const p=new URLSearchParams(location.search);fb.booting=false;fb.hi=fb.hmax=history.state?.fbi??0;
    fbGo(root,p.get('tab')==='folder'?p.get('path')||'':'',{push:false});}
  if(fb.root)history.replaceState({fbi:fb.hi},'',fbUrl());}
// A page's tab row with the "파일" tab: opening it starts the browser, leaving it clears the folder from the address.
function fbTabs(tab,root){subtabs(tab);const st=SUBTABS[tab];if(!st)return;const show=st.show;
  st.show=(sub)=>{show(sub);if(sub==='folder')fbOpen(root);};
  st.show(location.hash.split('/')[1]||st.cur);}
// A language switch redraws the path, the dates and the counts.
function fbRelabel(){if(typeof fb==='undefined')return;if(!fb.root)return;fbLoad();}
${EXPLORE_SCRIPT}
${LIBRARY_SCRIPT}
`;
