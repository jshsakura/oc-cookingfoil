/**
 * Browser script for the /admin dashboard (inlined into the page).
 * Plain DOM, no framework: the page must work on an offline LAN box.
 */
export const DASHBOARD_SCRIPT = /* js */ `
const $=(id)=>document.getElementById(id);
const fmt=(t)=>t?new Date(t).toLocaleString('ko-KR'):'—';
const ago=(t)=>{if(!t)return '—';const s=Math.round((Date.now()-t)/1000);
  if(s<60)return s+'초 전';if(s<3600)return Math.round(s/60)+'분 전';
  if(s<86400)return Math.round(s/3600)+'시간 전';return Math.round(s/86400)+'일 전';};
const num=(n)=>Number(n||0).toLocaleString('ko-KR');
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;}
function td(txt,cls){return el('td',txt,cls);}
function btn(txt,fn,cls){const b=el('button',txt,cls);b.type='button';b.addEventListener('click',fn);return b;}
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
const TABS=['overview','users','devices','settings','logs','featured','library','upload','homebrew'];
function showTab(){const want=location.hash.slice(1);const tab=TABS.includes(want)?want:'overview';
  for(const name of TABS){$('tab-'+name).hidden=name!==tab;
    const a=document.querySelector('[data-tab="'+name+'"]');if(name===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  if(tab==='library')loadLibrary();
  if(tab==='settings'){loadTfa();loadGoogle();}
  if(tab==='logs')loadClientLogs();
  if(tab==='homebrew')loadHomebrew();
  if(tab==='featured')loadFeatured();
  if(tab==='upload')loadUpload();}
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
function renderSecurity(d){
  const locks=d.lockouts||[];
  $('lock-count').hidden=!locks.length;$('lock-count').textContent=locks.length;
  $('unlock-all').disabled=!locks.length;
  table('lockouts',['IP','이유','차단 시각','해제 예정',''],locks.map((l)=>{const tr=el('tr');
    tr.append(td(l.ip,'ip'),td(l.reason||'—'),td(fmt(l.lockedAt)),td(l.until?fmt(l.until):'직접 해제할 때까지'));
    const act=td();act.append(btn('해제',()=>unlock(l.ip)));tr.append(act);return tr;}),'차단된 IP 가 없습니다.');
  table('denials',['시각','이유','클라이언트','경로','IP'],(d.denials?.recent||[]).map((x)=>{const tr=el('tr');
    const w=td(ago(x.at));w.title=fmt(x.at);tr.append(w);
    const r=td();r.append(pill(x.reason,'warn'));if(x.status)r.append(' ',pill(String(x.status)));
    if(x.hint)r.append(el('div',x.hint,'muted'));tr.append(r);
    tr.append(td(x.ua||'—'),td(x.path||'—','ip'),td(x.ip||'—','ip'));return tr;}),'거부된 요청이 없습니다.');}
async function loadStats(){
  const d=await api('/admin/api/stats');
  me=d.me||null;const a=d.lanes.admin;
  $('who').textContent=(me?(me.name||me.email):(a.email||a.owner||'admin'))+' 계정으로 로그인했습니다';
  $('ts').textContent=fmt(d.generatedAt)+' 기준';
  renderWarnings(d.warnings||[]);renderLanes(d.lanes);renderCards(d);renderUsers(d.users||[]);renderSecurity(d);}

// ── users ─────────────────────────────────────────────────────────────
let lastCred=null;
function showCredential(title,cred){lastCred=cred;$('cred-title').textContent=title;
  const box=$('cred');box.replaceChildren();
  // CyberFoil takes the shop's root as its eShop URL; Tinfoil's File Browser wants shop.tfl.
  for(const [label,value] of [['CyberFoil eShop 주소',origin+'/'],['Tinfoil 주소',origin+'/shop.tfl'],['사용자',cred.name],['비밀번호',cred.password]]){
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
  if(first&&!confirm('첫 사용자를 만들면 그때부터 이 서버 전체에 비밀번호가 필요합니다. 계속할까요?'))return;
  try{const cred=await api('/admin/api/users',{method:'POST',body:{name,password,role:$('new-role').value}});
    $('new-name').value='';$('new-pass').value='';showCredential(name+' 계정을 만들었습니다',cred);loadStats();}
  catch(err){toast(err.message);}});
async function resetPassword(name){if(!confirm(name+' 의 비밀번호를 새로 만듭니다. 지금 비밀번호는 바로 쓸 수 없게 됩니다.'))return;
  try{const cred=await api('/admin/api/users/'+encodeURIComponent(name)+'/password',{method:'POST',body:{}});
    showCredential(name+' 의 새 비밀번호',cred);loadStats();}catch(err){toast(err.message);}}
async function setRole(name,role){
  if(!confirm(role==='admin'?name+' 계정을 관리자로 바꿉니다. 이 계정도 관리 페이지를 열 수 있게 됩니다.':name+' 계정을 일반 사용자로 바꿉니다. 이 계정은 관리 페이지를 열 수 없게 됩니다.'))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/role',{method:'POST',body:{role}});toast('역할을 바꿨습니다.');loadStats();}catch(err){toast(errText(err));}}
async function setEnabled(name,enabled){
  if(!enabled&&!confirm(name+' 계정을 사용 중지합니다. 이 계정으로는 접속할 수 없게 됩니다.'))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/enabled',{method:'POST',body:{enabled}});
    toast(enabled?'다시 사용합니다.':'사용을 중지했습니다.');loadStats();}catch(err){toast(errText(err));}}
async function removeUser(name){
  const last=(await api('/admin/api/users')).users.length===1;
  const msg=last?name+' 은 마지막 계정입니다. 지우면 비밀번호 없이 누구나 이 서버에 접속하고 파일을 받습니다. 정말 지울까요?'
    :name+' 계정을 삭제합니다. 이 계정으로 접속하던 기기는 더 접속할 수 없습니다.';
  if(!confirm(msg))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+(last?'?allowEmpty=1':''),{method:'DELETE'});toast('삭제했습니다.');loadStats();}
  catch(err){toast(errText(err));}}

// ── security ──────────────────────────────────────────────────────────
async function unlock(ip){if(!confirm(ip+' 의 차단을 해제합니다.'))return;
  try{await api('/admin/api/unlock',{method:'POST',body:{ip}});toast('차단을 해제했습니다.');loadStats();}catch(err){toast(err.message);}}
$('unlock-all').addEventListener('click',async()=>{if(!confirm('차단된 IP 를 모두 해제합니다.'))return;
  try{const r=await api('/admin/api/unlock',{method:'POST',body:{ip:'all'}});toast(r.unlocked+'개를 해제했습니다.');loadStats();}catch(err){toast(err.message);}});
$('clrdeny').addEventListener('click',async()=>{if(!confirm('거부 기록을 지웁니다.'))return;
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
    if(a.status==='approved'&&!self)box.append(btn('사용 중지',()=>setAccount(a.sub,'disabled')));
    if(!self)box.append(btn('삭제',()=>removeAccount(a.sub,a.email),'danger'));
    act.append(box);tr.append(act);return tr;}),'아직 로그인한 계정이 없습니다.');}
async function setAccountRole(sub,email,role){
  if(!confirm(role==='admin'?email+' 계정을 관리자로 바꿉니다.':email+' 계정을 일반 사용자로 바꿉니다.'))return;
  try{await api('/admin/api/accounts/role',{method:'POST',body:{sub,role}});toast('역할을 바꿨습니다.');loadAccounts();}catch(err){toast(errText(err));}}
async function setAccount(sub,status){
  try{await api('/admin/api/accounts/status',{method:'POST',body:{sub,status}});toast(status==='approved'?'승인했습니다.':'사용을 중지했습니다.');loadAccounts();}catch(err){toast(errText(err));}}
async function removeAccount(sub,email){if(!confirm(email+' 계정을 지웁니다. 다시 로그인하면 승인 대기로 돌아옵니다.'))return;
  try{await api('/admin/api/accounts/remove',{method:'POST',body:{sub}});toast('지웠습니다.');loadAccounts();}catch(err){toast(errText(err));}}

async function loadGoogle(){
  const g=await api('/admin/api/google');$('g-enabled').checked=g.enabled;$('g-id').value=g.clientId||'';
  $('g-secret').value='';$('g-secret').placeholder=g.hasSecret?'저장된 시크릿을 씁니다 (바꿀 때만 입력)':'클라이언트 시크릿';
  $('g-redirect').textContent=g.redirectUri;
  $('g-status').textContent=g.active?'켜져 있습니다. 로그인 화면에 구글 버튼이 나옵니다.':g.enabled?'켜려면 ID 와 시크릿이 모두 필요합니다.':'꺼져 있습니다. 로그인 화면은 아이디와 비밀번호만 받습니다.';}
$('google-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/google',{method:'POST',body:{enabled:$('g-enabled').checked,clientId:$('g-id').value,clientSecret:$('g-secret').value}});
    toast('저장했습니다.');loadGoogle();loadAccounts();}catch(err){toast(err.message);}});
$('g-clear').addEventListener('click',async()=>{if(!confirm('구글 클라이언트 ID 와 시크릿을 지우고 구글 로그인을 끕니다.'))return;
  try{await api('/admin/api/google/clear',{method:'POST',body:{}});toast('지웠습니다.');loadGoogle();loadAccounts();}catch(err){toast(err.message);}});
$('g-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('g-redirect').textContent);toast('복사했습니다.');}catch{toast('복사하지 못했습니다. 직접 선택해 복사합니다.');}});

// ── devices ───────────────────────────────────────────────────────────
async function loadDevices(){
  const d=await api('/admin/api/devices');
  $('devhint').textContent=d.pairingEnabled?'CookingFoil 클라이언트가 승인을 요청하면 여기에 나옵니다. 기기 화면의 기기 코드를 넣거나 목록에서 승인하면 비밀번호 없이 접속합니다.'
    :'기기 승인이 꺼져 있습니다. 쓰려면 compose 에 COOK_DEVICE_PAIRING=true 를 넣습니다.';
  const pending=d.pending||[];$('pending-count').hidden=!pending.length;$('pending-count').textContent=pending.length;
  table('pending',['기기 코드','기기 키','요청 시각',''],pending.map((p)=>{const tr=el('tr');
    const k=td(p.deviceKey.slice(0,16)+'…','ip');k.title=p.deviceKey;tr.append(td(p.code||'—','ip'),k,td(fmt(p.lastSeenAt)));
    const act=td();act.append(btn('승인',()=>approve(p.deviceKey),'primary'));tr.append(act);return tr;}),'승인을 기다리는 기기가 없습니다.');
  // Last seen is kept in memory only, so it starts empty after a restart.
  const seenSince='서버 시작('+fmt(d.since)+') 뒤로 접속 없음';
  table('devices',['이름','연결한 계정','마지막 접속','승인한 날','기기 키',''],(d.approved||[]).map((a)=>{const tr=el('tr');
    const seen=td(a.lastSeenAt?ago(a.lastSeenAt):'—',a.lastSeenAt?'':'dim');seen.title=a.lastSeenAt?fmt(a.lastSeenAt):seenSince;
    tr.append(td(a.label||'—'),td(a.addedBy==='admin'?'관리자':String(a.addedBy||'—').replace(/^google:/,'')),seen,td(fmt(a.addedAt)));
    const k=td(a.deviceKey.slice(0,16)+'…','ip');k.title=a.deviceKey;tr.append(k);
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('이름 바꾸기',()=>renameDevice(a.deviceKey,a.label)),btn('키 재발급',()=>reissue(a.deviceKey,a.label)),btn('접근 키 회수',()=>revoke(a.deviceKey),'danger'));
    act.append(box);tr.append(act);return tr;}),'승인된 기기가 없습니다.');}
$('approve-code').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/devices/approve',{method:'POST',body:{code:$('code-in').value,label:$('code-label').value}});
    toast('승인했습니다. 기기가 다음 확인 때 접속 키를 받습니다.');$('code-in').value='';$('code-label').value='';loadDevices();}
  catch(err){toast(err.message==='no device is waiting with that code'?'그 코드로 승인을 기다리는 기기가 없습니다. 기기 화면의 코드를 다시 확인합니다.':err.message);}});
async function loadLogins(){
  const d=await api('/admin/api/device-logins');$('add-login').hidden=!d.enabled;
  table('logins',['이름','아이디','만든 계정','묶인 기기','만든 날',''],(d.logins||[]).map((l)=>{const tr=el('tr');
    const k=td(l.deviceKey?l.deviceKey.slice(0,16)+'…':'아직 접속 전','ip');if(l.deviceKey)k.title=l.deviceKey;
    tr.append(td(l.label||'—'),td(l.name,'ip'),td(l.owner==='admin'?'관리자':l.owner+(l.active?'':' (꺼짐)')),k,td(fmt(l.createdAt)));
    const act=td();act.append(btn('폐기',async()=>{if(!confirm(l.name+' 을 폐기합니다. 이 아이디로 접속하던 기기는 바로 끊깁니다.'))return;
      try{await api('/admin/api/device-logins/'+encodeURIComponent(l.name)+'/revoke',{method:'POST',body:{}});toast('폐기했습니다.');loadLogins();}catch(err){toast(err.message);}},'danger'));
    tr.append(act);return tr;}),d.enabled?'만든 접속 정보가 없습니다.':'서버 계정이 없어서 비밀번호 접속이 꺼져 있습니다.');}
$('add-login').addEventListener('submit',async(e)=>{e.preventDefault();
  try{const c=await api('/admin/api/device-logins',{method:'POST',body:{label:$('login-label').value}});$('login-label').value='';
    showCredential('기기 접속 정보를 만들었습니다',c);loadLogins();}catch(err){toast(err.message);}});
async function approve(deviceKey){const label=prompt('이 기기를 알아볼 이름을 정합니다 (예: 친구 기기)','');if(label===null)return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label}});toast('승인했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function reissue(deviceKey,label){if(!confirm('새 접속 키를 발급합니다. 기기는 다음 접속 때 새 키를 받고, 지금 키는 바로 쓸 수 없게 됩니다.'))return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label:label||''}});toast('새 키를 준비했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function revoke(deviceKey){if(!confirm('이 기기의 접근 키를 회수합니다. 다시 승인하기 전까지 비밀번호 없이는 접속할 수 없습니다.'))return;
  try{await api('/admin/api/devices/revoke',{method:'POST',body:{deviceKey}});toast('접근 키를 회수했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function renameDevice(deviceKey,label){const next=prompt('이 기기의 이름을 정합니다',label||'');if(next===null)return;
  try{await api('/admin/api/devices/label',{method:'POST',body:{deviceKey,label:next}});toast('이름을 바꿨습니다.');loadDevices();}catch(err){toast(err.message);}}

// ── homebrew ──────────────────────────────────────────────────────────
const mb=(n)=>n==null?'—':(n/1048576).toFixed(1)+' MB';
async function loadHomebrew(){
  const d=await api('/admin/api/homebrew');
  const reco=$('hb-reco');reco.replaceChildren();
  for(const r of d.recommended||[]){const l=el('label');const c=el('input');c.type='checkbox';c.value=r.repo;c.disabled=r.added;
    l.classList.toggle('added',r.added);const t=el('div');t.append(el('b',r.repo),el('span',(r.purpose.ko||r.purpose.en)+(r.added?' · 추가됨':'')));
    l.append(c,t);reco.append(l);}
  table('hb-sources',['저장소','버전','쓰는 파일','상태','마지막 확인',''],(d.sources||[]).map((s)=>{const tr=el('tr');
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
    const st=td();
    if(s.error){st.append(pill('오류','off'));st.append(el('div',s.error.message,'err'));}
    else if(s.cached)st.append(pill(s.cached.current?'받아 둠 · '+mb(s.cached.size):'새 버전 있음',s.cached.current?'on':'warn'));
    else st.append(pill(s.checked_at?'아직 받지 않음':'확인 전'));
    tr.append(st);const w=td(ago(s.checked_at));w.title=fmt(s.checked_at);tr.append(w);
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('설명',()=>editHbDesc(s.id,s.cached?.name||s.repo,s.description)),btn('지금 확인',()=>checkHb(s.repo)),btn('삭제',()=>removeHb(s.repo),'danger'));act.append(box);tr.append(act);return tr;}),
    '따라가는 저장소가 없습니다. 위에서 추천 홈브류를 고르거나 주소로 추가합니다.');
  table('hb-manual',['이름','버전','파일','크기',''],(d.manual||[]).map((m)=>{const tr=el('tr');
    const n=td(m.name||'—');const c=m.description?.custom;if(c)n.append(el('div',c.ko||c.en||'설명 없음','desc'));
    tr.append(n,td(m.version||'—'),td(m.file_name||'—','ip'),td(mb(m.size)));
    const act=td();act.append(btn('설명',()=>editHbDesc(m.id,m.name||m.file_name,m.description)));tr.append(act);return tr;}),'직접 넣은 앱이 없습니다.');}
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
$('hb-desc-reset').addEventListener('click',async()=>{
  try{await api('/admin/api/homebrew/description/reset',{method:'POST',body:{id:hbDescId}});$('hb-desc').close();toast('GitHub 기본값으로 돌렸습니다.');loadHomebrew();}catch(err){toast(err.message);}});
async function addHbRecommended(repos){
  if(!repos.length){toast('추가할 것을 고릅니다.');return;}
  try{const r=await api('/admin/api/homebrew/recommended',{method:'POST',body:{repos}});
    toast(r.added.length+'개를 추가했습니다. 첫 빌드를 받는 동안 잠시 걸립니다.');loadHomebrew();setTimeout(loadHomebrew,8000);}catch(err){toast(err.message);}}
$('hb-add-picked').addEventListener('click',()=>addHbRecommended([...document.querySelectorAll('#hb-reco input:checked')].map((c)=>c.value)));
$('hb-add-all').addEventListener('click',()=>{if(!confirm('추천 홈브류를 모두 추가합니다.'))return;
  addHbRecommended([...document.querySelectorAll('#hb-reco input:not(:disabled)')].map((c)=>c.value));});
$('hb-add').addEventListener('submit',async(e)=>{e.preventDefault();const b=e.submitter;if(b)b.disabled=true;
  try{const s=await api('/admin/api/homebrew',{method:'POST',body:{repo:$('hb-repo').value,asset:$('hb-asset').value}});
    $('hb-repo').value='';$('hb-asset').value='';toast(s?.error?'추가했지만 확인하지 못했습니다: '+s.error.message:'추가했습니다.');loadHomebrew();}
  catch(err){toast(err.message);}finally{if(b)b.disabled=false;}});
async function setHbAsset(repo,asset){
  try{const s=await api('/admin/api/homebrew/asset',{method:'POST',body:{repo,asset}});toast(s?.error?s.error.message:'쓸 파일을 바꿨습니다.');loadHomebrew();}catch(err){toast(err.message);}}
async function checkHb(repo){
  try{const s=await api('/admin/api/homebrew/check',{method:'POST',body:{repo}});toast(s?.error?s.error.message:'확인했습니다.');loadHomebrew();}catch(err){toast(err.message);}}
$('hb-check-all').addEventListener('click',async()=>{const b=$('hb-check-all');b.disabled=true;
  try{await api('/admin/api/homebrew/check',{method:'POST',body:{}});toast('모두 확인했습니다.');loadHomebrew();}catch(err){toast(err.message);}finally{b.disabled=false;}});
async function removeHb(repo){if(!confirm(repo+' 를 더 따라가지 않고 받아 둔 파일도 지웁니다.'))return;
  try{await api('/admin/api/homebrew/remove',{method:'POST',body:{repo}});toast('지웠습니다.');loadHomebrew();}catch(err){toast(err.message);}}

// ── client logs ───────────────────────────────────────────────────────
const kb=(n)=>n<1024?n+' B':(n/1024).toFixed(1)+' KB';
async function loadClientLogs(){
  const d=await api('/admin/api/client-logs');const box=$('cl-list');box.replaceChildren();
  if(!(d.consoles||[]).length){box.append(el('div','아직 받은 로그가 없습니다.','empty'));return;}
  for(const [i,c] of d.consoles.entries()){const det=el('details');det.open=i===0;
    const sum=el('summary',c.label||c.prefix);sum.append(el('span',c.files.length+'개'));det.append(sum);
    for(const f of c.files){const b=btn('',()=>openLog(c,f,b));b.append(el('span',fmt(f.at)),el('span',kb(f.size),'muted'));det.append(b);}
    box.append(det);}}
async function openLog(c,f,button){
  for(const b of document.querySelectorAll('#cl-list button'))b.setAttribute('aria-pressed',String(b===button));
  $('cl-head').textContent=(c.label?c.label+' · ':'')+c.prefix+' · '+fmt(f.at);
  const r=await fetch('/admin/api/client-logs/'+c.prefix+'/'+encodeURIComponent(f.name));
  $('cl-text').textContent=r.ok?await r.text():'기록을 읽지 못했습니다.';}
$('cl-refresh').addEventListener('click',loadClientLogs);

// ── upload ────────────────────────────────────────────────────────────
const UP_HINT={
  game:'nsp·nsz·xci·xcz 파일 하나를 올립니다. 패키지 폴더 맨 위에 들어가고 라이브러리가 바로 읽습니다.',
  retro:'기종을 고르고 롬을 올립니다. CD 게임은 cue·bin 이나 디스크 여러 장을 함께 고릅니다. 표지와 베젤은 올린 뒤 알아서 찾습니다.',
  patch:'게임을 고르고 패치를 zip 이나 폴더로 올립니다. 안에 atmosphere/contents/<타이틀 ID>/… 가 있어야 합니다.',
  save:'게임을 고르고 세이브 폴더(JKSV 로 뽑은 그대로)를 zip 이나 폴더로 올립니다. 설명은 영어가 기본이고 한국어는 한국어 화면에 나옵니다.',
};
let upKind='game',upInfo=null,upFiles=[],upPaths=null;
function upChosen(){const n=upFiles.length;const size=upFiles.reduce((a,f)=>a+f.size,0);
  $('up-chosen').textContent=n?(n===1?upFiles[0].name:n+'개 파일')+' · '+(size/1048576).toFixed(1)+' MB':'고른 파일이 없습니다';}
function upSetKind(kind){upKind=kind;upFiles=[];upPaths=null;upChosen();
  for(const b of document.querySelectorAll('#up-kinds [data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
  $('up-hint').textContent=UP_HINT[kind];
  $('up-system-l').hidden=kind!=='retro';
  $('up-game-l').hidden=$('up-name-l').hidden=!(kind==='patch'||kind==='save');
  $('up-desc-l').hidden=$('up-desc-ko-l').hidden=!(kind==='patch'||kind==='save');
  $('up-dir-btn').hidden=!(kind==='patch'||kind==='save');
  $('up-file').multiple=kind==='retro';
  $('up-file').accept=kind==='game'?'.nsp,.nsz,.xci,.xcz':(kind==='patch'||kind==='save')?'.zip':'';
  const w=upInfo&&upInfo.targets[kind];$('up-note').replaceChildren();
  if(w&&!w.writable){const n=el('div',null,'note warn');n.append(el('div','이 폴더는 지금 쓸 수 없습니다','t'),
    el('div','compose 에서 이 폴더 마운트의 read_only 를 false 로 바꾸고 컨테이너를 다시 띄웁니다.','d'));$('up-note').append(n);}
  $('up-go').disabled=!(w&&w.writable);}
async function loadUpload(){
  if(!upInfo){try{upInfo=await api('/admin/api/upload/targets');}catch(e){toast(e.message);return;}
    $('up-system').replaceChildren(...upInfo.systems.map((s)=>{const o=el('option',s.name+' ('+s.extensions.join(' ')+')');o.value=s.id;return o;}));
    $('up-games').replaceChildren(...upInfo.games.map((g)=>{const o=el('option',g.titleId);o.value=g.name+' ['+g.titleId+']';return o;}));}
  upSetKind(upKind);}
$('up-kinds').addEventListener('click',(e)=>{const b=e.target.closest('[data-kind]');if(b)upSetKind(b.dataset.kind);});
$('up-file-btn').addEventListener('click',()=>$('up-file').click());
$('up-dir-btn').addEventListener('click',()=>$('up-dir').click());
$('up-file').addEventListener('change',()=>{upFiles=[...$('up-file').files];upPaths=null;upChosen();$('up-file').value='';});
$('up-dir').addEventListener('change',()=>{upFiles=[...$('up-dir').files];upPaths=upFiles.map((f)=>f.webkitRelativePath||f.name);upChosen();$('up-dir').value='';});
function upTitleId(){const v=$('up-game').value.trim();const m=v.match(/[0-9A-Fa-f]{16}/);return m?m[0].toUpperCase():'';}
$('up-form').addEventListener('submit',(e)=>{e.preventDefault();
  if(!upFiles.length){toast('올릴 파일을 고릅니다');return;}
  const fd=new FormData();
  if(upKind==='retro')fd.append('system',$('up-system').value);
  if(upKind==='patch'||upKind==='save'){
    const tid=upTitleId();if(!tid){toast('게임을 고릅니다');return;}
    if(!$('up-name').value.trim()){toast('이름을 적습니다');return;}
    fd.append('titleId',tid);fd.append('name',$('up-name').value.trim());
    fd.append('description',$('up-desc').value.trim());fd.append('descriptionKo',$('up-desc-ko').value.trim());}
  if(upPaths)fd.append('paths',JSON.stringify(upPaths));
  for(const f of upFiles)fd.append('files',f,f.name);
  const xhr=new XMLHttpRequest();const bar=$('up-bar');bar.hidden=false;bar.firstElementChild.style.width='0';$('up-go').disabled=true;
  xhr.upload.addEventListener('progress',(ev)=>{if(ev.lengthComputable)bar.firstElementChild.style.width=(ev.loaded/ev.total*100).toFixed(1)+'%';});
  xhr.addEventListener('loadend',()=>{$('up-go').disabled=false;bar.hidden=true;
    if(xhr.status===401){location.reload();return;}
    let d={};try{d=JSON.parse(xhr.responseText);}catch{}
    const ok=xhr.status===201;const n=el('div',null,'note'+(ok?'':' warn'));
    n.append(el('div',ok?'올렸습니다':'올리지 못했습니다','t'),el('div',ok?(d.where+' · 파일 '+d.files+'개'):(d.error||('HTTP '+xhr.status)),'d'));
    $('up-log').prepend(n);
    if(ok){upFiles=[];upPaths=null;upChosen();$('up-name').value='';$('up-desc').value='';$('up-desc-ko').value='';toast('올렸습니다');}});
  xhr.open('POST','/admin/api/upload/'+upKind);xhr.send(fd);});

// ── library ───────────────────────────────────────────────────────────
function uptime(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return (d?d+'일 ':'')+(h?h+'시간 ':'')+m+'분';}
async function loadLibrary(){
  const d=await api('/admin/api/library');if(d.origin)origin=d.origin;
  const cards=$('lib-cards');cards.replaceChildren();
  const card=(l,v)=>{const c=el('div',null,'card');c.append(el('div',v,'v'),el('div',l,'l'));return c;};
  cards.append(card('게임 파일',num(d.files)),card('titledb 타이틀',num(d.titledb?.titles)),
    card('마지막 빌드',d.lastBuildMs!=null?num(d.lastBuildMs)+'ms':'—'),card('가동 시간',uptime(d.uptime)));
  const s=d.settings;const rows=[['버전','v'+d.version],['공개 주소',d.origin||'—'],
    ['titledb 지역',(d.titledb?.regions||[]).map((r)=>r.region||r).join(', ')||'—'],
    ['기기 승인',s.devicePairing?'켜짐':'꺼짐'],['업로드',s.uploadsEnabled?'켜짐':'꺼짐'],
    ['NSP/XCI 메타 추출',s.extractIcons],['이름 언어 순서',s.langPriority]];
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
      btn('줄 삭제',()=>{if(!confirm('"'+(c.title||'제목 없음')+'" 줄을 지웁니다.'))return;featured.splice(ci,1);markDirty();renderFeatured();},'danger'));
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
  const box=$('tfa-actions');box.replaceChildren();
  if(!s.manageable){box.append(el('span','COOK_ADMIN_TOTP_SECRET 으로 고정돼 있어 여기서 바꿀 수 없습니다.','muted'));return;}
  box.append(btn(s.authenticator?'인증 앱 다시 등록':'인증 앱 등록',startTfa,'primary'));
  if(s.password&&s.authenticator)box.append(btn('인증 앱 끄기',async()=>{
    if(!confirm('인증 앱을 끄면 관리자 비밀번호로만 들어갑니다. 끌까요?'))return;
    try{await api('/admin/api/2fa/disable',{method:'POST',body:{}});toast('인증 앱을 껐습니다.');loadTfa();}catch(e){toast(e.message);}}));}
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
showTab();loadStats();loadDevices();loadLogins();loadAccounts();loadGoogle();
setInterval(()=>{if(!$('cred-dialog').open){loadStats();loadDevices();loadLogins();loadAccounts();}},15000);
`;
