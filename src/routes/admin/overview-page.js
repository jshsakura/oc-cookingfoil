/** Administration overview: status summaries and links to task owners. */
import { top, TOP_WORDS } from "./top-i18n.js";

const ko = (key) => `${TOP_WORDS.ko[key]}`;

export const OVERVIEW_HTML = /* html */ `<section id="tab-overview">
  <h2 class="first" data-top="ov.h">${ko("ov.h")}</h2>
  <div class="copy-row"><code id="shop-url">—</code><button type="button" id="shop-url-copy" data-top="ov.copy">${ko("ov.copy")}</button></div>
  <h3 class="ov-h" data-top="ov.todoH">${ko("ov.todoH")}</h3>
  <div id="warnings"></div>
  <h3 class="ov-h" data-top="ov.statusH">${ko("ov.statusH")}</h3>
  <div class="cards" id="ov-status"></div>
  <div class="lanes" id="lanes"></div>
  <div class="lanes" id="health"></div>
  <p class="muted" id="health-hint" hidden></p>
  <h3 class="ov-h" data-top="ov.recentH">${ko("ov.recentH")}</h3>
  <ul class="ov-recent" id="ov-recent"></ul>
  <p class="muted" id="ts"></p>
</section>`;

export const OVERVIEW_CSS = /* css */ `
.ov-h{margin:26px 0 10px;font-size:15px}
.card .s{color:var(--muted);font-size:12px;margin-top:2px}
.card.alert .v{color:var(--accent)}
.ov-recent{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
.ov-recent li{display:flex;gap:12px;padding:10px 16px;border-top:1px solid var(--line);font-size:13.5px;min-width:0}
.ov-recent li:first-child{border-top:0}
.ov-recent time{color:var(--muted);flex:none;font-variant-numeric:tabular-nums}
.ov-recent span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-recent li.none{color:var(--muted)}
`;

export const OVERVIEW_SCRIPT = /* js */ `
const WARNINGS={
  'storage-kept':{t:'ov.w.storageKeptT',df:(w)=>topFill('ov.w.storageKeptD',{paths:(w.paths||[]).map((p)=>p.now+' → '+p.want).join(', ')})},
  'old-incoming':{t:'ov.w.oldIncomingT',df:(w)=>topFill('ov.w.oldIncomingD',{paths:(w.paths||[]).map((p)=>p.now+' → '+p.want).join(', ')})},
  'no-prod-keys':{t:'ov.w.noProdKeysT',d:'ov.w.noProdKeysD',go:['ov.w.uploadKeys','/admin/settings/server']},
  'admin-2fa-skipped':{t:'ov.w.admin2faSkippedT',d:'ov.w.admin2faSkippedD',go:['ov.w.enroll','/admin/settings/admin']},
  'admin-unenrolled':{t:'ov.w.adminUnenrolledT',d:'ov.w.adminUnenrolledD',go:['ov.w.enroll','/admin/settings/admin']},
  'admin-authenticator-optional':{t:'ov.w.adminOptionalT',d:'ov.w.adminOptionalD',go:['ov.w.enroll','/admin/settings/admin']},
  'no-auth':{t:'ov.w.noAuthT',d:'ov.w.noAuthD',go:['ov.w.makeAccount','/admin/users']},
  'proxy-collapse':{t:'ov.w.proxyT',d:'ov.w.proxyD'},
  'both-lanes':{t:'ov.w.bothLanesT',d:'ov.w.bothLanesD'},
  'client-build-rejected':{t:'ov.w.buildT',df:(w)=>topFill('ov.w.buildLead',{code:topWords.en['ov.w.buildR.'+w.reason]?topText('ov.w.buildR.'+w.reason):w.reason,msg:w.message})+' '+(w.version?topFill('ov.w.buildKept',{v:w.version}):topText('ov.w.buildNone'))},
};
// Counted to-dos: where the button goes and the words; the config warnings above keep their own.
const TODO={
  damaged:{t:'ov.t.damaged',d:'ov.t.damagedD',go:'/admin/games#library/verify'},
  'pending-devices':{t:'ov.t.pendingDevices',d:'ov.t.pendingDevicesD',go:'/admin/devices'},
  'pending-accounts':{t:'ov.t.pendingAccounts',d:'ov.t.pendingAccountsD',go:'/admin/users'},
  inbox:{t:'ov.t.inbox',d:'ov.t.inboxD',go:'/admin/inbox'},
  'plugins-failing':{t:'ov.t.pluginsFailing',d:'ov.t.pluginsFailingD',go:'/admin/settings/plugins'},
  lockouts:{t:'ov.t.lockouts',d:'ov.t.lockoutsD',go:'/admin/logs/security'},
};
function ovNote(title,detail,warn,go){const n=el('div',null,'note'+(warn?' warn':''));
  n.append(el('div',title,'t'),el('div',detail,'d'));
  if(go){const b=btn(go[0],()=>{location.href=go[1];});b.classList.add('note-go');n.append(b);}
  return n;}
function renderWarnings(list){const box=$('warnings');box.replaceChildren();
  for(const w of list){const c=TODO[w.code];
    if(c){box.append(ovNote(topFill(c.t,{n:num(w.n)}),topFill(c.d,{ids:(w.ids||[]).join(', ')}),w.code==='damaged'||w.code==='plugins-failing',[topText('ov.go'),c.go]));continue;}
    const k=WARNINGS[w.code];
    box.append(ovNote(k?topText(k.t):w.title,k?(k.df?k.df(w):topText(k.d)):w.detail,w.severity==='warn',k?.go?[topText(k.go[0]),k.go[1]]:null));}
  if(!list.length)box.append(el('p',topText('ov.todoNone'),'muted'));}
function renderLanes(l){const box=$('lanes');box.replaceChildren();
  box.append(pill(l.accounts.enabled?topFill('ov.laneAccounts',{n:l.accounts.userCount}):topText('ov.laneAccountsNone'),l.accounts.enabled?'on':'off'));
  box.append(pill(topFill('ov.lanePairing',{v:topText(l.pairing.enabled?'ov.on':'ov.off')}),l.pairing.enabled?'on':''));
  if(l.pairingOnly)box.append(pill(topText('ov.pairingOnly'),'warn'));
  box.append(pill(topFill('ov.lane2fa',{v:topText(l.admin.enrolled?'ov.enrolled':'ov.notEnrolled')}),l.admin.enrolled?'on':'off'));}
// Where game names come from (titledb, the files' own data): the operator's view of what the web page used to show.
let ovHealth=null;
async function loadHealth(){
  let nh=null;try{const r=await fetch('/healthz',{headers:{Accept:'application/json'}});nh=(await r.json().catch(()=>null))?.nameHealth;}catch{}
  ovHealth=nh;renderHealth(nh);}
function renderHealth(nh){
  const box=$('health');box.replaceChildren();if(!nh)return;
  const v=nh.verdict==='filename-only'?[topText('ov.namesFilenameOnly'),'off']:nh.verdict==='degraded'?[topText('ov.namesDegraded'),'warn']:[topText('ov.namesOk'),'on'];
  box.append(pill(v[0],v[1]));
  const tdb=nh.titledb||{};box.append(pill(topFill('ov.titledbCount',{n:num(tdb.titles||0)})+((tdb.regions||[]).length?topFill('ov.regions',{n:tdb.regions.length}):''),(tdb.titles||0)>0?'on':'off'));
  const ex=nh.extraction||{};
  box.append(pill(topFill('ov.extraction',{v:ex.mode==='off'?topText('ov.off'):!ex.nstool?topText('ov.exNoNstool'):!ex.prodKeys?topText('ov.exNoKeys'):topText('ov.exOn')}),ex.nspXciCapable?'on':'off'));
  const hint=$('health-hint');hint.hidden=nh.verdict!=='filename-only';
  hint.textContent=topText('ov.healthHint');}
function ovBytes(b){const u=['B','KB','MB','GB','TB','PB'];let i=0;b=Number(b||0);while(b>=1024&&i<u.length-1){b/=1024;i++;}
  return b.toLocaleString(loc(),{maximumFractionDigits:b<10&&i?1:0})+' '+u[i];}
function renderStatus(st){const box=$('ov-status');box.replaceChildren();
  const card=(l,v,sub,alert)=>{const c=el('div',null,'card'+(alert?' alert':''));c.append(el('div',v,'v'),el('div',l,'l'));if(sub)c.append(el('div',sub,'s'));return c;};
  box.append(card(topText('ov.s.games'),topFill('ov.s.gamesV',{n:num(st.games.titles)}),topFill('ov.s.gamesSub',{files:num(st.games.files),size:ovBytes(st.games.bytes)})));
  for(const dk of st.disk||[])box.append(card(topText(dk.key==='games'?'ov.s.diskGames':'ov.s.diskData'),ovBytes(dk.free),topFill('ov.s.diskSub',{size:ovBytes(dk.size)}),dk.size&&dk.free/dk.size<0.05));
  const vc=st.verify.counts||{};const bad=(vc.damaged||0)+(vc.modified||0);
  box.append(card(topText('ov.s.verify'),bad?topFill('ov.s.verifyBad',{d:num(vc.damaged),m:num(vc.modified)}):topText('ov.s.verifyOk'),topFill('ov.s.verifySub',{n:num(st.verify.total-(vc.unchecked||0))}),(vc.damaged||0)>0));
  box.append(card(topText('ov.s.xfer'),topFill('ov.s.xferV',{n:num(st.transfers.active)})));
  box.append(card(topText('ov.s.plugins'),topFill('ov.s.pluginsV',{on:num(st.plugins.on),total:num(st.plugins.total)})));}
function renderRecent(list){const box=$('ov-recent');box.replaceChildren();
  for(const e of list){const li=el('li');const t=el('time',fmt(e.at));t.dateTime=new Date(e.at).toISOString();li.append(t,el('span',e.text));li.title=e.text;box.append(li);}
  if(!list.length)box.append(el('li',topText('ov.recentNone'),'none'));}
function renderOverview(d){
  $('ts').textContent=topFill('overview.asOf',{at:fmt(d.generatedAt)});
  renderWarnings(d.todo||[]);if(d.lanes)renderLanes(d.lanes);renderStatus(d.status);renderRecent(d.recent||[]);}
function showShopUrl(){$('shop-url').textContent=location.origin.replace(/[/]$/,'');}
$('shop-url-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('shop-url').textContent);toast(topText('ov.copied'));}catch{toast(topText('ov.copyFail'));}});
showShopUrl();

async function loadOverview(){
  try{const d=await api('/admin/api/overview');ovData=d;renderOverview(d);await loadHealth();
  }catch(err){if(err.message!=='session')toast(errText(err));}}
// A language switch repaints the last data: dates and counts follow the new locale at once.
let ovData=null;
function ovRelabel(){if(ovData)renderOverview(ovData);if(ovHealth)renderHealth(ovHealth);}
`;
