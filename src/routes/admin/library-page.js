/** Game library tasks and game details, independent of the other admin pages. */
import { icon } from "../../views/icons.js";
import { top, topPh } from "./top-i18n.js";
import { LIBRARY_VERIFY_HTML } from "./library-files-panel.js";
import { LIB_BROWSER_HTML } from "./library-browser-panel.js";
import { ORGANIZE_HTML } from "./library-organize-panel.js";
import { GAME_PATCHES_HTML, PATCHES_HTML, SAVES_HTML } from "./patches-panel.js";

export const LIBRARY_HTML = /* html */ `<section id="tab-library" hidden>
  <div class="hd"><h2>라이브러리</h2><button type="button" class="primary" id="rescan">다시 스캔</button></div>
  <p class="muted" id="scan-status" aria-live="polite"></p>
  <div class="subtabs hide-bar" id="lib-subtabs" role="tablist" aria-label="라이브러리 구역">
    <button type="button" role="tab" data-lsub="files" aria-selected="true">${icon("folder")}파일</button>
    <button type="button" role="tab" data-lsub="organize" aria-selected="false">${icon("inbox")}임시 폴더</button>
    <button type="button" role="tab" data-lsub="verify" aria-selected="false">${icon("check")}검사</button>
    <button type="button" role="tab" data-lsub="patches" aria-selected="false">${icon("package")}패치</button>
    <button type="button" role="tab" data-lsub="saves" aria-selected="false">${icon("save")}세이브</button>
    <button type="button" role="tab" data-lsub="info" aria-selected="false">${icon("book")}이름과 소개</button>
    <button type="button" role="tab" data-lsub="server" aria-selected="false">${icon("sliders")}서버</button>
  </div>
  <div data-lib-panel="files">${LIB_BROWSER_HTML}
  <section class="lib-ops" aria-labelledby="lib-ops-h">
    <h3 class="sub-h" id="lib-ops-h">${top("ops.status")}</h3>
    <div class="cards" id="lib-cards"></div>
  </section></div>
  <div data-lib-panel="organize" hidden>${ORGANIZE_HTML}</div>
  <div data-lib-panel="verify" hidden>${LIBRARY_VERIFY_HTML}</div>
  <div data-lib-panel="patches" hidden>${PATCHES_HTML}</div>
  <div data-lib-panel="saves" hidden>${SAVES_HTML}</div>
  <div data-lib-panel="info" hidden>
  <h2 class="first">게임 이름, 소개, 추가 정보</h2>
  <p class="muted">소개는 titledb 가 새로 받아 오면 바뀔 수 있는 게임 설명이고, 직접 쓰면 그 글이 대신 나옵니다. 추가 정보는 운영자만 쓰는 안내(함께 설치할 것, 필요한 용량, 맞는 판, 오버클럭)로 자동 갱신이 건드리지 않습니다.</p>
  <form class="desc-form" id="gd-form">
    <label>${top("gp.find")}<input id="gd-game" autocomplete="off" ${topPh("gp.ph")}></label>
    <div id="gd-body" hidden>
      <h3 data-top="pp.name">${top("pp.name")}</h3>
      <p class="muted" id="gd-name-original"></p>
      <div class="ct-pair"><label>한국어<input id="gd-name-ko" maxlength="120" autocomplete="off"></label><label>영어 (다른 언어의 기본값)<input id="gd-name-en" maxlength="120" autocomplete="off"></label></div>
      ${GAME_PATCHES_HTML}
      <h3>추가 정보</h3>
      <label>한국어<textarea id="gd-notes-ko" maxlength="2000" placeholder="예: 게임 데이터 패치(약 49GB)를 함께 설치해야 실행됩니다."></textarea></label>
      <label>영어 (다른 언어의 기본값)<textarea id="gd-notes-en" maxlength="2000"></textarea></label>
      <h3>소개</h3>
      <p class="muted" id="gd-original"></p>
      <label>한국어<textarea id="gd-ko" maxlength="2000"></textarea></label>
      <label>영어 (다른 언어의 기본값)<textarea id="gd-en" maxlength="2000"></textarea></label>
      <h3>${top("fp.detailH")}</h3>
      <div class="fp-detail"><label>${top("fp.detailRow")}<select id="gd-feat-row"></select></label>
        <label id="gd-feat-title-l" hidden>${top("fp.newTitle")}<input id="gd-feat-title" maxlength="40" autocomplete="off"></label>
        <button type="button" id="gd-feat-go">${top("fp.addTo")}</button></div>
      <div class="row-actions"><button type="submit" class="primary">저장</button><button type="button" id="gd-reset">소개를 titledb 것으로 되돌리기</button></div>
    </div>
  </form>
  </div>
  <div data-lib-panel="server" hidden>
  <h2 class="first" data-top="s.settings">${top("s.settings")}</h2>
  <dl class="kv" id="settings"></dl>
  <p class="muted">바꿀 수 있는 설정은 <a href="#settings/server">설정 탭의 서버 동작</a>에 있습니다.</p>
  </div>
</section>`;

export const LIBRARY_PAGE_SCRIPT = /* js */ `
function uptime(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return (d?d+'일 ':'')+(h?h+'시간 ':'')+m+'분';}
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
  $('gd-name-original').textContent=(own.name?'직접 정한 이름을 보여 주고 있습니다. 비우고 저장하면 ':'비워 두면 ')+(d.originalName?'원래 이름('+d.originalName+')을 씁니다.':'파일에서 읽은 이름을 씁니다.')+' 이름이 깨졌거나 틀렸을 때 고칩니다.';
  $('gd-original').textContent=own.description?'직접 쓴 소개를 보여 주고 있습니다.':(d.original?'지금은 titledb 소개를 보여 줍니다: '+d.original.slice(0,160)+(d.original.length>160?'…':''):'지금은 소개가 비어 있습니다. 쓰면 그 글이 나옵니다.');
  $('gd-body').hidden=false;ptGame();gdFeatRows();}
$('gd-game').addEventListener('change',()=>openDesc());
gamePicker($('gd-game'),{fill:true,edited:true,pick:()=>openDesc()});
$('gd-form').addEventListener('submit',async(e)=>{e.preventDefault();if(!gdId)return;
  try{await api('/admin/api/descriptions/'+gdId,{method:'POST',body:{name:{ko:$('gd-name-ko').value,en:$('gd-name-en').value},description:{ko:$('gd-ko').value,en:$('gd-en').value},notes:{ko:$('gd-notes-ko').value,en:$('gd-notes-en').value}}});toast('저장했습니다');openDesc(true);}catch(err){toast(err.message);}});
$('gd-reset').addEventListener('click',async()=>{if(!gdId||!await ask('직접 쓴 소개를 지우고 titledb 소개로 돌아갑니다. 추가 정보는 그대로 둡니다.',{danger:true}))return;
  try{await api('/admin/api/descriptions/'+gdId+'/reset',{method:'POST',body:{field:'description'}});toast('원래 소개로 돌렸습니다');openDesc(true);}catch(err){toast(err.message);}});
// The library tab shows one area at a time and loads only that one: #library/patches opens a given area.
const LIB_SUBS=['files','organize','verify','patches','saves','info','server'];let libSub='files';
function libLoadSub(){
  if(libSub==='files')lbLoad();else if(libSub==='organize')loLoad();else if(libSub==='verify')lvLoad();else if(libSub==='patches'||libSub==='saves')loadPatches();}
function libShowSub(sub,quiet){if(!LIB_SUBS.includes(sub))return;libSub=sub;
  for(const b of document.querySelectorAll('#lib-subtabs [data-lsub]'))b.setAttribute('aria-selected',String(b.dataset.lsub===sub));
  for(const p of document.querySelectorAll('#tab-library [data-lib-panel]'))p.hidden=p.dataset.libPanel!==sub;
  if(!quiet){const next=new URL(location.href);next.searchParams.set('view',sub);next.hash='#library/'+sub;
    history.replaceState(null,'',next);libLoadSub();}}
for(const b of document.querySelectorAll('#lib-subtabs [data-lsub]'))b.addEventListener('click',()=>libShowSub(b.dataset.lsub));
addEventListener('hashchange',()=>{
  const [tab,sub]=location.hash.slice(1).split('/');if(tab==='library')libShowSub(sub||'files');});
async function loadLibrary(refreshPanel=true){
  if(refreshPanel)libLoadSub();
  const d=await api('/admin/api/library');
  const cards=$('lib-cards');cards.replaceChildren();
  const card=(l,v)=>{const c=el('div',null,'card');c.append(el('div',v,'v'),el('div',l,'l'));return c;};
  cards.append(card('게임 파일',num(d.files)),card('titledb 타이틀',num(d.titledb?.titles)),
    card('마지막 빌드',d.lastBuildMs!=null?num(d.lastBuildMs)+'ms':'—'),card('가동 시간',uptime(d.uptime)));
  const rows=[['버전','v'+d.version],['공개 주소',d.origin||'—'],
    ['읽어 둔 titledb 지역',(d.titledb?.regions||[]).map((r)=>r.region||r).join(', ')||'—']];
  const dl=$('settings');dl.replaceChildren();for(const [k,v] of rows)dl.append(el('dt',k),el('dd',String(v)));
  scanShow(d.scan||{});return d;}
// The rescan button stays pressed while a whole read of the games folder waits or runs.
const scanBusy=(s)=>s.state==='running'||s.fullPending;
const scanTook=(f)=>'파일 '+num(f.files)+'개, '+(f.ms/1000).toFixed(1)+'초';
function scanShow(s){const b=$('rescan');b.disabled=scanBusy(s);b.setAttribute('aria-busy',String(scanBusy(s)));
  $('scan-status').textContent=s.state==='running'?'게임 폴더를 읽고 있습니다.':s.fullPending?'곧 게임 폴더를 다시 읽습니다.'
    :s.lastFull?'마지막으로 전부 읽은 때는 '+fmt(s.lastFull.at)+'입니다. '+scanTook(s.lastFull)+' 걸렸습니다.':'';}
let scanPoll=null;
function scanWatch(since){
  if(scanPoll)scanPoll.stop();let lastError='';
  const poll=admInterval(async()=>{
    let d;try{d=await loadLibrary(false);lastError='';}catch(err){
      if(err.message!=='session'&&err.message!==lastError)toast(errText(err));lastError=err.message;return;}
    const status=d.scan||{};
    if(!scanBusy(status)&&status.lastFull&&status.lastFull.at>=since){
      poll.stop();if(scanPoll===poll)scanPoll=null;
      toast('다시 스캔을 마쳤습니다. '+scanTook(status.lastFull)+' 걸렸습니다.');}
  },1000);scanPoll=poll;}
$('rescan').addEventListener('click',async()=>{$('rescan').disabled=true;
  try{const r=await api('/admin/api/library/rescan',{method:'POST',body:{}});
    toast(r.already?'이미 다시 스캔을 기다리고 있습니다.':'다시 스캔을 시작했습니다.');scanShow({fullPending:true});scanWatch(r.requestedAt);}
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
