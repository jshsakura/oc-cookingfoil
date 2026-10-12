/**
 * The admin page's retro tab: box art and bezel coverage per system, a button
 * that fetches what is missing, and a dialog to match one item by hand from
 * libretro names or SteamGridDB covers. Talks to /admin/api/retro-art.
 */

export const RETRO_ART_HTML = `<section id="tab-retro" hidden>
  <div class="hd"><h2 class="first">표지와 베젤</h2><button type="button" class="primary" id="ra-sync">빠진 것 모두 받기</button></div>
  <p class="muted">파일 이름의 영어 제목으로 libretro 표지 목록에서 짝을 찾고, 표지와 베젤 프로젝트의 베젤을 받습니다. 이미 있는 파일은 건드리지 않습니다. 업로드한 뒤에는 그 시스템만 저절로 받습니다. 그 게임의 베젤이 없으면 같은 제목의 다른 지역판 베젤을, 그것도 없으면 시스템 기본 베젤을 씁니다. </p>
  <p class="warn-line" id="ra-gh" hidden>GitHub 토큰이 없습니다. 베젤 목록을 읽다 시간당 60번 한도에 걸리면 다른 지역판 베젤로 폴백하지 못합니다. <a href="#settings">설정 탭</a>에서 넣을 수 있습니다.</p>
  <p class="muted" id="ra-job"></p>
  <div class="hd"><h2>평점</h2><button type="button" id="ra-ratings">평점 갱신</button></div>
  <p class="muted">LaunchBox 게임 데이터베이스의 사용자 평점을 원제로 맞춰 붙입니다. 자료 파일이 100MB 쯤이라 몇 분 걸립니다. 일주일마다 저절로 갱신합니다.</p>
  <p class="muted" id="ra-ratings-state"></p>
  <div class="scroll" id="ra-systems"></div>
  <div class="hd"><h2>표지가 없는 항목</h2><input id="ra-filter" placeholder="이름으로 거르기" aria-label="이름으로 거르기"></div>
  <p class="muted">자동으로 짝을 찾지 못한 항목입니다. 맞추기를 눌러 제목을 검색하고 고르면 표지와 베젤이 그 이름을 따라갑니다.</p>
  <div class="scroll" id="ra-missing"></div>
</section>
<dialog id="ra-dialog" class="ra-dialog">
  <form method="dialog" class="ra-close"><button aria-label="닫기">닫기</button></form>
  <h3 id="ra-title"></h3>
  <form id="ra-search" class="add"><input id="ra-q" aria-label="검색어" placeholder="영어 제목"><button class="primary">libretro 에서 찾기</button><button type="button" id="ra-sgdb-go">SteamGridDB 에서 찾기</button></form>
  <p class="muted" id="ra-msg"></p>
  <div class="ra-grid" id="ra-results"></div>
  <div class="row"><button type="button" id="ra-none" class="danger">표지 없음으로 두기</button></div>
</dialog>`;

export const RETRO_ART_CSS = `
.ra-dialog{width:min(860px,94vw);max-height:88vh;border:1px solid var(--line);border-radius:16px;background:var(--bg);color:var(--text);padding:20px}
.ra-dialog::backdrop{background:rgba(0,0,0,.5)}.ra-close{float:right}.ra-dialog h3{margin:0 0 12px;font-size:16px}
.ra-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin:12px 0;overflow:auto;max-height:52vh}
.ra-grid button{display:flex;flex-direction:column;gap:6px;align-items:stretch;padding:6px;text-align:left;font-size:12px;font-weight:500;background:var(--panel)}
.ra-grid img{width:100%;aspect-ratio:3/4;object-fit:contain;background:var(--sunk);border-radius:8px}
.ra-grid span{overflow-wrap:anywhere}
#ra-filter{max-width:220px}
.warn-line{background:var(--sunk);border:1px solid var(--line);border-left:3px solid var(--warn,#d9a400);border-radius:10px;padding:10px 12px;font-size:13px}
`;

export const RETRO_ART_SCRIPT = /* js */ `
let raData=null,raGame=null,raTimer=null;
function raCell(node){const c=el('td');c.append(node);return c;}
async function loadRetroArt(){
  try{raData=await api('/admin/api/retro-art');}catch(err){toast(err.message);return;}
  const j=raData.job;
  $('ra-sync').disabled=Boolean(j&&!j.finishedAt);$('ra-gh').hidden=raData.github!==false;
  $('ra-job').textContent=!j?'':!j.finishedAt?'받고 있습니다'+(j.progress?' · '+j.progress.system+' ('+(j.progress.index+1)+'/'+j.progress.total+')':''):
    j.error?'실패했습니다: '+j.error:'마지막 정리: '+fmt(j.finishedAt)+' · '+Object.entries(j.summary||{}).map(([k,v])=>v.error?k+' 실패':k+' +'+(v.boxart||0)+'/'+(v.bezel||0)).join(', ');
  const r=raData.ratings||{},rj=r.job;const rRunning=Boolean(rj&&!rj.finishedAt);
  $('ra-ratings').disabled=rRunning;
  $('ra-ratings-state').textContent=rRunning?'평점을 받고 있습니다':rj&&rj.error?'실패했습니다: '+rj.error:
    (r.updatedAt?'마지막 갱신: '+fmt(r.updatedAt):'아직 받은 평점이 없습니다')+(rj&&rj.summary?' · '+Object.entries(rj.summary).map(([k,v])=>k+' '+v).join(', '):'');
  clearTimeout(raTimer);if((j&&!j.finishedAt)||rRunning)raTimer=setTimeout(loadRetroArt,3000);
  table('ra-systems',['시스템','항목','표지','베젤',''],raData.systems.map((s)=>{const tr=el('tr');
    const b=el('button','이 시스템만 받기');b.type='button';b.addEventListener('click',()=>raSync(s.id));
    const pct=(n)=>n+' ('+Math.round(n*100/Math.max(1,s.games))+'%)';
    tr.append(td(s.name),td(String(s.games)),td(pct(s.boxart)),td(pct(s.bezel)),raCell(b));return tr;}),'레트로 폴더에 항목이 없습니다.');
  raList();
}
function raList(){
  const q=$('ra-filter').value.trim().toLowerCase();
  const rows=(raData?.missing||[]).filter((m)=>!q||m.name.toLowerCase().includes(q)).slice(0,300);
  table('ra-missing',['시스템','이름',''],rows.map((m)=>{const tr=el('tr');
    const b=el('button','맞추기');b.type='button';b.addEventListener('click',()=>raOpen(m));
    tr.append(td(m.system),td(m.name),raCell(b));return tr;}),'표지가 빠진 항목이 없습니다.');
}
async function raSync(system){
  try{await api('/admin/api/retro-art/sync',{method:'POST',body:system?{system}:{}});toast('받기 시작했습니다.');loadRetroArt();}catch(err){toast(err.message);}
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
  try{await api(url,{method:'POST',body});$('ra-dialog').close();toast('바꿨습니다.');loadRetroArt();}catch(err){$('ra-msg').textContent=err.message;}
}
$('ra-sync').addEventListener('click',()=>raSync(null));
$('ra-ratings').addEventListener('click',async()=>{try{await api('/admin/api/retro-art/ratings',{method:'POST',body:{}});toast('평점 받기를 시작했습니다.');loadRetroArt();}catch(err){toast(err.message);}});
$('ra-filter').addEventListener('input',raList);
$('ra-search').addEventListener('submit',(e)=>{e.preventDefault();raSearch();});
$('ra-sgdb-go').addEventListener('click',raSgdb);
$('ra-none').addEventListener('click',()=>{if(confirm('이 항목은 표지 없이 두고 자동 맞춤에서도 뺄까요?'))raApply('/admin/api/retro-art/match',{game:raGame.id,name:null});});
`;
