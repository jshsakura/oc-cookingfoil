/** Homebrew apps, recommendations and tracked repositories. */
import { icon } from "../../views/icons.js";
import { box } from "./boxes.js";
import { top } from "./top-i18n.js";
export const HOMEBREW_HTML = /* html */ `<section id="tab-homebrew" hidden>
  <div class="subtabs hide-bar" id="homebrew-subtabs" role="tablist" aria-label="홈브류 구역">
    <button type="button" role="tab" data-sub="apps" aria-selected="true">${icon("package")}앱</button>
    <button type="button" role="tab" data-sub="reco" aria-selected="false">${icon("star")}추천 홈브류</button>
    <button type="button" role="tab" data-sub="sources" aria-selected="false">${icon("download")}GitHub 저장소</button>
  </div>
  <div data-sub-panel="apps">
  <div class="hd"><h2 class="first">앱</h2><div class="actions"><button type="button" id="hb-rescan">다시 읽기</button><button type="button" id="hb-adopt">폴더 등록</button></div></div>
  <p class="muted">서버에 있는 홈브류 앱 전체입니다. 끄면 기기 목록에서 빠지고 서버에는 남습니다. GitHub 앱은 빼기로 더 따라가지 않고, 직접 넣은 앱은 GitHub 연결로 저장소를 따라가게 바꾸거나 삭제합니다.</p>
  ${box("hb-apps-help", "앱 관리 안내", `<p class="muted">앱마다 도구나 포트로 나누고, 그 앱의 패치와 세이브를 올리거나 삭제합니다. 서버의 홈브류 폴더에 .nro 와 게임 파일이 든 폴더를 직접 넣었다면 "폴더 등록"을 누르면 폴더째 등록됩니다.</p>`, { level: "h3" })}
  <div id="hb-held" class="hb-held" hidden></div>
  <div class="scroll" id="hb-apps" data-skel></div>
  </div>
  <div data-sub-panel="reco" hidden>
  <div class="hd"><h2 class="first">추천 홈브류</h2><div class="actions"><button type="button" id="hb-add-picked">고른 것 추가</button><button type="button" class="primary" id="hb-add-all">모두 추가</button></div></div>
  <p class="muted">최신 릴리스에서 바로 받을 수 있는 것을 확인한 목록입니다. 추가하면 서버가 GitHub 릴리스를 따라가며 새 버전을 알려 줍니다.</p>
  <div class="hb-reco" id="hb-reco" data-skel></div>
  </div>
  <div data-sub-panel="sources" hidden>
  <div class="hd"><h2 class="first">GitHub 저장소 추가</h2></div>
  <form class="add" id="hb-add">
    <input id="hb-repo" autocomplete="off" spellcheck="false" placeholder="GitHub 주소 또는 owner/name" aria-label="GitHub 저장소" required maxlength="200">
    <input id="hb-asset" autocomplete="off" spellcheck="false" placeholder="쓸 파일 이름 (선택, 예: *-classic.nro)" aria-label="쓸 파일 이름" maxlength="100">
    <button class="primary" type="submit">추가</button>
  </form>
  <p class="muted">추가하면 서버가 바로 확인해 최신 릴리스를 받아 둡니다. 릴리스에 .nro 가 여럿이면 저장소 이름과 같은 것을, 없으면 .zip 안의 .nro 를 씁니다. 다른 파일을 쓰려면 아래 목록에서 고릅니다.</p>
  <div class="hd"><h2>등록된 GitHub 저장소</h2><button type="button" id="hb-check-all">모두 지금 확인</button></div>
  <div class="scroll" id="hb-sources" data-skel></div>
  </div>
</section>`;

export const HOMEBREW_DIALOG_HTML = /* html */ `<dialog id="hb-banner" class="hb-banner" aria-labelledby="hb-banner-title">
  <h3 id="hb-banner-title"></h3>
  <p class="muted">게임처럼 앱 정보 위쪽에 넓은 배경 그림을, 아래에 스크린샷을 보여 줍니다. 포트는 배경을 SteamGridDB 에서, 스크린샷을 IGDB 에서(키가 있을 때) 자동으로 찾아 둡니다.</p>
  <h4>배경 그림</h4>
  <div class="hb-banner-now" id="hb-banner-now"><img id="hb-banner-img" alt="지금 그림"><p class="muted" id="hb-banner-none">지금은 그림이 없습니다.</p></div>
  <form class="add" id="hb-banner-search"><input id="hb-banner-q" aria-label="검색어" placeholder="영어 게임 이름"><button class="primary">SteamGridDB 에서 찾기</button></form>
  <p class="muted" id="hb-banner-state" aria-live="polite"></p>
  <div class="hb-banner-grid" id="hb-banner-results"></div>
  <div class="row-actions">
    <label class="btn-like" for="hb-banner-file">배경 올리기</label><input type="file" id="hb-banner-file" accept="image/*" hidden>
    <button type="button" id="hb-banner-remove" class="danger">배경 빼기</button>
  </div>
  <h4>스크린샷 <span class="muted" id="hb-shots-count"></span></h4>
  <div class="hb-shots" id="hb-shots"></div>
  <p class="muted" id="hb-shots-state" aria-live="polite"></p>
  <div class="dialog-actions">
    <label class="btn-like" for="hb-shots-file">스크린샷 올리기</label><input type="file" id="hb-shots-file" accept="image/*" multiple hidden>
    <button type="button" id="hb-shots-clear" class="danger">스크린샷 모두 빼기</button>
    <button type="button" id="hb-banner-close" data-top="acc.close">${top("acc.close")}</button>
  </div>
</dialog>
<dialog id="hb-desc" aria-labelledby="hb-desc-title">
  <h3 id="hb-desc-title"></h3>
  <p class="muted" id="hb-desc-hint"></p>
  <form class="desc-form" id="hb-desc-form" method="dialog">
    <label>영어 설명 (모든 언어의 기본값)<textarea id="hb-desc-en" maxlength="2000"></textarea></label>
    <label>한국어 설명 (한국어로 볼 때)<textarea id="hb-desc-ko" maxlength="2000"></textarea></label>
    <div class="dialog-actions">
      <button type="button" id="hb-desc-reset">GitHub 기본값으로</button>
      <button type="button" id="hb-desc-close" data-top="acc.close">${top("acc.close")}</button>
      <button type="submit" class="primary" data-top="fp.save">${top("fp.save")}</button>
    </div>
  </form>
</dialog>
`;

export const HOMEBREW_SCRIPT = /* js */ `
async function loadHomebrew(){
  const d=await api('/admin/api/homebrew');
  const reco=$('hb-reco');hbReco=d.recommended||[];
  paged(reco,{key:'hb-reco',label:topText('ht.reco'),def:12,items:d.recommended||[],
    match:(r,q)=>(r.repo+' '+(r.purpose.ko||'')+' '+(r.purpose.en||'')).toLowerCase().includes(q),
    render:(rows)=>{reco.replaceChildren();
      for(const r of rows){const l=el('label');const c=el('input');c.type='checkbox';c.value=r.repo;c.disabled=r.added;c.checked=!r.added&&hbPicked.has(r.repo);
        c.addEventListener('change',()=>{if(c.checked)hbPicked.add(r.repo);else hbPicked.delete(r.repo);});
        l.classList.toggle('added',r.added);const t=el('div');t.append(el('b',r.repo),el('span',(r.purpose.ko||r.purpose.en)+(r.added?' · 추가됨':'')));
        l.append(c,t);reco.append(l);}}});
  paged($('hb-sources'),{key:'hb-sources',label:'등록된 GitHub 저장소',def:25,items:d.sources||[],
    match:(s,q)=>(s.repo+' '+(s.description?.github||'')+' '+(s.description?.custom?.ko||'')).toLowerCase().includes(q),
    render:(rows,list,q)=>{const m=$('hb-sources');if(m._grid){m._grid.destroy();m._grid=null;}
      if(!rows.length){m.replaceChildren(el('div',q?'찾은 저장소가 없습니다.':'등록된 GitHub 저장소가 없습니다. 위에서 추천 홈브류를 고르거나 주소로 추가합니다.','empty'));return;}
      const grid=el('div',null,'src-cards');grid.append(...rows.map(hbSourceCard));m.replaceChildren(grid);}});
  hbManual=d.manual||[];hbSources=d.sources||[];loadHbApps();}
// One registered repository as a card: name and description on top, the file, state and last check in the
// middle, the buttons in the footer.
function hbSourceCard(s){const card=el('article',null,'src-card');
  const head=el('div',null,'src-head');const a=el('a',s.repo);a.href='https://github.com/'+s.repo;a.target='_blank';a.rel='noopener';
  head.append(a,el('span',s.cached?.version||s.tag||'—','src-ver'));card.append(head);
  const shown=s.description?.custom?(s.description.custom.ko||s.description.custom.en||'설명 없음'):s.description?.github;
  if(shown)card.append(el('p',shown,'src-desc'));
  const facts=el('dl',null,'src-facts');const fact=(k,v)=>{const d=el('div');d.append(el('dt',k));const dd=el('dd');dd.append(v);d.append(dd);facts.append(d);};
  if((s.assets||[]).length>1||s.pattern){const sel=el('select');sel.setAttribute('aria-label','쓸 파일');
    const auto=el('option','자동 ('+(s.chosen||'없음')+')');auto.value='';sel.append(auto);
    for(const n of s.assets){const o=el('option',n);o.value=n;sel.append(o);}
    if(s.pattern&&!s.assets.includes(s.pattern)){const o=el('option',s.pattern);o.value=s.pattern;sel.append(o);}
    sel.value=s.pattern||'';sel.addEventListener('change',()=>setHbAsset(s.repo,sel.value));fact('쓰는 파일',sel);}
  else fact('쓰는 파일',s.chosen||'—');
  const when=el('span',ago(s.checked_at));when.title=fmt(s.checked_at);fact('마지막 확인',when);
  card.append(facts);
  const st=el('div',null,'src-state');const pills=el('div',null,'pills');st.append(pills);
  if(s.error){pills.append(pill('오류','off'));st.append(el('div',s.error.message,'err'));}
  else if(s.cached)pills.append(pill(s.cached.current?'받아 둠 · '+mb(s.cached.size):'새 버전 있음',s.cached.current?'on':'warn'));
  else pills.append(pill(s.checked_at?'아직 받지 않음':'확인 전'));
  if(s.install){const folder=s.install.mode==='folder';
    const how=pill(folder?'폴더 설치 · '+s.folder_files+'개 파일':'nro 만',folder?'on':null);
    if(!folder&&topText('hb.reason.'+s.install.reason))how.title=topText('hb.reason.'+s.install.reason);
    pills.append(how);
    for(const x of s.install.excluded||[])st.append(el('div','일부 파일 제외('+(topText('hb.ex.'+x.rule)||x.rule)+'): '+x.paths.join(', '),'muted'));
    if(s.install.rules?.length){const d=el('details');d.append(el('summary','판단 근거'),el('div',s.install.rules.join(' · '),'muted'));st.append(d);}}
  card.append(st);
  const foot=el('div',null,'src-foot');
  foot.append(hbKind(s.id,s.kind),btn('설명',()=>editHbDesc(s.id,s.cached?.name||s.repo,s.description)),btn('지금 확인',()=>checkHb(s.repo)),btn('삭제',()=>removeHb(s.repo),'danger'));
  card.append(foot);return card;}
let hbManual=[],hbSources=[],hbReco=[];const hbPicked=new Set();
// Every app with its own patches and saves: upload jumps to the upload tab with the app already chosen.
async function loadHbApps(){let d;try{d=await api('/admin/api/homebrew/apps');}catch(err){toast(err.message);return;}
  const held=d.held||[];$('hb-held').hidden=!held.length;
  $('hb-held').replaceChildren(...held.map((h)=>{const p=el('p');p.append(el('b','switch/'+h.folder+'/'),' '+h.reason);return p;}));
  // Only the patches and saves an app has; uploading one is a button in the card's footer.
  const extras=(type,items)=>{if(!items.length)return null;const c=el('div',null,'hb-extras');
    for(const it of items){const line=el('div',null,'xline');line.append(el('em',type==='patch'?topText('u.kPatch'):topText('u.kSave'),'hb-xk'),el('span',it.name+' · '+mb(it.size)));
      line.append(verifyPill(it.name,it.verified,async(next)=>{
        try{await api('/admin/api/content/'+type+'/verified',{method:'POST',body:{id:it.id,verified:next}});toast(next?it.name+' 에 검수됨 배지를 붙였습니다.':it.name+' 의 검수됨 배지를 뗐습니다.');}
        catch(err){toast(err.message);}loadHbApps();}));
      if(type==='patch'){const e=btn('편집',()=>ctOpen('patch',it,loadHbApps));e.setAttribute('aria-label',it.name+' 편집');line.append(e);}
      const x=btn(topText('pp.delete'),()=>removeHbExtra(type,it.id,it.name),'danger');x.setAttribute('aria-label',it.name+' '+topText('pp.delete'));line.append(x);c.append(line);}
    return c;};
  paged($('hb-apps'),{key:'hb-apps',label:topText('ht.apps'),def:24,items:d.apps||[],
    match:(a,q)=>((a.name||'')+' '+(a.app||'')+' '+(a.repo_url||'')+' '+(a.title_id||'')).toLowerCase().includes(q),
    render:(rows,list,q)=>{const m=$('hb-apps');
      if(!rows.length){m.replaceChildren(el('div',q?'찾은 앱이 없습니다.':'홈브류 앱이 없습니다. 업로드 탭에서 올리거나 아래에서 저장소를 추가합니다.','empty'));return;}
      const grid=el('div',null,'src-cards');grid.append(...rows.map((a)=>hbAppCard(a,extras)));m.replaceChildren(grid);}});}
// One app as a card the way the client shows it: its picture with the size on it, the icon and name with
// the on/off switch, the kind as chips, then its patches and saves and the buttons as one row of icons.
function hbAppCard(a,extras){const name=a.name||a.app;const card=el('article',null,'src-card hb-app'+(a.enabled?'':' hb-off'));
  const media=el('div',null,'hb-media');if(a.banner_url)media.style.backgroundImage='url("'+a.banner_url+'")';
  const iconUrl=a.custom_icon_url||'/api/homebrew/'+encodeURIComponent(a.id)+'/icon?size=sm';
  // Without a banner the icon, blurred, fills the picture so the card is never a blank box.
  if(!a.banner_url){const bg=el('img',null,'hb-media-blur');bg.alt='';bg.loading='lazy';bg.src=iconUrl;bg.onerror=()=>bg.remove();media.append(bg);}
  media.append(el('span',mb(a.size),'hb-size'));
  const head=el('div',null,'src-head');
  const icon=el('img',null,'hb-icon');icon.alt='';icon.loading='lazy';icon.src=iconUrl;
  icon.onerror=()=>icon.replaceWith(el('span',String(name||'?').slice(0,1),'hb-icon hb-icon-none'));
  const title=el('div',null,'hb-title');title.append(el('b',name));
  const where=a.install_type==='title'?'설치형 NSP · '+a.title_id:'switch/'+a.app+'/';
  title.append(el('span',(a.version?'v'+a.version+' · ':'')+(a.source==='github'?'GitHub '+(a.repo_url||'').replace('https://github.com/',''):'직접 넣음')+' · '+where,'muted'));
  title.title=name;
  const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=a.enabled;b.setAttribute('aria-label',name+' 켜기');
  b.addEventListener('change',()=>setHbEnabled(a.id,b.checked,name));w.append(b,el('span'));
  head.append(icon,title,w);
  // Tried on a console: the shop and the client show a 검수됨 badge on it.
  const tags=el('div',null,'hb-tags');tags.append(hbVerify(a),hbKind(a.id,a.kind));
  if(a.install_type!=='title')tags.append(hbCores(a.id,a.cores,name));
  card.append(media,head,tags);
  // An installable title has no switch/<app>/ folder for patches and saves to go under.
  if(a.app)for(const x of [extras('patch',a.patches),extras('save',a.saves)])if(x)card.append(x);
  const manual=hbManual.find((m)=>m.id===a.id);
  const desc=manual?.description||hbSources.find((s)=>s.id===a.id)?.description||{custom:null,github:a.description||null};
  const repo=(a.repo_url||'').replace('https://github.com/','');
  const foot=el('div',null,'src-foot hb-foot');
  if(a.app)for(const [txt,type,short] of [[topText('rpt.apply'),'patch',topText('u.kPatch')],['세이브 올리기','save',topText('u.kSave')]]){
    const u=btn(txt,()=>uploadFor(type,a.app),'hb-up');u.querySelector('span').textContent=short;foot.append(u);}
  foot.append(btn('설명',()=>editHbDesc(a.id,name,desc)),btn('그림',()=>openHbBanner(a)));
  if(a.replaceable)foot.append(btn(topText('t.hbReplace'),()=>pickHbFile(a,name)));
  if(a.source==='manual')foot.append(btn('GitHub 연결',()=>linkHb(a)),btn(topText('pp.delete'),()=>removeManualHb(a.id,name),'danger'));
  else if(repo)foot.append(btn('지금 확인',()=>checkHb(repo)),btn(topText('fp.remove'),()=>removeHb(repo),'danger'));
  card.append(foot);return card;}
// The picture behind an app's header: SteamGridDB's wide backgrounds, an upload, or none.
let hbBannerApp=null;
function hbBannerShow(url){const img=$('hb-banner-img');img.hidden=!url;if(url)img.src=url;$('hb-banner-none').hidden=Boolean(url);$('hb-banner-remove').hidden=!url;
  // An app turned off is not served publicly: its preview says so instead of a broken picture.
  img.onerror=()=>{img.hidden=true;$('hb-banner-none').hidden=false;$('hb-banner-none').textContent='앱이 꺼져 있어 미리 볼 수 없습니다. 그림은 그대로 있습니다.';};
  $('hb-banner-none').textContent='지금은 그림이 없습니다.';}
function hbShotsShow(urls){const n=(urls||[]).length;$('hb-shots-count').textContent=n?n+'장':'없음';$('hb-shots-clear').hidden=!n;
  $('hb-shots').replaceChildren(...(urls||[]).map((u,i)=>{const f=el('figure');const img=el('img');img.src=u;img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
    const x=btn('✕',()=>hbShotRemove(i+1));x.setAttribute('aria-label',(i+1)+'번째 스크린샷 빼기');f.append(img,x);return f;}));}
// The dialog stays open while pictures change; the list behind it is read again when it closes.
async function hbMediaReload(){const d=await api('/admin/api/homebrew/apps');const a=(d.apps||[]).find((x)=>x.id===hbBannerApp.id);
  if(a){hbBannerApp=a;hbBannerShow(a.banner_url);hbShotsShow(a.screenshots);}}
async function hbShotRemove(n){if(!await ask(n+'번째 스크린샷을 뺍니다.',{danger:true}))return;
  try{await api('/admin/api/homebrew/shots/remove',{method:'POST',body:{id:hbBannerApp.id,n}});await hbMediaReload();}catch(err){toast(err.message);}}
function openHbBanner(a){hbBannerApp=a;$('hb-banner-title').textContent=(a.name||a.app)+' 그림';hbBannerShow(a.banner_url);hbShotsShow(a.screenshots);$('hb-shots-state').textContent='';
  $('hb-banner-q').value='';$('hb-banner-results').replaceChildren();$('hb-banner-state').textContent='';$('hb-banner').showModal();hbBannerSearch();}
async function hbBannerSearch(){const st=$('hb-banner-state');st.textContent='찾고 있습니다';$('hb-banner-results').replaceChildren();
  try{const d=await api('/admin/api/homebrew/banner/candidates?id='+encodeURIComponent(hbBannerApp.id)+'&q='+encodeURIComponent($('hb-banner-q').value.trim()));
    $('hb-banner-q').value=d.q||'';st.textContent=d.items.length?'고르면 바로 바뀝니다.':'"'+d.q+'" 로 찾은 그림이 없습니다. 영어 이름으로 다시 찾습니다.';
    $('hb-banner-results').replaceChildren(...d.items.map((it)=>{const b=el('button');b.type='button';b.setAttribute('aria-label',it.game.name+' 그림 고르기');
      const img=el('img');img.src=it.thumb;img.alt='';img.loading='lazy';b.append(img);b.addEventListener('click',()=>hbBannerPick(it));
      const f=el('figure');f.style.margin='0';f.append(b,el('figcaption',it.game.name));return f;}));}
  catch(err){st.textContent=err.message;}}
async function hbBannerPick(it){$('hb-banner-state').textContent='받고 있습니다';
  try{await api('/admin/api/homebrew/banner',{method:'POST',body:{id:hbBannerApp.id,url:it.url,game:it.game}});toast('배경 그림을 변경했습니다.');await hbMediaReload();}
  catch(err){$('hb-banner-state').textContent=err.message;}}
$('hb-banner-search').addEventListener('submit',(e)=>{e.preventDefault();hbBannerSearch();});
$('hb-banner-close').addEventListener('click',()=>$('hb-banner').close());
$('hb-banner').addEventListener('close',()=>loadHbApps());
$('hb-shots-clear').addEventListener('click',async()=>{if(!await ask('스크린샷을 모두 뺍니다. 포트도 다시 자동으로 채우지 않습니다.',{danger:true}))return;
  try{await api('/admin/api/homebrew/shots/remove',{method:'POST',body:{id:hbBannerApp.id}});await hbMediaReload();}catch(err){toast(err.message);}});
$('hb-shots-file').addEventListener('change',async()=>{const files=[...$('hb-shots-file').files];$('hb-shots-file').value='';if(!files.length)return;
  const st=$('hb-shots-state');let done=0;
  for(const file of files){st.textContent='올리고 있습니다 ('+(done+1)+'/'+files.length+')';
    try{const r=await fetch('/admin/api/homebrew/shots/upload?id='+encodeURIComponent(hbBannerApp.id),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream',Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'},body:file});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||topText('u.rFail'));done++;}
    catch(err){st.textContent=file.name+': '+err.message;break;}}
  if(done===files.length)st.textContent=done+'장을 올렸습니다.';await hbMediaReload();});
$('hb-banner-remove').addEventListener('click',async()=>{if(!await ask('배경 그림을 뺍니다. 포트도 다시 자동으로 채우지 않습니다.',{danger:true}))return;
  try{await api('/admin/api/homebrew/banner/remove',{method:'POST',body:{id:hbBannerApp.id}});toast('배경 그림을 뺐습니다.');await hbMediaReload();}catch(err){toast(err.message);}});
$('hb-banner-file').addEventListener('change',async()=>{const file=$('hb-banner-file').files[0];$('hb-banner-file').value='';if(!file)return;
  $('hb-banner-state').textContent='올리고 있습니다';
  try{const r=await fetch('/admin/api/homebrew/banner/upload?id='+encodeURIComponent(hbBannerApp.id),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream',Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'},body:file});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||topText('u.rFail'));toast('배경 그림을 올렸습니다.');await hbMediaReload();}
  catch(err){$('hb-banner-state').textContent=err.message;}});
async function removeHbExtra(type,id,name){if(!await ask(topFill(type==='patch'?'t.askPatch':'t.askSave',{name}),{danger:true}))return;
  try{await api('/admin/api/homebrew/extra/remove',{method:'POST',body:{type,id}});toast(topText('t.movedToast'));loadHbApps();}catch(err){toast(err.message);}}
async function setHbEnabled(id,enabled,name){
  try{await api('/admin/api/homebrew/enabled',{method:'POST',body:{id,enabled}});toast(enabled?name+' 을(를) 다시 보여 줍니다.':name+' 을(를) 기기 목록에서 뺐습니다. 서버에는 남아 있습니다.');loadHbApps();}
  catch(err){toast(err.message);loadHbApps();}}
// A pill, not a second switch beside 켜기: green with a shield once someone tried the item on a console.
// Patch and save rows use it too; onClick gets the value to set.
function hbVerify(a){const name=a.name||a.app;return verifyPill(name,a.verified,(next)=>setHbVerified(a.id,next,name));}
async function setHbVerified(id,verified,name){
  try{await api('/admin/api/homebrew/verified',{method:'POST',body:{id,verified}});toast(verified?name+' 에 검수됨 배지를 붙였습니다.':name+' 의 검수됨 배지를 뗐습니다.');loadHbApps();}
  catch(err){toast(err.message);loadHbApps();}}
// A hand-placed app linked to its GitHub repository: the server follows the repository, then the hand-placed copy can go.
async function linkHb(a){const input=await askText((a.name||a.app)+' 의 GitHub 저장소 주소나 owner/name 을 넣습니다. 서버가 그 저장소의 새 버전을 따라갑니다.');
  if(!input||!input.trim())return;
  try{const s=await api('/admin/api/homebrew',{method:'POST',body:{repo:input.trim()}});
    if(s&&!s.error&&await ask(s.repo+' 을(를) 따라갑니다. 직접 넣은 '+(a.name||a.app)+' 사본을 삭제할까요? 이 앱의 패치와 세이브는 남습니다.',{danger:true})){
      await api('/admin/api/homebrew/manual/remove',{method:'POST',body:{id:a.id}});toast('GitHub 저장소로 변경했습니다.');}
    else toast(s?.error?.message?s.repo+' 을(를) 따라가지만 확인에 실패했습니다: '+s.error.message:'저장소를 추가했습니다.');
    loadHomebrew();}catch(err){toast(err.message);}}
async function removeManualHb(id,name){if(!await ask(topFill('t.askHbApp',{name}),{danger:true}))return;
  try{await api('/admin/api/homebrew/manual/remove',{method:'POST',body:{id}});toast(topText('t.movedToast'));loadHomebrew();}catch(err){toast(err.message);}}
// A new build of a hand-placed app, same format as now: the server keeps its folder, so its id and what was added by hand stay.
function pickHbFile(a,name){const ext=a.install_type==='title'?'.nsp':'.nro';
  const input=el('input');input.type='file';input.accept=ext;
  input.addEventListener('change',()=>{const file=input.files[0];if(file)replaceHbFile(a,name,file);});input.click();}
async function replaceHbFile(a,name,file){if(!await ask(topFill('t.askHbReplace',{name,file:file.name}),{danger:true}))return;
  toast(topFill('t.hbReplacing',{name}));
  const fd=new FormData();fd.append('replace',a.id);fd.append('files',file,file.name);
  try{const r=await fetch('/admin/api/upload/homebrew',{method:'POST',headers:{Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'},body:fd});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
    toast(topFill('t.hbReplacedToast',{name,old:d.replaced}));loadHomebrew();}
  catch(err){toast(err.message);}}
// Tool or port: a port (a program brought over from another system) is listed apart by the client.
function hbKind(id,kind){const sel=el('select');sel.setAttribute('aria-label','분류');
  for(const [v,t] of [['tool','도구'],['port',topText('u.kPort')]]){const o=el('option',t);o.value=v;if(v===kind)o.selected=true;sel.append(o);}
  sel.addEventListener('change',async()=>{try{await api('/admin/api/homebrew/kind',{method:'POST',body:{id,kind:sel.value}});toast(sel.value==='port'?'포트로 옮겼습니다.':'도구로 옮겼습니다.');}catch(err){toast(err.message);loadHomebrew();}});
  return sel;}
// CPU cores for the app's HOME-menu shortcut: 4 only for an app that starts a thread on core 3.
function hbCores(id,cores,name){const sel=el('select','', 'hb-cores');sel.setAttribute('aria-label',name+' 바로가기 CPU 코어');
  for(const [v,t] of [[3,'코어 3 (기본)'],[4,'코어 4']]){const o=el('option',t);o.value=String(v);if(v===cores)o.selected=true;sel.append(o);}
  sel.addEventListener('change',async()=>{const want=Number(sel.value);
    if(want===4&&!await ask('코어 3 은 시스템 서비스와 같이 씁니다. 코어 3 에 스레드를 만드는 앱에만 켭니다. 아무 앱에나 켜면 기기가 느려지거나 불안정할 수 있습니다.')){sel.value='3';return;}
    try{await api('/admin/api/homebrew/cores',{method:'POST',body:{id,cores:want}});toast(want===4?'바로가기를 코어 4 로 다시 만듭니다.':'바로가기를 기본 코어로 다시 만듭니다.');}catch(err){toast(err.message);loadHomebrew();}});
  return sel;}
let hbDescId=null;
function editHbDesc(id,name,d){hbDescId=id;
  $('hb-desc-title').textContent=name+' 설명';
  $('hb-desc-hint').textContent=d?.github?'비워 두고 저장하면 설명 없이 보여 줍니다. GitHub 기본값: '+d.github:'비워 두고 저장하면 설명 없이 보여 줍니다.';
  $('hb-desc-en').value=d?.custom?(d.custom.en||''):(d?.github||'');$('hb-desc-ko').value=d?.custom?.ko||'';
  $('hb-desc-reset').hidden=!d?.github;$('hb-desc').showModal();}
$('hb-desc-close').addEventListener('click',()=>$('hb-desc').close());
$('hb-desc-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/homebrew/description',{method:'POST',body:{id:hbDescId,en:$('hb-desc-en').value,ko:$('hb-desc-ko').value}});
    $('hb-desc').close();toast('설명을 저장했습니다.');loadHomebrew();}catch(err){toast(err.message);}});
$('hb-desc-reset').addEventListener('click',async()=>{if(!await ask('직접 쓴 설명을 지우고 GitHub 설명으로 되돌립니다.',{danger:true}))return;
  try{await api('/admin/api/homebrew/description/reset',{method:'POST',body:{id:hbDescId}});$('hb-desc').close();toast('GitHub 기본값으로 돌렸습니다.');loadHomebrew();}catch(err){toast(err.message);}});
async function addHbRecommended(repos){
  if(!repos.length){toast('추가할 것을 고릅니다.');return;}
  try{const r=await api('/admin/api/homebrew/recommended',{method:'POST',body:{repos}});
    toast(r.added.length+'개를 추가했습니다. 첫 빌드를 받는 동안 잠시 걸립니다.');loadHomebrew();setTimeout(loadHomebrew,8000);}catch(err){toast(err.message);}}
$('hb-add-picked').addEventListener('click',()=>{const repos=[...hbPicked];hbPicked.clear();addHbRecommended(repos);});
$('hb-add-all').addEventListener('click',async()=>{if(!await ask('추천 홈브류를 모두 추가합니다.'))return;
  hbPicked.clear();addHbRecommended(hbReco.filter((r)=>!r.added).map((r)=>r.repo));});
$('hb-add').addEventListener('submit',async(e)=>{e.preventDefault();const b=e.submitter;if(b)b.disabled=true;
  try{const s=await api('/admin/api/homebrew',{method:'POST',body:{repo:$('hb-repo').value,asset:$('hb-asset').value}});
    $('hb-repo').value='';$('hb-asset').value='';toast(s?.error?'추가했지만 확인하지 못했습니다: '+s.error.message:'추가했습니다.');loadHomebrew();}
  catch(err){toast(err.message);}finally{if(b)b.disabled=false;}});
async function setHbAsset(repo,asset){
  try{const s=await api('/admin/api/homebrew/asset',{method:'POST',body:{repo,asset}});toast(s?.error?s.error.message:'쓸 파일을 변경했습니다.');loadHomebrew();}catch(err){toast(err.message);}}
async function checkHb(repo){
  try{const s=await api('/admin/api/homebrew/check',{method:'POST',body:{repo}});toast(s?.error?s.error.message:'확인했습니다.');loadHomebrew();}catch(err){toast(err.message);}}
$('hb-check-all').addEventListener('click',async()=>{const b=$('hb-check-all');b.disabled=true;
  try{await api('/admin/api/homebrew/check',{method:'POST',body:{}});toast('모두 확인했습니다.');loadHomebrew();}catch(err){toast(err.message);}finally{b.disabled=false;}});
$('hb-rescan').addEventListener('click',async()=>{const b=$('hb-rescan');b.disabled=true;
  try{await api('/admin/api/homebrew/rescan',{method:'POST',body:{}});toast('홈브류 폴더를 다시 읽습니다. 끝나면 목록이 바뀝니다.');}
  catch(err){toast(err.message);}finally{b.disabled=false;}});
$('hb-adopt').addEventListener('click',async()=>{const b=$('hb-adopt');b.disabled=true;
  try{const r=await api('/admin/api/homebrew/adopt',{method:'POST',body:{}});
    toast(r.registered.length?r.registered.join(', ')+' 를 등록했습니다.':'새로 등록할 폴더가 없습니다.'+(r.skipped.length?' 건너뜀: '+r.skipped.map((x)=>x.folder+' ('+x.reason+')').join(', '):''));loadHomebrew();}
  catch(err){toast(err.message);}finally{b.disabled=false;}});
async function removeHb(repo){if(!await ask(repo+' 를 더 따라가지 않고 받아 둔 파일도 삭제합니다.',{danger:true}))return;
  try{await api('/admin/api/homebrew/remove',{method:'POST',body:{repo}});toast(topText('pp.deleted'));loadHomebrew();}catch(err){toast(err.message);}}



`;
