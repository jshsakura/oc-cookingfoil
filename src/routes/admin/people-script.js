/**
 * The admin's people pages: accounts (local and Google) and devices.
 *
 * Stage B, second bundle. Each page carries only its own markup and script
 * around the shared shell; the still-whole dashboard inlines the very same
 * script for its users and devices tabs, so there is one owner per behaviour.
 * The one-time credential dialog travels with the accounts page, because
 * creating a password shows it once and the page must not lose it.
 */
export const PEOPLE_SCRIPT = /* js */ `
let me=null;
let origin=location.origin;
function nameCell(name,self){const c=td();const s=el('span',name);if(self){const b=pill('나','on');b.classList.add('me');s.append(b);}c.append(s);return c;}
const isMe=(kind,id)=>Boolean(me)&&me.kind===kind&&(kind==='google'?me.sub===id:me.name===id);
let usersShown=null;
function renderUsers(list){usersShown=list;
  const configured=list.filter((u)=>u.configured);
  const row=(u)=>{const tr=el('tr');const self=isMe('password',u.user);
    tr.append(nameCell(u.user,self));
    tr.append(td(u.role==='admin'?'관리자':'일반 사용자'));
    const active=u.lastActiveAt||u.lastAt;
    const st=td();st.append(u.enabled?pill(active?'사용 중':'접속 기록 없음',active?'on':''):pill('사용 중지','off'));tr.append(st);
    tr.append(loginCell(u.lastLoginAt,u.lastLoginMethod,u.lastLoginIp,()=>openLogins(u.user,u.user)),whenCell(active),td(u.lastIp||'—','ip'));
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('비밀번호 변경',()=>resetPassword(u.user)));
    // Your own account can't be demoted, turned off or removed (you'd lock yourself out).
    if(!self||u.role!=='admin')box.append(btn(u.role==='admin'?'일반 사용자로':'관리자로',()=>setRole(u.user,u.role==='admin'?'user':'admin')));
    if(!self)box.append(btn(u.enabled?'사용 중지':'다시 사용',()=>setEnabled(u.user,!u.enabled)));
    // Removing the very last account opens the server, so nobody is locked out by it.
    if(!self||configured.length===1)box.append(btn('삭제',()=>removeUser(u.user),'danger'));
    act.append(box);tr.append(act);return tr;};
  pagedTable('users',['이름','역할','상태',topText('acc.lastLogin'),topText('acc.lastActive'),topText('acc.lastIp'),''],configured,row,'아직 사용자가 없습니다. 사용자가 없으면 비밀번호 없이 접속할 수 있습니다.',{label:'계정',placeholder:'이름이나 IP 로 찾기'});}



// Wire the sub-tab bars this page carries.
for(const t of ['users','devices'])subtabs(t);
// A direct address or reload must open the area named by the path bridge.
const [peopleTab,peopleSub]=location.hash.slice(1).split('/');
if(SUBTABS[peopleTab])SUBTABS[peopleTab].show(peopleSub||SUBTABS[peopleTab].cur);

// ── users ─────────────────────────────────────────────────────────────
let lastCred=null;
function showCredential(title,cred){lastCred=cred;$('cred-title').textContent=title;
  const box=$('cred');box.replaceChildren();
  for(const [label,value] of [['서버 주소',origin],['사용자',cred.name],['비밀번호',cred.password]]){
    box.append(el('span',label,'muted'),el('span',value,'v'),btn('복사',async()=>{
      try{await navigator.clipboard.writeText(value);toast(label+'를 복사했습니다.');}catch{toast('복사하지 못했습니다. 직접 선택해 복사합니다.');}}));}
  $('cred-dialog').showModal();}
if($('cred-close'))$('cred-close').addEventListener('click',()=>{$('cred-dialog').close();lastCred=null;});
function clearCredential(){lastCred=null;$('cred')?.replaceChildren();if($('cred-title'))$('cred-title').textContent='';}
if($('cred-dialog')){
  $('cred-dialog').addEventListener('close',clearCredential);
  addEventListener('pagehide',clearCredential);
}
if($('cred-config'))$('cred-config').addEventListener('click',()=>{if(!lastCred)return;
  const config={servers:[{title:location.hostname,url:origin,username:lastCred.name,password:lastCred.password,
    cfClientId:'',cfClientSecret:'',enabled:true}],language:(['ko','en','ja','zh'].find((l)=>(navigator.language||'').toLowerCase().startsWith(l))||'en'),installTarget:'sd'};
  const a=el('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\\n'],{type:'application/json'}));
  a.download='config.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
if($('add-user'))$('add-user').addEventListener('submit',async(e)=>{e.preventDefault();
  const name=$('new-name').value.trim(),password=$('new-pass').value;
  const first=!(await api('/admin/api/users')).users.length;
  if(first&&!await ask('첫 사용자를 만들면 그때부터 이 서버 전체에 비밀번호가 필요합니다. 계속할까요?'))return;
  try{const cred=await api('/admin/api/users',{method:'POST',body:{name,password,role:$('new-role').value}});
    $('new-name').value='';$('new-pass').value='';showCredential(name+' 계정을 만들었습니다',cred);peopleReload();}
  catch(err){toast(err.message);}});
async function resetPassword(name){if(!await ask(name+' 의 비밀번호를 새로 만듭니다. 지금 비밀번호는 바로 쓸 수 없게 되고, 이 계정이 승인한 기기도 연결이 끊겨 다시 승인받아야 합니다.',{danger:true}))return;
  try{const cred=await api('/admin/api/users/'+encodeURIComponent(name)+'/password',{method:'POST',body:{}});
    showCredential(name+' 의 새 비밀번호',cred);peopleReload();}catch(err){toast(err.message);}}
async function setRole(name,role){
  if(!await ask(role==='admin'?name+' 계정을 관리자로 변경합니다. 이 계정도 관리 페이지를 열 수 있게 됩니다.':name+' 계정을 일반 사용자로 변경합니다. 이 계정은 관리 페이지를 열 수 없게 됩니다.',{danger:true}))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/role',{method:'POST',body:{role}});toast('역할을 변경했습니다.');peopleReload();}catch(err){toast(errText(err));}}
async function setEnabled(name,enabled){
  if(!enabled&&!await ask(name+' 계정을 사용 중지합니다. 이 계정으로는 접속할 수 없게 됩니다.',{danger:true}))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/enabled',{method:'POST',body:{enabled}});
    toast(enabled?'다시 사용합니다.':'사용을 중지했습니다.');peopleReload();}catch(err){toast(errText(err));}}
async function removeUser(name){
  const last=(await api('/admin/api/users')).users.length===1;
  const msg=last?name+' 은 마지막 계정입니다. 지우면 비밀번호 없이 누구나 이 서버에 접속하고 파일을 받습니다. 정말 삭제할까요?'
    :name+' 계정을 삭제합니다. 이 계정으로 접속하던 기기는 더 접속할 수 없습니다.';
  if(!await ask(msg,{danger:true}))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+(last?'?allowEmpty=1':''),{method:'DELETE'});toast('삭제했습니다.');peopleReload();}
  catch(err){toast(errText(err));}}

// ── Google accounts ─────────────────────────────────────────────────
const ACCOUNT_STATUS={pending:['승인 대기','warn'],approved:['승인됨','on'],disabled:['사용 중지','off']};
let accountsLoaded=false;
async function loadAccounts(){
  const d=await api('/admin/api/accounts');accountsLoaded=true;const list=d.accounts||[];
  $('accounthint').textContent=d.enabled?'로그인 화면에서 구글로 들어온 계정입니다. 승인한 계정만 웹을 쓰고 기기 화면의 QR이나 기기 코드로 연결을 승인할 수 있습니다.'
    :'구글 로그인이 꺼져 있습니다. 설정 탭에서 켭니다.';
  const waiting=list.filter((a)=>a.status==='pending').length;
  for(const id of ['account-count','account-sub-count']){$(id).hidden=!waiting;$(id).textContent=waiting;}
  pagedTable('accounts',['이메일','역할','상태','승인','처음 로그인',topText('acc.lastLogin'),topText('acc.lastActive'),''],list,(a)=>{const tr=el('tr');const self=isMe('google',a.sub);
    const [label,kind]=ACCOUNT_STATUS[a.status]||[a.status,''];const st=td();st.append(pill(label,kind));
    tr.append(nameCell(a.email,self),td(a.role==='admin'?'관리자':'일반 사용자'),st,td(a.approvedAt?fmt(a.approvedAt):'—'),td(fmt(a.createdAt)),loginCell(a.lastLoginAt,a.lastLoginMethod,a.lastLoginIp,()=>openLogins('google:'+a.sub,a.email)),whenCell(a.lastActiveAt));
    const act=td();const box=el('div',null,'row-actions');
    if(a.status!=='approved')box.append(btn('승인',()=>setAccount(a.sub,'approved'),'primary'));
    if(a.status==='approved'&&(!self||a.role!=='admin'))box.append(btn(a.role==='admin'?'일반 사용자로':'관리자로',()=>setAccountRole(a.sub,a.email,a.role==='admin'?'user':'admin')));
    if(a.status==='approved'&&!self)box.append(btn('사용 중지',async()=>{if(await ask(a.email+' 계정의 사용을 중지합니다. 다시 승인하기 전까지 로그인하지 못합니다.',{danger:true}))setAccount(a.sub,'disabled');}));
    if(!self)box.append(btn('삭제',()=>removeAccount(a.sub,a.email),'danger'));
    act.append(box);tr.append(act);return tr;},'아직 로그인한 계정이 없습니다.',{label:'구글 로그인 계정',placeholder:'이메일로 찾기'});}
async function setAccountRole(sub,email,role){
  if(!await ask(role==='admin'?email+' 계정을 관리자로 변경합니다.':email+' 계정을 일반 사용자로 변경합니다.',{danger:true}))return;
  try{await api('/admin/api/accounts/role',{method:'POST',body:{sub,role}});toast('역할을 변경했습니다.');loadAccounts();}catch(err){toast(errText(err));}}
async function setAccount(sub,status){
  try{await api('/admin/api/accounts/status',{method:'POST',body:{sub,status}});toast(status==='approved'?'승인했습니다.':'사용을 중지했습니다.');loadAccounts();}catch(err){toast(errText(err));}}
async function removeAccount(sub,email){if(!await ask(email+' 계정을 삭제합니다. 다시 로그인하면 승인 대기로 돌아옵니다.',{danger:true}))return;
  try{await api('/admin/api/accounts/remove',{method:'POST',body:{sub}});toast('삭제했습니다.');loadAccounts();}catch(err){toast(errText(err));}}

// The Google OAuth form loader lives at the end of this file (with guards).
if($('google-form'))$('google-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/google',{method:'POST',body:{enabled:$('g-enabled').checked,clientId:$('g-id').value,clientSecret:$('g-secret').value}});
    toast('저장했습니다.');loadGoogleSettings();loadAccounts();}catch(err){toast(err.message);}});
if($('g-clear'))$('g-clear').addEventListener('click',async()=>{if(!await ask('구글 클라이언트 ID 와 시크릿을 지우고 구글 로그인을 끕니다.',{danger:true}))return;
  try{await api('/admin/api/google/clear',{method:'POST',body:{}});toast('삭제했습니다.');loadGoogleSettings();loadAccounts();}catch(err){toast(err.message);}});
if($('g-copy'))$('g-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('g-redirect').textContent);toast('복사했습니다.');}catch{toast('복사하지 못했습니다. 직접 선택해 복사합니다.');}});

// ── devices ───────────────────────────────────────────────────────────
const DOWNLOAD_WORDS={used:'다른 기기에서 이미 쓴 다운로드',expired:'기한이 지난 다운로드',revoked:'취소된 다운로드',waiting:'다운로드'};
let devicesShown=null;
const DAY_MS=86400000;
// When a console was last used: its last access, else when it was approved (after access history began), else no record.
function seenCell(a){
  if(a.lastSeenAt)return whenCell(a.lastSeenAt);
  const c=td(topText(a.idleSince?'acc.neverSince':'acc.noRecord'),'dim');
  c.title=a.idleSince?fmt(a.idleSince):topFill('acc.noRecordHint',{at:fmt(devicesShown.activitySince)});return c;}
// The approved consoles, only those unused for the chosen number of days when one is chosen.
function renderApproved(){const d=devicesShown;if(!d)return;
  const idle=Number($('dev-idle').value)||0;
  // Grouped by the account each console belongs to, so whose consoles are whose reads at a glance.
  const whose=(a)=>a.addedBy==='admin'?'관리자':a.addedBy==='telegram'?'텔레그램':String(a.addedBy||'—').replace(/^google:/,'');
  // A console with no record has been idle at least since the server began keeping history.
  const unused=(a)=>{if(!idle)return true;const from=a.idleSince??devicesShown.activitySince;return from!=null&&Date.now()-from>=idle*DAY_MS;};
  const approved=(d.approved||[]).filter(unused).sort((a,b)=>whose(a).localeCompare(whose(b))||(b.lastSeenAt??0)-(a.lastSeenAt??0));
  const counts={};for(const a of approved)counts[whose(a)]=(counts[whose(a)]||0)+1;
  const devRows=(slice)=>{const rows=[];let group=null;
  for(const a of slice){if(whose(a)!==group){group=whose(a);const h=el('tr',null,'group');const c=td(group+' · '+counts[group]+'대');c.colSpan=8;h.append(c);rows.push(h);}
    const tr=el('tr');
    const ipc=td(a.lastIp?null:'—',a.lastIp?'':'dim');if(a.lastIp)ipc.append(ipButton(a.lastIp,'acc.ipHistory',()=>openDeviceIps(a)));
    tr.append(td(a.label||'—'),seenCell(a),ipc,td(topFill('acc.daysN',{n:a.activeDays30||0}),a.activeDays30?'':'dim'),td(fmt(a.addedAt)));
    const k=td(a.deviceKey.slice(0,16)+'…','ip');k.title=a.deviceKey;tr.append(k);
    // An admin device may change item settings from the console; off by default.
    const adm=td();const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=a.admin===true;b.setAttribute('aria-label',(a.label||a.code||'기기')+' 관리자 기기');
    b.addEventListener('change',()=>setDeviceAdmin(a.deviceKey,b.checked,a.label||a.code||'이 기기'));w.append(b,el('span'));adm.append(w);tr.append(adm);
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('이름 변경',()=>renameDevice(a.deviceKey,a.label)),btn('키 재발급',()=>reissue(a.deviceKey,a.label)),btn('접근 키 회수',()=>revoke(a.deviceKey),'danger'));
    act.append(box);tr.append(act);rows.push(tr);}
  return rows;};
  pagedTable('devices',['이름',topText('acc.lastAccess'),topText('acc.lastIp'),topText('acc.days30'),'승인한 날','기기 키','관리자 기기',''],approved,devRows,idle?topText('acc.noIdle'):'승인된 기기가 없습니다.',{label:'승인된 기기',placeholder:'이름이나 계정으로 찾기',slice:true,
    match:(a,q)=>(a.label+' '+whose(a)+' '+a.deviceKey+' '+(a.lastIp||'')).toLowerCase().includes(q)});}
async function loadDevices(){
  const d=await api('/admin/api/devices');
  $('devhint').textContent=d.pairingEnabled?'CookingFoil 클라이언트가 승인을 요청하면 여기에 나옵니다. 기기 화면의 기기 코드를 넣거나 목록에서 승인하면 비밀번호 없이 접속합니다.'
    :'기기 승인이 꺼져 있습니다. 설정 탭의 서버 동작에서 QR 로 기기 연결을 켭니다.';
  const pending=d.pending||[];
  for(const id of ['pending-count','pending-sub-count']){$(id).hidden=!pending.length;$(id).textContent=pending.length;}
  table('pending',['기기 코드','기기 이름·메시지','요청한 곳','기기 키','요청 시각',''],pending.map((p)=>{const tr=el('tr');
    const k=td(p.deviceKey.slice(0,16)+'…','ip');k.title=p.deviceKey;const f=p.from,who=td('');if(f){who.append(el('div',f.ip+(f.place?' ('+f.place+')':''),'ip'));if(f.accounts&&f.accounts.length)who.append(el('div','같은 주소의 계정: '+f.accounts.slice(0,3).join(', ')+(f.accounts.length>3?' 외 '+(f.accounts.length-3)+'명':''),'dim'));if(f.app)who.append(el('div','앱: '+f.app,'dim'));}else{who.textContent='—';who.className='dim';who.title='서버를 다시 켠 뒤로는 보이지 않습니다';}
    if(p.download){const w=who.textContent==='—';if(w){who.textContent='';who.className='';}who.prepend(el('div','받은 계정: '+p.download.owner+' ('+(DOWNLOAD_WORDS[p.download.state]||'다운로드')+')'));}
    const said=td('');if(p.name)said.append(el('div',p.name));if(p.message)said.append(el('div',p.message,p.name?'dim':''));if(!p.name&&!p.message){said.textContent='—';said.className='dim';}
    tr.append(td(p.code||'—','ip'),said,who,k,td(fmt(p.lastSeenAt)));
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('승인',()=>approve(p.deviceKey),'primary'),btn('거절',()=>dismissDevice(p.deviceKey,p.code),'danger'));act.append(box);tr.append(act);return tr;}),'승인을 기다리는 기기가 없습니다.');
  devicesShown=d;renderApproved();
  const STATE={waiting:'기다리는 중',used:'연동함',expired:'만료',revoked:'취소함'};
  const clientRow=(c)=>{const tr=el('tr');
    const state=td(STATE[c.state]||c.state,c.state==='used'?'':'dim');if(c.state==='waiting')state.title=fmt(c.expiresAt)+'까지 연결할 수 있습니다';
    tr.append(td(String(c.owner||'—').replace(/^google:/,'')),td(fmt(c.createdAt)),state,td(c.code||'—','ip'),td(c.usedAt?fmt(c.usedAt):'—',c.usedAt?'':'dim'));
    const act=td();if(c.state==='waiting'){const box=el('div',null,'row-actions');box.append(btn('취소',()=>cancelClient(c.id),'danger'));act.append(box);}
    tr.append(act);return tr;};
  // Waiting and linked downloads stay in the list; ones whose time ran out or that were cancelled move apart.
  const COLS=['받은 계정','받은 시각','상태','기기 코드','연동 시각',''];
  const all=d.clients||[];const live=all.filter((c)=>c.state==='waiting'||c.state==='used').sort((a,b)=>(a.state==='waiting'?0:1)-(b.state==='waiting'?0:1));
  const ended=all.filter((c)=>c.state!=='waiting'&&c.state!=='used');
  pagedTable('clients',COLS,live,clientRow,'기다리거나 연동한 클라이언트가 없습니다.',{label:'받은 클라이언트',placeholder:'계정이나 기기 코드로 찾기'});
  $('clients-ended-box').hidden=!ended.length;$('clients-ended-count').textContent=ended.length;
  table('clients-ended',COLS,ended.map(clientRow),'');}
if($('dev-idle'))$('dev-idle').addEventListener('change',renderApproved);
// A new language redraws the tables whose words come from top-i18n.js.
function accRelabel(){if(usersShown)renderUsers(usersShown);renderApproved();if(accountsLoaded)loadAccounts().catch(()=>{});}
async function cancelClient(id){if(!await ask('이 다운로드로는 이제 연동할 수 없게 합니다.',{danger:true}))return;
  try{await api('/admin/api/clients/'+id+'/revoke',{method:'POST'});toast('취소했습니다.');loadDevices();}catch(err){toast(err.message);}}
if($('approve-code'))$('approve-code').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/devices/approve',{method:'POST',body:{code:$('code-in').value,label:$('code-label').value}});
    toast('승인했습니다. 기기가 다음 확인 때 접속 키를 받습니다.');$('code-in').value='';$('code-label').value='';loadDevices();}
  catch(err){toast(err.message==='no device is waiting with that code'?'그 코드로 승인을 기다리는 기기가 없습니다. 기기 화면의 코드를 다시 확인합니다.':err.message);}});
// Drops a request without approving it; the console shows up again only if it asks again.
async function dismissDevice(deviceKey,code){if(!await ask((code||'이')+' 기기의 승인 요청을 삭제합니다. 기기가 다시 요청하면 또 나옵니다.',{danger:true}))return;
  try{await api('/admin/api/devices/revoke',{method:'POST',body:{deviceKey}});toast('요청을 삭제했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function approve(deviceKey){const label=await askText('이 기기를 알아볼 이름을 정합니다 (예: 친구 기기)','');if(label===null)return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label}});toast('승인했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function reissue(deviceKey,label){if(!await ask('새 접속 키를 발급합니다. 기기는 다음 접속 때 새 키를 받고, 지금 키는 바로 쓸 수 없게 됩니다.',{danger:true}))return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label:label||''}});toast('새 키를 준비했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function revoke(deviceKey){if(!await ask('이 기기의 접근 키를 회수합니다. 다시 승인하기 전까지 접속할 수 없습니다.',{danger:true}))return;
  try{await api('/admin/api/devices/revoke',{method:'POST',body:{deviceKey}});toast('접근 키를 회수했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function setDeviceAdmin(deviceKey,admin,name){
  try{await api('/admin/api/devices/admin',{method:'POST',body:{deviceKey,admin}});toast(admin?name+' 에서 항목 설정을 바꿀 수 있습니다.':name+' 은(는) 다시 읽기만 합니다.');loadDevices();}catch(err){toast(err.message);loadDevices();}}
async function renameDevice(deviceKey,label){const next=await askText('이 기기의 이름을 정합니다',label||'');if(next===null)return;
  try{await api('/admin/api/devices/label',{method:'POST',body:{deviceKey,label:next}});toast('이름을 변경했습니다.');loadDevices();}catch(err){toast(err.message);}}




// The people pages' own loader: /admin/api/stats gives me and the users
// list; the devices come from their own endpoint. Only what is on the
// page gets rendered.
function peopleReload(){if(typeof loadStats==='function')loadStats();else loadPeople();}
async function loadPeople(){
  try{
    const d=await api('/admin/api/stats');
    me=d.me||null;
    // The accounts page: the local-user table and the Google approval list.
    if($('users')){renderUsers(d.users||[]);await loadAccounts();}
    // The devices page: the pending, approved and issued-clients areas.
    if($('devices')||$('pending'))await loadDevices();
  }catch(err){if(err.message!=='session')toast(errText(err));}}
// The Google OAuth form (settings page): a different owner from the accounts list.
async function loadGoogleSettings(){
  if(!$('g-enabled'))return;
  try{const g=await api('/admin/api/google');$('g-enabled').checked=g.enabled;$('g-id').value=g.clientId||'';
    $('g-secret').value='';$('g-secret').placeholder=g.hasSecret?'저장된 시크릿을 씁니다 (바꿀 때만 입력)':'클라이언트 시크릿';
    $('g-redirect').textContent=g.redirectUri;
    $('g-status').textContent=g.active?'켜져 있습니다. 로그인 화면에 구글 버튼이 나옵니다.':g.enabled?'켜려면 ID 와 시크릿이 모두 필요합니다.':'꺼져 있습니다. 로그인 화면은 아이디와 비밀번호만 받습니다.';
  }catch(err){/* the settings page shows the error in its own way */}}
`;
