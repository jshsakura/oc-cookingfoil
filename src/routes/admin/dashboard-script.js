/**
 * Browser script for the /admin dashboard (inlined into the page).
 * Plain DOM, no framework: the page must work on an offline LAN box.
 */
import { guessUpload } from "./upload-guess.js";

export const DASHBOARD_SCRIPT = /* js */ `
const $=(id)=>document.getElementById(id);
const fmt=(t)=>t?new Date(t).toLocaleString('ko-KR'):'—';
const ago=(t)=>{if(!t)return '—';const s=Math.round((Date.now()-t)/1000);
  if(s<60)return s+'초 전';if(s<3600)return Math.round(s/60)+'분 전';
  if(s<86400)return Math.round(s/3600)+'시간 전';return Math.round(s/86400)+'일 전';};
const num=(n)=>Number(n||0).toLocaleString('ko-KR');
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;}
function td(txt,cls){return el('td',txt,cls);}
// Row actions show an icon; on a wide screen the label hides and stays as the tooltip and accessible name.
const TRASH='<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
const PENCIL='<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>';
const CROSS='<path d="M6 6l12 12M18 6L6 18"/>';
const BAN='<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>';
const ROTATE='<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>';
const ICONS={'삭제':TRASH,'줄 삭제':TRASH,'폐기':TRASH,'휴지통으로 옮깁니다':TRASH,
  '편집':PENCIL,'이름':PENCIL,'이름 변경':PENCIL,
  '승인':'<path d="M5 12.5l4.5 4.5L19 7.5"/>','거절':CROSS,'취소':CROSS,'빼기':'<path d="M5 12h14"/>',
  '접근 키 회수':BAN,'사용 중지':BAN,'해제':BAN,
  '키 재발급':'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
  '재시도':ROTATE,'다시 시작':ROTATE,'되돌립니다':'<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  '복사':'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  '설명':'<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3"/>',
  '그림':'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>',
  '지금 다운로드':'<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'};
function btn(txt,fn,cls){const b=el('button',null,cls);b.type='button';const icon=ICONS[txt];
  if(icon){b.classList.add('ib');b.title=txt;b.setAttribute('aria-label',txt);
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg>';b.append(el('span',txt));}
  else b.textContent=txt;
  b.addEventListener('click',fn);return b;}
// Asks in a dialog that looks like the rest of the page, instead of the browser's confirm().
// Removing, revoking and the like get a red button, and the cancel button starts focused.
const ASK_DANGER=/삭제|폐기|회수|중지|되돌릴 수 없|휴지통|멈추고|끄면|끕니다/;
// askText(msg,value) asks for a line of text the same way, resolving to it or null (like await askText()).
function askDialog(msg,value){const d=$('ask-dialog'),ok=$('ask-ok'),no=$('ask-no'),inp=$('ask-input');
  const typing=value!==undefined,danger=!typing&&ASK_DANGER.test(msg);
  $('ask-text').textContent=msg;ok.className=danger?'danger-solid':'primary';inp.hidden=!typing;inp.value=typing?value:'';
  return new Promise((resolve)=>{const done=(v)=>{ok.onclick=no.onclick=d.oncancel=inp.onkeydown=null;d.close();resolve(v);};
    const yes=()=>done(typing?inp.value:true),nope=()=>done(typing?null:false);
    ok.onclick=yes;no.onclick=nope;d.oncancel=(e)=>{e.preventDefault();nope();};
    inp.onkeydown=(e)=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();yes();}};
    d.showModal();if(typing){inp.focus();inp.select();}else(danger?no:ok).focus();});}
const ask=(msg)=>askDialog(msg);
const askText=(msg,value='')=>askDialog(msg,value);
function pill(txt,kind){return el('span',txt,'pill'+(kind?' '+kind:''));}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2400);}
function table(mount,cols,rows,empty){const m=$(mount);m.replaceChildren();
  if(!rows.length){m.append(el('div',empty,'empty'));return;}
  const t=el('table');const hr=el('tr');for(const c of cols)hr.append(el('th',c));t.append(hr);
  // Each cell carries its column name: on a phone the table becomes labelled cards.
  for(const r of rows){[...r.children].forEach((c,i)=>{c.dataset.label=cols[i]??'';});t.append(r);}m.append(t);}

const ERRORS={self:'지금 로그인한 계정은 정지, 강등, 삭제할 수 없습니다.','last-admin':'관리자 계정이 하나는 남아 있어야 합니다.'};
const errText=(err)=>ERRORS[err.code]||err.message;
async function api(url,opts={}){
  const init={headers:{Accept:'application/json'},...opts};
  if(opts.body!==undefined){init.headers['Content-Type']='application/json';init.body=JSON.stringify(opts.body);}
  const r=await fetch(url,init);
  // Signed out (or the first account just switched sign-in on): reload, which leads
  // to the sign-in page, but never while a new password is still on screen.
  if(r.status===401){if($('cred-dialog').open)$('cred-dialog').addEventListener('close',()=>location.reload(),{once:true});else location.reload();throw new Error('session');}
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(data.message||data.error||('HTTP '+r.status));e.code=data.error;throw e;}
  return data;}

// ── tabs ──────────────────────────────────────────────────────────────
// why a zip was served as its single .nro instead of a whole folder
// why files of a release were left out of the install
const HB_EXCLUDED={'outside-switch':'switch 폴더 밖','other-app':'다른 앱 폴더','other-folder':'앱 폴더 밖','junk':'설명서와 시스템 파일','foreign-file':'다른 기기용 실행 파일','doc':'PC 용 설치 안내문'};
const HB_REASON={'not-one-folder':'zip 안이 switch/<앱>/ 폴더 하나로 되어 있지 않습니다','too-many-files':'파일이 너무 많습니다','several-nro':'nro 가 여러 개입니다','no-nro':'nro 가 없습니다','only-nro':'폴더에 nro 하나뿐입니다','link':'링크가 들어 있습니다','unsafe-path':'쓸 수 없는 이름이나 경로가 있습니다','foreign-file':'다른 기기용 실행 파일이 섞여 있습니다','nro-release':'릴리스가 nro 파일 하나입니다','partial':'일부 파일을 빼고 설치합니다'};
const TABS=['overview','users','devices','settings','alerts','logs','featured','library','nsz','upload','inbox','homebrew','retro'];
function showTab(){const [want,sub]=location.hash.slice(1).split('/');const tab=TABS.includes(want)?want:'overview';
  if(tab==='library'&&sub)libShowSub(sub,true);
  for(const name of TABS){$('tab-'+name).hidden=name!==tab;
    const a=document.querySelector('[data-tab="'+name+'"]');if(name===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  if(tab==='library')loadLibrary();
  if(tab==='settings'){loadServerSettings();loadClientRelease();loadIntegrations();loadTfa();loadGoogle();loadTokens();}
  if(tab==='logs'){loadClientLogs();setTimeout(xfOpen);}
  if(tab==='alerts')loadAlerts();
  if(tab==='homebrew')loadHomebrew();
  // After the whole script has run: the retro panel's state is declared further down.
  if(tab==='retro')setTimeout(retroOpen);
  if(tab==='featured')loadFeatured();
  if(tab==='upload')loadUpload();
  if(tab==='inbox')loadInbox();
  if(tab==='nsz')setTimeout(loadNsz);}
addEventListener('hashchange',showTab);


// ── overview + users + security (one stats call) ──────────────────────
let origin=location.origin;
// The server reports warnings by code (in English for its log); here each says what to do, with a button to the place to do it.
const WARNINGS={
  'admin-unenrolled':{t:'관리 페이지 2단계 인증이 아직 등록되지 않았습니다',d:'인증 앱을 등록하면 관리자 비밀번호 다음에 6자리 코드를 한 번 더 묻습니다. 설정 탭에서 QR 을 찍어 등록합니다.',go:['설정에서 등록','settings']},
  'admin-authenticator-optional':{t:'관리 페이지는 관리자 비밀번호로만 들어갑니다',d:'인증 앱을 등록하면 비밀번호 대신 6자리 코드로도 들어갈 수 있습니다. 꼭 해야 하는 것은 아닙니다.',go:['설정에서 등록','settings']},
  'no-auth':{t:'주소를 아는 누구나 서버에 접속할 수 있습니다',d:'계정이 없고 기기 승인도 꺼져 있습니다. 사용자 탭에서 계정을 하나 만들면 그때부터 로그인이 필요합니다.',go:['계정 만들기','users']},
  'pairing-only-blocks-tinfoil':{t:'승인된 기기만 접속할 수 있어 Tinfoil 은 연결하지 못합니다',d:'Tinfoil 은 기기 키를 보내지 못해 모든 요청이 거절됩니다. 사용자 탭에서 계정을 만들면 비밀번호로도 접속할 수 있습니다.',go:['계정 만들기','users']},
  'proxy-collapse':{t:'프록시를 거쳐 오는데 COOK_TRUST_PROXY 가 없습니다',d:'모든 접속이 프록시 하나의 IP 로 보여 한 사람의 로그인 실패가 모두를 잠글 수 있습니다. compose 에 COOK_TRUST_PROXY 를 넣고 프록시가 X-Forwarded-For 를 넘기게 합니다.'},
  'both-lanes':{t:'비밀번호와 기기 승인을 함께 씁니다',d:'승인된 기기는 비밀번호 없이, 나머지는 계정으로 접속합니다.'},
};
function renderWarnings(list){const box=$('warnings');box.replaceChildren();
  for(const w of list){const k=WARNINGS[w.code];const n=el('div',null,'note'+(w.severity==='warn'?' warn':''));
    n.append(el('div',k?.t??w.title,'t'),el('div',k?.d??w.detail,'d'));
    if(k?.go){const b=btn(k.go[0],()=>{location.hash='#'+k.go[1];});b.classList.add('note-go');n.append(b);}
    box.append(n);}}
function renderLanes(l){const box=$('lanes');box.replaceChildren();
  box.append(pill('비밀번호 접속: '+(l.basicAuth.enabled?l.basicAuth.userCount+'명':'꺼짐'),l.basicAuth.enabled?'on':'off'));
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
let me=null;
// The name, with a badge on the account you are signed in with (one cell child, so the phone layout keeps it on one line).
function nameCell(name,self){const c=td();const s=el('span',name);if(self){const b=pill('나','on');b.classList.add('me');s.append(b);}c.append(s);return c;}
const isMe=(kind,id)=>Boolean(me)&&me.kind===kind&&(kind==='google'?me.sub===id:me.name===id);
function renderUsers(list){
  const configured=list.filter((u)=>u.configured);
  const rows=configured.map((u)=>{const tr=el('tr');const self=isMe('password',u.user);
    tr.append(nameCell(u.user,self));
    tr.append(td(u.role==='admin'?'관리자':'일반 사용자'));
    const st=td();st.append(u.enabled?pill(u.lastAt?'사용 중':'접속 기록 없음',u.lastAt?'on':''):pill('사용 중지','off'));tr.append(st);
    const seen=td(ago(u.lastAt));seen.title=fmt(u.lastAt);tr.append(seen,td(u.lastIp||'—','ip'));
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('비밀번호 변경',()=>resetPassword(u.user)));
    // Your own account can't be demoted, turned off or removed (you'd lock yourself out).
    if(!self||u.role!=='admin')box.append(btn(u.role==='admin'?'일반 사용자로':'관리자로',()=>setRole(u.user,u.role==='admin'?'user':'admin')));
    if(!self)box.append(btn(u.enabled?'사용 중지':'다시 사용',()=>setEnabled(u.user,!u.enabled)));
    // Removing the very last account opens the server, so nobody is locked out by it.
    if(!self||configured.length===1)box.append(btn('삭제',()=>removeUser(u.user),'danger'));
    act.append(box);tr.append(act);return tr;});
  table('users',['이름','역할','상태','마지막 접속','마지막 IP',''],rows,'아직 사용자가 없습니다. 사용자가 없으면 비밀번호 없이 접속할 수 있습니다.');}
// What each refusal means, for the log tab (the server's own codes and English hints are for curl and the server log).
const DENY_KO={
  'rate-limited':['요청 과다','짧은 시간에 요청이 너무 많아 잠시 쉬게 했습니다. 승인된 기기와 로그인한 브라우저는 이 제한을 받지 않습니다.'],
  'ip-locked':['잠긴 주소','비밀번호를 여러 번 틀려 잠긴 주소에서 온 요청입니다. 위 차단 목록에서 풉니다.'],
  'probe':['공격 시도','알려진 공격 경로나 도구라 로그인 전에 걸렀습니다.'],
  'bad-credentials':['비밀번호 틀림','아이디나 비밀번호가 맞지 않습니다. 여러 번 틀리면 그 주소를 잠급니다.'],
  'no-device-key':['기기 키 없음','기기 키 없이 들어왔고 이 서버는 기기 승인으로만 받습니다.'],
  'device-not-approved':['승인 전 기기','아직 승인하지 않은 기기입니다. 기기 탭에서 승인합니다.'],
  'device-bad-access-key':['기기 키 틀림','승인된 기기가 맞지 않는 접근 키를 보냈습니다. 기기 탭에서 키를 다시 냅니다.'],
  'device-login-scope':['기기 로그인 범위 밖','기기 전용 로그인으로 게임 목록과 다운로드 밖의 것을 요청했습니다.'],
  'device-login-other-console':['다른 콘솔','기기 전용 로그인을 묶인 콘솔이 아닌 곳에서 썼습니다.'],
  'admin-no-session':['관리자 로그인 필요','관리 기능을 로그인 없이 요청했습니다.'],
  'admin-bad-totp':['OTP 틀림','관리자 6자리 코드가 맞지 않았습니다.'],
};
function renderSecurity(d){
  const locks=d.lockouts||[];const lockedNow=new Set(locks.map((l)=>l.ip));
  $('lock-count').hidden=!locks.length;$('lock-count').textContent=locks.length;
  $('unlock-all').disabled=!locks.length;
  table('lockouts',['IP','이유','차단 시각','해제 예정',''],locks.map((l)=>{const tr=el('tr');
    tr.append(td(l.ip,'ip'),td(l.reason||'—'),td(fmt(l.lockedAt)),td(l.until?fmt(l.until):'직접 해제할 때까지'));
    const act=td();act.append(btn('해제',()=>unlock(l.ip)));tr.append(act);return tr;}),'차단된 IP 가 없습니다.');
  table('denials',['시각','이유','클라이언트','경로','IP'],(d.denials?.recent||[]).map((x)=>{const tr=el('tr');
    const w=td(ago(x.at));w.title=fmt(x.at);tr.append(w);
    const [label,hint]=DENY_KO[x.reason]||[x.reason,x.hint||''];
    const r=td();r.append(pill(label,'warn'));if(x.status)r.append(' ',pill(String(x.status)));
    // A lock that has since been lifted is history, not a live block.
    if(x.reason==='ip-locked'&&!lockedNow.has(x.ip))r.append(' ',pill('지금은 풀림'));
    if(hint)r.append(el('div',hint,'muted'));tr.append(r);
    tr.append(td(x.ua||'—'),td(x.path||'—','ip'),td(x.ip||'—','ip'));return tr;}),'거부된 요청이 없습니다.');}
async function loadStats(){
  const d=await api('/admin/api/stats');
  me=d.me||null;const a=d.lanes.admin;
  $('who').textContent=me?(me.name||me.email):(a.email||a.owner||'admin');
  $('ts').textContent=fmt(d.generatedAt)+' 기준';
  renderWarnings(d.warnings||[]);renderLanes(d.lanes);renderCards(d);renderUsers(d.users||[]);renderSecurity(d);loadHealth();}

// ── users ─────────────────────────────────────────────────────────────
let lastCred=null;
function showCredential(title,cred){lastCred=cred;$('cred-title').textContent=title;
  const box=$('cred');box.replaceChildren();
  // CyberFoil takes the shop's root as its eShop URL; Tinfoil's File Browser wants shop.tfl.
  for(const [label,value] of [['CyberFoil 주소',origin+'/'],['Tinfoil 주소',origin+'/shop.tfl'],['사용자',cred.name],['비밀번호',cred.password]]){
    box.append(el('span',label,'muted'),el('span',value,'v'),btn('복사',async()=>{
      try{await navigator.clipboard.writeText(value);toast(label+'를 복사했습니다.');}catch{toast('복사하지 못했습니다. 직접 선택해 복사합니다.');}}));}
  $('cred-dialog').showModal();}
$('cred-close').addEventListener('click',()=>{$('cred-dialog').close();lastCred=null;});
$('cred-dialog').addEventListener('close',()=>{lastCred=null;});
$('cred-config').addEventListener('click',()=>{if(!lastCred)return;
  const config={servers:[{title:location.hostname,url:origin,username:lastCred.name,password:lastCred.password,
    cfClientId:'',cfClientSecret:'',enabled:true}],language:(['ko','en','ja','zh'].find((l)=>(navigator.language||'').toLowerCase().startsWith(l))||'en'),installTarget:'sd'};
  const a=el('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\\n'],{type:'application/json'}));
  a.download='config.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
$('add-user').addEventListener('submit',async(e)=>{e.preventDefault();
  const name=$('new-name').value.trim(),password=$('new-pass').value;
  const first=!(await api('/admin/api/users')).users.length;
  if(first&&!await ask('첫 사용자를 만들면 그때부터 이 서버 전체에 비밀번호가 필요합니다. 계속할까요?'))return;
  try{const cred=await api('/admin/api/users',{method:'POST',body:{name,password,role:$('new-role').value}});
    $('new-name').value='';$('new-pass').value='';showCredential(name+' 계정을 만들었습니다',cred);loadStats();}
  catch(err){toast(err.message);}});
async function resetPassword(name){if(!await ask(name+' 의 비밀번호를 새로 만듭니다. 지금 비밀번호는 바로 쓸 수 없게 됩니다.'))return;
  try{const cred=await api('/admin/api/users/'+encodeURIComponent(name)+'/password',{method:'POST',body:{}});
    showCredential(name+' 의 새 비밀번호',cred);loadStats();}catch(err){toast(err.message);}}
async function setRole(name,role){
  if(!await ask(role==='admin'?name+' 계정을 관리자로 변경합니다. 이 계정도 관리 페이지를 열 수 있게 됩니다.':name+' 계정을 일반 사용자로 변경합니다. 이 계정은 관리 페이지를 열 수 없게 됩니다.'))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/role',{method:'POST',body:{role}});toast('역할을 변경했습니다.');loadStats();}catch(err){toast(errText(err));}}
async function setEnabled(name,enabled){
  if(!enabled&&!await ask(name+' 계정을 사용 중지합니다. 이 계정으로는 접속할 수 없게 됩니다.'))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/enabled',{method:'POST',body:{enabled}});
    toast(enabled?'다시 사용합니다.':'사용을 중지했습니다.');loadStats();}catch(err){toast(errText(err));}}
async function removeUser(name){
  const last=(await api('/admin/api/users')).users.length===1;
  const msg=last?name+' 은 마지막 계정입니다. 지우면 비밀번호 없이 누구나 이 서버에 접속하고 파일을 받습니다. 정말 삭제할까요?'
    :name+' 계정을 삭제합니다. 이 계정으로 접속하던 기기는 더 접속할 수 없습니다.';
  if(!await ask(msg))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+(last?'?allowEmpty=1':''),{method:'DELETE'});toast('삭제했습니다.');loadStats();}
  catch(err){toast(errText(err));}}

// ── security ──────────────────────────────────────────────────────────
async function unlock(ip){if(!await ask(ip+' 의 차단을 해제합니다.'))return;
  try{await api('/admin/api/unlock',{method:'POST',body:{ip}});toast('차단을 해제했습니다.');loadStats();}catch(err){toast(err.message);}}
$('unlock-all').addEventListener('click',async()=>{if(!await ask('차단된 IP 를 모두 해제합니다.'))return;
  try{const r=await api('/admin/api/unlock',{method:'POST',body:{ip:'all'}});toast(r.unlocked+'개를 해제했습니다.');loadStats();}catch(err){toast(err.message);}});
$('clrdeny').addEventListener('click',async()=>{if(!await ask('거부 기록을 삭제합니다.'))return;
  try{await api('/admin/api/denials/clear',{method:'POST',body:{}});loadStats();}catch(err){toast(err.message);}});

// ── Google accounts ─────────────────────────────────────────────────
const ACCOUNT_STATUS={pending:['승인 대기','warn'],approved:['승인됨','on'],disabled:['사용 중지','off']};
async function loadAccounts(){
  const d=await api('/admin/api/accounts');const list=d.accounts||[];
  $('accounthint').textContent=d.enabled?'로그인 화면에서 구글로 들어온 계정입니다. 승인한 계정만 웹을 쓰고 기기 화면의 QR이나 기기 코드로 연결을 승인할 수 있습니다.'
    :'구글 로그인이 꺼져 있습니다. 설정 탭에서 켭니다.';
  const waiting=list.filter((a)=>a.status==='pending').length;$('account-count').hidden=!waiting;$('account-count').textContent=waiting;
  table('accounts',['이메일','역할','상태','처음 로그인','마지막 로그인',''],list.map((a)=>{const tr=el('tr');const self=isMe('google',a.sub);
    const [label,kind]=ACCOUNT_STATUS[a.status]||[a.status,''];const st=td();st.append(pill(label,kind));
    tr.append(nameCell(a.email,self),td(a.role==='admin'?'관리자':'일반 사용자'),st,td(fmt(a.createdAt)),td(ago(a.lastAt)));
    const act=td();const box=el('div',null,'row-actions');
    if(a.status!=='approved')box.append(btn('승인',()=>setAccount(a.sub,'approved'),'primary'));
    if(a.status==='approved'&&(!self||a.role!=='admin'))box.append(btn(a.role==='admin'?'일반 사용자로':'관리자로',()=>setAccountRole(a.sub,a.email,a.role==='admin'?'user':'admin')));
    if(a.status==='approved'&&!self)box.append(btn('사용 중지',async()=>{if(await ask(a.email+' 계정의 사용을 중지합니다. 다시 승인하기 전까지 로그인하지 못합니다.'))setAccount(a.sub,'disabled');}));
    if(!self)box.append(btn('삭제',()=>removeAccount(a.sub,a.email),'danger'));
    act.append(box);tr.append(act);return tr;}),'아직 로그인한 계정이 없습니다.');}
async function setAccountRole(sub,email,role){
  if(!await ask(role==='admin'?email+' 계정을 관리자로 변경합니다.':email+' 계정을 일반 사용자로 변경합니다.'))return;
  try{await api('/admin/api/accounts/role',{method:'POST',body:{sub,role}});toast('역할을 변경했습니다.');loadAccounts();}catch(err){toast(errText(err));}}
async function setAccount(sub,status){
  try{await api('/admin/api/accounts/status',{method:'POST',body:{sub,status}});toast(status==='approved'?'승인했습니다.':'사용을 중지했습니다.');loadAccounts();}catch(err){toast(errText(err));}}
async function removeAccount(sub,email){if(!await ask(email+' 계정을 삭제합니다. 다시 로그인하면 승인 대기로 돌아옵니다.'))return;
  try{await api('/admin/api/accounts/remove',{method:'POST',body:{sub}});toast('삭제했습니다.');loadAccounts();}catch(err){toast(errText(err));}}

async function loadGoogle(){
  const g=await api('/admin/api/google');$('g-enabled').checked=g.enabled;$('g-id').value=g.clientId||'';
  $('g-secret').value='';$('g-secret').placeholder=g.hasSecret?'저장된 시크릿을 씁니다 (바꿀 때만 입력)':'클라이언트 시크릿';
  $('g-redirect').textContent=g.redirectUri;
  $('g-status').textContent=g.active?'켜져 있습니다. 로그인 화면에 구글 버튼이 나옵니다.':g.enabled?'켜려면 ID 와 시크릿이 모두 필요합니다.':'꺼져 있습니다. 로그인 화면은 아이디와 비밀번호만 받습니다.';}
$('google-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/google',{method:'POST',body:{enabled:$('g-enabled').checked,clientId:$('g-id').value,clientSecret:$('g-secret').value}});
    toast('저장했습니다.');loadGoogle();loadAccounts();}catch(err){toast(err.message);}});
$('g-clear').addEventListener('click',async()=>{if(!await ask('구글 클라이언트 ID 와 시크릿을 지우고 구글 로그인을 끕니다.'))return;
  try{await api('/admin/api/google/clear',{method:'POST',body:{}});toast('삭제했습니다.');loadGoogle();loadAccounts();}catch(err){toast(err.message);}});
$('g-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('g-redirect').textContent);toast('복사했습니다.');}catch{toast('복사하지 못했습니다. 직접 선택해 복사합니다.');}});

// ── devices ───────────────────────────────────────────────────────────
async function loadDevices(){
  const d=await api('/admin/api/devices');
  $('devhint').textContent=d.pairingEnabled?'CookingFoil 클라이언트가 승인을 요청하면 여기에 나옵니다. 기기 화면의 기기 코드를 넣거나 목록에서 승인하면 비밀번호 없이 접속합니다.'
    :'기기 승인이 꺼져 있습니다. 설정 탭의 서버 동작에서 QR 로 기기 연결을 켭니다.';
  const pending=d.pending||[];$('pending-count').hidden=!pending.length;$('pending-count').textContent=pending.length;
  table('pending',['기기 코드','메시지','기기 키','요청 시각',''],pending.map((p)=>{const tr=el('tr');
    const k=td(p.deviceKey.slice(0,16)+'…','ip');k.title=p.deviceKey;tr.append(td(p.code||'—','ip'),td(p.message||'—',p.message?'':'dim'),k,td(fmt(p.lastSeenAt)));
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('승인',()=>approve(p.deviceKey),'primary'),btn('거절',()=>dismissDevice(p.deviceKey,p.code),'danger'));act.append(box);tr.append(act);return tr;}),'승인을 기다리는 기기가 없습니다.');
  // Last seen is kept in memory only, so it starts empty after a restart.
  const seenSince='서버 시작('+fmt(d.since)+') 뒤로 접속 없음';
  table('devices',['이름','연결한 계정','마지막 접속','승인한 날','기기 키',''],(d.approved||[]).map((a)=>{const tr=el('tr');
    const seen=td(a.lastSeenAt?ago(a.lastSeenAt):'—',a.lastSeenAt?'':'dim');seen.title=a.lastSeenAt?fmt(a.lastSeenAt):seenSince;
    tr.append(td(a.label||'—'),td(a.addedBy==='admin'?'관리자':a.addedBy==='telegram'?'텔레그램':String(a.addedBy||'—').replace(/^google:/,'')),seen,td(fmt(a.addedAt)));
    const k=td(a.deviceKey.slice(0,16)+'…','ip');k.title=a.deviceKey;tr.append(k);
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('이름 변경',()=>renameDevice(a.deviceKey,a.label)),btn('키 재발급',()=>reissue(a.deviceKey,a.label)),btn('접근 키 회수',()=>revoke(a.deviceKey),'danger'));
    act.append(box);tr.append(act);return tr;}),'승인된 기기가 없습니다.');
  const STATE={waiting:'기다리는 중',used:'연동함',expired:'만료',revoked:'취소함'};
  table('clients',['받은 계정','받은 시각','상태','기기 코드','연동 시각',''],(d.clients||[]).map((c)=>{const tr=el('tr');
    const state=td(STATE[c.state]||c.state,c.state==='used'?'':'dim');if(c.state==='waiting')state.title=fmt(c.expiresAt)+'까지 연결할 수 있습니다';
    tr.append(td(String(c.owner||'—').replace(/^google:/,'')),td(fmt(c.createdAt)),state,td(c.code||'—','ip'),td(c.usedAt?fmt(c.usedAt):'—',c.usedAt?'':'dim'));
    const act=td();if(c.state==='waiting'){const box=el('div',null,'row-actions');box.append(btn('취소',()=>cancelClient(c.id),'danger'));act.append(box);}
    tr.append(act);return tr;}),'웹에서 받은 클라이언트가 없습니다.');}
async function cancelClient(id){if(!await ask('이 다운로드로는 이제 연동할 수 없게 합니다.'))return;
  try{await api('/admin/api/clients/'+id+'/revoke',{method:'POST'});toast('취소했습니다.');loadDevices();}catch(err){toast(err.message);}}
$('approve-code').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/devices/approve',{method:'POST',body:{code:$('code-in').value,label:$('code-label').value}});
    toast('승인했습니다. 기기가 다음 확인 때 접속 키를 받습니다.');$('code-in').value='';$('code-label').value='';loadDevices();}
  catch(err){toast(err.message==='no device is waiting with that code'?'그 코드로 승인을 기다리는 기기가 없습니다. 기기 화면의 코드를 다시 확인합니다.':err.message);}});
// Drops a request without approving it; the console shows up again only if it asks again.
async function dismissDevice(deviceKey,code){if(!await ask((code||'이')+' 기기의 승인 요청을 삭제합니다. 기기가 다시 요청하면 또 나옵니다.'))return;
  try{await api('/admin/api/devices/revoke',{method:'POST',body:{deviceKey}});toast('요청을 삭제했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function loadLogins(){
  const d=await api('/admin/api/device-logins');$('add-login').hidden=!d.enabled;
  table('logins',['이름','아이디','만든 계정','묶인 기기','만든 날',''],(d.logins||[]).map((l)=>{const tr=el('tr');
    const k=td(l.deviceKey?l.deviceKey.slice(0,16)+'…':'아직 접속 전','ip');if(l.deviceKey)k.title=l.deviceKey;
    tr.append(td(l.label||'—'),td(l.name,'ip'),td(l.owner==='admin'?'관리자':l.owner+(l.active?'':' (꺼짐)')),k,td(fmt(l.createdAt)));
    const act=td();act.append(btn('폐기',async()=>{if(!await ask(l.name+' 을 폐기합니다. 이 아이디로 접속하던 기기는 바로 끊깁니다.'))return;
      try{await api('/admin/api/device-logins/'+encodeURIComponent(l.name)+'/revoke',{method:'POST',body:{}});toast('폐기했습니다.');loadLogins();}catch(err){toast(err.message);}},'danger'));
    tr.append(act);return tr;}),d.enabled?'만든 접속 정보가 없습니다.':'서버 계정이 없어서 비밀번호 접속이 꺼져 있습니다.');}
$('add-login').addEventListener('submit',async(e)=>{e.preventDefault();
  try{const c=await api('/admin/api/device-logins',{method:'POST',body:{label:$('login-label').value}});$('login-label').value='';
    showCredential('기기 접속 정보를 만들었습니다',c);loadLogins();}catch(err){toast(err.message);}});
async function approve(deviceKey){const label=await askText('이 기기를 알아볼 이름을 정합니다 (예: 친구 기기)','');if(label===null)return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label}});toast('승인했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function reissue(deviceKey,label){if(!await ask('새 접속 키를 발급합니다. 기기는 다음 접속 때 새 키를 받고, 지금 키는 바로 쓸 수 없게 됩니다.'))return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label:label||''}});toast('새 키를 준비했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function revoke(deviceKey){if(!await ask('이 기기의 접근 키를 회수합니다. 다시 승인하기 전까지 비밀번호 없이는 접속할 수 없습니다.'))return;
  try{await api('/admin/api/devices/revoke',{method:'POST',body:{deviceKey}});toast('접근 키를 회수했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function renameDevice(deviceKey,label){const next=await askText('이 기기의 이름을 정합니다',label||'');if(next===null)return;
  try{await api('/admin/api/devices/label',{method:'POST',body:{deviceKey,label:next}});toast('이름을 변경했습니다.');loadDevices();}catch(err){toast(err.message);}}

// ── paged lists: search, how many per page, page buttons ──────────────
// The data is already in the browser, so this only slices it. A list of ten or fewer shows no bar.
const PG_SIZES=[10,25,50,100],pgState={};
function pgSize(key,def){try{const v=Number(localStorage.getItem('pg-'+key));if(PG_SIZES.includes(v))return v;}catch(e){}return def;}
function pgPages(page,pages){const out=[];let last=0;
  for(let n=1;n<=pages;n++){if(n===1||n===pages||Math.abs(n-page)<=1){if(last&&n-last>1)out.push(0);out.push(n);last=n;}}return out;}
// mount: the element the rows go in. opts: key, items, match(item,q), def, render(slice,filtered), placeholder
function paged(mount,opts){
  const st=pgState[opts.key]||(pgState[opts.key]={q:'',page:1,per:pgSize(opts.key,opts.def||25)});
  let bar=document.getElementById(mount.id+'-bar');
  if(!bar){bar=el('div',null,'pg-bar');bar.id=mount.id+'-bar';mount.before(bar);}
  const run=()=>{
    const q=st.q.trim().toLowerCase();
    const list=q?opts.items.filter((it)=>opts.match(it,q)):opts.items;
    const pages=Math.max(1,Math.ceil(list.length/st.per));if(st.page>pages)st.page=pages;
    const from=(st.page-1)*st.per;
    opts.render(list.slice(from,from+st.per),list,q);
    bar.hidden=opts.items.length<=PG_SIZES[0];bar.replaceChildren();if(bar.hidden)return;
    const find=el('input',null,'pg-q');find.type='search';find.value=st.q;find.placeholder=opts.placeholder||'이름으로 찾기';find.setAttribute('aria-label',(opts.label||'목록')+' 찾기');
    find.addEventListener('input',()=>{st.q=find.value;st.page=1;run();find.focus();});
    const per=el('select',null,'pg-per');per.setAttribute('aria-label',(opts.label||'목록')+' 몇 개씩 볼지');
    for(const n of PG_SIZES){const o=el('option',n+'개씩');o.value=n;per.append(o);}per.value=st.per;
    per.addEventListener('change',()=>{st.per=Number(per.value);st.page=1;try{localStorage.setItem('pg-'+opts.key,String(st.per));}catch(e){}run();});
    const info=el('span',list.length?(from+1)+'-'+Math.min(list.length,from+st.per)+' / '+num(list.length)+'개':'찾은 것이 없습니다','pg-info');
    const nav=el('div',null,'pg-nav');nav.setAttribute('role','navigation');nav.setAttribute('aria-label',(opts.label||'목록')+' 페이지');
    const go=(n)=>{st.page=n;run();};
    const prev=btn('이전',()=>go(st.page-1));prev.disabled=st.page<=1;
    const next=btn('다음',()=>go(st.page+1));next.disabled=st.page>=pages;
    nav.append(prev);
    if(pages>1)for(const n of pgPages(st.page,pages)){
      if(!n){nav.append(el('span','…','pg-gap'));continue;}
      const b=btn(String(n),()=>go(n));b.dataset.noicon='1';b.setAttribute('aria-label',n+' 쪽');b.classList.add('pg-n');
      if(n===st.page)b.setAttribute('aria-current','page');nav.append(b);}
    nav.append(next);
    bar.append(find,per,info,nav);};
  run();}
// ── homebrew ──────────────────────────────────────────────────────────
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
  paged($('hb-sources'),{key:'hb-sources',label:'따라가는 저장소',def:25,items:d.sources||[],
    match:(s,q)=>(s.repo+' '+(s.description?.github||'')+' '+(s.description?.custom?.ko||'')).toLowerCase().includes(q),
    render:(rows,list,q)=>table('hb-sources',['저장소','버전','쓰는 파일','상태','마지막 확인',''],rows.map((s)=>{const tr=el('tr');
    const name=td();const a=el('a',s.repo);a.href='https://github.com/'+s.repo;a.target='_blank';a.rel='noopener';name.append(a);
    const shown=s.description?.custom?(s.description.custom.ko||s.description.custom.en||'설명 없음'):s.description?.github;
    if(shown)name.append(el('div',shown,'desc'));
    tr.append(name,td(s.cached?.version||s.tag||'—'));
    const file=td();
    if((s.assets||[]).length>1||s.pattern){const sel=el('select');sel.setAttribute('aria-label','쓸 파일');
      const auto=el('option','자동 ('+(s.chosen||'없음')+')');auto.value='';sel.append(auto);
      for(const n of s.assets){const o=el('option',n);o.value=n;sel.append(o);}
      if(s.pattern&&!s.assets.includes(s.pattern)){const o=el('option',s.pattern);o.value=s.pattern;sel.append(o);}
      sel.value=s.pattern||'';sel.addEventListener('change',()=>setHbAsset(s.repo,sel.value));file.append(sel);}
    else file.textContent=s.chosen||'—';
    tr.append(file);
    const st=td();const pills=el('div',null,'pills');st.append(pills);
    if(s.error){pills.append(pill('오류','off'));st.append(el('div',s.error.message,'err'));}
    else if(s.cached)pills.append(pill(s.cached.current?'받아 둠 · '+mb(s.cached.size):'새 버전 있음',s.cached.current?'on':'warn'));
    else pills.append(pill(s.checked_at?'아직 받지 않음':'확인 전'));
    if(s.install){const folder=s.install.mode==='folder';
      const how=pill(folder?'폴더 설치 · '+s.folder_files+'개 파일':'nro 만',folder?'on':null);
      if(!folder&&HB_REASON[s.install.reason])how.title=HB_REASON[s.install.reason];
      pills.append(how);
      for(const x of s.install.excluded||[])st.append(el('div','일부 파일 제외('+(HB_EXCLUDED[x.rule]||x.rule)+'): '+x.paths.join(', '),'muted'));
      if(s.install.rules?.length){const d=el('details');d.append(el('summary','판단 근거'),el('div',s.install.rules.join(' · '),'muted'));st.append(d);}}
    tr.append(st);const w=td(ago(s.checked_at));w.title=fmt(s.checked_at);tr.append(w);
    const act=td();const box=el('div',null,'row-actions');
    box.append(hbKind(s.id,s.kind),btn('설명',()=>editHbDesc(s.id,s.cached?.name||s.repo,s.description)),btn('지금 확인',()=>checkHb(s.repo)),btn('삭제',()=>removeHb(s.repo),'danger'));act.append(box);tr.append(act);return tr;}),
    q?'찾은 저장소가 없습니다.':'따라가는 저장소가 없습니다. 위에서 추천 홈브류를 고르거나 주소로 추가합니다.')});
  hbManual=d.manual||[];hbSources=d.sources||[];loadHbApps();}
let hbManual=[],hbSources=[],hbReco=[];const hbPicked=new Set();
// Every app with its own patches and saves: upload jumps to the upload tab with the app already chosen.
async function loadHbApps(){let d;try{d=await api('/admin/api/homebrew/apps');}catch(err){toast(err.message);return;}
  const held=d.held||[];$('hb-held').hidden=!held.length;
  $('hb-held').replaceChildren(...held.map((h)=>{const p=el('p');p.append(el('b','switch/'+h.folder+'/'),' '+h.reason);return p;}));
  const extraCell=(type,app,items)=>{const c=td();
    for(const it of items){const line=el('div',null,'xline');line.append(el('span',it.name+' · '+mb(it.size)));
      if(type==='patch'){const e=btn('편집',()=>ctOpen('patch',it,loadHbApps));e.setAttribute('aria-label',it.name+' 편집');line.append(e);}
      line.append(btn('삭제',()=>removeHbExtra(type,it.id,it.name),'danger'));c.append(line);}
    c.append(btn(type==='patch'?'패치 올리기':'세이브 올리기',()=>uploadFor(type,app)));return c;};
  paged($('hb-apps'),{key:'hb-apps',label:'앱',def:25,items:d.apps||[],
    match:(a,q)=>((a.name||'')+' '+(a.app||'')+' '+(a.repo_url||'')+' '+(a.title_id||'')).toLowerCase().includes(q),
    render:(rows,list,q)=>table('hb-apps',['켜기','이름','분류','크기','패치','세이브',''],rows.map((a)=>{const tr=el('tr');tr.classList.toggle('hb-off',!a.enabled);
    const on=td();const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=a.enabled;b.setAttribute('aria-label',(a.name||a.app)+' 켜기');
    b.addEventListener('change',()=>setHbEnabled(a.id,b.checked,a.name||a.app));w.append(b,el('span'));on.append(w);tr.append(on);
    const n=td();n.append(el('b',a.name||a.app));
    const where=a.install_type==='title'?'설치형 NSP · '+a.title_id:'switch/'+a.app+'/';
    n.append(el('div',(a.version?'v'+a.version+' · ':'')+(a.source==='github'?'GitHub '+(a.repo_url||'').replace('https://github.com/',''):'직접 넣음')+' · '+where,'muted'));
    const manual=hbManual.find((m)=>m.id===a.id);
    const desc=manual?.description||hbSources.find((s)=>s.id===a.id)?.description||{custom:null,github:a.description||null};
    tr.append(n);const k=td();k.append(hbKind(a.id,a.kind));if(a.install_type!=='title')k.append(hbCores(a.id,a.cores,a.name||a.app));tr.append(k,td(mb(a.size)));
    // An installable title has no switch/<app>/ folder for patches and saves to go under.
    if(a.app)tr.append(extraCell('patch',a.app,a.patches),extraCell('save',a.app,a.saves));else tr.append(td('—'),td('—'));
    const act=td();const box=el('div',null,'row-actions');box.append(btn('설명',()=>editHbDesc(a.id,a.name||a.app,desc)));
    const repo=(a.repo_url||'').replace('https://github.com/','');
    box.append(btn('그림',()=>openHbBanner(a)));
    if(a.source==='manual')box.append(btn('GitHub 연결',()=>linkHb(a)),btn('삭제',()=>removeManualHb(a.id,a.name||a.app),'danger'));
    else if(repo)box.append(btn('지금 확인',()=>checkHb(repo)),btn('빼기',()=>removeHb(repo),'danger'));
    act.append(box);tr.append(act);return tr;}),q?'찾은 앱이 없습니다.':'홈브류 앱이 없습니다. 업로드 탭에서 올리거나 아래에서 저장소를 추가합니다.')});}
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
async function hbShotRemove(n){if(!await ask(n+'번째 스크린샷을 뺍니다.'))return;
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
$('hb-shots-clear').addEventListener('click',async()=>{if(!await ask('스크린샷을 모두 뺍니다. 포트도 다시 자동으로 채우지 않습니다.'))return;
  try{await api('/admin/api/homebrew/shots/remove',{method:'POST',body:{id:hbBannerApp.id}});await hbMediaReload();}catch(err){toast(err.message);}});
$('hb-shots-file').addEventListener('change',async()=>{const files=[...$('hb-shots-file').files];$('hb-shots-file').value='';if(!files.length)return;
  const st=$('hb-shots-state');let done=0;
  for(const file of files){st.textContent='올리고 있습니다 ('+(done+1)+'/'+files.length+')';
    try{const r=await fetch('/admin/api/homebrew/shots/upload?id='+encodeURIComponent(hbBannerApp.id),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream',Accept:'application/json'},body:file});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'올리지 못했습니다');done++;}
    catch(err){st.textContent=file.name+': '+err.message;break;}}
  if(done===files.length)st.textContent=done+'장을 올렸습니다.';await hbMediaReload();});
$('hb-banner-remove').addEventListener('click',async()=>{if(!await ask('배경 그림을 뺍니다. 포트도 다시 자동으로 채우지 않습니다.'))return;
  try{await api('/admin/api/homebrew/banner/remove',{method:'POST',body:{id:hbBannerApp.id}});toast('배경 그림을 뺐습니다.');await hbMediaReload();}catch(err){toast(err.message);}});
$('hb-banner-file').addEventListener('change',async()=>{const file=$('hb-banner-file').files[0];$('hb-banner-file').value='';if(!file)return;
  $('hb-banner-state').textContent='올리고 있습니다';
  try{const r=await fetch('/admin/api/homebrew/banner/upload?id='+encodeURIComponent(hbBannerApp.id),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream',Accept:'application/json'},body:file});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'올리지 못했습니다');toast('배경 그림을 올렸습니다.');await hbMediaReload();}
  catch(err){$('hb-banner-state').textContent=err.message;}});
async function removeHbExtra(type,id,name){if(!await ask(name+' '+(type==='patch'?'패치':'세이브')+'를 서버에서 삭제합니다.'))return;
  try{await api('/admin/api/homebrew/extra/remove',{method:'POST',body:{type,id}});toast('삭제했습니다.');loadHbApps();}catch(err){toast(err.message);}}
async function setHbEnabled(id,enabled,name){
  try{await api('/admin/api/homebrew/enabled',{method:'POST',body:{id,enabled}});toast(enabled?name+' 을(를) 다시 보여 줍니다.':name+' 을(를) 기기 목록에서 뺐습니다. 서버에는 남아 있습니다.');loadHbApps();}
  catch(err){toast(err.message);loadHbApps();}}
// A hand-placed app linked to its GitHub repository: the server follows the repository, then the hand-placed copy can go.
async function linkHb(a){const input=await askText((a.name||a.app)+' 의 GitHub 저장소 주소나 owner/name 을 넣습니다. 서버가 그 저장소의 새 버전을 따라갑니다.');
  if(!input||!input.trim())return;
  try{const s=await api('/admin/api/homebrew',{method:'POST',body:{repo:input.trim()}});
    if(s&&!s.error&&await ask(s.repo+' 을(를) 따라갑니다. 직접 넣은 '+(a.name||a.app)+' 사본을 삭제할까요? 이 앱의 패치와 세이브는 남습니다.')){
      await api('/admin/api/homebrew/manual/remove',{method:'POST',body:{id:a.id}});toast('GitHub 저장소로 변경했습니다.');}
    else toast(s?.error?.message?s.repo+' 을(를) 따라가지만 확인에 실패했습니다: '+s.error.message:'저장소를 추가했습니다.');
    loadHomebrew();}catch(err){toast(err.message);}}
async function removeManualHb(id,name){if(!await ask(name+' 앱 폴더를 서버에서 삭제합니다. 이 앱의 패치와 세이브는 남습니다.'))return;
  try{await api('/admin/api/homebrew/manual/remove',{method:'POST',body:{id}});toast('삭제했습니다.');loadHomebrew();}catch(err){toast(err.message);}}
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
$('hb-desc-reset').addEventListener('click',async()=>{if(!await ask('직접 쓴 설명을 지우고 GitHub 설명으로 되돌립니다.'))return;
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
async function removeHb(repo){if(!await ask(repo+' 를 더 따라가지 않고 받아 둔 파일도 삭제합니다.'))return;
  try{await api('/admin/api/homebrew/remove',{method:'POST',body:{repo}});toast('삭제했습니다.');loadHomebrew();}catch(err){toast(err.message);}}

// ── client logs ───────────────────────────────────────────────────────
const kb=(n)=>n<1024?n+' B':(n/1024).toFixed(1)+' KB';
// Today shows the time alone, any other day month.day and time: short enough for one line.
function fmtShort(t){if(!t)return '—';const d=new Date(t),n=new Date();
  const hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return d.toDateString()===n.toDateString()?hm:(d.getMonth()+1)+'.'+d.getDate()+' '+hm;}
let logsSub='xfer';
function logsShowSub(sub){logsSub=sub;
  for(const b of document.querySelectorAll('#logs-subtabs [data-lsub]'))b.setAttribute('aria-selected',String(b.dataset.lsub===sub));
  for(const p of document.querySelectorAll('#tab-logs [data-logs-panel]'))p.hidden=p.dataset.logsPanel!==sub;}
for(const b of document.querySelectorAll('#logs-subtabs [data-lsub]'))b.addEventListener('click',()=>logsShowSub(b.dataset.lsub));
async function loadClientLogs(){
  const d=await api('/admin/api/client-logs');const box=$('cl-list');box.replaceChildren();
  table('bug-reports',['순위','사용자','기기','보낸 횟수','최근'],(d.bugReports||[]).map((r,i)=>{const tr=el('tr');
    const rk=td();rk.append(el('span',String(i+1),'rk'+(i<3?' r'+(i+1):'')));
    const dev=td();dev.append(el('span',r.label||r.prefix,r.label?'':'ip'));if(r.label)dev.append(el('span',r.prefix,'rk-key'));
    tr.append(rk,td(r.owner||'—',r.owner?'':'dim'),dev,td(num(r.count)+'번'),td(ago(r.last)));
    tr.lastChild.title=fmt(r.last);return tr;}),'아직 받은 버그 리포트가 없습니다.');
  if(!(d.consoles||[]).length){box.append(el('div','아직 받은 로그가 없습니다.','empty'));return;}
  for(const [i,c] of d.consoles.entries()){const det=el('details');det.open=i===0;
    const sum=el('summary');const name=el('b',c.label||c.prefix);
    // Several consoles can share one name ("자동 등록"): the key's first 8 characters tell them apart.
    if(c.label)name.append(el('small',c.prefix));
    sum.append(name,el('span',c.files.length+'개'));det.append(sum);
    for(const f of c.files){const b=btn('',()=>openLog(c,f,b));b.dataset.noicon='1';const t=el('span',fmtShort(f.at));t.title=fmt(f.at);b.append(t,el('span',kb(f.size),'muted'));det.append(b);}
    box.append(det);}}
async function openLog(c,f,button){
  for(const b of document.querySelectorAll('#cl-list button'))b.setAttribute('aria-pressed',String(b===button));
  const head=$('cl-head');head.hidden=false;$('cl-empty').hidden=true;$('cl-text').hidden=false;
  head.textContent=(c.label?c.label+' · ':'')+c.prefix+' · '+fmt(f.at);
  const r=await fetch('/admin/api/client-logs/'+c.prefix+'/'+encodeURIComponent(f.name));
  $('cl-text').textContent=r.ok?await r.text():'기록을 읽지 못했습니다.';}
$('cl-refresh').addEventListener('click',loadClientLogs);

// ── upload ────────────────────────────────────────────────────────────
// A homebrew app's patch or save is the inside of its switch/<app>/ folder, not a game's atmosphere/ tree.
const UP_HINT_HB={
  patch:'홈브류 앱의 패치를 zip 이나 폴더로 올립니다. 기기의 switch/<앱>/ 안에 놓일 파일을 그 구조 그대로 넣습니다.',
  save:'홈브류 앱의 세이브를 zip 이나 폴더로 올립니다. 기기의 switch/<앱>/ 안에 있던 세이브 파일을 그 구조 그대로 넣습니다.',
};
const UP_HINT={
  game:'nsp·nsz·xci·xcz 파일 하나를 올립니다. 패키지 폴더 맨 위에 들어가고 라이브러리가 바로 읽습니다.',
  retro:'기종을 고르고 롬을 올립니다. CD 게임은 cue·bin 이나 디스크 여러 장을 함께 고릅니다. 표지와 베젤은 올린 뒤 알아서 찾습니다.',
  patch:'게임을 고르고 패치를 zip 이나 폴더로 올립니다. 안에 atmosphere/contents/<타이틀 ID>/… 가 있어야 합니다.',
  save:'게임을 고르고 세이브 폴더(JKSV 로 뽑은 그대로)를 zip 이나 폴더로 올립니다. 설명은 영어가 기본이고 한국어는 한국어 화면에 나옵니다.',
  homebrew:'.nro 하나나 릴리스 zip, 또는 앱 폴더를 올립니다. 감싼 폴더를 벗기고 switch/<앱>/ 하나로 정리하며, 그 밖의 파일(atmosphere/ 등)과 설명서는 빼고 무엇을 뺐는지 아래에 남깁니다.',
  client:'직접 빌드한 cookingfoil.nro 하나를 올립니다. 지금 내보내는 것을 바꾸고, 기기는 다음에 앱을 켤 때 업데이트를 받습니다. 지금보다 낮은 버전은 받지 않습니다.',
  port:'포트 게임을 홈브류와 같은 방식으로 올리고 바로 포트로 등록합니다. .nro 나 릴리스 zip, 앱 폴더를 switch/<앱>/ 하나로 정리합니다. 포트의 패치와 세이브는 올린 뒤 그 앱을 골라 따로 올립니다.',
};
let upKind=null,upInfo=null,upFiles=[],upPaths=null,upSystems=[];
${guessUpload.toString()}
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
function upHint(){const app=$('up-target').value;
  let h=!upKind?(upFiles.length?'파일 이름만으로는 종류를 알 수 없습니다. 위에서 종류를 고릅니다.':'올릴 종류를 고르거나, 아래에 파일을 바로 놓습니다.'):app&&UP_HINT_HB[upKind]?UP_HINT_HB[upKind]:UP_HINT[upKind];
  if(upKind==='retro'&&upSystems.length>1)h+=' 이 확장자는 여러 기종이 씁니다. 기종이 맞는지 확인합니다.';
  if(upKind==='game'&&upFiles.length>1)h+=' 고른 '+upFiles.length+'개를 하나씩 차례로 올립니다.';
  $('up-hint').textContent=h;}
function upChosen(){const n=upFiles.length;const size=upFiles.reduce((a,f)=>a+f.size,0);
  $('up-drop').classList.toggle('has',n>0);$('up-form').hidden=!(n||$('up-target').value);
  $('up-drop-t').textContent=n?'다른 파일로 바꾸려면 여기에 다시 놓습니다':'파일이나 폴더를 여기에 끌어다 놓습니다';
  $('up-chosen').textContent=n?(upPaths?upPaths[0].split('/')[0]+'/ · ':'')+(n===1?upFiles[0].name:n+'개 파일')+' · '+(size/1048576).toFixed(1)+' MB'
    :'놓은 파일의 이름을 보고 종류를 알아서 고릅니다';}
function upSetKind(kind){upKind=kind;
  for(const b of document.querySelectorAll('#up-kinds [data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
  upHint();
  const ps=kind==='patch'||kind==='save';
  $('up-system-l').hidden=kind!=='retro';
  $('up-name-l').hidden=$('up-target-l').hidden=!ps;
  $('up-game-l').hidden=!ps||$('up-target').value!=='';
  $('up-desc-l').hidden=!ps;
  $('up-savetype-l').hidden=!(kind==='save'&&$('up-target').value==='');
  $('up-required-l').hidden=!(kind==='patch'&&$('up-target').value==='');
  const w=kind&&upInfo&&upInfo.targets[kind==='port'?'homebrew':kind];$('up-note').replaceChildren();
  if(w&&!w.writable){const n=el('div',null,'note warn');
    n.append(el('div',w.exists===false?'이 종류를 받을 폴더가 서버에 없습니다':'이 폴더는 지금 쓸 수 없습니다','t'),
      el('div',w.exists===false?'compose 에서 이 폴더를 마운트하고 컨테이너를 다시 띄웁니다. 폴더 위치는 README 의 폴더 설명을 봅니다.'
        :'compose 에서 이 폴더 마운트의 read_only 를 false 로 바꾸고 컨테이너를 다시 띄웁니다.','d'));$('up-note').append(n);}
  $('up-go').disabled=!(w&&w.writable);}
async function loadUploadInfo(){
  if(upInfo)return true;
  try{upInfo=await api('/admin/api/upload/targets');}catch(e){toast(e.message);return false;}
  $('up-system').replaceChildren(...upInfo.systems.map((s)=>{const o=el('option',s.name+' ('+s.extensions.join(' ')+')');o.value=s.id;return o;}));
  $('up-games').replaceChildren(...upInfo.games.map((g)=>{const o=el('option',g.titleId);o.value=g.name+' ['+g.titleId+']';return o;}));
  // A homebrew app's patch or save goes into its own switch/<app>/ folder.
  for(const h of upInfo.homebrew||[]){const o=el('option',(h.kind==='port'?'포트 · ':'홈브류 · ')+h.name+' (switch/'+h.app+'/)');o.value=h.app;$('up-target').append(o);}
  return true;}
async function loadUpload(){
  if(!await loadUploadInfo())return;
  if(upPending){$('up-target').value=upPending.app;upKind=upPending.kind;upPending=null;}
  upSetKind(upKind);upChosen();}
// New files: guess what they are and fill in what the names tell.
async function upTake(files,paths){
  if(!files.length||!await loadUploadInfo())return;
  upFiles=files;upPaths=paths;
  const zip=!paths&&files.length===1&&/[.]zip$/i.test(files[0].name)?await zipNames(files[0]):null;
  const g=guessUpload({names:files.map((f)=>f.name),paths,zipNames:zip,systems:upInfo.systems});
  // Picked from a homebrew app's row: its patch or save stays that.
  const keep=$('up-target').value&&(upKind==='patch'||upKind==='save');
  upSystems=g.systems||[];if(upSystems.length)$('up-system').value=upSystems[0];
  if(g.name)$('up-name').value=g.name;
  if(g.titleId&&!keep){$('up-target').value='';const game=upInfo.games.find((x)=>x.titleId===g.titleId);
    $('up-game').value=game?game.name+' ['+game.titleId+']':g.titleId;}
  // Picked as a port: a homebrew guess stays a port.
  // A kind picked before the files stays when their names say nothing.
  upSetKind(keep?upKind:upKind==='port'&&g.kind==='homebrew'?'port':g.kind??upKind);upChosen();}
function upReset(){upFiles=[];upPaths=null;upSystems=[];
  for(const id of ['up-name','up-desc','up-desc-ko','up-savetype'])$(id).value='';
  $('up-required').checked=false;
  upSetKind(null);upChosen();}
$('up-target').addEventListener('change',()=>{$('up-game-l').hidden=$('up-target').value!=='';
  $('up-savetype-l').hidden=!(upKind==='save'&&$('up-target').value==='');
  $('up-required-l').hidden=!(upKind==='patch'&&$('up-target').value==='');upHint();});
$('up-kinds').addEventListener('click',(e)=>{const b=e.target.closest('[data-kind]');if(b)upSetKind(b.dataset.kind);});
$('up-file-btn').addEventListener('click',()=>$('up-file').click());
$('up-dir-btn').addEventListener('click',()=>$('up-dir').click());
$('up-drop').addEventListener('click',(e)=>{if(!e.target.closest('button'))$('up-file').click();});
$('up-drop').addEventListener('keydown',(e)=>{if(e.target===$('up-drop')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();$('up-file').click();}});
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
// One request; resolves to whether it went in, after logging the answer.
function upSend(files,paths,label){return new Promise((resolve)=>{
  const fd=new FormData();
  if(upKind==='retro')fd.append('system',$('up-system').value);
  if(upKind==='patch'||upKind==='save'){const app=$('up-target').value;
    if(app)fd.append('homebrew',app);else fd.append('titleId',upTitleId());fd.append('name',$('up-name').value.trim());
    fd.append('description',$('up-desc').value.trim());fd.append('descriptionKo',$('up-desc-ko').value.trim());
    if(upKind==='save'&&!app&&$('up-savetype').value)fd.append('saveType',$('up-savetype').value);
    if(upKind==='patch'&&!app&&$('up-required').checked)fd.append('required','true');}
  if(upKind==='port')fd.append('port','true');
  if(paths)fd.append('paths',JSON.stringify(paths));
  for(const f of files)fd.append('files',f,f.name);
  const xhr=new XMLHttpRequest();const bar=$('up-bar');bar.hidden=false;bar.firstElementChild.style.width='0';$('up-progress').textContent=label;
  xhr.upload.addEventListener('progress',(ev)=>{if(ev.lengthComputable)bar.firstElementChild.style.width=(ev.loaded/ev.total*100).toFixed(1)+'%';});
  xhr.addEventListener('loadend',()=>{
    if(xhr.status===401){location.reload();return;}
    let d={};try{d=JSON.parse(xhr.responseText);}catch{}
    const ok=xhr.status===201;const n=el('div',null,'note'+(ok?'':' warn'));
    n.append(el('div',(ok?'올렸습니다':'올리지 못했습니다')+(label?' · '+label:''),'t'),el('div',ok?(d.where+' · 파일 '+d.files+'개'+(d.kind==='port'?' · 포트로 등록':'')):(d.error||('HTTP '+xhr.status)),'d'));
    if(ok&&d.install){for(const x of d.install.excluded||[])n.append(el('div','일부 파일 제외('+(HB_EXCLUDED[x.rule]||x.rule)+'): '+x.paths.join(', '),'d'));
      if(d.install.rules?.length)n.append(el('div','판단 근거: '+d.install.rules.join(' · '),'d'));}
    $('up-log').prepend(n);resolve(ok);});
  xhr.open('POST','/admin/api/upload/'+(upKind==='port'?'homebrew':upKind));xhr.send(fd);});}
$('up-form').addEventListener('submit',async(e)=>{e.preventDefault();
  if(!upFiles.length){toast('올릴 파일을 고릅니다');return;}
  if(!upKind){toast('종류를 고릅니다');return;}
  if(upKind==='patch'||upKind==='save'){
    if(!$('up-target').value&&!upTitleId()){toast('게임이나 홈브류 앱을 고릅니다');return;}
    if(!$('up-name').value.trim()){toast('이름을 적습니다');return;}}
  $('up-go').disabled=$('up-clear').disabled=true;
  let ok=true;
  if(upKind==='game'&&upFiles.length>1){const list=upFiles;
    for(const [i,f] of list.entries())ok=(await upSend([f],null,(i+1)+' / '+list.length+' · '+f.name))&&ok;}
  else ok=await upSend(upFiles,upPaths,'');
  $('up-go').disabled=$('up-clear').disabled=false;$('up-bar').hidden=true;$('up-progress').textContent='';
  if(ok){upReset();toast('올렸습니다');}else toast('올리지 못한 것이 있습니다. 아래 기록을 봅니다');});

// ── library ───────────────────────────────────────────────────────────
function uptime(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return (d?d+'일 ':'')+(h?h+'시간 ':'')+m+'분';}
// The admin's own description of a game; titledb refreshes never overwrite it.
let gdGames=[],gdId='';
async function loadDescGames(){let d;try{d=await api('/admin/api/descriptions');}catch(err){toast(err.message);return;}
  gdGames=d.games||[];$('gd-games').replaceChildren(...gdGames.map((g)=>{const o=el('option',g.edited?'직접 씀':g.titleId);o.value=g.name+' ['+g.titleId+']';return o;}));}
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
  $('gd-body').hidden=false;ptGame();}
$('gd-game').addEventListener('change',()=>openDesc());
$('gd-form').addEventListener('submit',async(e)=>{e.preventDefault();if(!gdId)return;
  try{await api('/admin/api/descriptions/'+gdId,{method:'POST',body:{name:{ko:$('gd-name-ko').value,en:$('gd-name-en').value},description:{ko:$('gd-ko').value,en:$('gd-en').value},notes:{ko:$('gd-notes-ko').value,en:$('gd-notes-en').value}}});toast('저장했습니다');openDesc(true);loadDescGames();}catch(err){toast(err.message);}});
$('gd-reset').addEventListener('click',async()=>{if(!gdId||!await ask('직접 쓴 소개를 지우고 titledb 소개로 돌아갑니다. 추가 정보는 그대로 둡니다.'))return;
  try{await api('/admin/api/descriptions/'+gdId+'/reset',{method:'POST',body:{field:'description'}});toast('원래 소개로 돌렸습니다');openDesc(true);loadDescGames();}catch(err){toast(err.message);}});
// The library tab shows one area at a time and loads only that one: #library/patches opens a given area.
const LIB_SUBS=['files','verify','patches','saves','info','server'];let libSub='files';
function libLoadSub(){
  if(libSub==='files')lbLoad();else if(libSub==='verify')lvLoad();else if(libSub==='patches'||libSub==='saves')loadPatches();
  else if(libSub==='info')loadDescGames();}
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
  const dl=$('settings');dl.replaceChildren();for(const [k,v] of rows)dl.append(el('dt',k),el('dd',String(v)));}
$('rescan').addEventListener('click',async()=>{$('rescan').disabled=true;
  try{await api('/admin/api/library/rescan',{method:'POST',body:{}});toast('다시 스캔을 시작했습니다. 끝나면 숫자가 바뀝니다.');
    setTimeout(loadLibrary,3000);}catch(err){toast(err.message);}finally{$('rescan').disabled=false;}});

// ── featured ──────────────────────────────────────────────────────────
let featured=[],names=new Map(),featuredDirty=false;
const ID_TAIL=/([0-9A-Fa-f]{16})\\s*$/;
function markDirty(){featuredDirty=true;$('f-save').textContent='저장 (바뀜)';}
async function loadFeatured(){
  if(featuredDirty)return;
  try{const d=await api('/admin/api/featured');featured=d.collections;
    names=new Map(d.candidates.map((c)=>[c.titleId,c.name]));
    const list=$('f-candidates');list.replaceChildren();
    for(const c of d.candidates){const o=el('option');o.value=c.name+' · '+c.titleId;list.append(o);}
    renderFeatured();}catch(err){toast(err.message);}}
function move(arr,i,d){const j=i+d;if(j<0||j>=arr.length)return;[arr[i],arr[j]]=[arr[j],arr[i]];}
function renderFeatured(){const box=$('f-list');box.replaceChildren();
  if(!featured.length){box.append(el('div','아직 추천 줄이 없습니다. 추천 줄 추가를 누릅니다.','empty'));return;}
  featured.forEach((c,ci)=>{const card=el('div',null,'fcard');
    const top=el('div',null,'top');const title=el('input');title.value=c.title;title.maxLength=40;
    title.placeholder='줄 제목 (예: 이번 주 추천)';title.setAttribute('aria-label','줄 제목');
    title.addEventListener('input',()=>{c.title=title.value;markDirty();});
    const banner=el('select');banner.setAttribute('aria-label','배너');banner.append(new Option('배너 없음',''));
    for(const id of c.titleIds)banner.append(new Option('배너: '+(names.get(id)||id),id,false,id===c.bannerTitleId));
    banner.addEventListener('change',()=>{c.bannerTitleId=banner.value||null;markDirty();});
    top.append(title,banner,btn('▲',()=>{move(featured,ci,-1);markDirty();renderFeatured();}),
      btn('▼',()=>{move(featured,ci,1);markDirty();renderFeatured();}),
      btn('줄 삭제',async()=>{if(!await ask('"'+(c.title||'제목 없음')+'" 줄을 삭제합니다.'))return;featured.splice(ci,1);markDirty();renderFeatured();},'danger'));
    card.append(top);
    const ul=el('ul',null,'fgames');
    c.titleIds.forEach((id,gi)=>{const li=el('li');const img=el('img');img.src='/api/shop/icon/'+id+'?size=sm';img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
      li.append(img,el('span',names.get(id)||id,'name'),
        btn('▲',()=>{move(c.titleIds,gi,-1);markDirty();renderFeatured();}),
        btn('▼',()=>{move(c.titleIds,gi,1);markDirty();renderFeatured();}),
        btn('빼기',()=>{c.titleIds.splice(gi,1);if(c.bannerTitleId===id)c.bannerTitleId=null;markDirty();renderFeatured();}));
      ul.append(li);});
    if(c.titleIds.length)card.append(ul);
    const add=el('form',null,'fadd');const q=el('input');q.setAttribute('list','f-candidates');
    q.placeholder='게임 이름이나 타이틀 ID 로 찾습니다';q.setAttribute('aria-label','추가할 게임');
    const addBtn=el('button','게임 추가');addBtn.type='submit';add.append(q,addBtn);
    add.addEventListener('submit',(e)=>{e.preventDefault();const m=ID_TAIL.exec(q.value.trim());
      const id=m&&m[1].toUpperCase();
      if(!id||!names.has(id)){toast('목록에서 게임을 고릅니다.');return;}
      if(c.titleIds.includes(id)){toast('이미 들어 있습니다.');return;}
      c.titleIds.push(id);markDirty();renderFeatured();});
    card.append(add);box.append(card);});}
$('f-add').addEventListener('click',()=>{featured.push({title:'',bannerTitleId:null,titleIds:[]});markDirty();renderFeatured();});
$('f-save').addEventListener('click',async()=>{
  try{const d=await api('/admin/api/featured',{method:'PUT',body:{collections:featured}});featured=d.collections;
    featuredDirty=false;$('f-save').textContent='저장';renderFeatured();toast('추천을 저장했습니다.');}
  catch(err){toast(err.message);}});
addEventListener('beforeunload',(e)=>{if(featuredDirty)e.preventDefault();});

// ── admin login: password and/or authenticator ─────────────────
const grouped=(s)=>String(s).replace(/(.{4})/g,'$1 ').trim();
async function loadTfa(){
  let s;try{s=await api('/admin/api/2fa');}catch(e){$('tfa-status').textContent='불러오지 못했습니다: '+e.message;return;}
  $('tfa-status').textContent=s.password
    ?(s.authenticator?'관리자 비밀번호나 인증 앱 코드 중 하나로 들어갑니다. 휴대폰이 없을 때는 비밀번호로, 평소에는 코드로 들어가면 됩니다.':'관리자 비밀번호로 들어갑니다. 인증 앱을 등록하면 비밀번호 대신 6자리 코드로도 들어갈 수 있습니다.')
    :(s.authenticator?'인증 앱 코드로 들어갑니다.':'인증 앱 코드로 들어갑니다. 아직 등록한 앱이 없습니다.');
  renderAdminPassword(s);
  const box=$('tfa-actions');box.replaceChildren();
  if(!s.manageable){box.append(el('span','COOK_ADMIN_TOTP_SECRET 으로 고정돼 있어 여기서 바꿀 수 없습니다.','muted'));return;}
  box.append(btn(s.authenticator?'인증 앱 다시 등록':'인증 앱 등록',startTfa,'primary'));
  if(s.password&&s.authenticator)box.append(btn('인증 앱 끄기',async()=>{
    if(!await ask('인증 앱을 끄면 관리자 비밀번호로만 들어갑니다. 끌까요?'))return;
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
$('ap-clear').addEventListener('click',async()=>{if(!await ask('여기서 정한 관리자 비밀번호를 삭제합니다.'))return;
  try{const s=await api('/admin/api/admin-password/clear',{method:'POST',body:{current:$('ap-current').value}});
    $('ap-current').value='';toast('비밀번호를 삭제했습니다.');renderAdminPassword(s);loadTfa();}catch(err){toast(err.message);}});
async function startTfa(){
  try{const d=await api('/admin/api/2fa/start',{method:'POST',body:{}});
    $('tfa-qr').innerHTML=d.qr||'';$('tfa-key').textContent=grouped(d.secret);
    $('tfa-setup').hidden=false;$('tfa-code').value='';$('tfa-code').focus();}catch(e){toast(e.message);}}
async function confirmTfa(){const code=$('tfa-code').value.trim();
  if(!/^\d{6}$/.test(code)){toast('숫자 6자리를 입력합니다.');return;}
  try{await api('/admin/api/2fa/confirm',{method:'POST',body:{code}});
    $('tfa-setup').hidden=true;$('tfa-qr').replaceChildren();$('tfa-key').textContent='';
    toast('인증 앱을 등록했습니다. 다음 로그인부터 코드도 묻습니다.');loadTfa();}
  catch(e){toast(e.message==='code does not match'?'코드가 맞지 않습니다. 앱에 나온 최신 코드를 넣습니다.':e.message==='enrollment expired, start again'?'시간이 지났습니다. 다시 등록합니다.':e.message);}}
$('tfa-confirm').addEventListener('click',confirmTfa);
$('tfa-code').addEventListener('keydown',(e)=>{if(e.key==='Enter')confirmTfa();});
$('tfa-cancel').addEventListener('click',()=>{$('tfa-setup').hidden=true;$('tfa-qr').replaceChildren();$('tfa-key').textContent='';});

// Signs out of the admin page and of the web session together.
$('logout').addEventListener('click',async()=>{try{await fetch('/admin/logout',{method:'POST'});
  const me=await fetch('/auth/me').then((r)=>r.ok?r.json():null);if(me)await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':me.csrf}});}
  finally{location.href='/login?next=%2Fadmin';}});
// The account circle in the header.
function setAcct(open){$('acct-list').hidden=!open;$('acct-btn').setAttribute('aria-expanded',String(open));}
$('acct-btn').addEventListener('click',(e)=>{e.stopPropagation();setAcct($('acct-list').hidden);});
document.addEventListener('click',(e)=>{if(!$('acct-list').hidden&&!e.target.closest('.acct-menu'))setAcct(false);});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!$('acct-list').hidden){setAcct(false);$('acct-btn').focus();}});
// Theme: the system setting until the switch is used here or on the web page (same key).
const THEME_KEY='cookingfoil:theme';
const systemLight=matchMedia('(prefers-color-scheme: light)');
const currentTheme=()=>document.documentElement.dataset.theme||(systemLight.matches?'light':'dark');
function syncThemeMenu(){$('theme-toggle').setAttribute('aria-checked',String(currentTheme()==='dark'));}
$('theme-toggle').addEventListener('click',()=>{const v=currentTheme()==='dark'?'light':'dark';document.documentElement.dataset.theme=v;
  try{localStorage.setItem(THEME_KEY,v);}catch{/* storage blocked: this visit only */}
  syncThemeMenu();});
systemLight.addEventListener('change',syncThemeMenu);
syncThemeMenu();
// The address a console is given, for the how-to on the devices tab.
function showShopUrl(){$('shop-url').textContent=origin.replace(/[/]$/,'')+'/shop.tfl';}
$('shop-url-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('shop-url').textContent);toast('주소를 복사했습니다');}catch{toast('복사하지 못했습니다. 주소를 직접 고릅니다');}});
showShopUrl();
// A tab that fails to load says so instead of leaving old rows on screen; the same failure is told once.
let loadErr='';
function guarded(fn){return async(...a)=>{try{const r=await fn(...a);loadErr='';return r;}
  catch(err){const m='불러오지 못했습니다: '+(err&&err.message||err);if(m!==loadErr)toast(m);loadErr=m;}};}
loadHealth=guarded(loadHealth);loadStats=guarded(loadStats);loadDevices=guarded(loadDevices);loadLogins=guarded(loadLogins);
loadAccounts=guarded(loadAccounts);loadServerSettings=guarded(loadServerSettings);loadGoogle=guarded(loadGoogle);loadLibrary=guarded(loadLibrary);loadHomebrew=guarded(loadHomebrew);
showTab();loadStats();loadDevices();loadLogins();loadAccounts();loadGoogle();
setInterval(()=>{if(!$('cred-dialog').open){loadStats();loadDevices();loadLogins();loadAccounts();}},15000);
`;
