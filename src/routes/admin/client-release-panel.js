/**
 * The settings tab's client update block: which GitHub repository the client
 * build comes from, what consoles are offered now, the last build taken from
 * the release, and a button to look right away. Talks to /admin/api/client-release
 * (client-release-api.js) and saves the repository as the clientReleaseRepo
 * server setting.
 */

export const CLIENT_RELEASE_HTML = `<div class="hd"><h2>클라이언트 업데이트</h2></div>
<p class="muted">CookingFoil 클라이언트 빌드를 GitHub 저장소의 client-latest 릴리즈에서 가져옵니다. 15분마다 확인하고, 크기와 sha256 이 릴리즈와 같고 버전이 지금보다 낮지 않은 빌드만 내보냅니다. 저장소를 비우면 가져오지 않고, 직접 올린 빌드만 내보냅니다.</p>
<form class="add" id="cr-form" autocomplete="off">
  <input id="cr-repo" placeholder="소유자/저장소 (예: jshsakura/oc-cookingfoil)" aria-label="클라이언트 저장소" maxlength="140" spellcheck="false">
  <button type="submit">저장</button>
  <button class="primary" type="button" id="cr-check">지금 가져오기</button>
</form>
<div class="scroll" id="cr-status"></div>`;

export const CLIENT_RELEASE_SCRIPT = /* js */ `
function crRender(d){
  $('cr-repo').value=d.repo||'';
  const rows=[
    ['내보내는 버전',d.offered?d.offered.version+' ('+fmt(d.offered.at)+')':'없음'],
    ['릴리즈에서 마지막으로 가져온 버전',d.fetched?d.fetched.version+' ('+fmt(d.fetched.at)+')':'없음'],
    ['마지막 확인',fmt(d.checked_at)],
  ];
  if(d.error)rows.push(['마지막 오류',d.error.message+' ('+fmt(d.error.at)+')']);
  if(d.rejected)rows.push(['내보내지 않은 빌드',d.rejected.message]);
  table('cr-status',['항목','값'],rows.map(([k,v])=>{const tr=el('tr');tr.append(td(k),td(v));return tr;}),'');
}
async function loadClientRelease(){try{crRender(await api('/admin/api/client-release'));}catch(err){toast(err.message);}}
async function crCheck(){const b=$('cr-check');b.disabled=true;
  try{const d=await api('/admin/api/client-release/check',{method:'POST',body:{}});crRender(d);
    toast(d.error?'가져오지 못했습니다: '+d.error.message:d.repo?'확인했습니다. 내보내는 버전은 '+(d.offered?.version||'없음')+' 입니다.':'저장소가 비어 있어 가져오지 않습니다.');}
  catch(err){toast(err.message);}finally{b.disabled=false;}}
$('cr-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/server-settings',{method:'POST',body:{clientReleaseRepo:$('cr-repo').value.trim()}});toast('저장했습니다.');crCheck();}
  catch(err){toast(/clientReleaseRepo/.test(err.message)?'저장소는 소유자/저장소 꼴로 넣습니다.':err.message);}});
$('cr-check').addEventListener('click',crCheck);
`;
