/**
 * Browser script for the /admin dashboard (inlined into the page).
 * Plain DOM, no framework: the page must work on an offline LAN box.
 */
import { guessUpload } from "./upload-guess.js";
import { failureKind, hasBatches, splitUnits, tally, tallyFiles, trimHistory, unitsToSend } from "./upload-flow.js";
import { COMMON_SCRIPT } from "./common-script.js";
import { CHROME_SCRIPT } from "./chrome-script.js";
import { PEOPLE_SCRIPT } from "./people-script.js";
import { LOGS_SCRIPT } from "./logs-pages.js";

// The helpers every page shares (element, format, ask, toast, api, pagedTable)
// live in common-script.js: this whole-page script inlines them first, and the
// split pages of the admin redesign inline the same block on their own.
export const DASHBOARD_SCRIPT = /* js */ `
${COMMON_SCRIPT}
${CHROME_SCRIPT}
${LOGS_SCRIPT}
${PEOPLE_SCRIPT}


// ── tabs ──────────────────────────────────────────────────────────────
// why a zip was served as its single .nro instead of a whole folder
// why files of a release were left out of the install
const HB_EXCLUDED={'outside-switch':'switch 폴더 밖','other-app':'다른 앱 폴더','other-folder':'앱 폴더 밖','junk':'설명서와 시스템 파일','foreign-file':'다른 기기용 실행 파일','doc':'PC 용 설치 안내문'};
const HB_REASON={'not-one-folder':'zip 안이 switch/<앱>/ 폴더 하나로 되어 있지 않습니다','too-many-files':'파일이 너무 많습니다','several-nro':'nro 가 여러 개입니다','no-nro':'nro 가 없습니다','only-nro':'폴더에 nro 하나뿐입니다','link':'링크가 들어 있습니다','unsafe-path':'쓸 수 없는 이름이나 경로가 있습니다','foreign-file':'다른 기기용 실행 파일이 섞여 있습니다','nro-release':'릴리스가 nro 파일 하나입니다','partial':'일부 파일을 빼고 설치합니다'};
// Six menus like the console's sidebar; the pages of the chosen one sit in the row under it.
// A menu remembers its last page, so coming back lands where the admin left it.
// The sidebar (admin-pages.js) owns the menu tree now, so with no group row the
// call just asks the sidebar to mark the current item.
const GROUP_LAST={};
function showGroup(tab){const bar=$('group-tabs');
  if(!bar){if(window.__admMark)window.__admMark();return;}
  const g=document.querySelector('#group-tabs [data-tab="'+tab+'"]').dataset.in;GROUP_LAST[g]=tab;
  const pages=[...document.querySelectorAll('#group-tabs [data-in="'+g+'"]')];
  for(const a of document.querySelectorAll('#group-tabs a'))a.hidden=a.dataset.in!==g||pages.length<2;
  $('group-tabs').hidden=pages.length<2;
  for(const a of document.querySelectorAll('nav.tabs [data-group]')){const on=a.dataset.group===g;
    if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    a.setAttribute('href','#'+(GROUP_LAST[a.dataset.group]||a.getAttribute('href').slice(1)));}}
// A menu shows the sum of its pages' counts, so a pending device is seen from any page.
function sumGroupCounts(){if(!$('group-tabs'))return;
  for(const c of document.querySelectorAll('nav.tabs [data-sum]')){let n=0;
  for(const x of document.querySelectorAll('#group-tabs [data-in="'+c.dataset.sum+'"] .count'))if(!x.hidden)n+=Number(x.textContent)||0;
  c.textContent=n;c.hidden=!n;}}
if($('group-tabs'))new MutationObserver(sumGroupCounts).observe($('group-tabs'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
const TABS=['overview','users','devices','settings','alerts','logs','featured','library','nsz','upload','inbox','homebrew','retro','trash'];
function showTab(){const [want,sub]=location.hash.slice(1).split('/');const tab=TABS.includes(want)?want:'overview';
  if(tab==='library'&&sub)libShowSub(sub,true);
  if(tab==='settings')setShowSub(sub||setSub,true);
  if(SUBTABS[tab])SUBTABS[tab].show(sub||SUBTABS[tab].cur);
  for(const name of TABS){$('tab-'+name).hidden=name!==tab;
    const a=document.querySelector('#group-tabs [data-tab="'+name+'"]');
    if(a){if(name===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}}
  showGroup(tab);
  if(tab==='library')loadLibrary();
  if(tab==='overview')loadClientRelease();
  if(tab==='settings')setLoadSub();
  if(tab==='logs'){loadClientLogs();setTimeout(xfOpen);
    if(window.__admLogs){logsShowSub(window.__admLogs);window.__admLogs=null;}}
  if(tab==='alerts')loadAlerts();
  if(tab==='homebrew')loadHomebrew();
  // After the whole script has run: the retro panel's state is declared further down.
  if(tab==='retro')setTimeout(retroOpen);
  if(tab==='featured')loadFeatured();
  if(tab==='upload')loadUpload();
  if(tab==='inbox')loadInbox();
  if(tab==='nsz')setTimeout(loadNsz);
  // Declared further down, with the trash panel.
  if(tab==='trash')setTimeout(loadTrash);}
addEventListener('hashchange',showTab);
// Tabs inside a tab that only show and hide: #devices/approved opens a given area, the area last opened stays.
// Sub-tab bars are wired by the shared subtabs() in common-script.js.
for(const tab of ['users','devices','homebrew','alerts'])subtabs(tab);
// The settings tab shows one area at a time and loads only that one: #settings/security opens a given area.
const SET_SUBS=['server','integrations','security','tokens'];let setSub='server';
function setLoadSub(){
  if(setSub==='server')loadServerSettings();else if(setSub==='integrations')loadIntegrations();
  else if(setSub==='security'){loadTfa();loadGoogle();}else if(setSub==='tokens'){loadTokens();loadMcp();}}
function setShowSub(sub,quiet){if(!SET_SUBS.includes(sub))return;setSub=sub;
  for(const b of document.querySelectorAll('#set-subtabs [data-ssub]'))b.setAttribute('aria-selected',String(b.dataset.ssub===sub));
  for(const p of document.querySelectorAll('#tab-settings [data-set-panel]'))p.hidden=p.dataset.setPanel!==sub;
  if(!quiet)setLoadSub();}
for(const b of document.querySelectorAll('#set-subtabs [data-ssub]'))b.addEventListener('click',()=>{history.replaceState(null,'','#settings/'+b.dataset.ssub);setShowSub(b.dataset.ssub);});


// ── overview + users + security (one stats call) ──────────────────────
let origin=location.origin;
// The server reports warnings by code (in English for its log); here each says what to do, with a button to the place to do it.
const WARNINGS={
  'storage-kept':{t:'일부 폴더를 아직 옛 위치에서 읽습니다',d:(w)=>'저장 폴더가 연결됐지만 아래 폴더는 옛 위치에 파일이 남아 있어 그대로 씁니다. 내용을 저장 폴더 안의 같은 이름 폴더로 옮기고 옛 마운트를 빼면 저장 폴더 하나로 정리됩니다. '+(w.paths||[]).map((p)=>p.now+' → '+p.want).join(', ')},
  'old-incoming':{t:'게임 폴더 안의 옛 incoming 에 파일이 남아 있습니다',d:(w)=>'새 incoming 에 같은 이름이 있거나 다른 디스크라 옮기지 못했습니다. 직접 옮기기 전에는 목록에도 정리에도 들어가지 않습니다. '+(w.paths||[]).map((p)=>p.now+' → '+p.want).join(', ')},
  'no-prod-keys':{t:'prod.keys 가 없어 스위치 게임 파일을 분석할 수 없습니다',d:'지금은 파일 이름의 [타이틀ID][vN] 로만 게임을 알아봅니다. 이름에 ID 가 없는 파일은 어떤 게임인지 모르고, 파일에서 이름과 아이콘 읽기, NSZ 변환, 홈 화면 바로가기를 쓸 수 없습니다. 레트로, 홈브류, 세이브, 패치는 그대로 씁니다. 설정 탭에서 자기 기기에서 덤프한 prod.keys 를 올리면 다시 시작하지 않아도 바로 적용됩니다.',go:['설정에서 올리기','settings']},
  'admin-2fa-skipped':{t:'2단계 인증 없이 관리 페이지가 열립니다',d:'셋업에서 인증 앱을 건너뛰어 관리자 계정 비밀번호만 알면 누구든 이 서버를 관리할 수 있습니다. 설정 탭에서 인증 앱을 등록합니다.',go:['설정에서 등록','settings/security']},
  'admin-unenrolled':{t:'관리 페이지 2단계 인증이 아직 등록되지 않았습니다',d:'인증 앱을 등록하면 관리자 비밀번호 다음에 6자리 코드를 한 번 더 묻습니다. 설정 탭에서 QR 을 찍어 등록합니다.',go:['설정에서 등록','settings/security']},
  'admin-authenticator-optional':{t:'관리 페이지는 관리자 비밀번호로만 들어갑니다',d:'인증 앱을 등록하면 비밀번호 대신 6자리 코드로도 들어갈 수 있습니다. 꼭 해야 하는 것은 아닙니다.',go:['설정에서 등록','settings/security']},
  'no-auth':{t:'주소를 아는 누구나 서버에 접속할 수 있습니다',d:'계정이 없고 기기 승인도 꺼져 있습니다. 계정 탭에서 계정을 하나 만들면 그때부터 로그인이 필요합니다.',go:['계정 만들기','users']},
  'proxy-collapse':{t:'프록시를 거쳐 오는데 COOK_TRUST_PROXY 가 없습니다',d:'모든 접속이 프록시 하나의 IP 로 보여 한 사람의 로그인 실패가 모두를 잠글 수 있습니다. compose 에 COOK_TRUST_PROXY 를 넣고 프록시가 X-Forwarded-For 를 넘기게 합니다.'},
  'both-lanes':{t:'계정과 기기 승인을 함께 씁니다',d:'콘솔은 승인된 기기 키로 접속하고, 대시보드는 계정으로 로그인합니다.'},
};
function renderWarnings(list){const box=$('warnings');box.replaceChildren();
  for(const w of list){const k=WARNINGS[w.code];const n=el('div',null,'note'+(w.severity==='warn'?' warn':''));
    n.append(el('div',k?.t??w.title,'t'),el('div',(typeof k?.d==='function'?k.d(w):k?.d)??w.detail,'d'));
    if(k?.go){const b=btn(k.go[0],()=>{location.hash='#'+k.go[1];});b.classList.add('note-go');n.append(b);}
    box.append(n);}}
function renderLanes(l){const box=$('lanes');box.replaceChildren();
  box.append(pill('계정: '+(l.accounts.enabled?l.accounts.userCount+'명':'없음'),l.accounts.enabled?'on':'off'));
  box.append(pill('기기 승인: '+(l.pairing.enabled?'켜짐':'꺼짐'),l.pairing.enabled?'on':''));
  if(l.pairingOnly)box.append(pill('승인된 기기만 받을 수 있음','warn'));
  box.append(pill('관리자 2단계 인증: '+(l.admin.enrolled?'등록됨':'등록 안 됨'),l.admin.enrolled?'on':'off'));}
// Where game names come from (titledb, the files' own data): the operator's view of what the web page used to show.
async function loadHealth(){
  let nh=null;try{const r=await fetch('/healthz',{headers:{Accept:'application/json'}});nh=(await r.json().catch(()=>null))?.nameHealth;}catch{}
  const box=$('health');box.replaceChildren();if(!nh)return;
  const v=nh.verdict==='filename-only'?['게임 이름: 파일 이름으로 대신하는 중','off']:nh.verdict==='degraded'?['게임 이름: 일부만 찾음','warn']:['게임 이름: 정상','on'];
  box.append(pill(v[0],v[1]));
  const tdb=nh.titledb||{};box.append(pill('titledb '+num(tdb.titles||0)+'개'+((tdb.regions||[]).length?' · 지역 '+tdb.regions.length+'곳':''),(tdb.titles||0)>0?'on':'off'));
  const ex=nh.extraction||{};
  box.append(pill('NSP/XCI 추출: '+(ex.mode==='off'?'꺼짐':!ex.nstool?'nstool 없음':!ex.prodKeys?'prod.keys 없음':'켜짐 · 키 확인됨'),ex.nspXciCapable?'on':'off'));
  const hint=$('health-hint');hint.hidden=nh.verdict!=='filename-only';
  hint.textContent='titledb 를 받지 못했고 서버에 prod.keys 도 없어 파일 이름으로 게임 이름을 대신합니다. 서버가 github 에 닿게 하거나 prod.keys 를 넣습니다.';}
function renderCards(d){const cards=$('cards');cards.replaceChildren();
  const card=(l,v,alert)=>{const c=el('div',null,'card'+(alert?' alert':''));c.append(el('div',num(v),'v'),el('div',l,'l'));return c;};
  cards.append(card('사용자',d.totals.configuredUsers),card('누적 요청',d.totals.totalRequests),
    card('차단된 IP',d.totals.lockouts,d.totals.lockouts>0),card('24시간 거부',d.totals.denied24h,d.totals.denied24h>0));}
async function loadStats(){
  const d=await api('/admin/api/stats');
  me=d.me||null;const a=d.lanes.admin;
  $('who').textContent=me?(me.name||me.email):(a.email||a.owner||'admin');acctAvatar(me?.avatar);
  $('ts').textContent=fmt(d.generatedAt)+' 기준';
  renderWarnings(d.warnings||[]);renderLanes(d.lanes);renderCards(d);renderUsers(d.users||[]);renderSecurity(d);loadHealth();}

// The users, Google accounts, devices and issued-clients behaviour lives in
// The one-time credential dialog lives in people-script.js.
const mb=(n)=>n==null?'—':(n/1048576).toFixed(1)+' MB';
async function loadHomebrew(){
  const d=await api('/admin/api/homebrew');
  const reco=$('hb-reco');hbReco=d.recommended||[];
  paged(reco,{key:'hb-reco',label:'추천 홈브류',def:12,items:d.recommended||[],
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
    if(!folder&&HB_REASON[s.install.reason])how.title=HB_REASON[s.install.reason];
    pills.append(how);
    for(const x of s.install.excluded||[])st.append(el('div','일부 파일 제외('+(HB_EXCLUDED[x.rule]||x.rule)+'): '+x.paths.join(', '),'muted'));
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
    for(const it of items){const line=el('div',null,'xline');line.append(el('em',type==='patch'?'패치':'세이브','hb-xk'),el('span',it.name+' · '+mb(it.size)));
      line.append(verifyPill(it.name,it.verified,async(next)=>{
        try{await api('/admin/api/content/'+type+'/verified',{method:'POST',body:{id:it.id,verified:next}});toast(next?it.name+' 에 검수됨 배지를 붙였습니다.':it.name+' 의 검수됨 배지를 뗐습니다.');}
        catch(err){toast(err.message);}loadHbApps();}));
      if(type==='patch'){const e=btn('편집',()=>ctOpen('patch',it,loadHbApps));e.setAttribute('aria-label',it.name+' 편집');line.append(e);}
      const x=btn('삭제',()=>removeHbExtra(type,it.id,it.name),'danger');x.setAttribute('aria-label',it.name+' 삭제');line.append(x);c.append(line);}
    return c;};
  paged($('hb-apps'),{key:'hb-apps',label:'앱',def:24,items:d.apps||[],
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
  if(a.app)for(const [txt,type,short] of [['패치 올리기','patch','패치'],['세이브 올리기','save','세이브']]){
    const u=btn(txt,()=>uploadFor(type,a.app),'hb-up');u.querySelector('span').textContent=short;foot.append(u);}
  foot.append(btn('설명',()=>editHbDesc(a.id,name,desc)),btn('그림',()=>openHbBanner(a)));
  if(a.replaceable)foot.append(btn(topText('t.hbReplace'),()=>pickHbFile(a,name)));
  if(a.source==='manual')foot.append(btn('GitHub 연결',()=>linkHb(a)),btn('삭제',()=>removeManualHb(a.id,name),'danger'));
  else if(repo)foot.append(btn('지금 확인',()=>checkHb(repo)),btn('빼기',()=>removeHb(repo),'danger'));
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
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'올리지 못했습니다');done++;}
    catch(err){st.textContent=file.name+': '+err.message;break;}}
  if(done===files.length)st.textContent=done+'장을 올렸습니다.';await hbMediaReload();});
$('hb-banner-remove').addEventListener('click',async()=>{if(!await ask('배경 그림을 뺍니다. 포트도 다시 자동으로 채우지 않습니다.',{danger:true}))return;
  try{await api('/admin/api/homebrew/banner/remove',{method:'POST',body:{id:hbBannerApp.id}});toast('배경 그림을 뺐습니다.');await hbMediaReload();}catch(err){toast(err.message);}});
$('hb-banner-file').addEventListener('change',async()=>{const file=$('hb-banner-file').files[0];$('hb-banner-file').value='';if(!file)return;
  $('hb-banner-state').textContent='올리고 있습니다';
  try{const r=await fetch('/admin/api/homebrew/banner/upload?id='+encodeURIComponent(hbBannerApp.id),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream',Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'},body:file});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'올리지 못했습니다');toast('배경 그림을 올렸습니다.');await hbMediaReload();}
  catch(err){$('hb-banner-state').textContent=err.message;}});
async function removeHbExtra(type,id,name){if(!await ask(topFill(type==='patch'?'t.askPatch':'t.askSave',{name}),{danger:true}))return;
  try{await api('/admin/api/homebrew/extra/remove',{method:'POST',body:{type,id}});toast(topText('t.movedToast'));loadHbApps();}catch(err){toast(err.message);}}
async function setHbEnabled(id,enabled,name){
  try{await api('/admin/api/homebrew/enabled',{method:'POST',body:{id,enabled}});toast(enabled?name+' 을(를) 다시 보여 줍니다.':name+' 을(를) 기기 목록에서 뺐습니다. 서버에는 남아 있습니다.');loadHbApps();}
  catch(err){toast(err.message);loadHbApps();}}
// A pill, not a second switch beside 켜기: green with a shield once someone tried the item on a console.
// Patch and save rows use it too; onClick gets the value to set.
function verifyPill(name,on,onClick){const b=el('button',null,'hb-verify');b.type='button';
  b.setAttribute('aria-pressed',String(Boolean(on)));b.setAttribute('aria-label',name+' 검수됨');
  b.title=on?'눌러서 검수됨 배지를 뗍니다':'기기에서 돌려 봤으면 눌러서 검수됨 배지를 붙입니다';
  b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg>';b.append(el('span',on?'검수됨':'검수 전'));
  b.addEventListener('click',()=>{b.disabled=true;onClick(!on);});return b;}
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
let upPending=null;
function uploadFor(kind,app){upPending={kind,app};if(location.hash==='#upload')loadUpload();else location.hash='upload';}
// Tool or port: a port (a program brought over from another system) is listed apart by the client.
function hbKind(id,kind){const sel=el('select');sel.setAttribute('aria-label','분류');
  for(const [v,t] of [['tool','도구'],['port','포트']]){const o=el('option',t);o.value=v;if(v===kind)o.selected=true;sel.append(o);}
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
  try{await api('/admin/api/homebrew/remove',{method:'POST',body:{repo}});toast('삭제했습니다.');loadHomebrew();}catch(err){toast(err.message);}}



// ── upload ────────────────────────────────────────────────────────────
// The page opens on the file chooser. What the names say is a suggestion shown next to it; the
// kinds and consoles only appear once files are picked, and only as many as the suggestion needs.
const upT=(k,v)=>{let s=topText('u.'+k);if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
const UP_KIND_KEY={game:'kGame',patch:'kPatch',save:'kSave',homebrew:'kHomebrew',port:'kPort',client:'kClient',retro:'kRetro'};
const UP_HINT_KEY={game:'hGame',retro:'hRetro',patch:'hPatch',save:'hSave',homebrew:'hHomebrew',client:'hClient',port:'hPort'};
let upKind=null,upInfo=null,upFiles=[],upPaths=null,upSystems=[],upGuess=null,upPreset=false,upOpen=false,upAllSys=false,upBusy=false;
let upUnits=[],upHistory=[],upDone=[];
${guessUpload.toString()}
${splitUnits.toString()}
${unitsToSend.toString()}
${tally.toString()}
${failureKind.toString()}
${tallyFiles.toString()}
${hasBatches.toString()}
${trimHistory.toString()}
// The entry names of a .zip, read from its central directory (no unpacking); null when it can't be read.
async function zipNames(file){
  try{const tail=Math.min(file.size,65557);const v=new DataView(await file.slice(file.size-tail).arrayBuffer());
    let end=-1;for(let i=tail-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
    if(end<0)return null;
    const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),off=v.getUint32(end+16,true);
    if(off===0xffffffff||size>8e6)return null;
    const cd=new DataView(await file.slice(off,off+size).arrayBuffer());const dec=new TextDecoder();const out=[];
    for(let p=0,i=0;i<count&&p+46<=size;i++){
      if(cd.getUint32(p,true)!==0x02014b50)return null;
      const nl=cd.getUint16(p+28,true),xl=cd.getUint16(p+30,true),cl=cd.getUint16(p+32,true);
      out.push(dec.decode(new Uint8Array(cd.buffer,p+46,nl)));p+=46+nl+xl+cl;}
    return out;}catch{return null;}}
// Files dropped on the page, with their paths when a folder was among them.
async function droppedFiles(dt){
  const entries=[...dt.items].map((i)=>i.webkitGetAsEntry?i.webkitGetAsEntry():null).filter(Boolean);
  const plain=[...dt.files];
  if(!entries.length||entries.every((x)=>x.isFile))return {files:plain,paths:null};
  const files=[],paths=[];
  const read=(r)=>new Promise((res,rej)=>r.readEntries(res,rej));
  async function walk(en,pre){
    if(en.isFile){files.push(await new Promise((res,rej)=>en.file(res,rej)));paths.push(pre+en.name);return;}
    const r=en.createReader();for(let b=await read(r);b.length;b=await read(r))for(const x of b)await walk(x,pre+en.name+'/');}
  for(const en of entries)await walk(en,'');
  return {files,paths};}
const upSysName=(id)=>(upInfo?.systems||[]).find((x)=>x.id===id)?.name||'';
function upKindName(kind){const sys=upSysName($('up-system').value);return kind==='retro'&&sys?upT('kRetro')+' · '+sys:upT(UP_KIND_KEY[kind]);}
// What the names say that the chosen kind (or console) does not match; '' when they agree or say nothing.
function upMismatch(){
  if(!upGuess||!upGuess.kind||!upKind)return '';
  const same=upGuess.kind===upKind||(upKind==='port'&&upGuess.kind==='homebrew');
  if(!same)return upKindName(upGuess.kind);
  const sys=$('up-system').value;
  if(upKind==='retro'&&sys&&upSystems.length&&!upSystems.includes(sys))return upSystems.map(upSysName).join(', ');
  return '';}
function upPlanText(){
  const app=$('up-target').value;
  if(!upKind)return '';
  if(upKind==='game')return upT('pGame',{n:upFiles.length||1});
  if(upKind==='retro'){const s=upSysName($('up-system').value);return s?upT('pRetro',{sys:s}):upT('pRetroNone');}
  if(upKind==='patch')return upT(app?'pPatchApp':'pPatch');
  if(upKind==='save')return upT(app?'pSaveApp':'pSave');
  return upT({homebrew:'pHomebrew',port:'pPort',client:'pClient'}[upKind]);}
function upHintText(){
  if(!upKind)return '';
  const app=$('up-target').value;
  let h=app&&(upKind==='patch'||upKind==='save')?upT(upKind==='patch'?'hPatchApp':'hSaveApp'):upT(UP_HINT_KEY[upKind]);
  if(upKind==='game'&&upFiles.length>1)h+=' '+upT('seq',{n:upFiles.length});
  return h;}
// One place draws the whole page from its state, so a language switch or a retry never leaves part of it stale.
function upRender(){
  const n=upFiles.length,size=upFiles.reduce((a,f)=>a+f.size,0),sys=$('up-system').value;
  $('up-drop').classList.toggle('has',n>0);
  $('up-drop-t').textContent=upT(n?'dropT2':'dropT');
  $('up-chosen').textContent=n?(upPaths?upPaths[0].split('/')[0]+'/ · ':'')+(n===1?upFiles[0].name:upT('filesN',{n}))+' · '+(size/1048576).toFixed(1)+' MB':'';
  $('up-lead').hidden=n>0||upPreset;
  $('up-form').hidden=!(n||$('up-target').value);
  // The suggestion and the choices.
  const showGuess=n>0&&!upPreset;
  const forced=!upKind||(upKind==='retro'&&!sys);
  const chooser=showGuess&&(upOpen||forced);
  $('up-guess').hidden=!showGuess;$('up-kinds').hidden=!chooser;
  $('up-change').hidden=forced;$('up-change').textContent=upT(chooser?'fold':'change');
  $('up-change').setAttribute('aria-expanded',String(chooser));
  const mm=upMismatch();
  let gt='',warn=false;
  if(showGuess){
    if(mm){gt=upT('mismatch',{kind:mm});warn=true;}
    else if(upGuess&&upGuess.mixed){gt=upT('guessMixed');warn=!upKind;}
    else if(!upKind){gt=upT('guessUnknown');warn=true;}
    else if(upGuess&&upGuess.kind===upKind&&upKind==='retro'&&upSystems.length>1&&!sys){gt=upT('guessAmbig');warn=true;}
    else if(upGuess&&(upGuess.kind===upKind||(upKind==='port'&&upGuess.kind==='homebrew')))gt=upT('guessed',{kind:upKindName(upKind)});
    else gt=upT('picked',{kind:upKindName(upKind)});}
  $('up-guess-t').textContent=gt;$('up-guess').classList.toggle('warn',warn);
  // Kind buttons: a console tile is pressed only when that console is the chosen one.
  for(const b of document.querySelectorAll('#up-kinds [data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===upKind&&(!b.dataset.system||b.dataset.system===sys)));
  const retro=chooser&&upKind==='retro';$('up-systems-wrap').hidden=!retro;
  const folded=upKind==='retro'&&Boolean(sys)&&!upAllSys,cands=upKind==='retro'&&!sys&&upSystems.length>0&&!upAllSys;
  $('up-systems').classList.toggle('folded',folded);$('up-systems').classList.toggle('cands',cands);
  for(const b of $('up-systems').querySelectorAll('[data-system]'))b.classList.toggle('cand',upSystems.includes(b.dataset.system));
  const more=$('up-systems').querySelector('.up-more-sys');if(more){more.textContent=upT('otherSys');more.hidden=!(folded||cands);}
  // The form.
  const ps=upKind==='patch'||upKind==='save';
  $('up-name-l').hidden=$('up-target-l').hidden=!ps;
  $('up-game-l').hidden=!ps||$('up-target').value!=='';
  $('up-desc-l').hidden=!ps;
  $('up-savetype-l').hidden=!(upKind==='save'&&$('up-target').value==='');
  $('up-required-l').hidden=!(upKind==='patch'&&$('up-target').value==='');
  $('up-hint').textContent=upHintText()+(upPreset&&n&&mm?' '+upT('mismatch',{kind:mm}):'');
  $('up-plan').textContent=upPlanText();
  const w=upKind&&upInfo&&upInfo.targets[upKind==='port'?'homebrew':upKind];$('up-note').replaceChildren();
  if(w&&!w.writable){const nt=el('div',null,'note warn');
    nt.append(el('div',w.exists===false?'이 종류를 받을 폴더가 서버에 없습니다':'이 폴더는 지금 쓸 수 없습니다','t'),
      el('div',w.exists===false?'compose 에서 이 폴더를 마운트하고 컨테이너를 다시 띄웁니다. 폴더 위치는 README 의 폴더 설명을 봅니다.'
        :'compose 에서 이 폴더 마운트의 read_only 를 false 로 바꾸고 컨테이너를 다시 띄웁니다.','d'));$('up-note').append(nt);}
  const failed=upUnits.filter((u)=>u.state==='fail').length;
  $('up-go').textContent=failed&&!upBusy?upT('goRetry',{n:failed}):upT('go');
  $('up-go').disabled=upBusy||!(w&&w.writable)||(upKind==='retro'&&!sys);$('up-clear').disabled=upBusy;$('up-clear').textContent=upT('reset');
  // The result of the batch on screen.
  // The batch on screen, or the one that just finished: its summary stays through a language switch.
  const shown=upUnits.length?upUnits:upDone;const t=tally(shown);const sum=$('up-sum');sum.hidden=!shown.length;
  if(shown.length)sum.textContent=upSumText(shown)+(upUnits.length&&t.fail&&t.ok&&!upBusy?'. '+upT('rKeep'):'');
  // While files are going up nothing that decides where they go can be changed.
  for(const b of document.querySelectorAll('#up-kinds button,#up-change,#up-file-btn,#up-dir-btn'))b.disabled=upBusy;
  for(const id of ['up-target','up-game','up-name','up-desc','up-desc-ko','up-savetype','up-required'])$(id).disabled=upBusy;
  $('up-drop').setAttribute('aria-disabled',String(upBusy));
  for(const u of upHistory)upPaint(u);}
// Counts in files when a request carries several (a folder, a disc set), else in requests; never invented per file.
const upFilesT=(n)=>n===1?upT('f1',{n}):upT('fN',{n});
const upBatchesT=(n,f)=>upT('bf',{b:n===1?upT('b1',{n}):upT('bN',{n}),f:upFilesT(f)});
function upSumText(units){const t=tally(units);
  if(!hasBatches(units))return upT('rSum',t)+(t.wait?upT('rSumWait',t):'');
  const f=tallyFiles(units);
  return upT('sumB',{ok:upBatchesT(t.ok,f.ok),fail:upBatchesT(t.fail,f.fail)})+(t.wait?upT('sumBWait',{wait:upBatchesT(t.wait,f.wait)}):'');}
function upTrim(){for(const u of trimHistory(upHistory,upUnits.length?upUnits:upDone,50)){u.row?.remove();upHistory.splice(upHistory.indexOf(u),1);}}
// One result row per request, updated in place as it goes from waiting to sent or failed.
function upPaint(u){
  if(!u.row){u.row=el('div',null,'note');u.row.setAttribute('role','listitem');$('up-log').prepend(u.row);}
  const ok=u.state==='ok',fail=u.state==='fail';
  u.row.className='note'+(fail?' warn':'');
  const head=ok?upT('rOk'):fail?upT('rFail'):upT(u.state==='busy'?'rBusy':'rWait');
  const kids=[el('div',head+' · '+u.label,'t')];
  if(u.files.length>1){const det=el('details',null,'d');det.append(el('summary',upT('rList',{n:u.files.length})));
    for(const [i,f] of u.files.entries())det.append(el('div',u.paths?u.paths[i]:f.name));
    kids.push(det,el('div',upT('rUnit'),'d'));}
  if(ok){const d=u.d||{};
    kids.push(el('div',upT('rWhere',{where:d.where,files:upFilesT(d.files)})+(d.kind==='port'?' · '+upT('rPort'):''),'d'));
    if(d.install){for(const x of d.install.excluded||[])kids.push(el('div',upT('rExcl',{rule:HB_EXCLUDED[x.rule]||x.rule,paths:x.paths.join(', ')}),'d'));
      if(d.install.rules?.length)kids.push(el('div',upT('rBasis',{rules:d.install.rules.join(' · ')}),'d'));}}
  if(fail){const why=failureKind(u.status,u.code);
    kids.push(el('div',why==='net'?upT('rNet'):(u.msg||('HTTP '+u.status)),'d'));
    if(why==='dup')kids.push(el('div',upT('rDup'),'d'));
    if(upUnits.includes(u)&&!upBusy){const row=el('div',null,'row-actions');const b=el('button',upT('rRetry'));b.type='button';
      b.addEventListener('click',()=>upSubmit([u]));row.append(b);kids.push(row);}}
  u.row.replaceChildren(...kids);}
function upSetKind(kind,fromUser){
  if(fromUser)upDropBatch();
  upKind=kind;upRender();}
// A batch that was partly sent is over once the kind changes: what went up stays up, the rest is picked again.
function upDropBatch(){
  if(upBusy||!upUnits.length)return;
  const rest=unitsToSend(upUnits);
  if(rest.length<upUnits.length){upFiles=rest.flatMap((u)=>u.files);if(!rest.some((u)=>u.paths))upPaths=null;}
  upUnits=[];}
async function loadUploadInfo(){
  if(upInfo)return true;
  try{upInfo=await api('/admin/api/upload/targets');}catch(e){toast(e.message);return false;}
  $('up-system').replaceChildren(...upInfo.systems.map((s)=>{const o=el('option',s.name+' ('+s.extensions.join(' ')+')');o.value=s.id;return o;}));
  // Every retro console is its own tile, so a ROM goes where it was meant to and not where its extension guesses.
  $('up-systems').replaceChildren(...upInfo.systems.map((s)=>{const b=el('button');b.type='button';b.dataset.kind='retro';b.dataset.system=s.id;
    const im=el('img');im.alt='';im.loading='lazy';im.src='/api/retro/systems/'+encodeURIComponent(s.id)+'/icon';im.onerror=()=>im.style.visibility='hidden';
    b.append(im,el('b',s.name));b.title=s.name+' · '+s.extensions.join(' ');b.setAttribute('aria-label','레트로 · '+s.name);return b;}));
  const more=el('button',null,'up-more-sys');more.type='button';more.hidden=true;
  more.addEventListener('click',()=>{upAllSys=true;upRender();});$('up-systems').append(more);
  if(!upInfo.systems.length)$('up-systems').append(el('div','서버에 레트로 기종이 없습니다.','empty'));
  // A homebrew app's patch or save goes into its own switch/<app>/ folder.
  for(const h of upInfo.homebrew||[]){const o=el('option',(h.kind==='port'?'포트 · ':'홈브류 · ')+h.name+' (switch/'+h.app+'/)');o.value=h.app;$('up-target').append(o);}
  return true;}
async function loadUpload(){
  if(!await loadUploadInfo())return;
  // Sent here from an app card: the app and what to add to it are already chosen.
  // An entry that arrives while files are going up waits: it is applied when the batch ends.
  if(upPending&&!upBusy){
    // A new entry starts clean: nothing picked or failed before may be sent to the kind chosen here.
    if(!upBusy){upFiles=[];upPaths=null;upUnits=[];upGuess=null;upSystems=[];upOpen=false;upAllSys=false;}
    $('up-target').value=upPending.app;upKind=upPending.kind;upPreset=true;upPending=null;}
  upRender();}
// New files: read what they are from the names, fill in what the names tell, and leave the rest to the admin.
async function upTake(files,paths){
  if(upBusy||!files.length||!await loadUploadInfo())return;
  upFiles=files;upPaths=paths;upUnits=[];upDone=[];upAllSys=false;upOpen=false;
  const zip=!paths&&files.length===1&&/[.]zip$/i.test(files[0].name)?await zipNames(files[0]):null;
  const g=guessUpload({names:files.map((f)=>f.name),paths,zipNames:zip,systems:upInfo.systems});
  upGuess=g;upSystems=g.systems||[];
  if(g.name)$('up-name').value=g.name;
  if(!upPreset){
    // Several consoles fit one extension: none is picked until the admin does.
    upKind=g.kind??null;$('up-system').value=upSystems.length===1?upSystems[0]:'';
    if(g.titleId){$('up-target').value='';const game=upInfo.games.find((x)=>x.titleId===g.titleId);
      $('up-game').value=game?game.name+' ['+game.titleId+']':g.titleId;}}
  upRender();}
function upReset(){if(upBusy)return;upFiles=[];upPaths=null;upSystems=[];upGuess=null;upUnits=[];upDone=[];upOpen=false;upAllSys=false;upPreset=false;upKind=null;
  for(const id of ['up-name','up-desc','up-desc-ko','up-savetype'])$(id).value='';
  $('up-required').checked=false;$('up-target').value='';$('up-game').value='';
  upRender();}
$('up-target').addEventListener('change',()=>{upDropBatch();upRender();});
$('up-game').addEventListener('input',()=>{upDropBatch();upRender();});
gamePicker($('up-game'),{fill:true,pick:()=>{upDropBatch();upRender();}});
$('up-kinds').addEventListener('click',(e)=>{const b=e.target.closest('[data-kind]');if(!b||upBusy)return;
  const kind=b.dataset.kind;
  if(b.dataset.system){$('up-system').value=b.dataset.system;upOpen=false;}
  else if(kind==='retro'){if(upKind!=='retro')$('up-system').value='';}
  else upOpen=false;
  upSetKind(kind,true);});
$('up-change').addEventListener('click',()=>{if(upBusy)return;upOpen=!upOpen;upRender();});
$('up-file-btn').addEventListener('click',()=>{if(!upBusy)$('up-file').click();});
$('up-dir-btn').addEventListener('click',()=>{if(!upBusy)$('up-dir').click();});
$('up-drop').addEventListener('click',(e)=>{if(!upBusy&&!e.target.closest('button'))$('up-file').click();});
$('up-drop').addEventListener('keydown',(e)=>{if(e.target===$('up-drop')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(!upBusy)$('up-file').click();}});
$('up-clear').addEventListener('click',upReset);
$('up-file').addEventListener('change',()=>{const f=[...$('up-file').files];$('up-file').value='';upTake(f,null);});
$('up-dir').addEventListener('change',()=>{const f=[...$('up-dir').files];$('up-dir').value='';upTake(f,f.map((x)=>x.webkitRelativePath||x.name));});
// Files dragged anywhere on the page open the upload tab and land there.
const hasFiles=(e)=>Boolean(e.dataTransfer)&&[...e.dataTransfer.types].includes('Files');
let dragDepth=0;
document.addEventListener('dragenter',(e)=>{if(!hasFiles(e))return;e.preventDefault();
  if(dragDepth++===0){document.body.classList.add('dragging');if(location.hash!=='#upload')location.hash='upload';}});
document.addEventListener('dragleave',(e)=>{if(!hasFiles(e))return;if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragging');}});
document.addEventListener('dragover',(e)=>{if(hasFiles(e)){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
document.addEventListener('drop',async(e)=>{if(!hasFiles(e))return;e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');
  const got=await droppedFiles(e.dataTransfer);upTake(got.files,got.paths);});
function upTitleId(){const v=$('up-game').value.trim();const m=v.match(/[0-9A-Fa-f]{16}/);return m?m[0].toUpperCase():'';}
// One request for one unit; it ends with the unit marked sent or failed and its row repainted.
function upSend(u,label){return new Promise((resolve)=>{
  const fd=new FormData();
  // Where it goes was frozen into the unit when the batch was made; the name and descriptions are read now.
  const k=u.f.kind;
  if(k==='retro')fd.append('system',u.f.system);
  if(k==='patch'||k==='save'){const app=u.f.app;
    if(app)fd.append('homebrew',app);else fd.append('titleId',u.f.titleId);fd.append('name',$('up-name').value.trim());
    fd.append('description',$('up-desc').value.trim());fd.append('descriptionKo',$('up-desc-ko').value.trim());
    if(k==='save'&&!app&&$('up-savetype').value)fd.append('saveType',$('up-savetype').value);
    if(k==='patch'&&!app&&$('up-required').checked)fd.append('required','true');}
  if(k==='port')fd.append('port','true');
  if(u.paths)fd.append('paths',JSON.stringify(u.paths));
  for(const f of u.files)fd.append('files',f,f.name);
  const xhr=new XMLHttpRequest();const bar=$('up-bar');bar.hidden=false;bar.firstElementChild.style.width='0';$('up-progress').textContent=label;
  xhr.upload.addEventListener('progress',(ev)=>{if(ev.lengthComputable)bar.firstElementChild.style.width=(ev.loaded/ev.total*100).toFixed(1)+'%';});
  xhr.addEventListener('loadend',()=>{
    if(xhr.status===401){location.reload();return;}
    let d={};try{d=JSON.parse(xhr.responseText);}catch{}
    u.status=xhr.status;u.d=d;u.msg=d.error||'';u.code=d.code||null;u.state=xhr.status===201?'ok':'fail';
    upPaint(u);resolve();});
  xhr.open('POST','/admin/api/upload/'+(k==='port'?'homebrew':k));xhr.setRequestHeader('Accept-Language',typeof adminLang==='string'?adminLang:'ko');xhr.send(fd);});}
// Send the given units (default: every one that has not gone in). Units that went up are never sent again.
async function upSubmit(only){
  if(upBusy)return;
  if(!upFiles.length){toast(upT('tFiles'));return;}
  if(!upKind){toast(upT('tKind'));return;}
  if(upKind==='retro'&&!$('up-system').value){toast(upT('tSys'));return;}
  if(upKind==='patch'||upKind==='save'){
    if(!$('up-target').value&&!upTitleId()){toast(upT('tTarget'));return;}
    if(!$('up-name').value.trim()){toast(upT('tName'));return;}}
  if(!upUnits.length){
    upUnits=splitUnits({kind:upKind,names:upFiles.map((f)=>f.name),paths:upPaths}).map((s)=>({label:s.label,files:s.from.map((i)=>upFiles[i]),paths:upPaths&&upKind!=='game'?s.from.map((i)=>upPaths[i]):null,state:'wait',f:{kind:upKind,system:$('up-system').value,app:$('up-target').value,titleId:upTitleId()}}));
    upDone=[];
    for(const u of upUnits)upHistory.push(u);
    // Rows go in newest first, so the batch reads top to bottom in the order it was picked.
    for(const u of [...upUnits].reverse())upPaint(u);
    upTrim();}
  const todo=(only||unitsToSend(upUnits)).filter((u)=>u.state!=='ok');
  upBusy=true;for(const u of todo)u.state='wait';upRender();
  for(const [i,u] of todo.entries()){u.state='busy';upPaint(u);
    await upSend(u,todo.length>1?(i+1)+' / '+todo.length+' · '+u.label:'');}
  upBusy=false;$('up-bar').hidden=true;$('up-progress').textContent='';
  if(!upUnits.some((u)=>u.state!=='ok')){
    // Everything went up: the picked files are done with, the results stay on screen.
    upFiles=[];upPaths=null;upSystems=[];upGuess=null;upOpen=false;upAllSys=false;upPreset=false;upKind=null;
    for(const id of ['up-name','up-desc','up-desc-ko','up-savetype'])$(id).value='';
    $('up-required').checked=false;$('up-target').value='';$('up-game').value='';
    const done=upUnits;upUnits=[];upRender();
    // The summary of a finished batch stays until the next pick.
    upDone=done;upRender();upTrim();
    toast(upT('tDone'));}
  else{upRender();toast(upT('tSome'));}
  if(upPending)await loadUpload();}
$('up-form').addEventListener('submit',(e)=>{e.preventDefault();upSubmit();});

// ── library ───────────────────────────────────────────────────────────
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
  if(!quiet)libLoadSub();}
for(const b of document.querySelectorAll('#lib-subtabs [data-lsub]'))b.addEventListener('click',()=>libShowSub(b.dataset.lsub));
async function loadLibrary(){
  libLoadSub();
  const d=await api('/admin/api/library');if(d.origin){origin=d.origin;showShopUrl();}
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
async function scanWatch(since){
  while(!$('tab-library').hidden){await new Promise((r)=>setTimeout(r,1000));
    let d;try{d=await loadLibrary();}catch{return;}const s=d.scan||{};
    if(!scanBusy(s)&&s.lastFull&&s.lastFull.at>=since){toast('다시 스캔을 마쳤습니다. '+scanTook(s.lastFull)+' 걸렸습니다.');return;}}}
$('rescan').addEventListener('click',async()=>{$('rescan').disabled=true;
  try{const r=await api('/admin/api/library/rescan',{method:'POST',body:{}});
    toast(r.already?'이미 다시 스캔을 기다리고 있습니다.':'다시 스캔을 시작했습니다.');scanShow({fullPending:true});scanWatch(r.requestedAt);}
  catch(err){toast(err.message);$('rescan').disabled=false;}});

// ── featured ──────────────────────────────────────────────────────────
// Each row has a list of every library game to tick: a ticked game is in the row. The list is a page
// of /admin/api/games/search at a time, so 2,000 games cost one page; its box filters the same list.
let featured=[],names=new Map(),featuredDirty=false;
const FP_PAGE=60,FP_MAX=40,FP_WAIT=150;
// A row's list state survives redrawing the rows (moving one, a new language): keyed by the row itself.
const fpState=new WeakMap();
const fpOf=(c)=>{let s=fpState.get(c);if(!s){s={open:!c.titleIds.length,q:'',sort:'name',only:false,offset:0,data:null,asked:0,timer:0};fpState.set(c,s);}return s;};
const fpFill=(text,vars)=>Object.entries(vars).reduce((t,[k,v])=>t.replaceAll('{'+k+'}',String(v)),text);
// btn() with the label in the admin's language; the Korean word still picks the icon.
function tbtn(ko,key,fn,cls){const b=btn(ko,fn,cls),t=topText(key);
  if(b.classList.contains('ib')){b.title=t;b.setAttribute('aria-label',t);b.querySelector('span').textContent=t;}else b.textContent=t;return b;}
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
    tbtn('줄 삭제','fp.delRow',async()=>{if(!await ask(fpFill(topText('fp.delAsk'),{title:c.title||topText('fp.untitled')}),{danger:true}))return;featured.splice(ci,1);markDirty();renderFeatured();},'danger'));
  const chosen=el('ul',null,'fgames');
  const toggle=el('button',null,'fp-toggle');toggle.type='button';
  const panel=el('div',null,'fp');
  // The games in the row, in order, and everything that shows how many there are.
  function drawChosen(){chosen.replaceChildren();
    banner.replaceChildren(new Option(topText('fp.noBanner'),''));
    for(const id of c.titleIds)banner.append(new Option(fpFill(topText('fp.bannerOf'),{name:names.get(id)||id}),id,false,id===c.bannerTitleId));
    c.titleIds.forEach((id,gi)=>{const li=el('li');const img=el('img');img.src='/api/shop/icon/'+id+'?size=sm';img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
      const u=btn('▲',()=>{move(c.titleIds,gi,-1);markDirty();drawChosen();}),d=btn('▼',()=>{move(c.titleIds,gi,1);markDirty();drawChosen();});
      u.setAttribute('aria-label',topText('fp.up'));d.setAttribute('aria-label',topText('fp.down'));
      li.append(img,el('span',names.get(id)||id,'name'),u,d,
        tbtn('빼기','fp.remove',()=>{fpSet(c,{titleId:id},false);drawChosen();drawList();}));
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
      const img=el('img');img.src='/api/shop/icon/'+g.titleId+'?size=sm';img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
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
// A game's page in the library's info area can put it in a row too: the same rows and the same save.
async function gdFeatRows(){
  if(!featuredDirty){try{const d=await api('/admin/api/featured');featured=d.collections;for(const c of d.candidates)names.set(c.titleId,c.name);}catch(err){toast(err.message);return;}}
  const sel=$('gd-feat-row'),keep=sel.value;sel.replaceChildren();
  featured.forEach((c,i)=>{const title=c.title||topText('fp.untitled');
    sel.append(new Option(c.titleIds.includes(gdId)?fpFill(topText('fp.inRow'),{title}):title,String(i)));});
  sel.append(new Option(topText('fp.newRow'),'new'));
  sel.value=[...sel.options].some((o)=>o.value===keep)?keep:sel.options[0].value;gdFeatNew();}
function gdFeatNew(){$('gd-feat-title-l').hidden=$('gd-feat-row').value!=='new';}
$('gd-feat-row').addEventListener('change',gdFeatNew);
$('gd-feat-go').addEventListener('click',async()=>{if(!gdId)return;
  const pick=$('gd-feat-row').value,name=names.get(gdId)||$('gd-game').value.replace(/\\s*\\[[0-9A-Fa-f]{16}\\]\\s*$/,'');
  let row;
  if(pick==='new'){const title=$('gd-feat-title').value.trim();if(!title){toast(topText('fp.needTitle'));$('gd-feat-title').focus();return;}
    row={title,bannerTitleId:null,titleIds:[]};}
  else row=featured[Number(pick)];
  if(!row)return;
  if(row.titleIds.includes(gdId)){toast(topText('gp.already'));return;}
  const wasDirty=featuredDirty;
  if(pick==='new')featured.push(row);
  if(!fpSet(row,{titleId:gdId,name},true)){if(pick==='new')featured.pop();return;}
  // Unsaved changes in the home picks tab are the admin's to save: this joins them instead of saving half.
  if(wasDirty){renderFeatured();toast(topText('fp.addedDirty'));gdFeatRows();return;}
  try{const d=await api('/admin/api/featured',{method:'PUT',body:{collections:featured}});featured=d.collections;featuredDirty=false;fpSaveLabel();
    $('gd-feat-title').value='';toast(topText('fp.addedOk'));gdFeatRows();}
  catch(err){featuredDirty=false;fpSaveLabel();toast(err.message);loadFeatured();}});

// ── admin login: password and/or authenticator ─────────────────
const grouped=(s)=>String(s).replace(/(.{4})/g,'$1 ').trim();
async function loadTfa(){
  let s;try{s=await api('/admin/api/2fa');}catch(e){$('tfa-status').textContent='불러오지 못했습니다: '+e.message;return;}
  // Registered: say so plainly, with the shield, instead of offering to register again.
  $('tfa-ok').hidden=!s.authenticator;$('tfa-status').hidden=s.authenticator;
  $('tfa-ok-sub').textContent=s.password?'관리 페이지에 들어올 때 앱의 6자리 코드를 묻습니다. 휴대폰이 없을 때는 관리자 비밀번호로도 들어갈 수 있습니다.':'관리 페이지에 들어올 때 앱의 6자리 코드를 묻습니다.';
  $('tfa-status').textContent=s.skipped?'셋업에서 2단계 인증을 건너뛰었습니다. 지금은 관리자 계정 비밀번호만으로 관리 페이지에 들어옵니다. 비밀번호가 새면 누구든 서버를 관리할 수 있으니 인증 앱을 등록합니다.'
    :s.password?'관리자 비밀번호로 들어갑니다. 인증 앱을 등록하면 비밀번호 대신 6자리 코드로도 들어갈 수 있습니다.':'아직 등록한 인증 앱이 없습니다.';
  $('tfa-status').classList.toggle('tfa-warn',Boolean(s.skipped));
  renderAdminPassword(s);
  const box=$('tfa-actions');box.replaceChildren();
  if(!s.manageable){box.append(el('span','COOK_ADMIN_TOTP_SECRET 으로 고정돼 있어 여기서 바꿀 수 없습니다.','muted'));return;}
  box.append(s.authenticator?btn('다른 앱으로 바꾸기',startTfa):btn('인증 앱 등록',startTfa,'primary'));
  if(s.password&&s.authenticator)box.append(btn('인증 앱 끄기',async()=>{
    if(!await ask('인증 앱을 끄면 관리자 비밀번호로만 들어갑니다. 끌까요?',{danger:true}))return;
    try{await api('/admin/api/2fa/disable',{method:'POST',body:{}});toast('인증 앱을 껐습니다.');loadTfa();}catch(e){toast(e.message);}}));}
// The admin password set here (stored as a hash); the compose one keeps working beside it.
function renderAdminPassword(s){
  $('ap-status').textContent=s.passwordSaved?'여기서 정한 비밀번호가 있습니다. 바꾸려면 지금 비밀번호와 새 비밀번호를 넣습니다.'
    :s.passwordEnv?'compose 의 비밀번호로 들어갑니다. 여기서 비밀번호를 정하면 둘 다 받습니다.'
    :'아직 관리자 비밀번호가 없습니다. 정해 두면 휴대폰이 없을 때도 비밀번호로 들어갑니다.';
  $('ap-current').hidden=!s.password;$('ap-clear').hidden=!s.passwordSaved;}
$('ap-form').addEventListener('submit',async(e)=>{e.preventDefault();
  const password=$('ap-new').value;if(password!==$('ap-new2').value){toast('새 비밀번호 두 칸이 다릅니다.');return;}
  try{const s=await api('/admin/api/admin-password',{method:'POST',body:{current:$('ap-current').value,password}});
    for(const id of ['ap-current','ap-new','ap-new2'])$(id).value='';toast('관리자 비밀번호를 정했습니다.');renderAdminPassword(s);loadTfa();}catch(err){toast(err.message);}});
$('ap-clear').addEventListener('click',async()=>{if(!await ask('여기서 정한 관리자 비밀번호를 삭제합니다.',{danger:true}))return;
  try{const s=await api('/admin/api/admin-password/clear',{method:'POST',body:{current:$('ap-current').value}});
    $('ap-current').value='';toast('비밀번호를 삭제했습니다.');renderAdminPassword(s);loadTfa();}catch(err){toast(err.message);}});
async function startTfa(){
  try{const d=await api('/admin/api/2fa/start',{method:'POST',body:{}});
    $('tfa-qr').innerHTML=d.qr||'';$('tfa-key').textContent=grouped(d.secret);
    $('tfa-setup').hidden=false;$('tfa-code').value='';$('tfa-code').focus();}catch(e){toast(e.message);}}
async function confirmTfa(){const code=$('tfa-code').value.trim();
  if(!/^\\d{6}$/.test(code)){toast('숫자 6자리를 입력합니다.');return;}
  try{await api('/admin/api/2fa/confirm',{method:'POST',body:{code}});
    $('tfa-setup').hidden=true;$('tfa-qr').replaceChildren();$('tfa-key').textContent='';
    toast('인증 앱을 등록했습니다. 다음 로그인부터 코드도 묻습니다.');loadTfa();}
  catch(e){toast(e.message==='code does not match'?'코드가 맞지 않습니다. 앱에 나온 최신 코드를 넣습니다.':e.message==='enrollment expired, start again'?'시간이 지났습니다. 다시 등록합니다.':e.message);}}
$('tfa-confirm').addEventListener('click',confirmTfa);
$('tfa-code').addEventListener('keydown',(e)=>{if(e.key==='Enter')confirmTfa();});
$('tfa-cancel').addEventListener('click',()=>{$('tfa-setup').hidden=true;$('tfa-qr').replaceChildren();$('tfa-key').textContent='';});

// The account circle, theme and sign-out wiring live in chrome-script.js,
// shared with the split pages of the redesign.
// The address a console is given, for the how-to on the devices tab.
function showShopUrl(){$('shop-url').textContent=origin.replace(/[/]$/,'');}
$('shop-url-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('shop-url').textContent);toast('주소를 복사했습니다');}catch{toast('복사하지 못했습니다. 주소를 직접 고릅니다');}});
showShopUrl();
// A tab that fails to load says so instead of leaving old rows on screen; the same failure is told once.
let loadErr='';
function guarded(fn){return async(...a)=>{try{const r=await fn(...a);loadErr='';return r;}
  catch(err){const m='불러오지 못했습니다: '+(err&&err.message||err);if(m!==loadErr)toast(m);loadErr=m;}};}
loadHealth=guarded(loadHealth);loadStats=guarded(loadStats);loadDevices=guarded(loadDevices);
loadAccounts=guarded(loadAccounts);loadServerSettings=guarded(loadServerSettings);loadGoogleSettings=guarded(loadGoogleSettings);loadLibrary=guarded(loadLibrary);loadHomebrew=guarded(loadHomebrew);
showTab();loadStats();loadDevices();loadAccounts();loadGoogleSettings();
setInterval(()=>{if(!$('cred-dialog').open){loadStats();loadDevices();loadAccounts();}},15000);
`;
