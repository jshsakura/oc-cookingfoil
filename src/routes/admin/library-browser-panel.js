/**
 * The library tab's file browser: one list per kind (게임, 업데이트, DLC, 패치,
 * 세이브, 홈브류, 기타) with its count, a search and sort inside the kind, and
 * pages of 25 cut on the server (GET /admin/api/library/browse). 전체 asks for every kind at once.
 * Rows delete, and lead on to the game or content editor.
 * Everything is scoped under #lib-files so it never restyles the rest of the page.
 */

import { TOP_WORDS, top, topPh, topLabel } from "./top-i18n.js";
import { LIB_ITEM_CSS, LIB_ITEM_HTML, LIB_ITEM_SCRIPT } from "./library-item-dialog.js";

// Line icons in the same 24px stroke style as views/icons.js, kept here so
// this panel does not touch the shared icon list.
const PATHS = {
  base: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/>',
  update: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  dlc: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
  patch: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  homebrew: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  other: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 13a2 2 0 1 1 2.5 1.94V16M12 19h.01"/>',
  all: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
};
const svg = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;

const KINDS = [["all", "lb.kAll"], ["base", "lb.kBase"], ["update", "lb.kUpdate"], ["dlc", "lb.kDlc"], ["patch", "lb.kPatch"], ["save", "lb.kSave"], ["homebrew", "lb.kHomebrew"], ["other", "lb.kOther"]];

export const LIB_BROWSER_CSS = /* css */ `
.lv-tip{flex:none;display:inline-grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:help}
.lv-tip:hover,.lv-tip:focus-visible{background:var(--sunk);color:var(--text)}
.lv-tip svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lv-pop{position:fixed;z-index:60;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel);color:var(--text);box-shadow:0 10px 30px var(--shadow);font-size:var(--fs-sm);line-height:1.55;pointer-events:none}
.lv-pop b{display:block;margin-bottom:6px;font-size:var(--fs-sm)}
.lv-pop p{margin:0 0 6px;color:var(--muted)}
.lv-pop p:last-child{margin-bottom:0}
#lb-list .lb-check{display:inline-flex;align-items:center;gap:2px}
#lib-files{display:grid;gap:12px;margin-bottom:8px}
#lib-files .lb-kinds{position:relative;display:flex;gap:4px;padding:5px;background:var(--sunk);border:1px solid var(--line);border-radius:var(--r-2xl);overflow-x:auto}
#lib-files .lb-ind{position:absolute;left:0;top:0;width:0;height:0;border-radius:var(--r-lg);background:var(--panel);box-shadow:0 1px 3px var(--shadow),0 0 0 1px var(--line2);transition:transform .28s cubic-bezier(.3,.7,.2,1),width .28s cubic-bezier(.3,.7,.2,1),height .28s;pointer-events:none}
#lib-files .lb-kinds button{position:relative;z-index:1;flex:1 0 auto;gap:7px;padding:8px 12px;border:0;border-radius:var(--r-lg);background:none;color:var(--muted);white-space:nowrap;transition:color .15s,transform .12s}
#lib-files .lb-kinds button:hover{color:var(--text)}
#lib-files .lb-kinds button[aria-pressed="true"]{color:var(--text)}
#lib-files .lb-n{min-width:22px;padding:1px 7px;border-radius:var(--r-pill);background:var(--line2);color:var(--text);font-size:var(--fs-2xs);font-weight:700;text-align:center;font-variant-numeric:tabular-nums;transition:background .2s,color .2s}
#lib-files .lb-kinds button[aria-pressed="true"] .lb-n{background:var(--accent);color:var(--accent-ink)}
#lib-files .lb-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0}
#lib-files .lb-q{position:relative;flex:1 1 260px;display:flex}
#lib-files .lb-q .ico{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
#lib-files .lb-q input{width:100%;padding-left:38px}
#lib-files .lb-bar select{flex:0 0 auto;min-width:9.5em}
#lib-files .lb-filter{display:flex;align-items:center;gap:10px;min-width:0}
#lib-files .lb-filter .lb-kinds{flex:1 1 auto;min-width:0}
#lib-files .lb-note{margin:4px 0 0;font-size:var(--fs-xs)}
#lib-files .lb-act{display:flex;gap:6px;flex-wrap:nowrap}
#lib-files .lb-act button.ib{width:36px;height:36px;padding:0;position:relative}
#lib-files .lb-act button.ib>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#lib-files button{transition:border-color .15s,background .15s,transform .12s,box-shadow .15s}
#lib-files button:not(:disabled):hover{box-shadow:0 2px 8px var(--shadow)}
#lib-files .lb-kinds button:not(:disabled):hover{box-shadow:none}
#lib-files button:not(:disabled):active{transform:scale(.96)}
#lib-files .lb-count{margin:0}
#lib-files .lb-for{display:flex;gap:10px;align-items:center}#lib-files .lb-for>div{min-width:0}
#lib-files .lb-gw{width:36px;height:36px;flex:none;border-radius:var(--r-md);overflow:hidden;background:var(--sunk);border:1px solid var(--line)}#lib-files .lb-gi{display:block;width:100%;height:100%;object-fit:cover}#lib-files .lb-gi.img-miss{display:grid}
#lib-files .lb-list{min-height:120px}
/* The server sorts and counts the whole list above; the grid's own page-only sort box and count would say it twice. */
#lib-files .lb-list .grid-sort,#lib-files .lb-list .grid-count{display:none}
#lib-files .lb-list.lb-in{animation:lb-in .26s ease-out}
@keyframes lb-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
#lib-files :is(td,.gc) b{word-break:break-all}
#lib-files :is(td,.gc) .muted{word-break:break-all}
#lib-files :is(td,.gc).lb-num{white-space:nowrap;font-variant-numeric:tabular-nums}
#lib-files .lb-skel td span{display:block;height:12px;border-radius:var(--r-sm);background:linear-gradient(90deg,var(--sunk) 0%,var(--line) 50%,var(--sunk) 100%);background-size:200% 100%;animation:lb-shimmer 1.2s linear infinite}
#lib-files .lb-skel td span.w2{width:40%;margin-top:6px;height:10px}
@keyframes lb-shimmer{from{background-position:100% 0}to{background-position:-100% 0}}
#lib-files .lb-pager{display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap}
#lib-files .lb-pager[hidden]{display:none}
#lib-files .lb-pager .lb-pg{min-width:38px;padding:8px 10px;font-variant-numeric:tabular-nums}
#lib-files .lb-pager .lb-pg[aria-current="page"]{background:var(--text);color:var(--bg);border-color:var(--text)}
#lib-files .lb-pager .lb-gap{color:var(--faint);padding:0 2px}
@media (max-width:640px){
  /* On a phone the search and the kinds take one line each; the kinds that do not fit scroll sideways. */
  #lib-files .lb-filter{flex-direction:column;align-items:stretch;gap:4px}
  #lib-files .lb-kinds{display:flex;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain}
  #lib-files .lb-kinds button{flex:0 0 auto;flex-direction:row;gap:4px;padding:7px 10px;font-size:var(--fs-xs)}
  #lib-files .lb-kinds button>svg{display:none}
  #lib-files .lb-n{min-width:0;padding:1px 5px}
  #lib-files .lb-bar{flex-wrap:nowrap;gap:6px}
  #lib-files .lb-q{flex:1 1 auto;min-width:0}
  #lib-files .lb-bar select{flex:0 1 auto;min-width:0;max-width:8em}
  #lib-files #lb-go{flex:0 0 auto;padding-inline:12px}
  #lib-files #lb-go>span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  #lib-files .lb-pager .lb-pg.lb-far{display:none}
}
@media (prefers-reduced-motion:reduce){
  #lib-files .lb-ind,#lib-files button,#lib-files .lb-n{transition:none}
  #lib-files .lb-list.lb-in,#lib-files .lb-skel td span{animation:none}
  #lib-files button:not(:disabled):active{transform:none}
}
${LIB_ITEM_CSS}`;

/**
 * The list over the given kinds: every kind on the 전체 목록 page, the game files on the 게임 page.
 * 전체 asks for all of those kinds at once.
 */
export const libBrowserHtml = (kinds) => `<div id="lib-files" data-kinds="${kinds.join(",")}">
    <form class="lb-bar" id="lb-bar" role="search">
      <label class="lb-q">${svg("search")}<input type="search" id="lb-q" autocomplete="off" spellcheck="false" maxlength="200" ${topPh("lb.qPh")} ${topLabel("lb.qLabel")}></label>
      <button type="submit" id="lb-go">${svg("search")}<span data-top="rpt.find">${top("rpt.find")}</span></button>
      <select id="lb-sort" ${topLabel("lb.sortLabel")}><option value="mtime" data-top="lb.byMtime">${TOP_WORDS.ko["lb.byMtime"]}</option><option value="name" data-top="fp.byName">${TOP_WORDS.ko["fp.byName"]}</option><option value="size" data-top="lb.bySize">${TOP_WORDS.ko["lb.bySize"]}</option></select>
    </form>
    <div class="lb-filter">
      <div class="lb-kinds hide-bar" id="lb-kinds" role="group" ${topLabel("f.type")}>
        <span class="lb-ind" id="lb-ind" aria-hidden="true"></span>
        ${KINDS.filter(([k]) => k === "all" || kinds.includes(k)).map(([k, label], i) => `<button type="button" id="lb-tab-${k}" data-kind="${k}" aria-controls="lb-list" aria-pressed="${i === 0}">${svg(k)}<span>${top(label)}</span><span class="lb-n" id="lb-n-${k}">0</span></button>`).join("")}
      </div>
    </div>
    <p class="muted lb-count" id="lb-count" aria-live="polite"></p>
    <div class="lb-list" id="lb-list" data-skel aria-live="polite"></div>
    <nav class="lb-pager" id="lb-pager" ${topLabel("lb.pagerLabel")} hidden></nav>
    <p class="muted lb-note">${top("lb.note")}</p>
  </div>${LIB_ITEM_HTML}`;
export const LIB_BROWSER_HTML = libBrowserHtml(KINDS.slice(1).map(([k]) => k));
export const GAME_FILES_HTML = libBrowserHtml(["base", "update", "dlc"]);

export const LIB_BROWSER_SCRIPT = /* js */ `
// A file check's help, in the admin's language as the server wrote it, opens beside its mark on hover, focus or tap (the list and the check page).
const LV_INFO='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
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

const LB_ICON=${JSON.stringify({ prev: svg("prev"), next: svg("next") })};
const LB_KIND=${JSON.stringify(Object.fromEntries(KINDS))};
const LB_PER=25;
const LB_ALL=$('lib-files').dataset.kinds.split(',');
// A modified file is not damage, and a hash mismatch may still install: each says which with its own label and tone.
const LB_CHECK={ok:['lb.ok','on'],modified:['lb.modified',''],damaged:['lb.damaged','off'],unchecked:['lb.unchecked','']};
function lbCheck(f){const c=td();const v=LB_CHECK[f.integrity]||LB_CHECK.unchecked;const w=f.why;
  const tone=f.integrity==='damaged'&&w&&!w.certain?'warn':v[1];const box=el('span',null,'lb-check');box.append(pill(w?.label||topText(v[0]),tone));
  if(w?.help){const b=el('button',null,'lv-tip');b.type='button';b.innerHTML=LV_INFO;b.setAttribute('aria-label',w.help.title);
    b.addEventListener('mouseenter',()=>lvTipShow(b,w.help));b.addEventListener('mouseleave',lvTipHide);
    b.addEventListener('focus',()=>lvTipShow(b,w.help));b.addEventListener('blur',lvTipHide);
    b.addEventListener('click',(e)=>{e.stopPropagation();lvTip&&lvTip.owner===b&&!lvTip.hidden?lvTipHide():lvTipShow(b,w.help);});box.append(b);}
  c.append(box);return c;}
const lb={kind:'all',page:1,sort:'mtime',order:'desc',q:'',seq:0,timer:null,pending:false};
const lbSize=(n)=>{if(n==null)return '-';const u=['B','KB','MB','GB','TB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++;}return (i?v.toFixed(v<10?1:0):String(v))+' '+u[i];};
const lbDate=(s)=>s?new Date(s*1000).toLocaleString(loc(),{dateStyle:'medium',timeStyle:'short'}):'-';
// A language switch re-renders the open list so dates and counts follow the new locale.
function lbRelabel(){if($('lib-files')&&$('lib-files').offsetParent!==null&&!lb.pending)lbLoad();}
function lbIndicator(){const t=$('lb-tab-'+lb.kind),ind=$('lb-ind');if(!t||!t.offsetWidth)return;
  ind.style.width=t.offsetWidth+'px';ind.style.height=t.offsetHeight+'px';ind.style.transform='translate('+t.offsetLeft+'px,'+t.offsetTop+'px)';
  // On a phone the kinds scroll sideways; the picked one is brought into view without moving the page.
  const box=$('lb-kinds'),l=t.offsetLeft,r=l+t.offsetWidth;
  if(l<box.scrollLeft)box.scrollLeft=l-8;else if(r>box.scrollLeft+box.clientWidth)box.scrollLeft=r-box.clientWidth+8;}
function lbSkeleton(){const m=$('lb-list');m.replaceChildren();const t=el('table');
  for(let i=0;i<6;i++){const tr=el('tr',null,'lb-skel');const a=td();a.append(el('span'),el('span',null,'w2'));tr.append(a);
    for(let j=0;j<3;j++){const c=td();c.append(el('span'));tr.append(c);}t.append(tr);}m.append(t);}
function lbAnimate(){const m=$('lb-list');m.classList.remove('lb-in');void m.offsetWidth;m.classList.add('lb-in');}
const lbIsGame=(k)=>k==='base'||k==='update'||k==='dlc';
function lbCols(kind){
  if(kind==='all')return [topText('lo.colFile'),topText('lo.colKind'),topText('lb.colTid'),topText('rv.colSize'),topText('lb.colMtime'),topText('lb.colCheck'),''];
  if(lbIsGame(kind))return [topText('lo.colFile'),topText('lb.colTid'),topText('rv.colVer'),topText('rv.colSize'),topText('lb.colMtime'),topText('lb.colCheck'),''];
  if(kind==='patch'||kind==='save')return [topText('lo.colFile'),topText('lb.colTid'),topText('rv.colSize'),topText('lb.colMtime'),''];
  if(kind==='homebrew')return [topText('lo.colFile'),topText('rv.colVer'),topText('rv.colSize'),topText('lb.colMtime'),''];
  return [topText('lo.colFile'),topText('rv.colSize'),topText('lb.colMtime'),''];}
// A game's name, summary and extra notes are edited on the game-info page: the row leads there with the game already open.
// A patch or save opens the same edit dialog the patches page uses; the list loads again when it closes.
async function lbEditContent(f,kind){
  try{await loadPatches();}catch(err){toast(err.message);return;}
  const x=(kind==='patch'?ptData:svData).find((i)=>i.id===f.id);
  if(!x){toast(topText('lb.editMiss'));lbLoad();return;}
  ctOpen(kind,x,lbLoad);}
function lbEditButton(f,k){
  if(lbIsGame(k)&&/^[0-9A-F]{16}$/i.test(f.titleId||'')){const b=tbtn('info','hb.descBtn',()=>lbDetail({...f,kind:k},{edit:true}));const t=topFill('lb.gameInfoTitle',{name:f.name||f.rel||topText('lo.colFile')});b.title=t;b.setAttribute('aria-label',t);return b;}
  if((k==='patch'||k==='save')&&f.id){const b=tbtn('edit','hb.editBtn',()=>lbEditContent(f,k));b.setAttribute('aria-label',topFill('hb.editAria',{name:f.name||topText('lb.item')}));return b;}
  return null;}
// Every row leads with a picture: the game's icon, or a tile with the kind's icon when there is none, so names line up.
// A patch or save then names its game first, so the list says which game each one is for.
const LB_MISS={homebrew:'package',other:'file'};
function lbPic(f,k){const pic=el('span',null,'lb-gw');
  // A homebrew app (and its patch) carries its own icon; a game's comes by its title id.
  const src=f.icon?f.icon+(f.icon.includes('?')?'&':'?')+'size=sm':/^[0-9A-F]{16}$/i.test(f.titleId||'')?'/api/library/icon/'+f.titleId+'?size=sm':null;
  if(src){const ico=el('img',null,'lb-gi');ico.alt='';ico.loading='lazy';ico.dataset.miss=LB_MISS[k]||'joystick';ico.src=src;pic.append(ico);}
  else{const t=el('span',null,'lb-gi img-miss');t.innerHTML=IMG_MISS[LB_MISS[k]||'joystick'];pic.append(t);}
  return pic;}
function lbRow(f,kind){const tr=el('tr');const n=td();const k=kind==='all'?f.kind:kind;
  const row=el('div',null,'lb-for');const t=el('div');
  if(k==='patch'||k==='save')t.append(el('b',f.game||topText('lb.unknownGame')),el('div',(f.name||'-')+(f.rel?' · '+f.rel:''),'muted'));
  else{t.append(el('b',f.name||'-'));if(f.rel)t.append(el('div',f.rel,'muted'));}
  // The name opens the item's window, and so does a press anywhere on the row outside its buttons.
  const open=el('button',null,'lb-open');open.type='button';open.append(t);open.setAttribute('aria-label',topFill('lb.d.open',{name:f.name||f.rel||topText('lb.item')}));
  open.addEventListener('click',()=>lbDetail({...f,kind:k}));tr.dataset.open='';
  tr.addEventListener('click',(e)=>{if(!e.target.closest('button,a,input,select,label'))lbDetail({...f,kind:k});});
  row.append(lbPic(f,k),open);n.append(row);
  tr.append(n);
  const game=lbIsGame(k);
  if(kind==='all')tr.append(td(LB_KIND[k]?topText(LB_KIND[k]):k),td(f.titleId||'-','mono lb-num'));
  else{if(game||k==='patch'||k==='save')tr.append(td(f.titleId||'-','mono lb-num'));
    if(game||k==='homebrew')tr.append(td(f.version!=null?(game?'v'+f.version:String(f.version)):'-','lb-num'));}
  tr.append(td(lbSize(f.size),'lb-num'),td(lbDate(f.mtime),'lb-num'));
  if(game||kind==='all')tr.append(game?lbCheck(f):td());
  const act=td();const box=el('div',null,'lb-act');const edit=lbEditButton(f,k);if(edit)box.append(edit);
  const del=tbtn('delete','pp.delete',()=>lbRemove(f,k),'danger');del.setAttribute('aria-label',topFill('lb.delAria',{name:f.name||f.rel||topText('lo.colFile')}));box.append(del);act.append(box);tr.append(act);
  return tr;}
// Every kind deletes through its own endpoint; the list loads again afterwards.
function lbRemoveCall(f,kind){
  if(kind==='base'||kind==='update'||kind==='dlc')return api('/admin/api/library/files/remove',{method:'POST',body:{rel:f.rel}});
  if(kind==='other')return api('/admin/api/library/other/remove',{method:'POST',body:{rel:f.rel}});
  if(kind==='patch'||kind==='save')return api('/admin/api/content/'+kind+'/remove',{method:'POST',body:{id:f.id}});
  if(f.source==='manual')return api('/admin/api/homebrew/manual/remove',{method:'POST',body:{id:f.id}});
  if(f.repo)return api('/admin/api/homebrew/remove',{method:'POST',body:{repo:f.repo}});
  // A .nro lying in the games folder is a plain file of that folder: it has no homebrew record, only its path.
  if(f.rel)return api('/admin/api/library/files/remove',{method:'POST',body:{rel:f.rel}});
  return Promise.reject(new Error(topText('lb.cantDelete')));}
async function lbRemove(f,kind){
  const name=f.name||f.rel||topText('lb.thisFile');
  // A GitHub app's download is the server's own copy; everything else goes to the trash of its folder.
  const gone=Boolean(f.repo);
  if(!await ask(topFill(gone?'t.askUnfollow':'t.askMove',{name}),{danger:true}))return false;
  try{await lbRemoveCall(f,kind);toast(gone?topText('pp.deleted'):topText('t.movedToast'));lbLoad();return true;}catch(err){toast(err.message);return false;}}
function lbPageButton(label,page,{icon,current,far}={}){const b=el('button',null,'lb-pg'+(far?' lb-far':''));b.type='button';
  if(icon){b.innerHTML=icon;b.append(el('span',label));b.setAttribute('aria-label',topFill('lb.pageAria',{label}));}else{b.textContent=String(page);b.setAttribute('aria-label',topFill('lb.pageAria',{label:String(page)}));}
  if(current)b.setAttribute('aria-current','page');
  b.addEventListener('click',()=>{if(page!==lb.page){lb.page=page;lbLoad();}});return b;}
function lbPager(d){const nav=$('lb-pager');nav.replaceChildren();nav.hidden=d.pages<=1;if(d.pages<=1)return;
  const prev=lbPageButton(topText('fp.prev'),Math.max(1,d.page-1),{icon:LB_ICON.prev});prev.disabled=d.page<=1;nav.append(prev);
  const want=new Set([1,d.pages,d.page-2,d.page-1,d.page,d.page+1,d.page+2].filter((p)=>p>=1&&p<=d.pages));
  let last=0;for(const p of [...want].sort((a,b)=>a-b)){if(p-last>1)nav.append(el('span','…','lb-gap'));
    nav.append(lbPageButton('',p,{current:p===d.page,far:Math.abs(p-d.page)>1&&p!==1&&p!==d.pages}));last=p;}
  const next=lbPageButton(topText('fp.next'),Math.min(d.pages,d.page+1),{icon:LB_ICON.next});next.disabled=d.page>=d.pages;nav.append(next);}
// A version chip would pick among this page's 25 rows by an internal number (v65536), so the version column gets none.
async function lbLoad(){const n=++lb.seq;const kind=lb.kind;
  const skel=setTimeout(()=>{if(n===lb.seq)lbSkeleton();},150);
  const qs=new URLSearchParams({kind:kind==='all'?LB_ALL.join(','):kind,page:String(lb.page),perPage:String(LB_PER),sort:lb.sort,order:lb.order});if(lb.q)qs.set('q',lb.q);
  let d;try{d=await api('/admin/api/library/browse?'+qs);}catch(err){clearTimeout(skel);if(n===lb.seq){$('lb-list').replaceChildren(el('div',topFill('lb.loadFail',{msg:err.message}),'empty'));}return;}
  clearTimeout(skel);if(n!==lb.seq)return;
  for(const k of LB_ALL)$('lb-n-'+k).textContent=num(d.counts[k]);
  $('lb-n-all').textContent=num(LB_ALL.reduce((sum,k)=>sum+(d.counts[k]||0),0));
  lb.page=d.page;
  const empty=kind==='all'?(lb.q?topText('lb.noMatch'):topText('lb.noFiles')):lb.q?topText('lb.kindNoMatch'):topFill('lb.kindNoFiles',{kind:topText(LB_KIND[kind])});
  table('lb-list',lbCols(kind),d.items.map((f)=>lbRow(f,kind)),empty,{paging:false,noFilter:kind==='all'?[topText('lo.colKind'),topText('lb.colCheck'),topText('rv.colVer')]:[topText('lo.colKind'),topText('rv.colVer')]});lbAnimate();
  const from=d.total?(d.page-1)*d.perPage+1:0,to=Math.min(d.total,d.page*d.perPage);
  $('lb-count').textContent=d.total?topFill('lb.showing',{kind:kind==='all'?topText('lo.colFile'):topText(LB_KIND[kind]),total:num(d.total),from:num(from),to:num(to)}):'';
  lbPager(d);lbIndicator();
  // The first walk of a big folder is still running on the server: ask again, once it may be done.
  lb.pending=Boolean(d.pending);}
admInterval(async()=>{if(lb.pending&&$('lb-list').offsetParent!==null)await lbLoad();},4000);
function lbSelect(kind){if(kind===lb.kind)return;lb.kind=kind;lb.page=1;
  for(const b of $('lb-kinds').querySelectorAll('button[data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
  lbIndicator();lbLoad();}
$('lb-kinds').addEventListener('click',(e)=>{const b=e.target.closest('button[data-kind]');if(b)lbSelect(b.dataset.kind);});
$('lb-bar').addEventListener('submit',(e)=>{e.preventDefault();clearTimeout(lb.timer);lb.q=$('lb-q').value.trim();lb.page=1;lbLoad();});
$('lb-q').addEventListener('input',()=>{clearTimeout(lb.timer);lb.timer=setTimeout(()=>{const q=$('lb-q').value.trim();if(q===lb.q)return;lb.q=q;lb.page=1;lbLoad();},300);});
$('lb-sort').addEventListener('change',()=>{lb.sort=$('lb-sort').value;lb.order=lb.sort==='name'?'asc':'desc';lb.page=1;lbLoad();});
window.addEventListener('resize',()=>lbIndicator());
${LIB_ITEM_SCRIPT}
`;
