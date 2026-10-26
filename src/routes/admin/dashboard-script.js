import { LIBRARY_PAGE_SCRIPT } from "./library-page.js";
import { LIST_HELPERS_SCRIPT } from "./list-helpers.js";
import { HOMEBREW_SCRIPT } from "./homebrew-page.js";
import { OVERVIEW_SCRIPT } from "./overview-page.js";
import { UPLOAD_SCRIPT } from "./upload-page.js";
import { ADMIN_SECURITY_SCRIPT } from "./security-pages.js";
import { FEATURED_SCRIPT } from "./featured-page.js";
/**
 * Browser script for the /admin dashboard (inlined into the page).
 * Plain DOM, no framework: the page must work on an offline LAN box.
 */
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
for(const tab of ['homebrew','alerts'])subtabs(tab);
// The settings tab shows one area at a time and loads only that one: #settings/security opens a given area.
const SET_SUBS=['server','integrations','security','tokens'];let setSub='server';
function setLoadSub(){
  if(setSub==='server')loadServerSettings();else if(setSub==='integrations')loadIntegrations();
  else if(setSub==='security'){loadTfa();loadGoogleSettings();}else if(setSub==='tokens'){loadTokens();loadMcp();}}
function setShowSub(sub,quiet){if(!SET_SUBS.includes(sub))return;setSub=sub;
  for(const b of document.querySelectorAll('#set-subtabs [data-ssub]'))b.setAttribute('aria-selected',String(b.dataset.ssub===sub));
  for(const p of document.querySelectorAll('#tab-settings [data-set-panel]'))p.hidden=p.dataset.setPanel!==sub;
  if(!quiet)setLoadSub();}
for(const b of document.querySelectorAll('#set-subtabs [data-ssub]'))b.addEventListener('click',()=>{history.replaceState(null,'','#settings/'+b.dataset.ssub);setShowSub(b.dataset.ssub);});


// ── overview + users + security (one stats call) ──────────────────────
// The server reports warnings by code (in English for its log); here each says what to do, with a button to the place to do it.
${OVERVIEW_SCRIPT}
async function loadStats(){
  const d=await api('/admin/api/stats');
  me=d.me||null;const a=d.lanes.admin;
  $('who').textContent=me?(me.name||me.email):(a.email||a.owner||'admin');acctAvatar(me?.avatar);
  $('ts').textContent=topFill('overview.asOf',{at:fmt(d.generatedAt)});
  renderWarnings(d.warnings||[]);renderLanes(d.lanes);renderCards(d);renderUsers(d.users||[]);renderSecurity(d);loadHealth();}

// The users, Google accounts, devices and issued-clients behaviour lives in
// The one-time credential dialog lives in people-script.js.
${LIST_HELPERS_SCRIPT}
// ── homebrew ──────────────────────────────────────────────────────────
${HOMEBREW_SCRIPT}

// ── upload ────────────────────────────────────────────────────────────
${UPLOAD_SCRIPT}

// ── library ───────────────────────────────────────────────────────────
${LIBRARY_PAGE_SCRIPT}
// ── featured ──────────────────────────────────────────────────────────
// Each row has a list of every library game to tick: a ticked game is in the row. The list is a page
// of /admin/api/games/search at a time, so 2,000 games cost one page; its box filters the same list.
${FEATURED_SCRIPT}
// A game's page in the library's info area can put it in a row too: the same rows and the same save.
// ── admin login: password and/or authenticator ─────────────────
${ADMIN_SECURITY_SCRIPT}
// The account circle, theme and sign-out wiring live in chrome-script.js,
// shared with the split pages of the redesign.
// The address a console is given, for the how-to on the devices tab.
// A tab that fails to load says so instead of leaving old rows on screen; the same failure is told once.
let loadErr='';
function guarded(fn){return async(...a)=>{try{const r=await fn(...a);loadErr='';return r;}
  catch(err){const m=topFill('as.loadFail',{msg:err&&err.message||err});if(m!==loadErr)toast(m);loadErr=m;}};}
loadHealth=guarded(loadHealth);loadStats=guarded(loadStats);loadDevices=guarded(loadDevices);
loadAccounts=guarded(loadAccounts);loadServerSettings=guarded(loadServerSettings);loadGoogleSettings=guarded(loadGoogleSettings);loadLibrary=guarded(loadLibrary);loadHomebrew=guarded(loadHomebrew);
showTab();loadStats();loadDevices();loadAccounts();loadGoogleSettings();
setInterval(()=>{if(!$('cred-dialog').open){loadStats();loadDevices();loadAccounts();}},15000);
`;
