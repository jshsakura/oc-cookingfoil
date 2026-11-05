/**
 * One library item in a window, opened from its row in 전체 목록 or 게임 목록: what it is and where it lies,
 * its file check with the reason, the game it belongs to (titledb's facts and introduction), that game's other
 * files (GET /admin/api/library/browse?game=), and a game's own name, notes and introduction, edited and saved
 * here (POST /admin/api/descriptions/:id). A patch or save opens its own edit dialog.
 * Rides on the list's script (library-browser-panel.js) and its helpers.
 */
import { topLabel } from "./top-i18n.js";

export const LIB_ITEM_CSS = `
#lb-dlg{width:min(680px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box;padding:0}
#lb-dlg .lbd-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:14px;padding:18px 20px;background:var(--panel);border-bottom:1px solid var(--line)}
#lb-dlg .lbd-head .lb-gw{flex:none;width:56px;height:56px}
#lb-dlg .lbd-head .lb-gi{width:56px;height:56px;border-radius:var(--r-lg)}
#lb-dlg .lbd-t{min-width:0;flex:1}
#lb-dlg .lbd-t h3{margin:0;font-size:var(--fs-lg);overflow-wrap:anywhere}
#lb-dlg .lbd-t p{margin:2px 0 0}
#lb-dlg .lbd-body{display:grid;gap:18px;padding:18px 20px}
#lb-dlg h4{margin:0 0 8px;font-size:var(--fs-sm);color:var(--muted);font-weight:var(--fw-bold)}
#lb-dlg dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}
#lb-dlg dt{color:var(--muted)}
#lb-dlg dd{margin:0;min-width:0;overflow-wrap:anywhere}
#lb-dlg .lbd-why{margin-top:8px;padding:10px 12px;border-radius:var(--r-md);background:var(--sunk);font-size:var(--fs-sm)}
#lb-dlg .lbd-why p{margin:4px 0 0;color:var(--muted)}
#lb-dlg .lbd-about{margin:8px 0 0;color:var(--muted);white-space:pre-line}
#lb-dlg .lbd-same{display:grid;gap:2px;margin:0;padding:0;list-style:none}
#lb-dlg .lbd-same button{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:10px;width:100%;padding:7px 10px;border:0;border-radius:var(--r-md);background:transparent;color:inherit;text-align:left;cursor:pointer}
#lb-dlg .lbd-same button:hover,#lb-dlg .lbd-same button:focus-visible{background:var(--sunk)}
#lb-dlg .lbd-same button[aria-current="true"]{background:var(--sunk);font-weight:var(--fw-bold)}
#lb-dlg .lbd-same .lbd-k{color:var(--muted);font-size:var(--fs-sm)}
#lb-dlg .lbd-same .lbd-n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#lb-dlg .lbd-same .lbd-s{color:var(--muted);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
#lb-dlg form{display:grid;gap:10px}
#lb-dlg form h5{margin:6px 0 0;font-size:var(--fs-sm)}
#lb-dlg form textarea{display:block;width:100%;box-sizing:border-box;min-height:72px}
#lb-dlg .lbd-foot{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:8px;padding:14px 20px;background:var(--panel);border-top:1px solid var(--line)}
#lb-dlg .lbd-foot .lbd-gap{flex:1}
#lib-files .lb-open{display:block;min-width:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
#lib-files .lb-open:hover b,#lib-files .lb-open:focus-visible b{text-decoration:underline}
#lb-list [role="row"][data-open]{cursor:pointer}`;

export const LIB_ITEM_HTML = `<dialog id="lb-dlg" aria-labelledby="lb-d-name">
  <div class="lbd-head"><span id="lb-d-pic"></span><div class="lbd-t"><h3 id="lb-d-name"></h3><p class="muted" id="lb-d-sub"></p></div>
    <button type="button" class="ib" id="lb-d-close" ${topLabel("ch.close")}><svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
  <div class="lbd-body" id="lb-d-body"></div>
  <div class="lbd-foot" id="lb-d-foot"></div>
</dialog>`;

export const LIB_ITEM_SCRIPT = /* js */ `
// ── one item in a window (library-item-dialog.js) ───────────────────
const LBD_ROOT={base:'games',update:'games',dlc:'games',other:'games',patch:'patches',save:'saves',homebrew:'homebrew'};
const LBD_PAGE={games:'/admin/games',patches:'/admin/patches',saves:'/admin/saves',homebrew:'/admin/homebrew'};
const lbdTitles=new Map();let lbdSeq=0;let lbdForm=null;
// An update's and a DLC's title id fold to the base game's, the way the server's library-browse.js folds them.
function lbdGameId(f){const id=String(f.titleId||'').toUpperCase();if(!/^[0-9A-F]{16}$/.test(id))return '';
  if(id.endsWith('000'))return id;if(id.endsWith('800'))return id.slice(0,13)+'000';
  return ((BigInt('0x'+id)&~0xfffn)-0x1000n).toString(16).toUpperCase().padStart(16,'0');}
const lbdDate=(v)=>{const t=String(v||'');return t.length===8?t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6):t;};
const lbdRows=(rows)=>{const dl=el('dl');for(const [k,v] of rows)if(v!=null&&v!=='')dl.append(el('dt',topText(k)),el('dd',String(v)));return dl;};
function lbdSection(key,...kids){const s=el('section');s.append(el('h4',topText(key)),...kids);return s;}
async function lbdTitle(id){if(!lbdTitles.has(id)){let d=null;try{d=await api('/api/title/'+id+'?lang='+encodeURIComponent(adminLang));}catch{}lbdTitles.set(id,d);}return lbdTitles.get(id);}
// What the file is: where it lies, its size and date, and the check with what it found spelled out.
function lbdFacts(f){const k=f.kind;const game=lbIsGame(k);
  const dl=lbdRows([['lb.colTid',f.titleId],['rv.colVer',f.version!=null?(game?'v'+f.version:String(f.version)):null],
    ['lb.d.where',f.rel],['fb.colSize',f.size!=null?lbSize(f.size):null],['lb.colMtime',f.mtime?lbDate(f.mtime):null]]);
  const s=lbdSection('lb.d.file',dl);
  if(game){const v=LB_CHECK[f.integrity]||LB_CHECK.unchecked;const w=f.why;const tone=f.integrity==='damaged'&&w&&!w.certain?'warn':v[1];
    dl.append(el('dt',topText('lb.colCheck')));const dd=el('dd');dd.append(pill(w?.label||topText(v[0]),tone));dl.append(dd);
    if(w?.help){const box=el('div',null,'lbd-why');box.append(el('b',w.help.title),...w.help.body.split('\\n\\n').map((p)=>el('p',p)));s.append(box);}}
  return s;}
function lbdAbout(d){const s=lbdSection('lb.d.game',lbdRows([['fb.m.publisher',d.publisher],['fb.m.released',lbdDate(d.releaseDate)],['fb.m.genre',d.category],
  ['fb.m.players',d.numberOfPlayers],['fb.m.region',d.region],['fb.m.rating',d.rating],['fb.m.latest',d.latestVersion!=null?'v'+d.latestVersion:null],['fb.m.dlc',d.dlcTotal||null],['fb.m.firmware',d.requiredFirmware]]));
  if(d.description)s.append(el('p',d.description,'lbd-about'));return s;}
// The game's other files; pressing one shows it in this window.
function lbdSame(items,f){const ul=el('ul',null,'lbd-same');
  for(const it of items){const li=el('li');const b=el('button');b.type='button';if(it.kind===f.kind&&it.rel===f.rel&&it.id===f.id)b.setAttribute('aria-current','true');
    const name=it.kind==='patch'||it.kind==='save'?it.name:(it.version!=null&&lbIsGame(it.kind)?'v'+it.version:it.name);
    const end=el('span');if(lbIsGame(it.kind)){const v=LB_CHECK[it.integrity]||LB_CHECK.unchecked;if(it.integrity==='damaged'||it.integrity==='modified')end.append(pill(it.why?.label||topText(v[0]),it.integrity==='damaged'&&it.why&&!it.why.certain?'warn':v[1]));}
    b.append(el('span',LB_KIND[it.kind]?topText(LB_KIND[it.kind]):it.kind,'lbd-k'),el('span',name||it.rel||'-','lbd-n'),end,el('span',lbSize(it.size),'lbd-s'));
    b.title=it.rel||'';b.addEventListener('click',async()=>{if(await lbdLeave())lbDetail(it);});li.append(b);ul.append(li);}
  return lbdSection('lb.d.same',items.length>1?ul:el('p',topText('lb.d.sameNone'),'muted'));}
// The game's own name, notes and introduction: what the 이름과 소개 tab edits, saved the same way.
function lbdEdit(id,d){const own=d.own||{};const form=el('form');form.autocomplete='off';
  const field=(tag,key,v,ph)=>{const l=el('label',topText(key));const i=el(tag);i.maxLength=tag==='input'?120:2000;i.value=v||'';if(ph)i.placeholder=ph;l.append(i);return [l,i];};
  const pair=(head,tag,obj,ph)=>{const [lk,ik]=field(tag,'lp.ko',obj?.ko,ph);const [le,ie]=field(tag,'lp.en',obj?.en,ph);form.append(el('h5',topText(head)),lk,le);return {ko:ik,en:ie};};
  const name=pair('pp.name','input',own.name,d.originalName||'');const notes=pair('lp.notesH','textarea',own.notes,'');const desc=pair('lp.introH','textarea',own.description,d.original?d.original.slice(0,120):'');
  const save=el('button',topText('fp.save'),'primary');save.type='submit';const row=el('div',null,'row-actions');row.append(save);form.append(row);
  const read=()=>({name:{ko:name.ko.value,en:name.en.value},notes:{ko:notes.ko.value,en:notes.en.value},description:{ko:desc.ko.value,en:desc.en.value}});
  const start=JSON.stringify(read());form.dirty=()=>JSON.stringify(read())!==start;
  form.addEventListener('submit',async(e)=>{e.preventDefault();save.disabled=true;
    try{await api('/admin/api/descriptions/'+id,{method:'POST',body:read()});toast(topText('lp.saved'));lbdForm=null;lbLoad();$('lb-dlg').close();}
    catch(err){toast(err.message);}finally{save.disabled=false;}});
  lbdForm=form;return lbdSection('m.titles',form);}
// Leaving with an edit not saved asks first.
async function lbdLeave(){return !lbdForm?.dirty?.()||await ask(topText('lb.d.unsaved'),{danger:true});}
function lbdFoot(f){const foot=$('lb-d-foot');foot.replaceChildren();const k=f.kind;const root=LBD_ROOT[k];
  if(root&&LBD_PAGE[root]&&f.rel){const dir=k==='patch'||k==='save'?f.rel:f.rel.split('/').slice(0,-1).join('/');
    const a=el('a',topText('lb.d.openFolder'),'btn');a.href=LBD_PAGE[root]+'?tab=folder&path='+encodeURIComponent(dir);foot.append(a);}
  if(root&&f.rel&&f.ext){const a=el('a',topText('fb.download'),'btn');a.href='/admin/api/files/download?'+new URLSearchParams({root,path:f.rel});a.download='';foot.append(a);}
  if((k==='patch'||k==='save')&&f.id){const b=el('button',topText('hb.editBtn'));b.type='button';b.addEventListener('click',()=>{$('lb-dlg').close();lbEditContent(f,k);});foot.append(b);}
  foot.append(el('span',null,'lbd-gap'));
  const del=el('button',topText('pp.delete'),'danger');del.type='button';del.addEventListener('click',async()=>{if(await lbRemove(f,k))$('lb-dlg').close();});foot.append(del);}
async function lbDetail(f,{edit=false}={}){const dlg=$('lb-dlg');const n=++lbdSeq;const k=f.kind;lbdForm=null;
  $('lb-d-pic').replaceChildren(lbPic(f,k));
  $('lb-d-name').textContent=k==='patch'||k==='save'?(f.game||topText('lb.unknownGame')):(f.name||f.rel||'-');
  $('lb-d-sub').textContent=[LB_KIND[k]?topText(LB_KIND[k]):k,k==='patch'||k==='save'?f.name:null].filter(Boolean).join(' · ');
  const body=$('lb-d-body');body.replaceChildren(lbdFacts(f));lbdFoot(f);
  if(!dlg.open)dlg.showModal();body.scrollTop=0;
  const id=lbdGameId(f);if(!id)return;
  const [meta,same,own]=await Promise.all([lbdTitle(id),
    api('/admin/api/library/browse?'+new URLSearchParams({kind:'base,update,dlc,patch,save',game:id,perPage:'100',sort:'name'})).catch(()=>null),
    lbIsGame(k)?api('/admin/api/descriptions/'+id).catch(()=>null):null]);
  if(n!==lbdSeq||!dlg.open)return;
  if(meta)body.append(lbdAbout(meta));
  if(same)body.append(lbdSame(same.items,f));
  if(own){const s=lbdEdit(id,own);body.append(s);if(edit)s.querySelector('input')?.focus();}}
$('lb-d-close').addEventListener('click',async()=>{if(await lbdLeave())$('lb-dlg').close();});
$('lb-dlg').addEventListener('cancel',(e)=>{if(!lbdForm?.dirty?.())return;e.preventDefault();lbdLeave().then((ok)=>{if(ok)$('lb-dlg').close();});});
$('lb-dlg').addEventListener('close',()=>{lbdForm=null;lbdSeq++;});
`;
