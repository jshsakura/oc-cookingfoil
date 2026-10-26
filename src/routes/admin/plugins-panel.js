/**
 * The plugins page (Settings > Plugins): what is in data/plugins, whether each is on, why one is broken
 * or was switched off, and the plugins deleted into their own trash. Talks to /admin/api/plugins
 * (plugins-api.js); words come from plugins-words.js in the language the top area uses. The page shows
 * state codes from the server and words them here, so every language gets the same facts.
 */
import { top } from "./top-i18n.js";

export const PLUGINS_HTML = `<section id="tab-settings">
  <div class="hd"><h2 class="first">${top("pl.h")}</h2>
    <div class="actions"><button type="button" id="pl-rescan">${top("pl.rescan")}</button></div></div>
  <p class="muted">${top("pl.lead")}</p>
  <p class="pl-safe" id="pl-safe" hidden>${top("pl.safe")}</p>
  <div class="pl-list" id="pl-list"></div>
  <h3 id="pl-trashed-h" hidden>${top("pl.trashedH")}</h3>
  <div class="pl-list" id="pl-trashed"></div>
</section>`;

export const PLUGINS_CSS = `
.pl-safe{background:rgba(var(--accent-rgb),.1);border:1px solid rgba(var(--accent-rgb),.5);border-radius:14px;padding:10px 14px;margin:6px 0 12px;font-weight:600}
.pl-list{display:grid;gap:10px;margin:8px 0 14px}
.pl-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px 14px}
.pl-main{display:grid;gap:3px;min-width:0}
.pl-main b{overflow-wrap:anywhere}
.pl-main span{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.pl-main .err{color:var(--bad)}
.pl-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13px}
.pl-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
@media (max-width:640px){.pl-row{grid-template-columns:1fr}.pl-act{justify-content:flex-start}}
`;

export const PLUGINS_SCRIPT = /* js */ `
const plT=(k,v)=>{let s=topText('pl.'+k);if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
let plData=null;
const plWhen=(t)=>t?new Date(t).toLocaleString(adminLang==='ko'?'ko-KR':adminLang):'';
const PL_STATE={on:'s.on',off:'s.off',cooling:'s.cooling',failed:'s.failed','auto-disabled':'s.auto','crash-disabled':'s.crash',broken:'s.broken',incompatible:'s.incompat',missing:'s.missing',starting:'s.starting'};
const PL_REASON={'start-failed':'r.start',crash:'r.crash','crash-during-start':'r.crash','unhandled-rejection':'r.rej'};
function plProblem(code){
  if(code==='id-folder-mismatch')return plT('p.folder');
  if(code==='no-manifest')return plT('p.noManifest');
  if(code==='no-index')return plT('p.noIndex');
  if(/symlink|outside/.test(code))return plT('p.link');
  return plT('p.manifest');}
const plBytes=(n)=>n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
async function plClearCache(p){if(!await ask(plT('askCache',{name:(p.name&&(p.name[adminLang]||p.name.en))||p.id})))return;
  try{await api('/admin/api/plugins/'+encodeURIComponent(p.id)+'/cache/clear',{method:'POST',body:{}});toast(plT('tCache'));}
  catch(err){toast(err.message);}loadPlugins();}
function plRow(p){
  const r=el('div',null,'pl-row');const main=el('div',null,'pl-main');
  const name=(p.name&&(p.name[adminLang]||p.name.en))||p.id;
  main.append(el('b',name+' ('+p.id+')'));
  const d=p.description&&(p.description[adminLang]||p.description.en);if(d)main.append(el('span',d));
  const meta=el('div',null,'pl-meta');
  meta.append(pill(plT(PL_STATE[p.state]||'s.off'),p.state==='on'?'on':(p.state==='off'?'':'warn')));
  if(p.version)meta.append(el('span',plT('ver',{v:p.version})));
  if(p.provides.length)meta.append(el('span',plT('provides',{list:p.provides.map((k)=>plT('k.'+k)).join(', ')})));
  main.append(meta);
  if(p.cache&&p.cache.bytes>0)meta.append(el('span',plT('cacheUsed',{used:plBytes(p.cache.bytes),cap:plBytes(p.cache.capBytes)})));
  if(p.state==='broken'){const codes=[...new Set(p.problems.map(plProblem))];for(const c of codes)main.append(el('span',c,'err'));}
  if(p.state==='incompatible')main.append(el('span',plT('needs',{n:p.needs}),'err'));
  if(p.disabledReason&&PL_REASON[p.disabledReason]&&!p.enabled)main.append(el('span',plT(PL_REASON[p.disabledReason]),'err'));
  if(p.lastError&&p.state!=='on'&&p.state!=='off')main.append(el('span',plT('lastErr',{when:plWhen(p.lastErrorAt),msg:p.lastError}),'err'));
  if(p.state==='cooling')main.append(el('span',plT('retry',{when:plWhen(p.retryAt)})));
  const act=el('div',null,'pl-act');
  const usable=!['broken','incompatible','missing'].includes(p.state);
  if(usable)act.append(p.enabled?btn(plT('turnOff'),()=>plSwitch(p,false)):btn(plT('turnOn'),()=>plSwitch(p,true)));
  if(p.cache&&p.cache.bytes>0)act.append(btn(plT('cacheClear'),()=>plClearCache(p)));
  if(p.state!=='missing')act.append(btn(plT('del'),()=>plDelete(p,name),'danger'));
  r.append(main,act);return r;}
function plTrashedRow(t){
  const r=el('div',null,'pl-row');const main=el('div',null,'pl-main');
  main.append(el('b',t.id+(t.version?' '+t.version:'')),el('span',plT('trashedAt',{when:plWhen(t.trashedAt)})));
  const act=el('div',null,'pl-act');act.append(btn(plT('restore'),()=>plRestore(t)));
  r.append(main,act);return r;}
function plRender(){if(!plData)return;
  $('pl-safe').hidden=!plData.safeMode;
  $('pl-list').replaceChildren(...(plData.plugins.length?plData.plugins.map(plRow):[el('p',plT('none'),'muted')]));
  $('pl-trashed-h').hidden=!plData.trashed.length;
  $('pl-trashed').replaceChildren(...plData.trashed.map(plTrashedRow));}
async function loadPlugins(){try{plData=await api('/admin/api/plugins');plRender();}
  catch(err){if(err.message!=='session')toast(plT('loadFail',{err:err.message}));}}
async function plSwitch(p,on){
  const needsAsk=on&&p.needsKeys;if(needsAsk&&!await ask(plT('askKeys')))return;
  try{await api('/admin/api/plugins/'+encodeURIComponent(p.id)+'/enabled',{method:'POST',body:{on,confirmKeys:needsAsk}});toast(plT(on?'tOn':'tOff'));}
  catch(err){toast(err.message);}loadPlugins();}
async function plDelete(p,name){if(!await ask(plT('askDel',{name})))return;
  const dropData=await ask(plT('askDrop'));
  try{await api('/admin/api/plugins/'+encodeURIComponent(p.id)+'/trash',{method:'POST',body:{dropData}});toast(plT('tDel'));}
  catch(err){toast(err.message);}loadPlugins();}
async function plRestore(t){
  try{await api('/admin/api/plugins/restore',{method:'POST',body:{name:t.name}});toast(plT('tRestored'));}
  catch(err){toast(err.message);}loadPlugins();}
$('pl-rescan').addEventListener('click',async()=>{try{plData=await api('/admin/api/plugins/rescan',{method:'POST',body:{}});plRender();toast(plT('tScan'));}catch(err){toast(err.message);}});
`;
