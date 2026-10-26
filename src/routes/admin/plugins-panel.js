/**
 * The plugins page (Settings > Plugins): what is in data/plugins, whether each is on, why one is broken
 * or was switched off, and the plugins deleted into their own trash. Talks to /admin/api/plugins
 * (plugins-api.js); words come from plugins-words.js in the language the top area uses. The page shows
 * state codes from the server and words them here, so every language gets the same facts.
 */
import { top } from "./top-i18n.js";
import { box } from "./boxes.js";

export const PLUGINS_HTML = `<section id="tab-settings">
  <div class="hd"><h2 class="first">${top("pl.h")}</h2>
    <div class="actions"><button type="button" id="pl-rescan">${top("pl.rescan")}</button></div></div>
  <p class="muted">${top("pl.lead")}</p>
  <p class="pl-safe" id="pl-safe" hidden>${top("pl.safe")}</p>
  ${box("pl-install", top("pl.installH"), `<p class="muted">${top("pl.installLead")}</p>
    <p class="pl-off" id="pl-install-off" hidden>${top("pl.installOffNote")}</p>
    <div class="actions" id="pl-install-on"><button type="button" id="pl-install-btn">${top("pl.installBtn")}</button><span class="muted" id="pl-install-state" role="status"></span></div>
    <input type="file" id="pl-install-file" accept=".zip,application/zip" hidden>`, { level: "h3" })}
  ${box("pl-installed", top("pl.listH"), `<div class="pl-list" id="pl-list"></div>`, { level: "h3", meta: `<span id="pl-count"></span>` })}
  <div id="pl-agents" hidden>${box("pl-agents-box", top("pl.agH"), `<p class="muted">${top("pl.agLead")}</p>
    <div class="pl-list" id="pl-agents-list"></div>`, { level: "h3" })}</div>
  <div id="pl-trashed-h" hidden>${box("pl-trash", top("pl.trashedH"), `<div class="pl-list" id="pl-trashed"></div>`, { level: "h3" })}</div>
</section>`;

export const PLUGINS_CSS = `
.pl-safe{background:rgba(var(--accent-rgb),.1);border:1px solid rgba(var(--accent-rgb),.5);border-radius:var(--r-xl);padding:10px 14px;margin:6px 0 12px;font-weight:var(--fw-bold)}
#ask-text{white-space:pre-line}
.pl-off{margin:0;padding:10px 14px;border-radius:var(--r-lg);background:var(--sunk);color:var(--muted);font-size:var(--fs-sm)}
#pl-install-on[hidden]{display:none}
.pl-list{display:grid;gap:10px}
.pl-list>p.muted{margin:0}
.pl-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:12px 14px}
.pl-main{display:grid;gap:3px;min-width:0}
.pl-main b{overflow-wrap:anywhere}
.pl-main span{color:var(--muted);font-size:var(--fs-sm);overflow-wrap:anywhere}
.pl-main .err{color:var(--bad)}
.pl-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:var(--fs-sm)}
.pl-sw{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;min-width:92px;padding:9px 12px 9px 16px;color:var(--muted)}
.pl-sw[aria-checked="true"]{color:var(--text);border-color:var(--accent)}
.pl-sw:disabled{opacity:.6;cursor:not-allowed}
.pl-ag{display:grid;gap:6px}
.pl-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pl-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:var(--r-pill);padding:2px 4px 2px 10px;font-size:var(--fs-sm)}
.pl-chip button{min-width:28px;height:26px;padding:0 6px}
.pl-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
@media (max-width:640px){.pl-row{grid-template-columns:1fr}.pl-act{justify-content:flex-start}}
`;

export const PLUGINS_SCRIPT = /* js */ `
const plT=(k,v)=>{let s=topText('pl.'+k);if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
let plData=null;let plAg=null;
const plSrc=(s)=>s.startsWith('agent:')?s.slice(6):plT('agS.'+s);
async function plSaveOrder(field,list){
  try{plAg=await api('/admin/api/plugins/agents/order',{method:'POST',body:{[field]:list}});toast(plT('tAgOrder'));}
  catch(err){toast(err.message);}plAgRender();}
function plAgRow(f){
  const list=(plAg.order[f]||plAg.defaults[f]).filter((x)=>x!=='admin');
  const row=el('div',null,'pl-row pl-ag');row.append(el('b',plT('agF.'+f)));
  const chips=el('div',null,'pl-chips');
  list.forEach((src,i)=>{
    const c=el('span',null,'pl-chip');c.append(el('span',plSrc(src)));
    const up=btn('\u2191',()=>{const n=[...list];[n[i-1],n[i]]=[n[i],n[i-1]];plSaveOrder(f,n);});
    const dn=btn('\u2193',()=>{const n=[...list];[n[i+1],n[i]]=[n[i],n[i+1]];plSaveOrder(f,n);});
    up.title=plT('agUp');up.setAttribute('aria-label',plT('agUp'));dn.title=plT('agDown');dn.setAttribute('aria-label',plT('agDown'));
    up.disabled=i===0;dn.disabled=i===list.length-1;c.append(up,dn);chips.append(c);});
  row.append(chips);
  if(plAg.order[f])row.append(btn(plT('agUsual'),()=>plSaveOrder(f,null)));
  return row;}
function plAgRender(){
  const box=$('pl-agents');if(!plAg||!plAg.plugins.length){box.hidden=true;return;}
  box.hidden=false;$('pl-agents-list').replaceChildren(...plAg.fields.map(plAgRow));}
async function plClearValues(p){if(!await ask(plT('agAsk',{name:plName(p)})))return;
  try{await api('/admin/api/plugins/agents/clear',{method:'POST',body:{id:p.id}});toast(plT('tAgClear'));}
  catch(err){toast(err.message);}loadPlugins();}
const plWhen=(t)=>t?new Date(t).toLocaleString(adminLang==='ko'?'ko-KR':adminLang):'';
const PL_STATE={on:'s.on',off:'s.off',cooling:'s.cooling',failed:'s.failed','auto-disabled':'s.auto','crash-disabled':'s.crash',broken:'s.broken',incompatible:'s.incompat',missing:'s.missing',starting:'s.starting'};
const PL_REASON={'start-failed':'r.start',crash:'r.crash','crash-during-start':'r.crash','unhandled-rejection':'r.rej'};
function plProblem(code){
  if(code==='id-folder-mismatch')return plT('p.folder');
  if(code==='no-manifest')return plT('p.noManifest');
  if(code==='no-index')return plT('p.noIndex');
  if(/symlink|outside/.test(code))return plT('p.link');
  return plT('p.manifest');}
const plName=(p)=>(p.name&&(p.name[adminLang]||p.name.en))||p.id;
// What a plugin asks for, one line each, for the dialogs that come before installing or switching it on.
function plPerms(p){const L=[];
  if(p.needsKeys)L.push(plT('permKeys'));
  if(p.hosts&&p.hosts.length)L.push(plT('permHosts',{list:p.hosts.join(', ')}));
  if(p.console&&p.console.length)L.push(plT('permConsole',{list:p.console.join(', ')}));
  if(p.libraries&&p.libraries.length)L.push(plT('permLibs',{list:p.libraries.join(', ')}));
  const has=(k)=>p.provides&&p.provides.includes(k);
  if(has('request'))L.push(plT('permRequest'));
  if(has('route')&&p.routes&&p.routes.length)L.push(plT('permRoutes',{list:p.routes.map((r)=>r.method+' /api/plugins/'+p.id+'/'+r.name+' ('+plT('access.'+r.access)+')').join(', ')}));
  if(has('event'))L.push(plT('permEvents'));
  if(has('event')&&p.identity&&p.identity.length)L.push(plT('permIdentity',{list:p.identity.map((i)=>plT('id.'+i)).join(', ')}));
  if(p.provides&&p.provides.length)L.push(plT('permProvides',{list:p.provides.map((k)=>plT('k.'+k)).join(', ')}));
  return L.length?L.join('\\n'):plT('permNone');}
// The on/off switch of a row, as tall as the row's other buttons. Turning on opens the permission
// dialog; if that is cancelled or fails, the row is drawn again and the switch is back where it was.
function plToggle(p,name,usable){
  const b=el('button',p.enabled?plT('s.on'):plT('s.off'),'pl-sw');b.type='button';
  b.setAttribute('role','switch');b.setAttribute('aria-checked',String(p.enabled));b.setAttribute('aria-label',name);
  b.append(el('span',null,'switch'));
  if(!usable){b.disabled=true;b.setAttribute('aria-disabled','true');return b;}
  b.title=plT(p.enabled?'turnOff':'turnOn');
  b.addEventListener('click',async()=>{
    const want=!p.enabled;b.disabled=true;b.setAttribute('aria-checked',String(want));
    try{await plSwitch(p,want);}finally{plRender();}});
  return b;}
const plBytes=(n)=>n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
async function plClearCache(p){if(!await ask(plT('askCache',{name:plName(p)})))return;
  try{await api('/admin/api/plugins/'+encodeURIComponent(p.id)+'/cache/clear',{method:'POST',body:{}});toast(plT('tCache'));}
  catch(err){toast(err.message);}loadPlugins();}
function plRow(p){
  const r=el('div',null,'pl-row');const main=el('div',null,'pl-main');
  const name=plName(p);
  main.append(el('b',name+' ('+p.id+')'));
  const d=p.description&&(p.description[adminLang]||p.description.en);if(d)main.append(el('span',d));
  const meta=el('div',null,'pl-meta');
  meta.append(pill(plT(PL_STATE[p.state]||'s.off'),p.state==='on'?'on':(p.state==='off'?'':'warn')));
  if(p.version)meta.append(el('span',plT('ver',{v:p.version})));
  if(p.provides.length)meta.append(el('span',plT('provides',{list:p.provides.map((k)=>plT('k.'+k)).join(', ')})));
  main.append(meta);
  if(p.cache&&p.cache.bytes>0)meta.append(el('span',plT('cacheUsed',{used:plBytes(p.cache.bytes),cap:plBytes(p.cache.capBytes)})));
  if(p.origin&&p.origin.source==='upload')main.append(el('span',plT('fromUpload',{sha:p.origin.sha256})));
  if(p.state==='broken'){const codes=[...new Set(p.problems.map(plProblem))];for(const c of codes)main.append(el('span',c,'err'));}
  if(p.state==='incompatible')main.append(el('span',plT('needs',{n:p.needs}),'err'));
  if(p.disabledReason&&PL_REASON[p.disabledReason]&&!p.enabled)main.append(el('span',plT(PL_REASON[p.disabledReason]),'err'));
  if(p.lastError&&p.state!=='on'&&p.state!=='off')main.append(el('span',plT('lastErr',{when:plWhen(p.lastErrorAt),msg:p.lastError}),'err'));
  if(p.events&&(p.events.handled||p.events.dropped||p.events.failed||p.events.queued))main.append(el('span',plT('evStats',{handled:p.events.handled,dropped:p.events.dropped,failed:p.events.failed})));
  const ag=plAg&&plAg.plugins.find((x)=>x.id===p.id);
  if(ag)main.append(el('span',plT('agStats',{asked:ag.asked,answered:ag.answered,empty:ag.empty,failed:ag.failed,waiting:ag.waiting})));
  if(p.state==='cooling')main.append(el('span',plT('retry',{when:plWhen(p.retryAt)})));
  const act=el('div',null,'pl-act');
  const usable=!['broken','incompatible','missing'].includes(p.state);
  if(p.restartNeeded)main.append(el('span',plT('restartNeeded'),'err'));
  act.append(plToggle(p,name,usable&&!p.restartNeeded&&p.state!=='crash-disabled'));
  if(p.cache&&p.cache.bytes>0)act.append(btn(plT('cacheClear'),()=>plClearCache(p)));
  if(ag&&ag.cached>0)act.append(btn(plT('agClear'),()=>plClearValues(p)));
  if(p.state!=='missing'){const dl=el('a',plT('download'),'btn');dl.href='/admin/api/plugins/'+encodeURIComponent(p.id)+'/download';dl.setAttribute('download','');act.append(dl);}
  if(p.state!=='missing')act.append(btn(plT('del'),()=>plDelete(p,name),'danger'));
  r.append(main,act);return r;}
function plTrashedRow(t){
  const r=el('div',null,'pl-row');const main=el('div',null,'pl-main');
  main.append(el('b',t.id+(t.version?' '+t.version:'')),el('span',plT('trashedAt',{when:plWhen(t.trashedAt)})));
  const act=el('div',null,'pl-act');act.append(btn(plT('restore'),()=>plRestore(t)));
  r.append(main,act);return r;}
function plRender(){if(!plData)return;
  $('pl-safe').hidden=!plData.safeMode;
  $('pl-install-on').hidden=!plData.installAllowed;$('pl-install-off').hidden=!!plData.installAllowed;$('pl-count').textContent=plData.plugins.length?String(plData.plugins.length):'';
  $('pl-list').replaceChildren(...(plData.plugins.length?plData.plugins.map(plRow):[el('p',plT('none'),'muted')]));
  $('pl-trashed-h').hidden=!plData.trashed.length;
  $('pl-trashed').replaceChildren(...plData.trashed.map(plTrashedRow));}
async function loadPlugins(){try{plData=await api('/admin/api/plugins');plAg=await api('/admin/api/plugins/agents').catch(()=>null);plAgRender();plRender();}
  catch(err){if(err.message!=='session')toast(plT('loadFail',{err:err.message}));}}
async function plSwitch(p,on){
  // Switching on runs the plugin's code in this server: show what it asks for before it is on.
  if(on&&!await ask(plT('askEnableNoPw',{name:plName(p),perms:plPerms(p)})))return;
  try{await api('/admin/api/plugins/'+encodeURIComponent(p.id)+'/enabled',{method:'POST',body:{on,confirmKeys:on&&p.needsKeys}});toast(plT(on?'tOn':'tOff'));}
  catch(err){toast(err.message);}loadPlugins();}
async function plDelete(p,name){if(!await ask(plT('askDel',{name})))return;
  const dropData=await ask(plT('askDrop'));
  try{await api('/admin/api/plugins/'+encodeURIComponent(p.id)+'/trash',{method:'POST',body:{dropData}});toast(plT('tDel'));}
  catch(err){toast(err.message);}loadPlugins();}
async function plRestore(t){
  try{await api('/admin/api/plugins/restore',{method:'POST',body:{name:t.name}});toast(plT('tRestored'));}
  catch(err){toast(err.message);}loadPlugins();}
$('pl-install-btn').addEventListener('click',()=>$('pl-install-file').click());
$('pl-install-file').addEventListener('change',async()=>{
  const file=$('pl-install-file').files[0];$('pl-install-file').value='';if(!file)return;
  const state=$('pl-install-state');state.textContent=plT('checking');
  try{
    const r=await chunkedFetch('/admin/api/plugins/install',file,{headers:{'Content-Type':'application/zip',Accept:'application/json','Accept-Language':adminLang}});
    const d=await r.json().catch(()=>({}));
    if(r.status===401){location.reload();return;}
    if(!r.ok)throw new Error((d.error||('HTTP '+r.status))+(d.reason?' ('+plT('u.'+d.reason)+')':''));
    state.textContent='';
    const m=d.manifest;let overwrite=false;
    if(d.existing){if(!await ask(plT('overwriteAsk',{id:m.id,old:d.existing.version,new:m.version,sha:d.sha256}),{danger:true}))return;overwrite=true;}
    if(!await ask(plT('installAsk',{name:plName(m),id:m.id,version:m.version,perms:plPerms(m),sha:d.sha256})))return;
    await api('/admin/api/plugins/install/confirm',{method:'POST',body:{stagedId:d.stagedId,overwrite}});
    toast(plT('tInstalled'));
  }catch(err){toast(plT('tInstallFail',{why:err.message}));}
  state.textContent='';loadPlugins();});
$('pl-rescan').addEventListener('click',async()=>{try{plData=await api('/admin/api/plugins/rescan',{method:'POST',body:{}});plRender();toast(plT('tScan'));}catch(err){toast(err.message);}});
`;
