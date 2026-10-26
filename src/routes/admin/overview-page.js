/** Administration overview: status summaries and links to task owners. */
import { box } from "./boxes.js";
import { connectHowto } from "./connect-howto.js";
import { top, TOP_WORDS } from "./top-i18n.js";

const ko = (key) => `${TOP_WORDS.ko[key]}`;

export const OVERVIEW_HTML = /* html */ `<section id="tab-overview">
  <h2 class="first" data-top="ov.h">${ko("ov.h")}</h2>
  <div class="copy-row"><code id="shop-url">—</code><button type="button" id="shop-url-copy" data-top="ov.copy">${ko("ov.copy")}</button></div>
  ${box("connect-howto", `<span data-top="ov.howtoH">${ko("ov.howtoH")}</span>`, `<ul class="howto-list">${connectHowto().map((line) => `<li>${line}</li>`).join("")}</ul>`, { level: "h3", folded: true })}
  <div id="warnings"></div>
  <div class="lanes" id="lanes"></div>
  <div class="lanes" id="health"></div>
  <p class="muted" id="health-hint" hidden></p>
  <div class="cards" id="cards"></div>
  <p><a href="/admin/client">${top("m.client")}</a></p>
  <p class="muted" id="ts"></p>
</section>`;

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
function renderWarnings(list){const box=$('warnings');box.replaceChildren();
  for(const w of list){const k=WARNINGS[w.code];const n=el('div',null,'note'+(w.severity==='warn'?' warn':''));
    n.append(el('div',k?topText(k.t):w.title,'t'),el('div',k?(k.df?k.df(w):topText(k.d)):w.detail,'d'));
    if(k?.go){const b=btn(topText(k.go[0]),()=>{location.href=k.go[1];});b.classList.add('note-go');n.append(b);}
    box.append(n);}}
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
function renderCards(d){const cards=$('cards');cards.replaceChildren();
  const card=(l,v,alert)=>{const c=el('div',null,'card'+(alert?' alert':''));c.append(el('div',num(v),'v'),el('div',l,'l'));return c;};
  cards.append(card(topText('ov.cardUsers'),d.totals.configuredUsers),card(topText('ov.cardRequests'),d.totals.totalRequests),
    card(topText('ov.cardLockouts'),d.totals.lockouts,d.totals.lockouts>0),card(topText('ov.cardDenied'),d.totals.denied24h,d.totals.denied24h>0));}

function showShopUrl(){$('shop-url').textContent=location.origin.replace(/[/]$/,'');}
$('shop-url-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('shop-url').textContent);toast(topText('ov.copied'));}catch{toast(topText('ov.copyFail'));}});
showShopUrl();

async function loadOverview(){
  try{const d=await api('/admin/api/stats');
    ovStats=d;
    $('ts').textContent=topFill('overview.asOf',{at:fmt(d.generatedAt)});
    renderWarnings(d.warnings||[]);renderLanes(d.lanes);renderCards(d);await loadHealth();
  }catch(err){if(err.message!=='session')toast(errText(err));}}
// A language switch repaints the last data: dates and counts follow the new locale at once.
let ovStats=null;
function ovRelabel(){if(!ovStats)return;
  $('ts').textContent=topFill('overview.asOf',{at:fmt(ovStats.generatedAt)});
  renderWarnings(ovStats.warnings||[]);renderLanes(ovStats.lanes);renderCards(ovStats);
  if(ovHealth)renderHealth(ovHealth);}
`;
