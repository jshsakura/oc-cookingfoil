/**
 * The admin page's retro tab: box art and bezel coverage per system, a button
 * that fetches what is missing, and a dialog to match one item by hand from
 * libretro names or SteamGridDB covers. Talks to /admin/api/retro-art.
 * The tab is split by a bar of sub-tabs: covers and bezels, ratings, the cores
 * in the RetroArch pack (/admin/api/retro-cores), and the
 * versions block (retro-variants-panel.js: duplicates, arcade sets, trash),
 * one shown at a time.
 */
import { icon } from "../../views/icons.js";
import { RETRO_KO_HTML, RETRO_KO_SCRIPT } from "./retro-ko-panel.js";
import { RETRO_VARIANTS_CSS, RETRO_VARIANTS_HTML, RETRO_VARIANTS_SCRIPT } from "./retro-variants-panel.js";
import { RQ_WORDS } from "./retro-requirements-words.js";
import { top } from "./top-i18n.js";

export const RETRO_ART_HTML = `<section id="tab-retro" hidden>
  <nav class="subtabs" id="retro-subtabs" role="tablist" aria-label="레트로">
    <button type="button" role="tab" data-sub="art">${icon("image")}표지·베젤</button>
    <button type="button" role="tab" data-sub="ratings">${icon("star")}평점</button>
    <button type="button" role="tab" data-sub="cores">${icon("package")}코어</button>
    <button type="button" role="tab" data-sub="names">${icon("tag")}${top("rk.tab")}</button>
    <button type="button" role="tab" data-sub="dups">${icon("copy")}중복 버전</button>
    <button type="button" role="tab" data-sub="sets">${icon("monitor")}아케이드 세트</button>
    <button type="button" role="tab" data-sub="trash">${icon("trash")}휴지통</button>
  </nav>
  <div data-sub-panel="art">
  <div class="hd"><h2 class="first">표지와 베젤</h2><button type="button" class="primary" id="ra-sync">빠진 것 모두 다운로드</button></div>
  <p class="muted">파일 이름의 영어 제목으로 libretro 표지 목록에서 짝을 찾고, 표지와 베젤 프로젝트의 베젤을 받습니다. 이미 있는 파일은 건드리지 않습니다. 업로드한 뒤에는 그 시스템만 저절로 받습니다. 그 게임의 베젤이 없으면 같은 제목의 다른 지역판 베젤을, 그것도 없으면 시스템 기본 베젤을 씁니다. 아케이드 세트에 표지가 없으면 같은 게임의 다른 세트 표지를 보여 줍니다.</p>
  <p class="muted ra-credit"><span data-top="rp.creditBezel">베젤: The Bezel Project 커뮤니티가 만들어 공개한 작품입니다. 감사합니다.</span> <a href="https://github.com/thebezelproject" target="_blank" rel="noopener">github.com/thebezelproject</a><br><span data-top="rp.creditCover">표지: libretro-thumbnails 가 모아 공개한 이미지입니다. 감사합니다.</span> <a href="https://github.com/libretro-thumbnails" target="_blank" rel="noopener">github.com/libretro-thumbnails</a></p>
  <p class="warn-line" id="ra-gh" hidden>GitHub 토큰이 없습니다. 베젤 목록을 읽다 시간당 60번 한도에 걸리면 다른 지역판 베젤로 폴백하지 못합니다. <a href="#settings/integrations">설정 탭</a>에서 넣을 수 있습니다.</p>
  <p class="muted" id="ra-job"></p>
  <div id="ra-bios"></div>
  <details class="ra-scaffold" id="ra-scaffold" hidden><summary id="ra-scaffold-t"></summary><div id="ra-scaffold-b"></div></details>
  <div class="scroll" id="ra-systems" data-skel></div>
  <div class="hd"><h2 id="ra-list-title">표지가 없는 항목</h2><input id="ra-filter" placeholder="이름으로 찾기" aria-label="이름으로 찾기"></div>
  <p class="muted">자동으로 짝을 찾지 못한 항목입니다. 맞추기를 눌러 제목을 검색하고 고르면 표지와 베젤이 그 이름을 따라갑니다. 이름으로 찾으면 표지가 있는 항목도 나와서 표지를 바꿀 수 있습니다.</p>
  <div class="scroll" id="ra-missing" data-skel></div>
  <div class="ra-pager" id="ra-pager" hidden><button type="button" id="ra-prev">이전</button><span id="ra-page"></span><button type="button" id="ra-next">다음</button></div>
  </div>
  <div data-sub-panel="ratings" hidden>
  <div class="hd"><h2 class="first">평점</h2><button type="button" id="ra-ratings">평점 갱신</button></div>
  <p class="muted">LaunchBox 게임 데이터베이스의 사용자 평점을 원제로 맞춰 붙입니다. 자료 파일이 100MB 쯤이라 몇 분 걸립니다. 일주일마다 저절로 갱신합니다.</p>
  <p class="muted" id="ra-ratings-state"></p>
  </div>
  <div data-sub-panel="cores" hidden>
  <div class="hd"><h2 class="first">RetroArch 코어</h2><button type="button" id="rc-reload">${icon("refresh")}다시 읽기</button><button type="button" class="primary" id="rc-up-pick">${icon("upload")}코어 올리기</button><input type="file" id="rc-up" accept=".nro" hidden></div>
  <p class="muted">retroarch/cores/ 에 있는 코어입니다. 공식 RetroArch <span id="rc-official"></span> 번들과 파일 내용을 비교해 출처를 표시합니다. 공식과 다른 코어는 한글패치나 해크판을 위해 따로 받은 것일 수 있으니 서버가 바꾸지 않습니다. 올린 코어는 <코어>_libretro_libnx.nro 이름의 Switch NRO 여야 하고, 바꾸거나 지운 코어는 휴지통 탭에서 되돌릴 수 있습니다.</p>
  <p class="muted" id="rc-nro"></p>
  <div class="hd"><h3 data-top="rp.title">RetroArch 한 번에 채우기</h3><button type="button" class="primary" id="rp-fill" data-top="rp.button">한 번에 채우기</button></div>
  <p class="muted" data-top="rp.lead">공식 RetroArch 번들에서 본체, 지금 ROM 이 있는 기종의 코어, info·assets·autoconfig 를 받아 채운 뒤 표지와 베젤을 받습니다. 직접 넣은 파일, 바꾼 파일, retroarch.cfg, system(BIOS)은 건드리지 않습니다.</p>
  <p class="muted" id="rp-last"></p>
  <div class="hd"><h3>기종별 코어</h3>
    <button type="button" id="rc-auto">${top("ac.button")}</button><button type="button" id="rc-update">${top("ac.update")}</button></div>
  <p class="muted" id="rc-auto-last"></p>
  <div class="hd"><h3>${top("ac.repo")}</h3></div>
  <p class="muted">${top("ac.repoLead")}</p>
  <div class="row"><input type="text" id="rc-repo" placeholder="owner/name" aria-label="${top("ac.repo")}" spellcheck="false" autocomplete="off"><button type="button" id="rc-repo-save">${top("ac.repoSave")}</button></div>
  <div id="rc-hidden"></div>
  <p class="muted">기종마다 게임을 켤 코어를 고릅니다. 위쪽 묶음은 .info 파일상 그 기종의 확장자를 여는 코어입니다. 바꾸면 기기의 홈 메뉴 바로가기가 새 코어로 다시 만들어지므로 기기에서 새로 받아야 합니다. 서버의 systems.json 은 바꾸지 않습니다.</p>
  <div class="scroll" id="rc-systems" data-skel></div>
  <h3>설치된 코어</h3>
  <div class="scroll" id="rc-list" data-skel></div>
  </div>
  <div data-sub-panel="names" hidden>
${RETRO_KO_HTML}
  </div>
  <div data-sub-panel="versions" hidden>
${RETRO_VARIANTS_HTML}
  </div>
</section>
<dialog id="ra-dialog" class="ra-dialog">
  <form method="dialog" class="ra-close"><button aria-label="닫기">닫기</button></form>
  <h3 id="ra-title"></h3>
  <form id="ra-search" class="add"><input id="ra-q" aria-label="검색어" placeholder="영어 제목"><button class="primary">libretro 에서 찾기</button><button type="button" id="ra-sgdb-go">SteamGridDB 에서 찾기</button></form>
  <div class="ra-up" id="ra-up">
    <button type="button" id="ra-up-btn">내 이미지 올리기</button>
    <span class="muted">jpg·png·webp 를 골라도 되고, 여기에 끌어다 놓거나 붙여 넣어도 됩니다. 모양을 살려 세로 표지는 400×600, 가로 표지는 600×400 안의 작은 PNG 로 바꿔 저장합니다.</span>
    <input type="file" id="ra-up-file" accept="image/*" hidden>
  </div>
  <p class="muted" id="ra-msg"></p>
  <div class="ra-grid" id="ra-results"></div>
  <div class="row"><button type="button" id="ra-none" class="danger">표지 없음으로 두기</button></div>
</dialog>
<dialog id="rp-dialog" class="ra-dialog" aria-labelledby="rp-dtitle">
  <form method="dialog" class="ra-close"><button aria-label="닫기">닫기</button></form>
  <h3 id="rp-dtitle" data-top="rp.confirmTitle">RetroArch 팩을 채웁니다</h3>
  <p id="rp-size"></p>
  <h4 data-top="rp.install">설치할 목록</h4>
  <ul id="rp-items" class="rp-items"></ul>
  <p class="muted" id="rp-extra"></p>
  <div class="row"><button type="button" class="primary" id="rp-go" data-top="rp.go">채우기 시작</button><button type="button" id="rp-cancel" data-top="rp.cancel">취소</button></div>
</dialog>
<dialog id="rm-dialog" class="ra-dialog" aria-labelledby="rm-title">
  <form method="dialog" class="ra-close"><button aria-label="닫기">닫기</button></form>
  <h3 id="rm-title"></h3>
  <p class="muted">기기의 게임 상세에 보이는 정보입니다. 같은 게임의 다른 버전도 같은 정보를 씁니다. 칸을 비우면 자동으로 모은 값(흐린 글씨)으로 돌아가고, 메타데이터를 다시 받아도 여기서 고친 값은 그대로입니다.</p>
  <form id="rm-form" class="rm-form">
    <label>한국어 소개<textarea id="rm-ko" rows="5"></textarea></label>
    <label>영어 소개 (다른 언어의 기본값)<textarea id="rm-en" rows="5"></textarea></label>
    <div class="rm-pair"><label>발매<input id="rm-publisher"></label><label>개발<input id="rm-developer"></label></div>
    <div class="rm-pair"><label>발매 연도<input id="rm-year" inputmode="numeric" maxlength="4"></label><label>최대 인원<input id="rm-players" inputmode="numeric" maxlength="2"></label></div>
    <fieldset><legend>장르 (4개까지, 아무것도 고르지 않으면 자동으로 모은 장르를 씁니다)</legend><div id="rm-genres" class="rm-genres"></div></fieldset>
    <div class="row"><button class="primary">저장</button><button type="button" id="rm-reset" class="danger">모두 자동 값으로 돌리기</button></div>
  </form>
</dialog>`;

export const RETRO_ART_CSS = RETRO_VARIANTS_CSS + `
.ra-scaffold{margin:0 0 12px}.ra-scaffold summary{cursor:pointer;font-weight:600}
.ra-scaffold-list{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.ra-scaffold-list code{font-size:12.5px}
.rm-form{display:grid;gap:12px}.rm-form label{display:grid;gap:4px}.rm-form textarea{width:100%;resize:vertical}
.rm-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.rm-genres{display:flex;flex-wrap:wrap;gap:6px 14px}.rm-genres label{display:flex;gap:6px;align-items:center}
@media (max-width:560px){.rm-pair{grid-template-columns:1fr}}
.subtabs{display:flex;gap:4px;margin:0 0 18px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.subtabs::-webkit-scrollbar{display:none}
.subtabs button{flex:none;border:none;border-bottom:2px solid transparent;border-radius:0;background:none;padding:10px 14px;margin-bottom:-1px;color:var(--muted);font-weight:600;white-space:nowrap}
.subtabs button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--text)}
.subtabs button:hover{color:var(--text)}
.ra-dialog{width:min(860px,94vw);max-height:88vh;border:1px solid var(--line2);border-radius:22px;background:var(--panel);color:var(--text);padding:20px;box-shadow:0 30px 60px var(--shadow)}
.ra-dialog::backdrop{background:rgba(0,0,0,.55)}.ra-close{float:right}.ra-dialog h3{margin:0 0 12px;font-size:16px}
.ra-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin:12px 0;overflow:auto;max-height:52vh}
.ra-grid button{display:flex;flex-direction:column;gap:6px;align-items:stretch;padding:6px;text-align:left;font-size:12px;font-weight:500;background:var(--panel)}
.ra-grid img{width:100%;aspect-ratio:3/4;object-fit:contain;background:var(--sunk);border-radius:8px}
.ra-grid span{overflow-wrap:anywhere}
#ra-filter{max-width:220px}
.rp-items{margin:0 0 10px;padding-left:18px;max-height:42vh;overflow:auto}.rp-items li{margin:3px 0}.rp-items .muted{margin-left:6px}
.ra-credit a{overflow-wrap:anywhere}
.ra-pager{display:flex;align-items:center;justify-content:center;gap:12px;margin:10px 0;font-size:13px;color:var(--muted)}
.ra-up{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:10px 0;padding:10px 12px;border:1px dashed var(--line);border-radius:12px;font-size:13px}
.ra-up.over{border-color:var(--accent,#4c8dff);background:var(--sunk)}
#rc-list .pill.warn{background:rgba(217,164,0,.16);color:var(--text)}
#rc-list .rc-hash{font-family:ui-monospace,monospace;font-size:12px}
.warn-line{background:var(--sunk);border:1px solid var(--line);border-left:3px solid var(--warn,#d9a400);border-radius:10px;padding:10px 12px;font-size:13px}
#ra-bios{display:grid;gap:8px;margin:0 0 12px}#ra-bios p{margin:0}
.rq-note{font-size:12.5px}
.rq-ok{color:var(--good);font-weight:600;font-size:13.5px}
.rq-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
.rq-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;display:grid;gap:6px;align-content:start}
.rq-card.need,.rq-card.check{border-color:rgba(var(--warn-rgb),.45)}
.rq-tag{margin-left:auto;font-size:11.5px;font-weight:600;color:var(--warn)}
.rq-card h4{margin:0;font-size:13.5px;display:flex;gap:8px;align-items:baseline}.rq-card h4 span{color:var(--muted);font-weight:400;font-size:12px}
.rq-core{color:var(--muted);font-size:12px;overflow-wrap:anywhere}.rq-core code{font-size:11.5px}
.rq-chips{display:flex;flex-wrap:wrap;gap:5px}
.rq-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 9px;border-radius:100px;font-size:12px;line-height:1.6;border:1px solid var(--line);background:var(--sunk);color:var(--muted);overflow-wrap:anywhere}
.rq-chip.present{color:var(--good);border-color:rgba(var(--good-rgb),.5);background:rgba(var(--good-rgb),.12)}
.rq-chip.mismatch{color:var(--warn);border-color:rgba(var(--warn-rgb),.6);background:rgba(var(--warn-rgb),.12)}
.rq-chip .rq-ic{font-weight:700}.rq-chip .rq-opt{font-size:10.5px;opacity:.85;border:1px solid currentColor;border-radius:100px;padding:0 5px}
.rq-hint{color:var(--muted);font-size:12px}
.rq-done summary{cursor:pointer;color:var(--good);font-weight:600;font-size:13px}.rq-done .rq-cards{margin-top:8px}
`;

export const RETRO_ART_SCRIPT = /* js */ `
let raData=null,raGame=null,raTimer=null;
// One sub-tab at a time; the choice is remembered in this browser only.
// var, not let: the tab can open while the page's script is still being read.
var RETRO_SUBS=['art','ratings','cores','names','dups','sets','trash'];
var retroSub=(()=>{try{const v=localStorage.getItem('cf-retro-sub');return RETRO_SUBS.includes(v)?v:'art';}catch{return 'art';}})();
function retroShowSub(sub){retroSub=RETRO_SUBS.includes(sub)?sub:'art';
  try{localStorage.setItem('cf-retro-sub',retroSub);}catch{}
  for(const b of document.querySelectorAll('#retro-subtabs [data-sub]'))b.setAttribute('aria-selected',String(b.dataset.sub===retroSub));
  const panel=['art','ratings','cores','names'].includes(retroSub)?retroSub:'versions';
  for(const p of document.querySelectorAll('#tab-retro [data-sub-panel]'))p.hidden=p.dataset.subPanel!==panel;
  if(panel==='names')loadRetroKo();
  if(panel==='cores'){loadRetroCores();api('/admin/api/retro-pack').then((d)=>rpLast(d.job)).catch(()=>{});}
  if(panel==='versions'&&rvView!==retroSub){rvView=retroSub;rvShow();loadRetroVariants();}}
for(const b of document.querySelectorAll('#retro-subtabs [data-sub]'))b.addEventListener('click',()=>retroShowSub(b.dataset.sub));
function retroOpen(){loadRetroArt();if(['dups','sets','trash'].includes(retroSub))rvView=retroSub;retroShowSub(retroSub);rvShow();loadRetroVariants();}
function raCell(node){const c=el('td');c.append(node);return c;}
const RC_ORIGIN={official:['공식 번들과 같음','on'],modified:['공식과 다름','warn'],extra:['공식 번들에 없음','']};
const rcMb=(n)=>(n/1048576).toFixed(1)+' MB';
function rcOrigin(o){const [t,k]=RC_ORIGIN[o]||[o,''];return pill(t,k);}
function rcHash(h){const s=el('span',h.slice(0,12),'rc-hash');s.title=h;return s;}
async function loadRetroCores(){let d;
  try{d=await api('/admin/api/retro-cores');}catch(err){toast(err.message);return;}
  rcSources=d.sources||{repo:null,cores:{}};$('rc-repo').value=rcSources.repo||'';
  $('rc-official').textContent=d.official;rcSystems(d.systems||[]);acLast(d.auto);
  const n=d.retroarch;$('rc-nro').replaceChildren(...(n?['RetroArch 본체 retroarch.nro · '+rcMb(n.size)+' · ',rcOrigin(n.origin)]:['RetroArch 본체(retroarch.nro)가 없습니다.']));
  table('rc-list',[topText('ac.on'),'코어',topText('ac.source'),'쓰는 기종','크기','수정일','출처','SHA-256',''],d.cores.map((c)=>{const tr=el('tr');
    const name=td();name.append(c.name||c.core);name.append(el('div',c.file,'muted'));
    const used=c.systems.length?c.systems.map((s)=>s.name+' '+s.games+'개').join(', '):'쓰는 게임이 없습니다';
    const rm=btn('지우기',()=>rcRemove(c));rm.setAttribute('aria-label',c.core+' 지우기');
    tr.append(raCell(rcSwitch(c)),name,raCell(rcSource(c.core)),td(used),td(rcMb(c.size)),td(fmt(c.modifiedAt*1000)),raCell(rcOrigin(c.origin)),raCell(rcHash(c.sha256)),raCell(rm));return tr;}),'retroarch/cores/ 에 코어가 없습니다.');}
// Off leaves the core out of the console pack; the games that need it stay listed but can't be taken.
function rcSwitch(c){const box=el('input');box.type='checkbox';box.checked=!c.off;box.setAttribute('aria-label',c.core+' '+topText('ac.on'));
  box.addEventListener('change',async()=>{const on=box.checked;const fill=(k)=>topText(k).split('{core}').join(c.core);
    if(!on&&!await ask(fill('ac.offQ'))){box.checked=true;return;}
    try{await api('/admin/api/retro-cores/enabled',{method:'POST',body:{core:c.core,enabled:on}});toast(fill(on?'ac.onDone':'ac.offDone'));loadRetroCores();}
    catch(err){box.checked=!on;toast(err.message);}});return box;}
// Where the upkeep takes a core: nightly, the core repository's latest release, or the admin's own upload.
let rcSources={repo:null,cores:{}};
function rcSource(core){const sel=el('select');sel.setAttribute('aria-label',core+' '+topText('ac.source'));
  for(const v of ['nightly','repo','upload']){const o=el('option',topText('ac.src.'+v));o.value=v;sel.append(o);}
  const now=rcSources.cores[core]||'nightly';sel.value=now;
  sel.addEventListener('change',async()=>{const v=sel.value;
    if(v==='repo'&&!rcSources.repo){toast(topText('ac.repoFirst'));sel.value=now;$('rc-repo').focus();return;}
    try{await api('/admin/api/retro-cores/source',{method:'POST',body:{core,source:v}});toast(topText('ac.srcDone').split('{core}').join(core).split('{src}').join(topText('ac.src.'+v)));loadRetroCores();}
    catch(err){sel.value=now;toast(err.message);}});return sel;}
$('rc-repo-save').addEventListener('click',async()=>{const repo=$('rc-repo').value.trim();
  try{await api('/admin/api/retro-cores/repo',{method:'POST',body:{repo}});toast(topText(repo?'ac.repoSaved':'ac.repoCleared'));loadRetroCores();}catch(err){toast(err.message);}});
const rpT=(k,v)=>{let s=topText('rp.'+k);if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
function rpLast(job){const p=$('rp-last');if(!job){p.textContent='';return;}
  if(job.error)p.textContent=rpT('lastFail',{err:job.error});
  else if(job.result)p.textContent=rpT('lastOk',{i:job.result.installed,r:job.result.replaced,k:job.result.keptCount.operator+job.result.keptCount.modified,b:job.art?job.art.boxart:0,z:job.art?job.art.bezel:0});
  else p.textContent='';}
async function rpOpen(){let d;
  try{d=await api('/admin/api/retro-pack');}catch(err){toast(err.message);return;}
  $('rp-size').textContent=d.bundle.remaining===0||!d.needsBundle?rpT('sizeCached'):rpT('size',{size:rcMb(d.bundle.remaining),ver:d.version});
  const ul=$('rp-items');ul.replaceChildren();
  for(const i of d.items){const li=el('li',i.kind==='body'?rpT('body'):rpT('core',{name:i.name,sys:i.systems.map((s)=>s.name).join(', '),n:i.games}));
    li.append(el('span',rcMb(i.size)+' · '+rpT('state.'+i.state),'muted'));ul.append(li);}
  ul.append(el('li',rpT('dirs')),el('li',rpT('art')));
  const notes=[];if(d.notInBundle.length)notes.push(rpT('notInBundle',{names:d.notInBundle.map((c)=>c.core).join(', ')}));
  if(!d.needsBundle)notes.push(rpT('nothing'));
  $('rp-extra').textContent=notes.join(' ');rpLast(d.job);$('rp-dialog').showModal();}
async function rpStart(){$('rp-go').disabled=true;
  try{await api('/admin/api/retro-pack/fill',{method:'POST',body:{confirm:true}});toast(rpT('started'));$('rp-dialog').close();}
  catch(err){toast(err.message);}finally{$('rp-go').disabled=false;}}
$('rp-fill').addEventListener('click',rpOpen);$('rp-go').addEventListener('click',rpStart);$('rp-cancel').addEventListener('click',()=>$('rp-dialog').close());
function rcPicker(s){const sel=el('select');sel.setAttribute('aria-label',s.name+' 코어');
  const opt=(core,label)=>{const o=el('option',label);o.value=core;if(core===s.core)o.selected=true;return o;};
  const group=(label,cores)=>{const g=el('optgroup');g.label=label;g.append(...cores.map((c)=>opt(c,c+(c===s.tableCore?' (기본값)':''))));return g;};
  if(!s.installed)sel.append(opt(s.core,s.core+' (설치돼 있지 않습니다)'));
  if(s.fits.length)sel.append(group('확장자가 맞는 코어',s.fits));
  if(s.others.length)sel.append(group('기타',s.others));
  sel.addEventListener('change',()=>rcSetSystem(s,sel.value,sel));return sel;}
function rcSystems(list){
  table('rc-systems',['기종','게임','코어',''],list.map((s)=>{const tr=el('tr');
    const cs=s.coreState;const state=cs?acPill(cs):!s.installed?pill('코어가 없습니다','warn'):'';const swap=cs?acSwap(cs):'';
    const picked=s.core!==s.tableCore?pill('기본값에서 바꿈',''):'';
    const back=s.core!==s.tableCore?btn('기본값으로',()=>rcSetSystem(s,s.tableCore)):'';
    const extra=td();if(cs)extra.append(rcSource(cs.core));if(state)extra.append(state);if(swap)extra.append(swap);if(picked)extra.append(picked);if(back)extra.append(back);
    tr.append(td(s.name),td(s.games+'개'),raCell(rcPicker(s)),extra);return tr;}),'게임이 있는 기종이 없습니다.');}
async function rcSetSystem(s,core,sel){
  if(!await ask(s.name+' 게임 '+s.games+'개를 '+core+' 코어로 켭니다. 기기의 홈 메뉴 바로가기는 새로 받아야 합니다.')){if(sel)sel.value=s.core;return;}
  try{await api('/admin/api/retro-cores/system',{method:'POST',body:{system:s.id,core}});toast(s.name+' 코어를 '+core+' 로 바꿨습니다.');loadRetroCores();}
  catch(err){toast(err.message);if(sel)sel.value=s.core;}}
async function rcRemove(c,force=false){
  if(!force&&!await ask(c.file+' 코어를 휴지통으로 옮깁니다. 휴지통 탭에서 되돌릴 수 있습니다.'))return;
  try{await api('/admin/api/retro-cores/remove',{method:'POST',body:{core:c.core,force}});toast('휴지통으로 옮겼습니다.');loadRetroCores();}
  catch(err){if(/게임 \\d+개가/.test(err.message)&&!force){
      if(await ask(err.message+'. 지우면 그 게임들은 기기에서 켜지지 않습니다. 그래도 지울까요?'))rcRemove(c,true);return;}
    toast(err.message);}}
async function rcUpload(file,replace=false){
  const fd=new FormData();fd.append('files',file,file.name);if(replace)fd.append('replace','true');
  const r=await fetch('/admin/api/upload/core',{method:'POST',body:fd});const d=await r.json().catch(()=>({}));
  if(r.status===409&&!replace&&/같은 이름/.test(d.error||'')){if(await ask(file.name+' 코어가 이미 있습니다. 올린 파일로 바꾸고 지금 파일은 휴지통으로 옮길까요?'))return rcUpload(file,true);return;}
  if(r.status===409&&d.reason==='busy'){toast(topText('ac.uploadBusy'));return;}
  if(!r.ok){toast(d.error||('HTTP '+r.status));return;}
  toast(d.where+' 에 올렸습니다.');loadRetroCores();}
// The official core upkeep's state of a console's core (auto-cores.js coreStates).
const AC_KIND={off:'',"not-in-repo":'warn',present:'ok',pinned:'',installing:'',"will-install":'',missing:'warn',held:'',"not-in-nightly":'warn',failed:'warn'};
function acPill(cs){const k=cs.state==='missing'?'missing.'+cs.reason:cs.state;const p=pill(topText('ac.'+k),AC_KIND[cs.state]??'');
  if(cs.state==='present'&&cs.built)p.title=cs.source+' · '+cs.built+(cs.crc32?' · '+cs.crc32:'');
  if(cs.state==='failed')p.title=(cs.message||'')+(cs.retryAt?' · '+fmt(cs.retryAt):'');return p;}
// A user's core can be swapped for the nightly build (it goes to the trash) and back again.
function acSwap(cs){
  if(cs.state==='pinned')return btn(topText('ac.toOfficial'),()=>acRun('official',cs.core,topText('ac.toOfficialQ').split('{core}').join(cs.core)));
  if(cs.state==='present'&&cs.userVersion)return btn(topText('ac.toUser'),()=>acRun('user-version',cs.core,topText('ac.toUserQ').split('{core}').join(cs.core)));
  return '';}
async function acRun(name,core,question){if(question&&!await ask(question))return;
  try{const d=await api('/admin/api/retro-cores/'+name,{method:'POST',body:core?{core}:{}});toast(topText(d.started===false?'ac.nothing':'ac.started'));loadRetroCores();}
  catch(err){toast(err.message);}}
// A user's core a crash or a lost race left under a hidden name: held, never deleted, and put back on request.
function acHidden(list){$('rc-hidden').replaceChildren(...(list||[]).map((h)=>{const fill=(k)=>topText(k).split('{name}').join(h.name).split('{file}').join(h.file);
  const p=el('p',fill('ac.hidden')+' ','warn-line');p.append(btn(topText('ac.hiddenBack'),async()=>{if(!await ask(fill('ac.hiddenQ')))return;
    try{await api('/admin/api/retro-cores/user-version',{method:'POST',body:{core:h.core,hidden:h.file}});toast(topText('ac.hiddenDone'));loadRetroCores();}catch(err){toast(err.message);}}));return p;}));}
function acLast(a){acHidden(a&&a.hidden);const p=$('rc-auto-last');if(!a){p.textContent='';return;}
  const l=a.last;p.textContent=a.job?topText('ac.running'):l&&l.error?topText('ac.lastFail').split('{err}').join(l.error):l?topText('ac.lastOk').split('{i}').join((l.installed||[]).length).split('{r}').join((l.replaced||[]).length):'';}
$('rc-auto').addEventListener('click',()=>acRun('auto'));
$('rc-update').addEventListener('click',()=>acRun('update',null,topText('ac.updateQ')));
$('rc-reload').addEventListener('click',loadRetroCores);
$('rc-up-pick').addEventListener('click',()=>$('rc-up').click());
$('rc-up').addEventListener('change',(e)=>{const f=e.target.files[0];e.target.value='';if(f)rcUpload(f);});
async function loadRetroArt(){
  api('/admin/api/storage-guide?format=json').then(raScaffold).catch(()=>raScaffold(null));
  try{raData=await api('/admin/api/retro-art');}catch(err){toast(err.message);return;}
  const j=raData.job;
  $('ra-sync').disabled=Boolean(j&&!j.finishedAt);$('ra-gh').hidden=raData.github!==false;
  raBios(raData.bios||[],raData.unread||[],raData.pack,raData.shadowed||[]);
  $('ra-job').textContent=!j?'':!j.finishedAt?'받고 있습니다'+(j.progress?' · '+j.progress.system+' ('+(j.progress.index+1)+'/'+j.progress.total+')':''):
    j.error?'실패했습니다: '+j.error:'마지막 정리: '+fmt(j.finishedAt)+' · '+Object.entries(j.summary||{}).map(([k,v])=>v.error?k+' 실패':k+' +'+(v.boxart||0)+'/'+(v.bezel||0)).join(', ');
  const r=raData.ratings||{},rj=r.job;const rRunning=Boolean(rj&&!rj.finishedAt);
  $('ra-ratings').disabled=rRunning;
  $('ra-ratings-state').textContent=rRunning?'평점을 받고 있습니다':rj&&rj.error?'실패했습니다: '+rj.error:
    (r.updatedAt?'마지막 갱신: '+fmt(r.updatedAt):'아직 받은 평점이 없습니다')+(rj&&rj.summary?' · '+Object.entries(rj.summary).map(([k,v])=>k+' '+v).join(', '):'');
  clearTimeout(raTimer);if((j&&!j.finishedAt&&!actLive)||rRunning)raTimer=setTimeout(loadRetroArt,3000);
  table('ra-systems',['시스템','항목','표지','다른 세트 표지','베젤',''],raData.systems.map((s)=>{const tr=el('tr');
    const b=el('button','다운로드');b.type='button';b.setAttribute('aria-label',s.name+' 다운로드');b.addEventListener('click',()=>raSync(s.id));
    const pct=(n)=>n+' ('+Math.round(n*100/Math.max(1,s.games))+'%)';
    tr.append(td(s.name),td(String(s.games)),td(pct(s.boxart)),td(s.borrowed?String(s.borrowed):'—'),td(pct(s.bezel)),raCell(b));return tr;}),'레트로 폴더에 항목이 없습니다.');
  raList();
}
// The system folders the server keeps (retro/scaffold.js) and a link to the storage guide.
let raScaffoldData=null;
const raFill=(key,vars)=>{let s=topText(key);for(const x in vars)s=s.split('{'+x+'}').join(vars[x]);return s;};
function raScaffoldRelabel(){if(raScaffoldData)raScaffold(raScaffoldData);if(raData)raBios(raData.bios||[],raData.unread||[],raData.pack,raData.shadowed||[]);}
function raScaffold(d){raScaffoldData=d;const box=$('ra-scaffold');box.hidden=!d;if(!d)return;
  const folders=d.folders||[];
  $('ra-scaffold-t').textContent=raFill('sc.title',{n:folders.length});
  const lead=el('p',d.enabled===false?topText('sc.off'):d.skipped==='old-retro'?topText('sc.waiting'):d.skipped==='no-retro'?topText('sc.noRetro'):topText('sc.lead'),d.enabled===false||d.skipped?'warn-line':'muted');
  const pills=el('div',null,'ra-scaffold-list');
  pills.append(...folders.map((f)=>{const p=pill('');p.replaceChildren(el('code',f.folder),document.createTextNode(' '+f.name));if(f.made)p.append(el('b',' '+topText('sc.new')));return p;}));
  const failed=(d.failed||[]).map((f)=>el('p',raFill('sc.failed',{folder:f.folder,error:f.error}),'warn-line'));
  const guide=el('p',null,'muted');
  const a=el('a',topText('sc.guide'));a.href='/admin/api/storage-guide';a.target='_blank';a.rel='noopener';guide.append(a,document.createTextNode(' '+topText('sc.readme')));
  $('ra-scaffold-b').replaceChildren(lead,pills,...failed,guide);}
// What the games in the library still need (GET /admin/api/retro-art requirements): the BIOS the operator puts in
// as chips, grey while missing, green once there, amber when the md5 differs; each system's core as a quiet line,
// since the server supplies cores. Systems still missing something come first; complete ones fold away.
// A folder under roms/ that no system reads would hide its games without a word.
const rqWords=${JSON.stringify(RQ_WORDS)};
const rqT=(k,v)=>{let s=(rqWords[adminLang]||rqWords.ko)[k]??rqWords.ko[k]??k;if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
const rqHas=(k)=>Object.hasOwn(rqWords.ko,k);
// A core state or reason the pack adds later still reads as words, never as a key.
const rqCs=(state)=>rqHas('cs.'+state)?rqT('cs.'+state):rqT('cs.unknown',{state:String(state)});
const rqReason=(code)=>!code?'':rqHas('reason.'+code)?rqT('reason.'+code):rqT('reason.other');
const rqName=(s)=>s.names[adminLang]||s.names.en||s.id;
const rqBase=(f)=>f.slice(f.lastIndexOf('/')+1);
function rqChip(label,state,opts={}){const c=el('span',null,'rq-chip '+state);c.dataset.state=state;
  c.append(el('span',state==='present'?'\u2713':state==='mismatch'?'!':'\u25CB','rq-ic'),el('span',label));
  if(opts.optional)c.append(el('span',rqT('opt'),'rq-opt'));
  c.title=[rqT('st.'+state),...(opts.notes||[])].join('\\n');c.setAttribute('aria-label',label+', '+rqT('st.'+state)+(opts.optional?', '+rqT('opt'):''));return c;}
function rqFirmwareChip(f){const n=f.files.length;
  const label=f.recognizedAs?rqBase(f.recognizedAs):f.file?rqBase(f.file):n>2?rqBase(f.files[0])+' / +'+(n-1):f.files.map(rqBase).join(' / ');
  const notes=[];if(f.recognizedAs)notes.push(rqT('recognized',{file:f.file,as:f.recognizedAs}));
  if(f.state==='mismatch')notes.push(rqT('mismatch',{file:f.file}));if(f.state==='missing'&&n>1)notes.push(rqT('anyOf',{files:f.files.join(', ')}));
  if(!f.required)notes.push(rqT('optWhy'));return rqChip(label,f.state,{optional:!f.required,notes});}
function rqCard(s){const card=el('div',null,'rq-card'+(s.missing?' need':s.check?' check':''));card.dataset.system=s.id;
  const h=el('h4',rqName(s));h.append(el('span',rqT('games',{n:s.games})));
  // Something not there and a file of another dump are told apart: the second may still start.
  if(s.missing||s.check)h.append(el('span',s.missing?rqT('tagMissing',{n:s.missing}):rqT('tagCheck'),'rq-tag'));card.append(h);
  for(const c of s.cores){const line=el('div',null,'rq-core');line.append(rqT('core',{file:''}),el('code',c.file),' \u00B7 '+rqCs(c.state));card.append(line);}
  const chips=el('div',null,'rq-chips');chips.append(...s.firmware.map(rqFirmwareChip));
  if(s.arcade){chips.append(...s.arcade.bios.map((b)=>rqChip(b.zip,b.state,{notes:[rqT('games',{n:b.sets})]})));
    if(s.arcade.parents.length)chips.append(rqChip(rqT('parents',{n:s.arcade.parents.length}),'missing',{notes:[s.arcade.parents.slice(0,20).map((p)=>p.zip).join(', ')]}));}
  if(chips.childElementCount)card.append(chips);
  if(s.missing||s.check){const fw=s.firmware.some((f)=>f.required&&f.state==='missing'),arc=s.arcade&&(s.arcade.parents.length||s.arcade.bios.some((b)=>b.state==='missing'));
    const mm=s.firmware.some((f)=>f.required&&f.state==='mismatch');
    card.append(el('p',[fw?rqT('hintFw'):'',arc?rqT('hintArc'):'',mm?rqT('hintMd5'):''].filter(Boolean).join(' '),'rq-hint'));}
  return card;}
const RQ_CORE_WARN={'not-in-bundle':'coreNotInBundle','not-in-nightly':'coreNotInNightly',failed:'coreFailed'};
function rqCoreWarn(s,c){const v={system:rqName(s),n:c.games,file:c.file,reason:rqReason(c.reason)};
  const p=el('p',rqT(RQ_CORE_WARN[c.state]||'coreMissing',v).trim(),'warn-line');if(c.message)p.title=c.message;return p;}
function raBios(list,unread,pack,shadowed=[]){
  const req=raData&&raData.requirements;const systems=req?req.systems:[];
  const out=[];
  if(req)out.push(el('p',rqT('nro'),'muted rq-note'));
  if(pack&&pack.retroarch==='missing')out.push(el('p',rqT('noRa'),'warn-line'));
  for(const s of systems)for(const c of s.cores)if(c.warn)out.push(rqCoreWarn(s,c));
  if(unread.length)out.push(el('p',rqT('unread',{folders:unread.join(', ')}),'warn-line'));
  // A look-alike of a known system: its own folder already has games, so this one waits.
  out.push(...shadowed.map((f)=>el('p',raFill('sc.shadowed',{alias:f.folder,canonical:f.by,system:f.names[adminLang]||f.names.en||f.system}),'warn-line')));
  const need=systems.filter((s)=>s.missing||s.check),done=systems.filter((s)=>!s.missing&&!s.check&&(s.firmware.length||(s.arcade&&s.arcade.bios.length)));
  if(req&&systems.length&&!need.length)out.push(el('p','\u2713 '+rqT('allOk'),'rq-ok'));
  if(need.length){const box=el('div',null,'rq-cards');box.id='rq-need';box.append(...need.map(rqCard));out.push(box);}
  if(done.length){const d=el('details',null,'rq-done');d.id='rq-done';d.append(el('summary','\u2713 '+rqT('okList',{n:done.length})));
    const box=el('div',null,'rq-cards');box.append(...done.map(rqCard));d.append(box);out.push(d);}
  $('ra-bios').replaceChildren(...out);
}
function raRow(m,withArt){const tr=el('tr');
  const b=el('button',m.boxart?'변경':'맞추기');b.type='button';b.addEventListener('click',()=>raOpen(m));
  const del=btn('삭제',()=>raRemove(m),'danger');del.setAttribute('aria-label',m.name+' 삭제');
  const nm=btn('이름',()=>raName(m));nm.setAttribute('aria-label',m.name+' 이름');
  const info=btn('정보',()=>rmOpen(m));info.setAttribute('aria-label',m.name+' 정보');const box=el('div',null,'row-actions');box.append(b,nm,info,del);
  const n=td();n.append(m.title?.ko||m.title?.en||m.name);if(m.title)n.append(el('div','파일: '+m.name,'muted'));
  tr.append(td(m.system),n);if(withArt)tr.append(td(m.boxart?'있음':'없음'));tr.append(raCell(box));return tr;}
// The name clients show; the ROM file keeps its own (box art and configs are found by it).
async function raName(m){const ko=await askText(m.name+' 의 한국어 이름을 넣습니다. 비우면 파일 이름을 씁니다.',m.title?.ko||'');if(ko===null)return;
  const en=await askText('영어 이름을 넣습니다 (다른 언어의 기본값). 비워 둬도 됩니다.',m.title?.en||'');if(en===null)return;
  try{const r=await api('/admin/api/retro-art/games/name',{method:'POST',body:{game:m.id,ko,en}});m.title=r.title;toast(r.title?'이름을 정했습니다.':'파일 이름으로 돌렸습니다.');raShow();}catch(err){toast(err.message);}}
// The details clients show (description, makers, year, players, genres): the admin's edit over what was collected.
let rmGame=null,rmMax=4;
const rmYear=(d)=>Number.isInteger(d)?String(Math.floor(d/10000)):'';
async function rmOpen(m){let d;
  try{d=await api('/admin/api/retro-art/games/meta?game='+encodeURIComponent(m.id));}catch(err){toast(err.message);return;}
  rmGame=m;const c=d.collected||{},e=d.edit||{};
  $('rm-title').textContent=(m.title?.ko||m.title?.en||m.name)+' 정보';
  const put=(id,mine,auto)=>{$(id).value=mine??'';$(id).placeholder=auto??'';};
  put('rm-ko',e.description?.ko,c.description?.ko);put('rm-en',e.description?.en,c.description?.en);
  put('rm-publisher',e.publisher,c.publisher);put('rm-developer',e.developer,c.developer);
  put('rm-year',rmYear(e.releaseDate)||null,rmYear(c.releaseDate));put('rm-players',e.numberOfPlayers,c.numberOfPlayers);
  const picked=new Set(e.genres||[]),auto=new Set(c.genres||[]);
  $('rm-genres').replaceChildren(...d.genres.map((g)=>{const l=el('label');const box=el('input');box.type='checkbox';box.value=g.key;box.checked=picked.has(g.key);
    l.append(box,g.name+(auto.has(g.key)?' (자동)':''));return l;}));
  $('rm-dialog').showModal();}
async function rmSave(body){
  try{const r=await api('/admin/api/retro-art/games/meta',{method:'POST',body:{game:rmGame.id,...body}});$('rm-dialog').close();toast(r.edit?'정보를 저장했습니다.':'자동으로 모은 값으로 돌렸습니다.');}
  catch(err){toast(err.message);}}
$('rm-form').addEventListener('submit',(e)=>{e.preventDefault();
  const genres=[...document.querySelectorAll('#rm-genres input:checked')].map((x)=>x.value);
  if(genres.length>rmMax){toast('장르는 '+rmMax+'개까지 고릅니다.');return;}
  rmSave({description:{ko:$('rm-ko').value,en:$('rm-en').value},publisher:$('rm-publisher').value,developer:$('rm-developer').value,year:$('rm-year').value.trim(),players:$('rm-players').value.trim(),genres});});
$('rm-reset').addEventListener('click',async()=>{if(await ask('이 게임에서 고친 정보를 모두 지우고 자동으로 모은 값으로 돌립니다.'))rmSave({});});
// Deletes the ROM (and the disc files it names) from the server; its box art stays.
async function raRemove(m){if(!await ask(topFill('t.askRetroRom',{name:m.name,system:m.system})))return;
  try{const r=await api('/admin/api/retro-art/games/remove',{method:'POST',body:{game:m.id}});toast(topFill('t.movedFiles',{n:r.files}));
    raRows=raRows.filter((x)=>x.id!==m.id);raShow();}catch(err){toast(err.message);}}
// Empty: the games without box art. A name: every game that matches, so art can be replaced too.
let raFind=0,raRows=[],raAt=0,raFound=false;
const RA_PAGE=50;
function raShow(){
  const pages=Math.max(1,Math.ceil(raRows.length/RA_PAGE));raAt=Math.min(raAt,pages-1);
  const rows=raRows.slice(raAt*RA_PAGE,(raAt+1)*RA_PAGE).map((m)=>raRow(m,raFound));
  table('ra-missing',raFound?['시스템','이름','표지','']:['시스템','이름',''],rows,raFound?'맞는 항목이 없습니다.':'표지가 빠진 항목이 없습니다.');
  $('ra-pager').hidden=pages<2;$('ra-page').textContent=(raAt+1)+' / '+pages+' · '+raRows.length+'개';
  $('ra-prev').disabled=raAt===0;$('ra-next').disabled=raAt>=pages-1;
}
async function raList(){
  const q=$('ra-filter').value.trim();const n=++raFind;
  $('ra-list-title').textContent=q?'이름으로 찾은 항목':'표지가 없는 항목';
  if(!q){raRows=raData?.missing||[];raFound=false;raShow();return;}
  try{const d=await api('/admin/api/retro-art/games?q='+encodeURIComponent(q));if(n!==raFind)return;
    raRows=d.games;raFound=true;raShow();}catch(err){toast(err.message);}
}
async function raUpload(file){
  if(!file||!(file.type||'').startsWith('image/')){$('ra-msg').textContent='이미지 파일을 고릅니다';return;}
  $('ra-msg').textContent='줄여서 올리고 있습니다';
  try{const r=await fetch('/admin/api/retro-art/cover/upload?game='+encodeURIComponent(raGame.id),{method:'POST',headers:{'Content-Type':file.type,Accept:'application/json'},body:file});
    if(r.status===401){location.reload();return;}
    const d=await r.json().catch(()=>({}));
    if(!r.ok){$('ra-msg').textContent=d.error||('HTTP '+r.status);return;}
    const kb=(n)=>Math.max(1,Math.round(n/1024))+' KB';
    $('ra-dialog').close();toast('표지를 변경했습니다. '+kb(d.from)+' → '+kb(d.bytes));loadRetroArt();
  }catch(err){$('ra-msg').textContent=err.message;}
}
async function raSync(system){
  try{await api('/admin/api/retro-art/sync',{method:'POST',body:system?{system}:{}});toast('다운로드를 시작했습니다.');loadRetroArt();}catch(err){toast(err.message);}
}
function raOpen(m){raGame=m;$('ra-title').textContent=m.name;$('ra-q').value='';$('ra-results').replaceChildren();$('ra-msg').textContent='';
  $('ra-sgdb-go').hidden=!raData.steamgriddb;$('ra-dialog').showModal();raSearch();}
function raTile(src,label,onPick){const b=el('button');b.type='button';const img=el('img');img.loading='lazy';img.alt='';img.src=src;
  b.append(img,el('span',label));b.addEventListener('click',onPick);return b;}
async function raSearch(){
  $('ra-msg').textContent='찾고 있습니다';$('ra-results').replaceChildren();
  try{const d=await api('/admin/api/retro-art/candidates?game='+encodeURIComponent(raGame.id)+'&q='+encodeURIComponent($('ra-q').value));
    if(!$('ra-q').value)$('ra-q').value=d.q;
    $('ra-msg').textContent=d.names.length?'맞는 표지를 고릅니다.':'찾지 못했습니다. 검색어를 줄이거나 바꿔 봅니다.';
    $('ra-results').replaceChildren(...d.names.map((n)=>raTile(n.preview,n.name,()=>raApply('/admin/api/retro-art/match',{game:raGame.id,name:n.name}))));
  }catch(err){$('ra-msg').textContent=err.message;}
}
async function raSgdb(){
  $('ra-msg').textContent='SteamGridDB 에서 찾고 있습니다';$('ra-results').replaceChildren();
  try{const d=await api('/admin/api/retro-art/sgdb?q='+encodeURIComponent($('ra-q').value));
    $('ra-msg').textContent=d.games.length?'게임을 고르면 표지 후보가 나옵니다.':'찾지 못했습니다.';
    $('ra-results').replaceChildren(...d.games.map((g)=>{const b=el('button',g.name+(g.year?' ('+g.year+')':''));b.type='button';b.addEventListener('click',()=>raCovers(g.id));return b;}));
  }catch(err){$('ra-msg').textContent=err.message;}
}
async function raCovers(id){
  $('ra-msg').textContent='표지를 불러오고 있습니다';
  try{const d=await api('/admin/api/retro-art/sgdb/'+id);
    $('ra-msg').textContent=d.covers.length?'쓸 표지를 고릅니다.':'표지가 없습니다.';
    $('ra-results').replaceChildren(...d.covers.map((c)=>raTile(c.thumb,'',()=>raApply('/admin/api/retro-art/cover',{game:raGame.id,url:c.url}))));
  }catch(err){$('ra-msg').textContent=err.message;}
}
async function raApply(url,body){
  $('ra-msg').textContent='적용하고 있습니다';
  try{await api(url,{method:'POST',body});$('ra-dialog').close();toast('변경했습니다.');loadRetroArt();}catch(err){$('ra-msg').textContent=err.message;}
}
$('ra-sync').addEventListener('click',()=>raSync(null));
$('ra-ratings').addEventListener('click',async()=>{try{await api('/admin/api/retro-art/ratings',{method:'POST',body:{}});toast('평점 다운로드를 시작했습니다.');loadRetroArt();}catch(err){toast(err.message);}});
$('ra-prev').addEventListener('click',()=>{raAt--;raShow();});
$('ra-next').addEventListener('click',()=>{raAt++;raShow();});
let raFilterT=0;$('ra-filter').addEventListener('input',()=>{raAt=0;clearTimeout(raFilterT);raFilterT=setTimeout(raList,250);});
$('ra-up-btn').addEventListener('click',()=>$('ra-up-file').click());
$('ra-up-file').addEventListener('change',(e)=>{const f=e.target.files[0];e.target.value='';raUpload(f);});
// A drop or paste inside the dialog is the cover; it never reaches the upload tab's page-wide drop.
for(const t of ['dragenter','dragover','dragleave','drop'])$('ra-dialog').addEventListener(t,(e)=>{
  if(!e.dataTransfer||![...e.dataTransfer.types].includes('Files'))return;
  e.preventDefault();e.stopPropagation();$('ra-up').classList.toggle('over',t==='dragenter'||t==='dragover');
  if(t==='drop')raUpload(e.dataTransfer.files[0]);});
$('ra-dialog').addEventListener('paste',(e)=>{const f=[...(e.clipboardData?.files||[])].find((x)=>(x.type||'').startsWith('image/'));if(f){e.preventDefault();raUpload(f);}});
$('ra-search').addEventListener('submit',(e)=>{e.preventDefault();raSearch();});
$('ra-sgdb-go').addEventListener('click',raSgdb);
$('ra-none').addEventListener('click',async()=>{if(await ask('이 항목은 표지 없이 두고 자동 맞춤에서도 뺄까요?'))raApply('/admin/api/retro-art/match',{game:raGame.id,name:null});});
`+RETRO_KO_SCRIPT+RETRO_VARIANTS_SCRIPT;
