/** Administration overview: status summaries and links to task owners. */
import { top, TOP_WORDS } from "./top-i18n.js";

const ko = (key) => `${TOP_WORDS.ko[key]}`;

export const OVERVIEW_HTML = /* html */ `<section id="tab-overview">
  <h2 class="first" data-top="ov.h">${ko("ov.h")}</h2>
  <div class="copy-row"><code id="library-url">—</code><button type="button" id="library-url-copy" data-top="ov.copy">${ko("ov.copy")}</button></div>
  <h3 class="ov-h" data-top="ov.todoH">${ko("ov.todoH")}</h3>
  <div id="warnings"></div>
  <h3 class="ov-h" data-top="ov.addedH">${ko("ov.addedH")}</h3>
  <div class="ov-added">
    <section class="ov-col"><div class="ov-col-h"><b data-top="ov.addedGames">${ko("ov.addedGames")}</b><a href="/admin/games" data-top="ov.seeAll">${ko("ov.seeAll")}</a></div><ul class="ov-list" id="ov-added-games"></ul></section>
    <section class="ov-col"><div class="ov-col-h"><b data-top="ov.addedPatches">${ko("ov.addedPatches")}</b><a href="/admin/games#library/patches" data-top="ov.seeAll">${ko("ov.seeAll")}</a></div><ul class="ov-list" id="ov-added-patches"></ul></section>
  </div>
  <h3 class="ov-h" data-top="ov.statusH">${ko("ov.statusH")}</h3>
  <div class="cards" id="ov-status"></div>
  <dl class="ov-facts" id="lanes"></dl>
  <dl class="ov-facts" id="health"></dl>
  <p class="muted" id="health-hint" hidden></p>
  <h3 class="ov-h" data-top="ov.recentH">${ko("ov.recentH")}</h3>
  <ul class="ov-recent" id="ov-recent"></ul>
  <dialog id="ov-alert" aria-labelledby="ov-alert-h">
    <h3 id="ov-alert-h"></h3>
    <p class="muted" id="ov-alert-meta"></p>
    <div class="ov-alert-body" id="ov-alert-body"></div>
    <div class="dialog-actions"><a class="btn" href="/admin/logs/alerts" data-top="ov.alertAll">${ko("ov.alertAll")}</a><button type="button" class="primary" id="ov-alert-x" data-top="acc.close">${ko("acc.close")}</button></div>
  </dialog>
  <p class="muted" id="ts"></p>
</section>`;

export const OVERVIEW_CSS = /* css */ `
.ov-h{margin:26px 0 10px;font-size:var(--fs-md)}
.card .s{color:var(--muted);font-size:var(--fs-xs);margin-top:2px}
.card.alert .v{color:var(--accent)}
#ov-status .card .v{font-size:var(--fs-2xl);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ov-recent{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:var(--r-2xl);background:var(--panel);overflow:hidden}
.ov-recent li{display:flex;gap:12px;padding:10px 16px;border-top:1px solid var(--line);font-size:var(--fs-sm);min-width:0}
.ov-recent li:first-child{border-top:0}
.ov-recent time{color:var(--muted);flex:none;font-variant-numeric:tabular-nums}
.ov-recent span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-recent li.none{color:var(--muted)}
.ov-recent li[role=button]{cursor:pointer}.ov-recent li[role=button]:hover{background:var(--sunk)}
.ov-recent li[role=button]:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}
#ov-alert{width:min(560px,94vw)}
.ov-alert-body{white-space:pre-wrap;word-break:break-word;background:var(--sunk);border-radius:var(--r-lg);padding:12px 14px;font-size:var(--fs-sm);max-height:50vh;overflow:auto}
.ov-added{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:12px}
.ov-col{border:1px solid var(--line);border-radius:var(--r-2xl);background:var(--panel);overflow:hidden;min-width:0}
.ov-col-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px;background:var(--sunk);border-bottom:1px solid var(--line);font-size:var(--fs-sm)}
.ov-col-h a{color:var(--muted);font-size:var(--fs-xs);text-decoration:none;white-space:nowrap}.ov-col-h a:hover{color:var(--text)}
.ov-list{list-style:none;margin:0;padding:0}
.ov-list li{display:flex;align-items:center;gap:10px;padding:8px 16px;border-top:1px solid var(--line);font-size:var(--fs-sm);min-width:0}
.ov-list li:first-child{border-top:0}
.ov-list img{width:30px;height:30px;border-radius:var(--r-sm);flex:none;object-fit:cover;background:var(--sunk)}
.ov-list .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-list .nm small{display:block;color:var(--muted);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis}
.ov-list .pill{flex:none}
.ov-list time{flex:none;color:var(--muted);font-size:var(--fs-xs);font-variant-numeric:tabular-nums;white-space:nowrap}
.ov-list li.none{color:var(--muted)}
.ov-list .pt-edit{flex:none}
.ov-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));margin:12px 0 0;border:1px solid var(--line);border-radius:var(--r-2xl);background:var(--panel);overflow:hidden}
.ov-facts:empty{display:none}
.ov-facts+.ov-facts{margin-top:8px}
.ov-fact{display:flex;align-items:center;gap:10px;min-width:0;padding:11px 16px;border-top:1px solid var(--line);margin-top:-1px;font-size:var(--fs-sm)}
.ov-fact::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--muted)}
.ov-fact.on::before{background:var(--good)}.ov-fact.warn::before{background:var(--warn)}.ov-fact.off::before{background:var(--bad)}
.ov-fact dt{color:var(--muted);flex:none}
.ov-fact dd{margin:0 0 0 auto;font-weight:var(--fw-bold);text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-fact a{flex:none;color:var(--text);font-size:var(--fs-xs);text-underline-offset:3px}
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
  damaged:{t:'ov.t.damaged',d:'ov.t.damagedD',go:'/admin/games?view=verify&check=damaged#library/verify'},
  'pending-devices':{t:'ov.t.pendingDevices',d:'ov.t.pendingDevicesD',go:'/admin/devices'},
  'pending-accounts':{t:'ov.t.pendingAccounts',d:'ov.t.pendingAccountsD',go:'/admin/users'},
  inbox:{t:'ov.t.inbox',d:'ov.t.inboxD',go:'/admin/inbox'},
  'plugins-failing':{t:'ov.t.pluginsFailing',d:'ov.t.pluginsFailingD',go:'/admin/settings/plugins'},
  lockouts:{t:'ov.t.lockouts',d:'ov.t.lockoutsD',go:'/admin/logs/security'},
  'no-names-plugin':{t:'ov.t.noNames',d:'ov.t.noNamesD',go:'/admin/settings/plugins'},
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
// Every status string in every language reads "label: value" (or "titledb 12"), so one row splits it there.
function ovFact(text,state,go){const m=/^(.*?)\\s?[:：]\\s?(.*)$/.exec(text)||/^(\\S+)\\s(.*)$/.exec(text)||[text,text,''];
  const row=el('div',null,'ov-fact'+(state?' '+state:''));row.append(el('dt',m[1]),el('dd',m[2]));
  if(go){const a=document.createElement('a');a.href=go[1];a.textContent=go[0];row.append(a);}
  return row;}
function renderLanes(l){const box=$('lanes');box.replaceChildren();
  box.append(ovFact(l.accounts.enabled?topFill('ov.laneAccounts',{n:l.accounts.userCount}):topText('ov.laneAccountsNone'),l.accounts.enabled?'on':'off'));
  const pairing=ovFact(topFill('ov.lanePairing',{v:topText(l.pairing.enabled?'ov.on':'ov.off')}),l.pairing.enabled?'on':'');
  if(l.pairingOnly){pairing.className='ov-fact warn';pairing.querySelector('dd').textContent+=' · '+topText('ov.pairingOnly');}
  box.append(pairing);
  box.append(ovFact(topFill('ov.lane2fa',{v:topText(l.admin.enrolled?'ov.enrolled':'ov.notEnrolled')}),l.admin.enrolled?'on':'',l.admin.enrolled?null:[topText('ov.w.enroll'),'/admin/settings/admin']));}
// Where game names come from (titledb, the files' own data): the operator's view of what the web page used to show.
let ovHealth=null;
async function loadHealth(){
  let nh=null;try{const r=await fetch('/healthz',{headers:{Accept:'application/json'}});nh=(await r.json().catch(()=>null))?.nameHealth;}catch{}
  ovHealth=nh;renderHealth(nh);}
function renderHealth(nh){
  const box=$('health');box.replaceChildren();if(!nh)return;
  const v=nh.verdict==='filename-only'?[topText('ov.namesFilenameOnly'),'off']:nh.verdict==='degraded'?[topText('ov.namesDegraded'),'warn']:[topText('ov.namesOk'),'on'];
  box.append(ovFact(v[0],v[1]));
  const tdb=nh.titledb||{};box.append(ovFact(topFill('ov.titledbCount',{n:num(tdb.titles||0)})+((tdb.regions||[]).length?topFill('ov.regions',{n:tdb.regions.length}):''),(tdb.titles||0)>0?'on':'off'));
  const ex=nh.extraction||{};
  box.append(ovFact(topFill('ov.extraction',{v:ex.mode==='off'?topText('ov.off'):!ex.nstool?topText('ov.exNoNstool'):!ex.prodKeys?topText('ov.exNoKeys'):topText('ov.exOn')}),ex.nspXciCapable?'on':'off'));
  const hint=$('health-hint');hint.hidden=nh.verdict!=='filename-only';
  hint.textContent=topText('ov.healthHint');}
function ovBytes(b){const u=['B','KB','MB','GB','TB','PB'];let i=0;b=Number(b||0);while(b>=1024&&i<u.length-1){b/=1024;i++;}
  return b.toLocaleString(loc(),{maximumFractionDigits:b<10&&i?1:0})+' '+u[i];}
function renderStatus(st){const box=$('ov-status');box.replaceChildren();
  const card=(l,v,sub,alert)=>{const c=el('div',null,'card'+(alert?' alert':''));c.append(el('div',v,'v'),el('div',l,'l'));if(sub)c.append(el('div',sub,'s'));return c;};
  box.append(card(topText('ov.s.games'),topFill('ov.s.gamesV',{n:num(st.games.titles)}),topFill('ov.s.gamesSub',{files:num(st.games.files),size:ovBytes(st.games.bytes)})));
  for(const dk of st.disk||[])box.append(card(topText(dk.key==='games'?'ov.s.diskGames':'ov.s.diskData'),ovBytes(dk.free),topFill('ov.s.diskSub',{size:ovBytes(dk.size)}),dk.size&&dk.free/dk.size<0.05));
  // Damage is the headline; a modified file (a translation patch) is not damage, so it goes in the small line.
  const vc=st.verify.counts||{};const checked=topFill('ov.s.verifySub',{n:num(st.verify.total-(vc.unchecked||0))});
  box.append(card(topText('ov.s.verify'),vc.damaged?topFill('ov.s.verifyDamaged',{d:num(vc.damaged)}):topText('ov.s.verifyOk'),vc.modified?checked+' · '+topFill('ov.s.verifyModified',{m:num(vc.modified)}):checked,(vc.damaged||0)>0));
  box.append(card(topText('ov.s.xfer'),topFill('ov.s.xferV',{n:num(st.transfers.active)})));
  box.append(card(topText('ov.s.plugins'),topFill('ov.s.pluginsV',{on:num(st.plugins.on),total:num(st.plugins.total)})));}
// A row opens the whole message: the list shows its first line only.
function ovAlert(e){$('ov-alert-h').textContent=e.text;
  $('ov-alert-meta').textContent=fmt(e.at)+' · '+(topWords.ko['al.st.'+e.status]?topText('al.st.'+e.status):e.status)+(e.detail?' · '+e.detail:'');
  $('ov-alert-body').textContent=e.body||e.text;$('ov-alert').showModal();}
$('ov-alert-x').addEventListener('click',()=>$('ov-alert').close());
function renderRecent(list){const box=$('ov-recent');box.replaceChildren();
  for(const e of list){const li=el('li');const t=el('time',fmt(e.at));t.dateTime=new Date(e.at).toISOString();li.append(t,el('span',e.text));li.title=e.text;
    li.tabIndex=0;li.setAttribute('role','button');li.addEventListener('click',()=>ovAlert(e));li.addEventListener('keydown',(ev)=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ovAlert(e);}});
    box.append(li);}
  if(!list.length)box.append(el('li',topText('ov.recentNone'),'none'));}
// What came in lately: the newest game files and patches, each with when.
const OV_KIND={base:'ov.kind.base',update:'ov.kind.update',dlc:'ov.kind.dlc'};
function ovDay(at){return new Date(at).toLocaleDateString(loc(),{month:'short',day:'numeric'});}
function ovRow(iconId,name,sub,tag,at){const li=el('li');
  if(iconId&&/^[0-9A-F]{16}$/i.test(iconId)){const im=document.createElement('img');im.alt='';im.loading='lazy';im.src='/api/library/icon/'+iconId+'?size=sm';im.onerror=()=>{im.style.visibility='hidden';};li.append(im);}
  const nm=el('span',name,'nm');if(sub)nm.append(el('small',sub));li.title=name;
  li.append(nm);if(tag)li.append(pill(tag,''));const t=el('time',ovDay(at));t.dateTime=new Date(at).toISOString();li.append(t);return li;}
function renderAdded(a){
  const g=$('ov-added-games');g.replaceChildren();
  for(const f of a?.games||[])g.append(ovRow(f.titleId,f.name,null,OV_KIND[f.kind]?topText(OV_KIND[f.kind]):'',f.at));
  if(!g.children.length)g.append(el('li',topText('ov.addedGamesNone'),'none'));
  const p=$('ov-added-patches');p.replaceChildren();
  for(const x of a?.patches||[]){const li=ovRow(x.titleId,x.name,x.game,null,x.at);
    const e=tbtn('edit','hb.editBtn',()=>ctOpen('patch',{...x,title_id:x.titleId},loadOverview),'pt-edit');e.setAttribute('aria-label',topFill('hb.editAria',{name:x.name}));
    li.append(e);p.append(li);}
  if(!p.children.length)p.append(el('li',topText('ov.addedPatchesNone'),'none'));}
function renderOverview(d){
  $('ts').textContent=topFill('overview.asOf',{at:fmt(d.generatedAt)});
  renderWarnings(d.todo||[]);if(d.lanes)renderLanes(d.lanes);renderAdded(d.added);renderStatus(d.status);renderRecent(d.recent||[]);}
function showLibraryUrl(){$('library-url').textContent=location.origin.replace(/[/]$/,'');}
$('library-url-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('library-url').textContent);toast(topText('ov.copied'));}catch{toast(topText('ov.copyFail'));}});
showLibraryUrl();

async function loadOverview(){
  try{const d=await api('/admin/api/overview');ovData=d;renderOverview(d);await loadHealth();
  }catch(err){if(err.message!=='session')toast(errText(err));}}
// A language switch repaints the last data: dates and counts follow the new locale at once.
let ovData=null;
function ovRelabel(){if(ovData)renderOverview(ovData);if(ovHealth)renderHealth(ovHealth);}
`;
