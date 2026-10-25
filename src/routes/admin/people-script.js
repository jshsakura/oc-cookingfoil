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
function nameCell(name,self){const c=td();const s=el('span',name);if(self){const b=pill(topText('pp.me'),'on');b.classList.add('me');s.append(b);}c.append(s);return c;}
const isMe=(kind,id)=>Boolean(me)&&me.kind===kind&&(kind==='google'?me.sub===id:me.name===id);
let usersShown=null;
function renderUsers(list){usersShown=list;
  const configured=list.filter((u)=>u.configured);
  const row=(u)=>{const tr=el('tr');const self=isMe('password',u.user);
    tr.append(nameCell(u.user,self));
    tr.append(td(u.role==='admin'?topText('pp.admin'):topText('pp.user')));
    const active=u.lastActiveAt||u.lastAt;
    const st=td();st.append(u.enabled?pill(active?topText('pp.on'):topText('pp.noRecord'),active?'on':''):pill(topText('pp.off'),'off'));tr.append(st);
    tr.append(loginCell(u.lastLoginAt,u.lastLoginMethod,u.lastLoginIp,()=>openLogins(u.user,u.user)),whenCell(active),td(u.lastIp||'—','ip'));
    const act=td();const box=el('div',null,'row-actions');
    box.append(tbtn('edit','pp.passChange',()=>resetPassword(u.user)));
    // Your own account can't be demoted, turned off or removed (you'd lock yourself out).
    if(!self||u.role!=='admin')box.append(tbtn(u.role==='admin'?'edit':'star',u.role==='admin'?'pp.toUser':'pp.toAdmin',()=>setRole(u.user,u.role==='admin'?'user':'admin')));
    if(!self)box.append(tbtn(u.enabled?'disable':'enable',u.enabled?'pp.off':'pp.enable',()=>setEnabled(u.user,!u.enabled)));
    // Removing the very last account opens the server, so nobody is locked out by it.
    if(!self||configured.length===1)box.append(tbtn('delete','pp.delete',()=>removeUser(u.user),'danger'));
    act.append(box);tr.append(act);return tr;};
  pagedTable('users',[topText('pp.name'),topText('pp.role'),topText('pp.status'),topText('acc.lastLogin'),topText('acc.lastActive'),topText('acc.lastIp'),''],configured,row,topText('pp.noUsers'),{label:topText('pp.accountLabel'),placeholder:topText('pp.accountPh')});}



// Wire the sub-tab bars this page carries.
for(const t of ['users','devices'])subtabs(t);
// A direct address or reload must open the area named by the path bridge.
const [peopleTab,peopleSub]=location.hash.slice(1).split('/');
if(SUBTABS[peopleTab])SUBTABS[peopleTab].show(peopleSub||SUBTABS[peopleTab].cur);

// ── users ─────────────────────────────────────────────────────────────
let lastCred=null;
function showCredential(title,cred){lastCred=cred;$('cred-title').textContent=title;
  const box=$('cred');box.replaceChildren();
  for(const [label,value] of [[topText('pp.serverAddr'),origin],[topText('pp.userName'),cred.name],[topText('pp.pass'),cred.password]]){
    box.append(el('span',label,'muted'),el('span',value,'v'),tbtn('copy','pp.copyBtn',async()=>{
      try{await navigator.clipboard.writeText(value);toast(topFill('pp.copyOk',{label}));}catch{toast(topText('pp.copyFail'));}}));}
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
  if(first&&!await ask(topText('pp.firstUser')))return;
  try{const cred=await api('/admin/api/users',{method:'POST',body:{name,password,role:$('new-role').value}});
    $('new-name').value='';$('new-pass').value='';showCredential(topFill('pp.createdToast',{name}),cred);peopleReload();}
  catch(err){toast(err.message);}});
async function resetPassword(name){if(!await ask(topFill('pp.resetAsk',{name}),{danger:true}))return;
  try{const cred=await api('/admin/api/users/'+encodeURIComponent(name)+'/password',{method:'POST',body:{}});
    showCredential(topFill('pp.newPassTitle',{name}),cred);peopleReload();}catch(err){toast(err.message);}}
async function setRole(name,role){
  if(!await ask(topFill(role==='admin'?'pp.toAdminAsk':'pp.toUserAsk',{name}),{danger:true}))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/role',{method:'POST',body:{role}});toast(topText('pp.roleChanged'));peopleReload();}catch(err){toast(errText(err));}}
async function setEnabled(name,enabled){
  if(!enabled&&!await ask(topFill('pp.offAsk',{name}),{danger:true}))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/enabled',{method:'POST',body:{enabled}});
    toast(enabled?topText('pp.enabled'):topText('pp.disabledToast'));peopleReload();}catch(err){toast(errText(err));}}
async function removeUser(name){
  const last=(await api('/admin/api/users')).users.length===1;
  const msg=topFill(last?'pp.lastWarn':'pp.delAsk',{name});
  if(!await ask(msg,{danger:true}))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+(last?'?allowEmpty=1':''),{method:'DELETE'});toast(topText('pp.deleted'));peopleReload();}
  catch(err){toast(errText(err));}}

// ── Google accounts ─────────────────────────────────────────────────
const ACCOUNT_STATUS={pending:[topText('pp.devWait'),'warn'],approved:[topText('pp.devApproved'),'on'],disabled:[topText('pp.devDisabled'),'off']};
let accountsLoaded=false;
async function loadAccounts(){
  const d=await api('/admin/api/accounts');accountsLoaded=true;const list=d.accounts||[];
  $('accounthint').textContent=d.enabled?topText('pp.googleLead')
    :topText('pp.googleOff');
  const waiting=list.filter((a)=>a.status==='pending').length;
  for(const id of ['account-count','account-sub-count']){$(id).hidden=!waiting;$(id).textContent=waiting;}
  pagedTable('accounts',[topText('pp.email'),topText('pp.role'),topText('pp.status'),topText('pp.approval'),topText('pp.firstSeen'),topText('acc.lastLogin'),topText('acc.lastActive'),''],list,(a)=>{const tr=el('tr');const self=isMe('google',a.sub);
    const [label,kind]=ACCOUNT_STATUS[a.status]||[a.status,''];const st=td();st.append(pill(label,kind));
    tr.append(nameCell(a.email,self),td(a.role==='admin'?topText('pp.admin'):topText('pp.user')),st,td(a.approvedAt?fmt(a.approvedAt):'—'),td(fmt(a.createdAt)),loginCell(a.lastLoginAt,a.lastLoginMethod,a.lastLoginIp,()=>openLogins('google:'+a.sub,a.email)),whenCell(a.lastActiveAt));
    const act=td();const box=el('div',null,'row-actions');
    if(a.status!=='approved')box.append(tbtn('approve','pp.approve',()=>setAccount(a.sub,'approved'),'primary'));
    if(a.status==='approved'&&(!self||a.role!=='admin'))box.append(tbtn(a.role==='admin'?'edit':'star',a.role==='admin'?'pp.toUser':'pp.toAdmin',()=>setAccountRole(a.sub,a.email,a.role==='admin'?'user':'admin')));
    if(a.status==='approved'&&!self)box.append(tbtn('disable','pp.off',async()=>{if(await ask(topFill('pp.googleOffAsk',{email:a.email}),{danger:true}))setAccount(a.sub,'disabled');}));
    if(!self)box.append(tbtn('delete','pp.delete',()=>removeAccount(a.sub,a.email),'danger'));
    act.append(box);tr.append(act);return tr;},topText('pp.noAccounts'),{label:topText('pp.googleAccounts'),placeholder:topText('pp.emailSearch')});}
async function setAccountRole(sub,email,role){
  if(!await ask(topFill(role==='admin'?'pp.toAdminAsk':'pp.toUserAsk',{name:email}),{danger:true}))return;
  try{await api('/admin/api/accounts/role',{method:'POST',body:{sub,role}});toast(topText('pp.roleChanged'));loadAccounts();}catch(err){toast(errText(err));}}
async function setAccount(sub,status){
  try{await api('/admin/api/accounts/status',{method:'POST',body:{sub,status}});toast(status==='approved'?topText('pp.approved'):topText('pp.disabledToast'));loadAccounts();}catch(err){toast(errText(err));}}
async function removeAccount(sub,email){if(!await ask(topFill('pp.googleDelAsk',{name:email}),{danger:true}))return;
  try{await api('/admin/api/accounts/remove',{method:'POST',body:{sub}});toast(topText('pp.deleted'));loadAccounts();}catch(err){toast(errText(err));}}

// The Google OAuth form loader lives at the end of this file (with guards).
if($('google-form'))$('google-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/google',{method:'POST',body:{enabled:$('g-enabled').checked,clientId:$('g-id').value,clientSecret:$('g-secret').value}});
    toast(topText('pp.saved'));loadGoogleSettings();loadAccounts();}catch(err){toast(err.message);}});
if($('g-clear'))$('g-clear').addEventListener('click',async()=>{if(!await ask(topText('pp.googleClearAsk'),{danger:true}))return;
  try{await api('/admin/api/google/clear',{method:'POST',body:{}});toast(topText('pp.deleted'));loadGoogleSettings();loadAccounts();}catch(err){toast(err.message);}});
if($('g-copy'))$('g-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('g-redirect').textContent);toast(topText('pp.copied'));}catch{toast(topText('pp.copyFail'));}});

// ── devices ───────────────────────────────────────────────────────────
const DOWNLOAD_WORDS={used:topText('pp.dlUsed'),expired:topText('pp.dlExpired'),revoked:topText('pp.dlRevoked'),waiting:topText('pp.dlWaiting')};
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
  const whose=(a)=>a.addedBy==='admin'?topText('pp.admin'):a.addedBy==='telegram'?topText('pp.telegram'):String(a.addedBy||'—').replace(/^google:/,'');
  // A console with no record has been idle at least since the server began keeping history.
  const unused=(a)=>{if(!idle)return true;const from=a.idleSince??devicesShown.activitySince;return from!=null&&Date.now()-from>=idle*DAY_MS;};
  const approved=(d.approved||[]).filter(unused).sort((a,b)=>whose(a).localeCompare(whose(b))||(b.lastSeenAt??0)-(a.lastSeenAt??0));
  const counts={};for(const a of approved)counts[whose(a)]=(counts[whose(a)]||0)+1;
  const devRows=(slice)=>{const rows=[];let group=null;
  for(const a of slice){if(whose(a)!==group){group=whose(a);const h=el('tr',null,'group');const c=td(group+' · '+topFill('pp.count',{n:counts[group]}));c.colSpan=8;h.append(c);rows.push(h);}
    const tr=el('tr');
    const ipc=td(a.lastIp?null:'—',a.lastIp?'':'dim');if(a.lastIp)ipc.append(ipButton(a.lastIp,'acc.ipHistory',()=>openDeviceIps(a)));
    tr.append(td(a.label||'—'),seenCell(a),ipc,td(topFill('acc.daysN',{n:a.activeDays30||0}),a.activeDays30?'':'dim'),td(fmt(a.addedAt)));
    const k=td(a.deviceKey.slice(0,16)+'…','ip');k.title=a.deviceKey;tr.append(k);
    // An admin device may change item settings from the console; off by default.
    const adm=td();const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=a.admin===true;b.setAttribute('aria-label',(a.label||a.code||topText('pp.device'))+' '+topText('pp.adminDevice'));
    b.addEventListener('change',()=>setDeviceAdmin(a.deviceKey,b.checked,a.label||a.code||topText('pp.thisDevice')));w.append(b,el('span'));adm.append(w);tr.append(adm);
    const act=td();const box=el('div',null,'row-actions');
    box.append(tbtn('rename','pp.rename',()=>renameDevice(a.deviceKey,a.label)),tbtn('reissue','pp.reissue',()=>reissue(a.deviceKey,a.label)),tbtn('key','pp.revokeKey',()=>revoke(a.deviceKey),'danger'));
    act.append(box);tr.append(act);rows.push(tr);}
  return rows;};
  pagedTable('devices',[topText('pp.name'),topText('acc.lastAccess'),topText('acc.lastIp'),topText('acc.days30'),topText('pp.approvedOn'),topText('pp.devKey'),topText('pp.adminDevice'),''],approved,devRows,idle?topText('acc.noIdle'):topText('pp.noDevices'),{label:topText('pp.approvedList'),placeholder:topText('pp.devSearchPh'),slice:true,
    match:(a,q)=>(a.label+' '+whose(a)+' '+a.deviceKey+' '+(a.lastIp||'')).toLowerCase().includes(q)});}
async function loadDevices(){
  const d=await api('/admin/api/devices');
  $('devhint').textContent=d.pairingEnabled?topText('pp.pairingOnLead')
    :topText('pp.pairingOffLead');
  const pending=d.pending||[];
  for(const id of ['pending-count','pending-sub-count']){$(id).hidden=!pending.length;$(id).textContent=pending.length;}
  table('pending',[topText('pp.devCode'),topText('pp.devNameMsg'),topText('pp.requestedFrom'),topText('pp.devKey'),topText('pp.requestedAt'),''],pending.map((p)=>{const tr=el('tr');
    const k=td(p.deviceKey.slice(0,16)+'…','ip');k.title=p.deviceKey;const f=p.from,who=td('');if(f){who.append(el('div',f.ip+(f.place?' ('+f.place+')':''),'ip'));if(f.accounts&&f.accounts.length)who.append(el('div',topText('pp.sameAddrAcct')+f.accounts.slice(0,3).join(', ')+(f.accounts.length>3?topText('pp.otherCount')+(f.accounts.length-3)+topText('pp.countUnit'):''),'dim'));if(f.app)who.append(el('div',topText('pp.appLabel')+f.app,'dim'));}else{who.textContent='—';who.className='dim';who.title=topText('pp.notAfterRestart');}
    if(p.download){const w=who.textContent==='—';if(w){who.textContent='';who.className='';}who.prepend(el('div',topText('pp.receivedBy')+p.download.owner+' ('+(DOWNLOAD_WORDS[p.download.state]||topText('pp.download'))+')'));}
    const said=td('');if(p.name)said.append(el('div',p.name));if(p.message)said.append(el('div',p.message,p.name?'dim':''));if(!p.name&&!p.message){said.textContent='—';said.className='dim';}
    tr.append(td(p.code||'—','ip'),said,who,k,td(fmt(p.lastSeenAt)));
    const act=td();const box=el('div',null,'row-actions');
    box.append(tbtn('approve','pp.approve',()=>approve(p.deviceKey),'primary'),tbtn('reject','pp.reject',()=>dismissDevice(p.deviceKey,p.code),'danger'));act.append(box);tr.append(act);return tr;}),topText('pp.noPending'));
  devicesShown=d;renderApproved();
  const STATE={waiting:topText('pp.waitingStatus'),used:topText('pp.dlUsedShort'),expired:topText('pp.dlExpiredShort'),revoked:topText('pp.dlRevokedShort')};
  const clientRow=(c)=>{const tr=el('tr');
    const state=td(STATE[c.state]||c.state,c.state==='used'?'':'dim');if(c.state==='waiting')state.title=topFill('pp.dlUntil',{at:fmt(c.expiresAt)});
    tr.append(td(String(c.owner||'—').replace(/^google:/,'')),td(fmt(c.createdAt)),state,td(c.code||'—','ip'),td(c.usedAt?fmt(c.usedAt):'—',c.usedAt?'':'dim'));
    const act=td();if(c.state==='waiting'){const box=el('div',null,'row-actions');box.append(tbtn('cancel','pp.cancelBtn',()=>cancelClient(c.id),'danger'));act.append(box);}
    tr.append(act);return tr;};
  // Waiting and linked downloads stay in the list; ones whose time ran out or that were cancelled move apart.
  const COLS=[topText('pp.receivedByCol'),topText('pp.receivedAtCol'),topText('pp.status'),topText('pp.devCode'),topText('pp.pairedAtCol'),''];
  const all=d.clients||[];const live=all.filter((c)=>c.state==='waiting'||c.state==='used').sort((a,b)=>(a.state==='waiting'?0:1)-(b.state==='waiting'?0:1));
  const ended=all.filter((c)=>c.state!=='waiting'&&c.state!=='used');
  pagedTable('clients',COLS,live,clientRow,topText('pp.noClients'),{label:topText('pp.clientList'),placeholder:topText('pp.clientSearchPh')});
  $('clients-ended-box').hidden=!ended.length;$('clients-ended-count').textContent=ended.length;
  table('clients-ended',COLS,ended.map(clientRow),'');}
if($('dev-idle'))$('dev-idle').addEventListener('change',renderApproved);
// A new language redraws the tables whose words come from top-i18n.js.
function accRelabel(){if(usersShown)renderUsers(usersShown);renderApproved();if(accountsLoaded)loadAccounts().catch(()=>{});}
async function cancelClient(id){if(!await ask(topText('pp.cancelClientAsk'),{danger:true}))return;
  try{await api('/admin/api/clients/'+id+'/revoke',{method:'POST'});toast(topText('pp.cancelled'));loadDevices();}catch(err){toast(err.message);}}
if($('approve-code'))$('approve-code').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/devices/approve',{method:'POST',body:{code:$('code-in').value,label:$('code-label').value}});
    toast(topText('pp.approvedKeyToast'));$('code-in').value='';$('code-label').value='';loadDevices();}
  catch(err){toast(err.message==='no device is waiting with that code'?topText('pp.noMatchingCode'):err.message);}});
// Drops a request without approving it; the console shows up again only if it asks again.
async function dismissDevice(deviceKey,code){if(!await ask(topFill('pp.dismissAsk',{code:code||topText('pp.thisDevice')}),{danger:true}))return;
  try{await api('/admin/api/devices/revoke',{method:'POST',body:{deviceKey}});toast(topText('pp.dismissed'));loadDevices();}catch(err){toast(err.message);}}
async function approve(deviceKey){const label=await askText(topText('pp.approveNamePh'),'');if(label===null)return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label}});toast(topText('pp.approved'));loadDevices();}catch(err){toast(err.message);}}
async function reissue(deviceKey,label){if(!await ask(topText('pp.reissueAsk'),{danger:true}))return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label:label||''}});toast(topText('pp.keyReady'));loadDevices();}catch(err){toast(err.message);}}
async function revoke(deviceKey){if(!await ask(topText('pp.revokeAsk'),{danger:true}))return;
  try{await api('/admin/api/devices/revoke',{method:'POST',body:{deviceKey}});toast(topText('pp.keyRevoked'));loadDevices();}catch(err){toast(err.message);}}
async function setDeviceAdmin(deviceKey,admin,name){
  try{await api('/admin/api/devices/admin',{method:'POST',body:{deviceKey,admin}});toast(admin?topFill('pp.canChangeItems',{name}):topFill('pp.readOnly',{name}));loadDevices();}catch(err){toast(err.message);loadDevices();}}
async function renameDevice(deviceKey,label){const next=await askText(topText('pp.renameDevicePh'),label||'');if(next===null)return;
  try{await api('/admin/api/devices/label',{method:'POST',body:{deviceKey,label:next}});toast(topText('pp.renamed'));loadDevices();}catch(err){toast(err.message);}}




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
    $('g-secret').value='';$('g-secret').placeholder=g.hasSecret?topText('pp.storedSecretPh'):topText('pp.clientSecret');
    $('g-redirect').textContent=g.redirectUri;
    $('g-status').textContent=g.active?topText('pp.googleOn'):g.enabled?topText('pp.googleNeedBoth'):topText('pp.googleOffStatus');
  }catch(err){/* the settings page shows the error in its own way */}}
`;
