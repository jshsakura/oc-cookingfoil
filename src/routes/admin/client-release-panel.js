/**
 * The overview tab's client build block: how the CookingFoil client build
 * reaches this server (uploaded by hand, or also followed on GitHub), the
 * release followed, what consoles are offered and from where, and a button to
 * look right away. Talks to /admin/api/client-release (client-release-api.js)
 * and saves the mode and the release as server settings.
 */

export const CLIENT_RELEASE_HTML = `<p class="muted">기기에 내려줄 CookingFoil 클라이언트를 어디서 받을지 정합니다. 수동 업로드는 업로드 탭에서 올리거나 client 폴더에 넣은 빌드만 씁니다. 기본은 수동 업로드입니다. GitHub 릴리즈를 고르면 클라이언트 저장소의 최신 릴리즈를 30분마다 확인해 따로 받아 두고, 수동 빌드와 견줘 버전이 높은 쪽을 내려줍니다. 버전이 같으면 수동 빌드를 씁니다. 태그를 넣으면 최신 릴리즈 대신 그 태그의 릴리즈를 따릅니다.</p>
<form class="add" id="cr-form" autocomplete="off">
  <select id="cr-mode" aria-label="클라이언트 받는 방식"><option value="manual">수동 업로드</option><option value="github">GitHub 릴리즈</option></select>
  <input id="cr-repo" placeholder="소유자/저장소 (jshsakura/oc-cookingfoil-client)" aria-label="저장소" maxlength="140" spellcheck="false">
  <input id="cr-tag" placeholder="태그 (비우면 최신 릴리즈)" aria-label="태그" maxlength="100" spellcheck="false">
  <input id="cr-asset" placeholder="자산 이름 (.nro)" aria-label="자산 이름" maxlength="104" spellcheck="false">
  <button type="submit">저장</button>
  <button class="primary" type="button" id="cr-check">지금 가져오기</button>
</form>
<p class="muted" id="cr-token-hint" hidden>비공개 저장소라면 연동의 GitHub 토큰을 씁니다. 공개 저장소는 토큰 없이 받습니다.</p>
<div class="scroll" id="cr-status"></div>`;

export const CLIENT_RELEASE_SCRIPT = /* js */ `
const CR_SOURCE={manual:'수동',github:'GitHub'};
function crShowFields(){const gh=$('cr-mode').value==='github';for(const id of ['cr-repo','cr-tag','cr-asset','cr-check','cr-token-hint'])$(id).hidden=!gh;}
function crRender(d){
  $('cr-mode').value=d.mode||'manual';$('cr-repo').value=d.repo||'';$('cr-tag').value=d.tag||'';$('cr-asset').value=d.asset||'';crShowFields();
  const v=(x)=>x?x.version:'없음';
  const rows=[['내려주는 버전',d.offered?d.offered.version+' ('+(CR_SOURCE[d.offered.source]||'수동')+', '+fmt(d.offered.at)+')':'없음'],['수동 빌드',v(d.manual)]];
  if(d.mode==='github'){
    rows.push(['따르는 릴리즈',(d.repo||'')+' · '+(d.tag||'최신 릴리즈')]);
    rows.push(['GitHub 에서 받은 빌드',d.fetched?d.fetched.version+' ('+fmt(d.fetched.at)+')':v(d.github)]);
    rows.push(['마지막 확인',d.checked_at?fmt(d.checked_at)+(d.error?' · 실패':' · 정상'):'아직 확인하지 않았습니다']);
    if(d.error)rows.push(['확인 결과',d.error.message]);
  }
  if(d.rejected)rows.push(['내보내지 않은 수동 빌드',d.rejected.message]);
  table('cr-status',['항목','값'],rows.map(([k,x])=>{const tr=el('tr');tr.append(td(k),td(x));return tr;}),'');
}
async function loadClientRelease(){try{crRender(await api('/admin/api/client-release'));}catch(err){toast(err.message);}}
async function crCheck(quiet){const b=$('cr-check');b.disabled=true;
  try{const d=await api('/admin/api/client-release/check',{method:'POST',body:{}});crRender(d);
    if(!quiet)toast(d.error?'가져오지 못했습니다: '+d.error.message:'확인했습니다. 내려주는 버전은 '+(d.offered?.version||'없음')+' 입니다.');}
  catch(err){toast(err.message);}finally{b.disabled=false;}}
$('cr-mode').addEventListener('change',crShowFields);
$('cr-form').addEventListener('submit',async(e)=>{e.preventDefault();
  const body={clientSource:$('cr-mode').value};
  if(body.clientSource==='github')Object.assign(body,{clientReleaseRepo:$('cr-repo').value.trim(),clientReleaseTag:$('cr-tag').value.trim(),clientReleaseAsset:$('cr-asset').value.trim()});
  try{await api('/admin/api/server-settings',{method:'POST',body});toast('저장했습니다.');crCheck(true);}
  catch(err){toast(/clientReleaseRepo/.test(err.message)?'저장소는 소유자/저장소 꼴로 넣습니다.':/clientReleaseTag/.test(err.message)?'태그에는 영문, 숫자, 점, 밑줄, 하이픈만 씁니다.':/clientReleaseAsset/.test(err.message)?'자산 이름은 .nro 로 끝나야 합니다.':err.message);}});
$('cr-check').addEventListener('click',()=>crCheck(false));
`;
