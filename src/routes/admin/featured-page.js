/** Home-screen collections: one editor shared by the standalone page and the legacy shell. */
import { top } from "./top-i18n.js";

export const FEATURED_HTML = /* html */ `<section id="tab-featured" hidden>
  <div class="hd"><h2 data-top="fp.h">${top("fp.h")}</h2>
    <div class="actions"><button type="button" id="f-add" data-top="fp.addRow">${top("fp.addRow")}</button>
    <button type="button" class="primary" id="f-save">${top("fp.save")}</button></div></div>
  <p class="muted" data-top="fp.lead">${top("fp.lead")}</p>
  <div id="f-list"></div>
</section>`;

export const FEATURED_SCRIPT = /* js */ `
let featured=[],names=new Map(),featuredDirty=false;
const FP_PAGE=60,FP_MAX=40,FP_WAIT=150;
// A row's list state survives redrawing the rows (moving one, a new language): keyed by the row itself.
const fpState=new WeakMap();
const fpOf=(c)=>{let s=fpState.get(c);if(!s){s={open:!c.titleIds.length,q:'',sort:'name',only:false,offset:0,data:null,asked:0,timer:0};fpState.set(c,s);}return s;};
const fpFill=(text,vars)=>Object.entries(vars).reduce((t,[k,v])=>t.replaceAll('{'+k+'}',String(v)),text);
// tbtn lives in common-script.js (with ACTION_ICONS), shared by the whole
// dashboard and the split pages alike.
function markDirty(){featuredDirty=true;fpSaveLabel();}
function fpSaveLabel(){$('f-save').textContent=topText(featuredDirty?'fp.saveDirty':'fp.save');}
function fpRelabel(){fpSaveLabel();renderFeatured();}
async function loadFeatured(){
  if(featuredDirty)return;
  try{const d=await api('/admin/api/featured');featured=d.collections;
    for(const c of d.candidates)names.set(c.titleId,c.name);
    renderFeatured();}catch(err){toast(err.message);}}
function move(arr,i,d){const j=i+d;if(j<0||j>=arr.length)return;[arr[i],arr[j]]=[arr[j],arr[i]];}
// Puts a game in a row or takes it out; false when the row is full.
function fpSet(c,g,on){const has=c.titleIds.includes(g.titleId);
  if(on&&!has){if(c.titleIds.length>=FP_MAX){toast(fpFill(topText('fp.full'),{n:FP_MAX}));return false;}
    names.set(g.titleId,g.name);c.titleIds.push(g.titleId);}
  else if(!on&&has){c.titleIds.splice(c.titleIds.indexOf(g.titleId),1);if(c.bannerTitleId===g.titleId)c.bannerTitleId=null;}
  else return true;
  markDirty();return true;}
function renderFeatured(){const box=$('f-list');box.replaceChildren();
  if(!featured.length){box.append(el('div',topText('fp.empty'),'empty'));return;}
  featured.forEach((c,ci)=>box.append(fpCard(c,ci)));}
function fpCard(c,ci){const card=el('div',null,'fcard'),st=fpOf(c);
  const top=el('div',null,'top');const title=el('input');title.value=c.title;title.maxLength=40;
  title.placeholder=topText('fp.rowTitle');title.setAttribute('aria-label',topText('fp.rowTitleAria'));
  title.addEventListener('input',()=>{c.title=title.value;markDirty();});
  const banner=el('select');banner.setAttribute('aria-label',topText('fp.banner'));
  banner.addEventListener('change',()=>{c.bannerTitleId=banner.value||null;markDirty();});
  const up=btn('▲',()=>{move(featured,ci,-1);markDirty();renderFeatured();}),down=btn('▼',()=>{move(featured,ci,1);markDirty();renderFeatured();});
  up.setAttribute('aria-label',topText('fp.up'));down.setAttribute('aria-label',topText('fp.down'));
  top.append(title,banner,up,down,
    tbtn('delete','fp.delRow',async()=>{if(!await ask(fpFill(topText('fp.delAsk'),{title:c.title||topText('fp.untitled')}),{danger:true}))return;featured.splice(ci,1);markDirty();renderFeatured();},'danger'));
  const chosen=el('ul',null,'fgames');
  const toggle=el('button',null,'fp-toggle');toggle.type='button';
  const panel=el('div',null,'fp');
  // The games in the row, in order, and everything that shows how many there are.
  function drawChosen(){chosen.replaceChildren();
    banner.replaceChildren(new Option(topText('fp.noBanner'),''));
    for(const id of c.titleIds)banner.append(new Option(fpFill(topText('fp.bannerOf'),{name:names.get(id)||id}),id,false,id===c.bannerTitleId));
    c.titleIds.forEach((id,gi)=>{const li=el('li');const img=el('img');img.src='/api/library/icon/'+id+'?size=sm';img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
      const u=btn('▲',()=>{move(c.titleIds,gi,-1);markDirty();drawChosen();}),d=btn('▼',()=>{move(c.titleIds,gi,1);markDirty();drawChosen();});
      u.setAttribute('aria-label',topText('fp.up'));d.setAttribute('aria-label',topText('fp.down'));
      li.append(img,el('span',names.get(id)||id,'name'),u,d,
        tbtn('remove','fp.remove',()=>{fpSet(c,{titleId:id},false);drawChosen();drawList();}));
      chosen.append(li);});
    chosen.hidden=!c.titleIds.length;
    toggle.textContent=fpFill(topText(st.open?'fp.close':'fp.open'),{n:c.titleIds.length});
    toggle.setAttribute('aria-expanded',String(st.open));}
  // The list panel: a search box, the order, "picked only", a page of games and the pager.
  const listId='fp-'+ci;panel.id=listId+'-panel';toggle.setAttribute('aria-controls',panel.id);
  const bar=el('div',null,'fp-bar');
  const q=el('input',null,'fp-q');q.type='search';q.value=st.q;q.autocomplete='off';
  q.placeholder=topText('fp.q');q.setAttribute('aria-label',topText('fp.qAria'));q.setAttribute('aria-controls',listId);
  const sort=el('select');sort.setAttribute('aria-label',topText('fp.sort'));
  sort.append(new Option(topText('fp.byName'),'name'),new Option(topText('fp.byRecent'),'recent'));sort.value=st.sort;
  const onlyL=el('label',null,'check'),only=el('input');only.type='checkbox';only.checked=st.only;onlyL.append(only,document.createTextNode(' '+topText('fp.only')));
  bar.append(q,sort,onlyL);
  const list=el('ul',null,'fp-list');list.id=listId;list.setAttribute('aria-label',topText('fp.list'));
  const pager=el('div',null,'fp-pager');
  const prev=el('button',topText('fp.prev'));prev.type='button';const next=el('button',topText('fp.next'));next.type='button';
  const info=el('span',null,'fp-info');info.setAttribute('role','status');info.setAttribute('aria-live','polite');
  pager.append(prev,info,next);panel.append(bar,list,pager);
  // "Picked only" pages through the row itself, filtered here; otherwise the server pages the library.
  function pageOfPicked(){const text=st.q.trim().toLowerCase();
    const all=c.titleIds.map((id)=>({titleId:id,name:names.get(id)||id}))
      .filter((g)=>!text||g.name.toLowerCase().includes(text)||g.titleId.toLowerCase().includes(text));
    return {total:all.length,offset:st.offset,items:all.slice(st.offset,st.offset+FP_PAGE)};}
  function drawList(){const d=st.only?pageOfPicked():st.data;if(!d)return;
    list.replaceChildren();
    for(const g of d.items){const li=el('li'),lab=el('label'),box=el('input');box.type='checkbox';
      const on=c.titleIds.includes(g.titleId);box.checked=on;lab.classList.toggle('on',on);
      const img=el('img');img.src='/api/library/icon/'+g.titleId+'?size=sm';img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
      const t=el('span',null,'fp-t');t.append(el('span',g.name||g.titleId,'fp-n'),el('span',(g.matched?g.matched+' · ':'')+g.titleId,'fp-s'));
      box.addEventListener('change',()=>{if(!fpSet(c,g,box.checked)){box.checked=!box.checked;return;}
        // The box stays where it is, also under "picked only", so a slip is undone with one more click.
        lab.classList.toggle('on',box.checked);drawChosen();});
      lab.append(box,img,t);li.append(lab);list.append(li);}
    if(!d.items.length){const li=el('li',topText('gp.none'),'fp-note');list.append(li);}
    info.textContent=d.total?fpFill(topText('fp.page'),{from:d.offset+1,to:d.offset+d.items.length,total:d.total}):topText('gp.none');
    prev.disabled=d.offset<=0;next.disabled=d.offset+d.items.length>=d.total;}
  // The last page stays on screen until the next one arrives; a late answer to an older ask is dropped.
  async function fetchList(){if(st.only){drawList();return;}
    const n=++st.asked;let d;
    try{d=await api('/admin/api/games/search?limit='+FP_PAGE+'&offset='+st.offset+'&sort='+st.sort+'&q='+encodeURIComponent(st.q.trim()));}
    catch(err){if(n===st.asked)toast(err.message);return;}
    if(n!==st.asked)return;st.data=d;drawList();}
  const refetch=()=>{st.offset=0;clearTimeout(st.timer);st.timer=setTimeout(fetchList,FP_WAIT);};
  // The server finds a syllable still being composed ("젤ㄷ"), so typing mid-composition searches from page 1 like any other.
  q.addEventListener('compositionend',()=>{st.q=q.value;refetch();});
  q.addEventListener('input',()=>{st.q=q.value;refetch();});
  sort.addEventListener('change',()=>{st.sort=sort.value;st.offset=0;fetchList();});
  only.addEventListener('change',()=>{st.only=only.checked;st.offset=0;fetchList();});
  prev.addEventListener('click',()=>{st.offset=Math.max(0,st.offset-FP_PAGE);fetchList();});
  next.addEventListener('click',()=>{st.offset+=FP_PAGE;fetchList();});
  toggle.addEventListener('click',()=>{st.open=!st.open;panel.hidden=!st.open;drawChosen();if(st.open&&!st.data)fetchList();});
  panel.hidden=!st.open;drawChosen();
  if(st.open){if(st.data||st.only)drawList();else fetchList();}
  card.append(top,chosen,toggle,panel);return card;}
$('f-add').addEventListener('click',()=>{featured.push({title:'',bannerTitleId:null,titleIds:[]});markDirty();renderFeatured();
  $('f-list').querySelector('.fcard:last-child .top input')?.focus();});
$('f-save').addEventListener('click',async()=>{
  try{const d=await api('/admin/api/featured',{method:'PUT',body:{collections:featured}});
    // The saved rows are new objects: carry each row's list state over to its saved copy.
    d.collections.forEach((c,i)=>{const was=featured[i];if(was&&fpState.has(was))fpState.set(c,fpState.get(was));});
    featured=d.collections;featuredDirty=false;fpSaveLabel();renderFeatured();toast(topText('fp.saved'));}
  catch(err){toast(err.message);}});
addEventListener('beforeunload',(e)=>{if(featuredDirty)e.preventDefault();});
`;
