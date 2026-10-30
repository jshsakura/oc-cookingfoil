/** Game library tasks and game details, independent of the other admin pages. */
import { icon } from "../../views/icons.js";
import { top, topLabel, topPh } from "./top-i18n.js";
import { LIBRARY_VERIFY_HTML } from "./library-files-panel.js";
import { LIB_BROWSER_HTML } from "./library-browser-panel.js";
import { GAME_PATCHES_HTML } from "./patches-panel.js";
import { FOLDER_MARK } from "./files-panel.js";

export const LIBRARY_HTML = /* html */ `<section id="tab-library" hidden>
  <div class="hd"><h2>${top("m.grpGames")}</h2><button type="button" class="primary" id="rescan">${top("lib.rescan")}</button></div>
  <p class="muted" id="scan-status" aria-live="polite"></p>
  <div class="subtabs hide-bar" id="lib-subtabs" role="tablist" ${topLabel("lp.areaAria")}>
    <button type="button" role="tab" data-lsub="folder" aria-selected="true">${icon("folder")}${top("m.files")}</button>
    <button type="button" role="tab" data-lsub="files" aria-selected="false">${icon("grid")}${top("m.gameList")}</button>
    <button type="button" role="tab" data-lsub="verify" aria-selected="false">${icon("check")}${top("lb.colCheck")}</button>
    <button type="button" role="tab" data-lsub="info" aria-selected="false">${icon("book")}${top("m.titles")}</button>
  </div>
  <div data-lib-panel="folder">${FOLDER_MARK}</div>
  <div data-lib-panel="files" hidden>${LIB_BROWSER_HTML}
  <section class="lib-ops" aria-labelledby="lib-ops-h">
    <h3 class="sub-h" id="lib-ops-h">${top("ops.status")}</h3>
    <div class="cards" id="lib-cards"></div>
  </section></div>
  <div data-lib-panel="verify" hidden>${LIBRARY_VERIFY_HTML}</div>
  <div data-lib-panel="info" hidden>
  <h2 class="first">${top("m.titles")}</h2>
  <p class="muted">${top("lp.notesLead")}</p>
  <form class="desc-form" id="gd-form">
    <label>${top("gp.find")}<input id="gd-game" autocomplete="off" ${topPh("gp.ph")}></label>
    <div id="gd-body" hidden>
      <h3 data-top="pp.name">${top("pp.name")}</h3>
      <p class="muted" id="gd-name-original"></p>
      <div class="ct-pair"><label>${top("lp.ko")}<input id="gd-name-ko" maxlength="120" autocomplete="off"></label><label>${top("lp.en")}<input id="gd-name-en" maxlength="120" autocomplete="off"></label></div>
      ${GAME_PATCHES_HTML}
      <h3>${top("lp.notesH")}</h3>
      <label>${top("lp.ko")}<textarea id="gd-notes-ko" maxlength="2000" ${topPh("lp.notesPh")}></textarea></label>
      <label>${top("lp.en")}<textarea id="gd-notes-en" maxlength="2000"></textarea></label>
      <h3>${top("lp.introH")}</h3>
      <p class="muted" id="gd-original"></p>
      <label>${top("lp.ko")}<textarea id="gd-ko" maxlength="2000"></textarea></label>
      <label>${top("lp.en")}<textarea id="gd-en" maxlength="2000"></textarea></label>
      <h3>${top("fp.detailH")}</h3>
      <div class="fp-detail"><label>${top("fp.detailRow")}<select id="gd-feat-row"></select></label>
        <label id="gd-feat-title-l" hidden>${top("fp.newTitle")}<input id="gd-feat-title" maxlength="40" autocomplete="off"></label>
        <button type="button" id="gd-feat-go">${top("fp.addTo")}</button></div>
      <div class="row-actions"><button type="submit" class="primary">${top("fp.save")}</button><button type="button" id="gd-reset">${top("lp.resetBtn")}</button></div>
    </div>
  </form>
  </div>
</section>`;

export const LIBRARY_PAGE_SCRIPT = /* js */ `
function uptime(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return [d?topFill('lp.d',{n:d}):'',h?topFill('lp.h',{n:h}):'',topFill('lp.m',{n:m})].filter(Boolean).join(' ');}
// The admin's own description of a game; titledb refreshes never overwrite it.
let gdId='';
// Leaving the game box fires change again: the same game already open keeps what is being typed.
async function openDesc(force){const m=$('gd-game').value.match(/[0-9A-Fa-f]{16}/);const id=m?m[0].toUpperCase():'';
  if(!id){$('gd-body').hidden=true;gdId='';return;}
  if(force!==true&&id===gdId&&!$('gd-body').hidden)return;
  let d;try{d=await api('/admin/api/descriptions/'+id);}catch(err){toast(err.message);return;}
  gdId=id;const own=d.own||{};
  $('gd-ko').value=own.description?.ko||'';$('gd-en').value=own.description?.en||'';
  $('gd-notes-ko').value=own.notes?.ko||'';$('gd-notes-en').value=own.notes?.en||'';
  $('gd-name-ko').value=own.name?.ko||'';$('gd-name-en').value=own.name?.en||'';
  $('gd-name-original').textContent=topFill(own.name?(d.originalName?'lp.nameOwnOrig':'lp.nameOwnFile'):(d.originalName?'lp.nameEmptyOrig':'lp.nameEmptyFile'),{name:d.originalName});
  $('gd-original').textContent=own.description?topText('lp.descOwn'):(d.original?topFill('lp.descOrig',{text:d.original.slice(0,160)+(d.original.length>160?'…':'')}):topText('lp.descEmpty'));
  $('gd-body').hidden=false;ptGame();gdFeatRows();}
$('gd-game').addEventListener('change',()=>openDesc());
gamePicker($('gd-game'),{fill:true,edited:true,pick:()=>openDesc()});
$('gd-form').addEventListener('submit',async(e)=>{e.preventDefault();if(!gdId)return;
  try{await api('/admin/api/descriptions/'+gdId,{method:'POST',body:{name:{ko:$('gd-name-ko').value,en:$('gd-name-en').value},description:{ko:$('gd-ko').value,en:$('gd-en').value},notes:{ko:$('gd-notes-ko').value,en:$('gd-notes-en').value}}});toast(topText('lp.saved'));openDesc(true);}catch(err){toast(err.message);}});
$('gd-reset').addEventListener('click',async()=>{if(!gdId||!await ask(topText('lp.resetAsk'),{danger:true}))return;
  try{await api('/admin/api/descriptions/'+gdId+'/reset',{method:'POST',body:{field:'description'}});toast(topText('lp.resetDone'));openDesc(true);}catch(err){toast(err.message);}});
// The library tab shows one area at a time and loads only that one: #library/patches opens a given area.
const LIB_SUBS=['folder','files','verify','info'];let libSub='folder';
function libLoadSub(){
  if(libSub==='files')lbLoad();else if(libSub==='verify')lvLoad();else if(libSub==='folder')fbOpen('games');else if(libSub==='info')loadPatches();}
function libShowSub(sub,quiet){if(!LIB_SUBS.includes(sub))return;libSub=sub;
  for(const b of document.querySelectorAll('#lib-subtabs [data-lsub]'))b.setAttribute('aria-selected',String(b.dataset.lsub===sub));
  for(const p of document.querySelectorAll('#tab-library [data-lib-panel]'))p.hidden=p.dataset.libPanel!==sub;
  if(!quiet){const next=new URL(location.href);
    if(sub==='folder')next.searchParams.delete('view');
    else{next.searchParams.set('view',sub);next.searchParams.delete('tab');next.searchParams.delete('path');}
    next.hash='#library/'+sub;
    history.replaceState(null,'',next);libLoadSub();}
  if(window.__admMark)window.__admMark();}
for(const b of document.querySelectorAll('#lib-subtabs [data-lsub]'))b.addEventListener('click',()=>libShowSub(b.dataset.lsub));
addEventListener('hashchange',()=>{
  const [tab,sub]=location.hash.slice(1).split('/');if(tab==='library')libShowSub(sub||'folder');});
async function loadLibrary(refreshPanel=true){
  if(refreshPanel)libLoadSub();
  const d=await api('/admin/api/library');
  const cards=$('lib-cards');cards.replaceChildren();
  const card=(l,v)=>{const c=el('div',null,'card');c.append(el('div',v,'v'),el('div',l,'l'));return c;};
  cards.append(card(topText('lp.cardFiles'),num(d.files)),card(topText('lp.cardTitledb'),num(d.titledb?.titles)),
    card(topText('lp.cardBuild'),d.lastBuildMs!=null?num(d.lastBuildMs)+'ms':'—'),card(topText('lp.cardUptime'),uptime(d.uptime)));
  scanShow(d.scan||{});return d;}
// The rescan button stays pressed while a whole read of the games folder waits or runs.
const scanBusy=(s)=>s.state==='running'||s.fullPending;
const scanTook=(f)=>topFill('lp.scanTook',{files:num(f.files),sec:(f.ms/1000).toFixed(1)});
function scanShow(s){const b=$('rescan');b.disabled=scanBusy(s);b.setAttribute('aria-busy',String(scanBusy(s)));
  b.title=$('scan-status').textContent=s.state==='running'?topText('lp.scanRunning'):s.fullPending?topText('lp.scanPending')
    :s.lastFull?topFill('lp.scanLast',{at:fmt(s.lastFull.at),took:scanTook(s.lastFull)}):'';}
let scanPoll=null;
function scanWatch(since){
  if(scanPoll)scanPoll.stop();let lastError='';
  const poll=admInterval(async()=>{
    let d;try{d=await loadLibrary(false);lastError='';}catch(err){
      if(err.message!=='session'&&err.message!==lastError)toast(errText(err));lastError=err.message;return;}
    const status=d.scan||{};
    if(!scanBusy(status)&&status.lastFull&&status.lastFull.at>=since){
      poll.stop();if(scanPoll===poll)scanPoll=null;
      toast(topFill('lp.scanDone',{took:scanTook(status.lastFull)}));}
  },1000);scanPoll=poll;}
$('rescan').addEventListener('click',async()=>{$('rescan').disabled=true;
  try{const r=await api('/admin/api/library/rescan',{method:'POST',body:{}});
    toast(topText(r.already?'lp.scanAlready':'lp.scanStarted'));scanShow({fullPending:true});scanWatch(r.requestedAt);}
  catch(err){toast(err.message);$('rescan').disabled=false;}});

let gdCollections=[];
const gdFill=(text,vars)=>Object.entries(vars).reduce((t,[k,v])=>t.replaceAll('{'+k+'}',String(v)),text);
async function gdFeatRows(){
  try{const d=await api('/admin/api/featured');gdCollections=d.collections;}catch(err){toast(err.message);return;}
  const sel=$('gd-feat-row'),keep=sel.value;sel.replaceChildren();
  gdCollections.forEach((c,i)=>{const title=c.title||topText('fp.untitled');
    sel.append(new Option(c.titleIds.includes(gdId)?gdFill(topText('fp.inRow'),{title}):title,String(i)));});
  sel.append(new Option(topText('fp.newRow'),'new'));
  sel.value=[...sel.options].some((o)=>o.value===keep)?keep:sel.options[0].value;gdFeatNew();}
function gdFeatNew(){$('gd-feat-title-l').hidden=$('gd-feat-row').value!=='new';}
$('gd-feat-row').addEventListener('change',gdFeatNew);
$('gd-feat-go').addEventListener('click',async()=>{if(!gdId)return;
  const pick=$('gd-feat-row').value;
  const collections=gdCollections.map((c)=>({...c,titleIds:[...c.titleIds]}));
  let row;
  if(pick==='new'){const title=$('gd-feat-title').value.trim();if(!title){toast(topText('fp.needTitle'));$('gd-feat-title').focus();return;}
    row={title,bannerTitleId:null,titleIds:[]};collections.push(row);}
  else row=collections[Number(pick)];
  if(!row)return;
  if(row.titleIds.includes(gdId)){toast(topText('gp.already'));return;}
  if(row.titleIds.length>=40){toast(gdFill(topText('fp.full'),{n:40}));return;}
  row.titleIds.push(gdId);
  try{await api('/admin/api/featured',{method:'PUT',body:{collections}});
    $('gd-feat-title').value='';toast(topText('fp.addedOk'));await gdFeatRows();}
  catch(err){toast(err.message);await gdFeatRows();}});
`;
