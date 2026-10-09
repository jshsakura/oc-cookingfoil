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
  for(const r of rows)t.append(r);m.append(t);}

async function api(url,opts={}){
  const init={headers:{Accept:'application/json'},...opts};
  if(opts.body!==undefined){init.headers['Content-Type']='application/json';init.body=JSON.stringify(opts.body);}
  const r=await fetch(url,init);
  if(r.status===401){location.reload();throw new Error('session');}
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.message||data.error||('HTTP '+r.status));
  return data;}

// ── tabs ──────────────────────────────────────────────────────────────
const TABS=['overview','users','devices','security','featured','library'];
function showTab(){const want=location.hash.slice(1);const tab=TABS.includes(want)?want:'overview';
  for(const name of TABS){$('tab-'+name).hidden=name!==tab;
    const a=document.querySelector('[data-tab="'+name+'"]');if(name===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  if(tab==='library')loadLibrary();
  if(tab==='featured')loadFeatured();}
addEventListener('hashchange',showTab);

// ── theme (shared with the public dashboard) ──────────────────────────
const systemLight=matchMedia('(prefers-color-scheme: light)');
const theme=()=>document.documentElement.dataset.theme||(systemLight.matches?'light':'dark');
function syncTheme(){for(const b of $('theme').querySelectorAll('button')){const on=b.dataset.themeChoice===theme();
  b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}}
$('theme').addEventListener('click',(e)=>{const next=e.target.closest('button')?.dataset.themeChoice;if(!next)return;
  document.documentElement.dataset.theme=next;try{localStorage.setItem('cookingfoil:theme',next);}catch{}syncTheme();});
systemLight.addEventListener('change',syncTheme);

// ── overview + users + security (one stats call) ──────────────────────
let origin=location.origin;
function renderWarnings(list){const box=$('warnings');box.replaceChildren();
  for(const w of list){const n=el('div',null,'note'+(w.severity==='warn'?' warn':''));
    n.append(el('div',w.title,'t'),el('div',w.detail,'d'));box.append(n);}}
function renderLanes(l){const box=$('lanes');box.replaceChildren();
  box.append(pill('비밀번호 접속: '+(l.basicAuth.enabled?l.basicAuth.userCount+'명':'꺼짐'),l.basicAuth.enabled?'on':'off'));
  box.append(pill('기기 승인: '+(l.pairing.enabled?'켜짐':'꺼짐'),l.pairing.enabled?'on':''));
  if(l.pairingOnly)box.append(pill('승인된 기기만 받을 수 있음','warn'));
  box.append(pill('관리자 2단계 인증: '+(l.admin.enrolled?'등록됨':'등록 안 됨'),l.admin.enrolled?'on':'off'));}
function renderCards(d){const cards=$('cards');cards.replaceChildren();
  const card=(l,v,alert)=>{const c=el('div',null,'card'+(alert?' alert':''));c.append(el('div',num(v),'v'),el('div',l,'l'));return c;};
  cards.append(card('사용자',d.totals.configuredUsers),card('누적 요청',d.totals.totalRequests),
    card('차단된 IP',d.totals.lockouts,d.totals.lockouts>0),card('24시간 거부',d.totals.denied24h,d.totals.denied24h>0));}
function renderUsers(list){
  const rows=list.filter((u)=>u.configured).map((u)=>{const tr=el('tr');
    tr.append(td(u.user));
    const st=td();st.append(u.enabled?pill(u.lastAt?'사용 중':'접속 기록 없음',u.lastAt?'on':''):pill('사용 중지','off'));tr.append(st);
    const seen=td(ago(u.lastAt));seen.title=fmt(u.lastAt);tr.append(seen,td(num(u.count)),td(u.lastIp||'—','ip'));
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('비밀번호 재발급',()=>resetPassword(u.user)),
      btn(u.enabled?'사용 중지':'다시 사용',()=>setEnabled(u.user,!u.enabled)),
      btn('삭제',()=>removeUser(u.user),'danger'));
    act.append(box);tr.append(act);return tr;});
  table('users',['이름','상태','마지막 접속','요청','마지막 IP',''],rows,'아직 사용자가 없습니다. 사용자가 없으면 비밀번호 없이 접속할 수 있습니다.');}
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
  const a=d.lanes.admin;$('who').textContent=(a.email||a.owner||'admin')+' 으로 로그인했습니다';
  $('ts').textContent=fmt(d.generatedAt)+' 기준';
  renderWarnings(d.warnings||[]);renderLanes(d.lanes);renderCards(d);renderUsers(d.users||[]);renderSecurity(d);}

// ── users ─────────────────────────────────────────────────────────────
let lastCred=null;
function showCredential(title,cred){lastCred=cred;$('cred-title').textContent=title;
  const box=$('cred');box.replaceChildren();
  for(const [label,value] of [['서버 주소',origin+'/shop.tfl'],['사용자',cred.name],['비밀번호',cred.password]]){
    box.append(el('span',label,'muted'),el('span',value,'v'),btn('복사',async()=>{
      try{await navigator.clipboard.writeText(value);toast(label+'를 복사했습니다.');}catch{toast('복사하지 못했습니다. 직접 선택해 복사합니다.');}}));}
  $('cred-dialog').showModal();}
$('cred-close').addEventListener('click',()=>{$('cred-dialog').close();lastCred=null;});
$('cred-dialog').addEventListener('close',()=>{lastCred=null;});
$('cred-config').addEventListener('click',()=>{if(!lastCred)return;
  const config={servers:[{title:location.hostname,url:origin,username:lastCred.name,password:lastCred.password,
    cfClientId:'',cfClientSecret:'',enabled:true}],language:'ko',installTarget:'sd'};
  const a=el('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\\n'],{type:'application/json'}));
  a.download='config.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
$('add-user').addEventListener('submit',async(e)=>{e.preventDefault();
  const name=$('new-name').value.trim(),password=$('new-pass').value;
  const first=!(await api('/admin/api/users')).users.length;
  if(first&&!confirm('첫 사용자를 만들면 그때부터 이 서버 전체에 비밀번호가 필요합니다. 계속할까요?'))return;
  try{const cred=await api('/admin/api/users',{method:'POST',body:{name,password}});
    $('new-name').value='';$('new-pass').value='';showCredential(name+' 계정을 만들었습니다',cred);loadStats();}
  catch(err){toast(err.message);}});
async function resetPassword(name){if(!confirm(name+' 의 비밀번호를 새로 만듭니다. 지금 비밀번호는 바로 쓸 수 없게 됩니다.'))return;
  try{const cred=await api('/admin/api/users/'+encodeURIComponent(name)+'/password',{method:'POST',body:{}});
    showCredential(name+' 의 새 비밀번호',cred);loadStats();}catch(err){toast(err.message);}}
async function setEnabled(name,enabled){
  if(!enabled&&!confirm(name+' 계정을 사용 중지합니다. 이 계정으로는 접속할 수 없게 됩니다.'))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+'/enabled',{method:'POST',body:{enabled}});
    toast(enabled?'다시 사용합니다.':'사용을 중지했습니다.');loadStats();}catch(err){toast(err.message);}}
async function removeUser(name){
  const last=(await api('/admin/api/users')).users.length===1;
  const msg=last?name+' 은 마지막 계정입니다. 지우면 비밀번호 없이 누구나 이 서버에 접속하고 파일을 받습니다. 정말 지울까요?'
    :name+' 계정을 삭제합니다. 이 계정으로 접속하던 기기는 더 접속할 수 없습니다.';
  if(!confirm(msg))return;
  try{await api('/admin/api/users/'+encodeURIComponent(name)+(last?'?allowEmpty=1':''),{method:'DELETE'});toast('삭제했습니다.');loadStats();}
  catch(err){toast(err.message);}}

// ── security ──────────────────────────────────────────────────────────
async function unlock(ip){if(!confirm(ip+' 의 차단을 해제합니다.'))return;
  try{await api('/admin/api/unlock',{method:'POST',body:{ip}});toast('차단을 해제했습니다.');loadStats();}catch(err){toast(err.message);}}
$('unlock-all').addEventListener('click',async()=>{if(!confirm('차단된 IP 를 모두 해제합니다.'))return;
  try{const r=await api('/admin/api/unlock',{method:'POST',body:{ip:'all'}});toast(r.unlocked+'개를 해제했습니다.');loadStats();}catch(err){toast(err.message);}});
$('clrdeny').addEventListener('click',async()=>{if(!confirm('거부 기록을 지웁니다.'))return;
  try{await api('/admin/api/denials/clear',{method:'POST',body:{}});loadStats();}catch(err){toast(err.message);}});

// ── devices ───────────────────────────────────────────────────────────
async function loadDevices(){
  const d=await api('/admin/api/devices');
  $('devhint').textContent=d.pairingEnabled?'CyberFoil 기기가 승인을 요청하면 여기에 나옵니다. 승인하면 비밀번호 없이 접속합니다.'
    :'기기 승인이 꺼져 있습니다. 쓰려면 compose 에 COOK_DEVICE_PAIRING=true 를 넣습니다.';
  const pending=d.pending||[];$('pending-count').hidden=!pending.length;$('pending-count').textContent=pending.length;
  table('pending',['기기 키','마지막 요청','IP',''],pending.map((p)=>{const tr=el('tr');
    const k=td(p.deviceKey.slice(0,16)+'…','ip');k.title=p.deviceKey;tr.append(k,td(fmt(p.lastSeenAt)),td(p.lastIp||'—','ip'));
    const act=td();act.append(btn('승인',()=>approve(p.deviceKey),'primary'));tr.append(act);return tr;}),'승인을 기다리는 기기가 없습니다.');
  table('devices',['이름','기기 키','마지막 접속','IP',''],(d.approved||[]).map((a)=>{const tr=el('tr');
    tr.append(td(a.label||'—'));const k=td(a.deviceKey.slice(0,16)+'…','ip');k.title=a.deviceKey;
    tr.append(k,td(fmt(a.lastSeenAt)),td(a.lastIp||'—','ip'));
    const act=td();const box=el('div',null,'row-actions');
    box.append(btn('키 재발급',()=>reissue(a.deviceKey,a.label)),btn('승인 취소',()=>revoke(a.deviceKey),'danger'));
    act.append(box);tr.append(act);return tr;}),'승인된 기기가 없습니다.');}
async function approve(deviceKey){const label=prompt('이 기기를 알아볼 이름을 정합니다 (예: 친구 스위치)','');if(label===null)return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label}});toast('승인했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function reissue(deviceKey,label){if(!confirm('새 접속 키를 발급합니다. 기기는 다음 접속 때 새 키를 받고, 지금 키는 바로 쓸 수 없게 됩니다.'))return;
  try{await api('/admin/api/devices/approve',{method:'POST',body:{deviceKey,label:label||''}});toast('새 키를 준비했습니다.');loadDevices();}catch(err){toast(err.message);}}
async function revoke(deviceKey){if(!confirm('이 기기의 승인을 취소합니다. 더는 접속할 수 없습니다.'))return;
  try{await api('/admin/api/devices/revoke',{method:'POST',body:{deviceKey}});toast('승인을 취소했습니다.');loadDevices();}catch(err){toast(err.message);}}

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

$('logout').addEventListener('click',async()=>{await fetch('/admin/logout',{method:'POST'});location.reload();});
syncTheme();showTab();loadStats();loadDevices();
setInterval(()=>{if(!$('cred-dialog').open){loadStats();loadDevices();}},15000);
`;
