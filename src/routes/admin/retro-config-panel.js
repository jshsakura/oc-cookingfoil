/**
 * The retro tab's RetroArch settings block, laid out the way RetroArch reads its files: recommended lines a
 * core's override lacks, then a tab per layer (global retroarch.cfg, a core's override and options, one game's
 * files) whose settings sit under RetroArch's own menu groups with the console menu path of each, and the
 * history with a way back for each change. Talks to
 * /admin/api/retro-config (retro-config-api.js). Also the core advice beside each console's core picker
 * (rcAdvice, called from retro-art-panel.js rcSystems).
 */
import { top } from "./top-i18n.js";

export const RETRO_CONFIG_CSS = `
.rcf-sec{margin:0 0 20px}
.rcf-layer{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px;font-size:var(--fs-sm)}
.rcf-layer .muted{flex-basis:100%;font-size:var(--fs-xs)}
.rcf-scopes{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.rcf-scopes button[aria-selected="true"]{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.rcf-fold{margin:0 0 8px;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.rcf-fold>summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;cursor:pointer;background:var(--sunk)}
.rcf-fold>summary .muted{font-size:var(--fs-xs)}
.rcf-fold>.rcf-rows{border:0;border-top:1px solid var(--line);border-radius:0}
.rcf-rows{display:grid;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.rcf-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,260px) auto;gap:10px;align-items:center;padding:9px 12px}
.rcf-row+.rcf-row{border-top:1px solid var(--line)}
.rcf-row .rcf-k{display:grid;gap:2px;min-width:0;overflow-wrap:anywhere}
.rcf-row .rcf-k code,.rcf-row .rcf-k .muted{font-size:var(--fs-xs)}
.rcf-row .rcf-k code{color:var(--faint)}
.rcf-row select,.rcf-row input{width:100%}
.rcf-row[data-set] .rcf-k b::after{content:" •";color:var(--accent)}
.rcf-add{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;margin:8px 0 16px}
.rcf-pick{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 12px}
.rcf-hist{list-style:none;margin:0;padding:0}
.rcf-hist li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:8px 0}
.rcf-hist li+li{border-top:1px solid var(--line)}
.rcf-hist .muted{font-size:var(--fs-xs)}
.rc-adv{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.rc-adv-why{font-size:var(--fs-xs);margin-top:2px}
.rc-alt{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:4px 0;font-size:var(--fs-sm)}
@media (max-width:640px){.rcf-row{grid-template-columns:minmax(0,1fr) auto}.rcf-row>select,.rcf-row>input{grid-column:1/-1;grid-row:2}}
`;

export const RETRO_CONFIG_HTML = `
  <div class="hd"><h2 class="first">${top("rcf.tab")}</h2></div>
  <p class="muted">${top("rcf.lead")}</p>
  <div class="rcf-sec"><h3>${top("rcf.adviceH")}</h3><div id="rcf-advice"></div></div>
  <p class="rcf-layer"><span class="pill">${top("rcf.scope.global")}</span>→<span class="pill">${top("rcf.scope.core")}</span>→<span class="pill">${top("rcf.scope.game")}</span><span class="muted">${top("rcf.layer")}</span></p>
  <div class="rcf-scopes" role="tablist">
    <button type="button" role="tab" data-rcf="global">${top("rcf.scope.global")}</button>
    <button type="button" role="tab" data-rcf="core">${top("rcf.scope.core")}</button>
    <button type="button" role="tab" data-rcf="game">${top("rcf.scope.game")}</button>
    <button type="button" role="tab" data-rcf="history">${top("rcf.scope.history")}</button>
  </div>
  <div id="rcf-body" data-skel></div>`;

export const RETRO_CONFIG_SCRIPT = /* js */ `
const rcf={view:null,hist:[],scope:'global',core:null,game:null};
const RCF_UNDO_MS=7000;
const RCF_CAT={system:'system',video:'video',screen:'video',gliden64:'video',gpu_neon:'video',audio:'audio',channel_volume:'audio',input:'input',controls:'input',light_gun:'input',lightgun:'input',cursor:'input',hacks:'hacks',speed_hack:'hacks',compat_hack:'hacks',performance:'hacks',timing:'hacks',advanced:'advanced',advanced_av:'advanced',cd:'advanced'};
const RCF_CAT_ORDER=['general','system','video','audio','input','hacks','advanced'];
async function loadRetroConfig(){let d,h;
  try{[d,h]=await Promise.all([api('/admin/api/retro-config'),api('/admin/api/retro-config/history')]);}catch(err){toast(err.message);return;}
  rcf.view=d;rcf.hist=h;rcfAdvice();rcfScope(rcf.scope);}
function rcfScope(scope){rcf.scope=scope;
  for(const b of document.querySelectorAll('.rcf-scopes [data-rcf]'))b.setAttribute('aria-selected',String(b.dataset.rcf===scope));
  if(!rcf.view)return;const body=$('rcf-body');delete body.dataset.skel;
  body.replaceChildren(...(scope==='core'?rcfCoreScope():scope==='game'?rcfGameScope():scope==='history'?[rcfHistory()]:rcfGlobalScope()));}
for(const b of document.querySelectorAll('.rcf-scopes [data-rcf]'))b.addEventListener('click',()=>rcfScope(b.dataset.rcf));
function rcfUndoToast(msg,id){toast(msg);if(!id)return;const t=$('toast');const b=el('button',topText('rcf.undo'),'toast-act');b.type='button';
  b.addEventListener('click',async()=>{t.classList.remove('show');
    try{await api('/admin/api/retro-config/restore',{method:'POST',body:{id}});toast(topText('rcf.undone'));}catch(err){toast(err.message);}loadRetroConfig();});
  t.append(b);clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),RCF_UNDO_MS);}
async function rcfSave(rel,changes){
  try{const out=await api('/admin/api/retro-config/file',{method:'POST',body:{rel,changes}});rcfUndoToast(topText('rcf.saved'),out.change&&out.change.id);}
  catch(err){toast(err.message);}loadRetroConfig();}
const rcfChoices=(s)=>s.type==='bool'?[{value:'true',label:topText('rcf.on')},{value:'false',label:topText('rcf.off')}]:(s.values||[]);
const rcfLabelOf=(s,v)=>(rcfChoices(s).find((c)=>c.value===v)||{label:v}).label;
const rcfFile=(rel)=>rel==='retroarch.cfg'?rcf.view.files.global:(rcf.view.files.cores.flatMap((c)=>c.files).find((f)=>f.rel===rel)||{rel,values:{}});
// A select (bool, enum) or number box whose empty choice leaves the line out: the default, or what the layer under it says.
function rcfControl(s,now,blankText,onPick){
  if(s.type==='int'){const inp=el('input');inp.type='number';inp.min=String(s.min);inp.max=String(s.max);inp.value=now??'';inp.placeholder=blankText;
    inp.setAttribute('aria-label',s.label);inp.addEventListener('change',()=>onPick(inp.value===''?null:String(inp.value)));return inp;}
  const sel=el('select');sel.setAttribute('aria-label',s.label||s.key);const blank=el('option',blankText);blank.value='';sel.append(blank);
  const vals=rcfChoices(s);for(const c of vals){const o=el('option',c.label);o.value=c.value;sel.append(o);}
  if(now!=null&&!vals.some((c)=>c.value===now)){const o=el('option',now);o.value=now;sel.append(o);}
  sel.value=now??'';sel.addEventListener('change',()=>onPick(sel.value===''?null:sel.value));return sel;}
function rcfRow(label,key,notes,control,extra){const row=el('div',null,'rcf-row');const k=el('div',null,'rcf-k');
  k.append(el('b',label),el('code',key));for(const n of notes)if(n)k.append(el('span',n,'muted'));row.append(k,control,extra||el('span'));return row;}
function rcfFold(title,sub,count,rows){const d=el('details',null,'rcf-fold');if(count)d.open=true;const sum=el('summary');sum.append(el('b',title));
  if(sub)sum.append(el('span',sub,'muted'));if(count)sum.append(pill(topFill('rcf.changedN',{n:count}),'on'));const box=el('div',null,'rcf-rows');box.append(...rows);d.append(sum,box);return d;}
const rcfDefText=(s)=>s.def!=null?topFill('rcf.defaultIs',{value:rcfLabelOf(s,s.def)}):topText('rcf.default');
// The named settings group by group, as RetroArch's Settings menu has them. Under a core or a game, an empty
// choice follows the global value, which is named.
function rcfSettings(rel,{under=null,spread=false}={}){const values=rcfFile(rel).values;
  return rcf.view.settings.groups.map((g)=>{let set=0;const rows=g.settings.map((s)=>{const now=values[s.key];if(now!=null)set++;
    const blank=under?(under[s.key]!=null?topFill('rcf.inheritIs',{value:rcfLabelOf(s,under[s.key])}):topFill('rcf.inheritIs',{value:rcfDefText(s)})):rcfDefText(s);
    const row=rcfRow(s.label,s.key,[s.path&&topFill('rcf.menuPath',{path:s.path}),s.help],rcfControl(s,now,blank,(v)=>rcfSave(rel,{[s.key]:v})),spread?btn(topText('rcf.spread'),()=>rcfSpread(s,values[s.key]??null)):null);
    if(now!=null)row.dataset.set='';return row;});
    return rcfFold(g.label,g.path,set,rows);});}
// A core's options under the core's own categories.
function rcfOptions(rel,options){const values=rcfFile(rel).values;const cats=new Map();
  for(const o of options){const c=RCF_CAT[o.category]||'general';if(!cats.has(c))cats.set(c,[]);cats.get(c).push(o);}
  return RCF_CAT_ORDER.filter((c)=>cats.has(c)).map((c)=>{let set=0;const rows=cats.get(c).map((o)=>{const s={key:o.key,label:o.label,type:'enum',values:o.values};if(values[o.key]!=null)set++;
    const row=rcfRow(o.label,o.key,[o.info],rcfControl(s,values[o.key],topFill('rcf.optionDefault',{value:rcfLabelOf(s,o.default)}),(v)=>rcfSave(rel,{[o.key]:v})));
    if(values[o.key]!=null)row.dataset.set='';return row;});
    return rcfFold(topText('rcf.cat.'+c),null,set,rows);});}
// Lines of the file no list above names, each editable and removable, and a row to add any line by name.
function rcfExtra(rel,known){const values=rcfFile(rel).values;const wrap=el('div');const rest=Object.keys(values).filter((k)=>!known.has(k)).sort();
  if(rest.length){const rows=el('div',null,'rcf-rows');for(const k of rest){const inp=el('input');inp.value=values[k];inp.setAttribute('aria-label',k);
    inp.addEventListener('change',()=>rcfSave(rel,{[k]:inp.value}));const row=rcfRow(k,k,[],inp,tbtn('delete','rcf.remove',()=>rcfSave(rel,{[k]:null})));row.dataset.set='';rows.append(row);}
    wrap.append(el('h4',topText('rcf.lines')),rows);}
  const add=el('div',null,'rcf-add');const key=el('input');key.placeholder=topText('rcf.addKey');key.setAttribute('aria-label',topText('rcf.addKey'));key.spellcheck=false;
  const val=el('input');val.placeholder=topText('rcf.addValue');val.setAttribute('aria-label',topText('rcf.addValue'));val.spellcheck=false;
  add.append(key,val,btn(topText('rcf.add'),()=>{const k=key.value.trim();if(k)rcfSave(rel,{[k]:val.value.trim()});}));wrap.append(add);return wrap;}
const rcfNamedKeys=()=>new Set(rcf.view.settings.groups.flatMap((g)=>g.settings.map((s)=>s.key)));
function rcfGlobalScope(){return [el('p',topText('rcf.globalLead'),'muted'),...rcfSettings('retroarch.cfg',{spread:true}),rcfExtra('retroarch.cfg',rcfNamedKeys())];}
async function rcfSpread(s,value){const n=rcf.view.cores.length;
  const q=value==null?topFill('rcf.spreadClearQ',{n,key:s.key}):topFill('rcf.spreadQ',{n,key:s.key,value:rcfLabelOf(s,value)});
  if(!await ask(q))return;
  try{const out=await api('/admin/api/retro-config/spread',{method:'POST',body:{changes:{[s.key]:value}}});
    if(out.files.length)rcfUndoToast(topFill('rcf.spreadDone',{n:out.files.length}),out.batch);else toast(topText('rcf.spreadNone'));}
  catch(err){toast(err.message);}loadRetroConfig();}
function rcfCorePicker(){const wrap=el('div',null,'rcf-pick');const sel=el('select');sel.id='rcf-core';sel.setAttribute('aria-label',topText('rcf.corePick'));
  const cores=rcf.view.cores;if(!cores.some((c)=>c.dir===rcf.core))rcf.core=(cores.find((c)=>rcf.view.files.cores.some((f)=>f.core===c.dir))||cores[0]||{}).dir||null;
  for(const c of cores){const n=(rcf.view.files.cores.find((f)=>f.core===c.dir)||{files:[]}).files.length;const o=el('option',c.name+(n?' ('+n+')':''));o.value=c.dir;sel.append(o);}
  if(rcf.core)sel.value=rcf.core;sel.addEventListener('change',()=>{rcf.core=sel.value;rcf.game=null;rcfScope(rcf.scope);});
  wrap.append(el('label',topText('rcf.corePick')),sel);return wrap;}
function rcfCoreScope(){const out=[el('p',topText('rcf.coreLead'),'muted'),rcfCorePicker()];const dir=rcf.core;if(!dir)return out;
  const cfg='config/'+dir+'/'+dir+'.cfg',opt='config/'+dir+'/'+dir+'.opt';const opts=rcf.view.options[dir]||[];
  out.push(el('h4',topText('rcf.overrideH')),...rcfSettings(cfg,{under:rcf.view.files.global.values}),rcfExtra(cfg,rcfNamedKeys()));
  out.push(el('h4',topText('rcf.optionsH')),el('p',topText('rcf.optionsPath'),'muted'));
  if(!opts.length)out.push(el('p',topText('rcf.optionsNone'),'muted'));
  out.push(...rcfOptions(opt,opts),rcfExtra(opt,new Set(opts.map((o)=>o.key))));return out;}
function rcfGameScope(){const out=[el('p',topText('rcf.gameLead'),'muted'),rcfCorePicker()];const dir=rcf.core;if(!dir)return out;
  const games=(rcf.view.files.cores.find((c)=>c.core===dir)||{files:[]}).files.filter((f)=>f.game!==null);
  if(rcf.game){const rel=rcf.game;const opts=rcf.view.options[dir]||[];const cfg='config/'+dir+'/'+dir+'.cfg';
    out.push(el('h4',topText('rcf.editing')+': '+rel.split('/').pop()));
    if(rel.endsWith('.opt'))out.push(...rcfOptions(rel,opts),rcfExtra(rel,new Set(opts.map((o)=>o.key))));
    else{const under={...rcf.view.files.global.values,...rcfFile(cfg).values};out.push(...rcfSettings(rel,{under}),rcfExtra(rel,rcfNamedKeys()));}
    out.push(btn(topText('acc.close'),()=>{rcf.game=null;rcfScope('game');}));return out;}
  const rows=games.map((f)=>rcfRow(f.game,f.rel.split('/').pop(),[],el('span',topText('rcf.kind.'+f.kind),'muted'),btn(topText('rcf.gameOpen'),()=>{rcf.game=f.rel;rcfScope('game');})));
  if(rows.length){const box=el('div',null,'rcf-rows');box.append(...rows);out.push(box);}else out.push(el('p',topText('rcf.gamesNone'),'muted'));
  out.push(btn(topText('rcf.gameNew'),async()=>{const name=await askText(topText('rcf.gameNewQ'),'');if(name==null||!name.trim())return;
    const kind=await askPick(topText('rcf.gameKindQ'),[{value:'opt',label:topText('rcf.kind.opt')},{value:'cfg',label:topText('rcf.kind.cfg')}]);if(!kind)return;
    rcf.game='config/'+dir+'/'+name.trim()+'.'+kind;rcfScope('game');}));
  return out;}
function rcfAdvice(){const box=$('rcf-advice');const have=new Set(rcf.view.cores.map((c)=>c.dir));
  const open=rcf.view.settings.advice.filter((a)=>have.has(a.core)&&rcfFile(a.rel).values[a.key]!==a.value);
  if(!open.length){box.replaceChildren(el('p',topText('rcf.adviceNone'),'muted'));return;}
  box.replaceChildren(...open.map((a)=>{const p=el('p',null,'warn-line');p.append(el('b',topFill('rcf.adviceLine',{core:a.core,key:a.key,value:a.value})),el('br'),a.why+' ');
    p.append(btn(topText('rcf.adviceApply'),()=>rcfSave(a.rel,{[a.key]:a.value}),'primary'));return p;}));}
const rcfFileName=(rel)=>rel==='retroarch.cfg'?topText('rcf.global')+' (retroarch.cfg)':rel.slice('config/'.length);
const rcfChangeText=(c)=>c.key+': '+(c.from??topText('rcf.default'))+' → '+(c.to??topText('rcf.removed'));
function rcfHistory(){if(!rcf.hist.length)return el('p',topText('rcf.historyNone'),'muted');
  const seen=new Set();const ul=el('ul',null,'rcf-hist');
  for(const e of rcf.hist){if(e.batch&&seen.has(e.batch))continue;if(e.batch)seen.add(e.batch);
    const group=e.batch?rcf.hist.filter((x)=>x.batch===e.batch):[e];const li=el('li');const left=el('div');const name=group.length>1?topFill('rcf.historyBatch',{n:group.length}):rcfFileName(e.rel);
    left.append(el('div',name),el('div',[...new Set(group.flatMap((x)=>x.changes.map(rcfChangeText)))].join(' · ')||'—','muted'));
    left.append(el('div',fmt(e.at)+(e.by?' · '+(e.by.name??e.by):'')+(e.restoreOf?' · '+topText('rcf.historyRestoreOf'):''),'muted'));
    const id=group.length>1?e.batch:e.id;
    li.append(left,btn(topText('rcf.historyRestore'),async()=>{if(!await ask(topFill('rcf.historyRestoreQ',{file:name})))return;
      try{await api('/admin/api/retro-config/restore',{method:'POST',body:{id}});toast(topText('rcf.undone'));}catch(err){toast(err.message);}loadRetroConfig();}));
    ul.append(li);}
  return ul;}
// Beside each console's core picker: the core we recommend and why, and the others worth a look.
function rcAdvice(s){const a=s.advice;const c=td();if(!a)return c;const head=el('div',null,'rc-adv');
  if(s.core===a.pick)head.append(pill(topText('rc.adv.using'),'on'));
  else head.append(pill(topFill('rc.adv.pick',{core:a.pick}),'warn'),rcUse(s,a.pick));
  c.append(head,el('div',a.why,'muted rc-adv-why'));
  if(a.separate&&!rcHas(s,a.pick))c.append(el('div',topText('rc.adv.separate'),'muted rc-adv-why'));
  if(a.alts.length){const d=el('details');d.append(el('summary',topFill('rc.adv.alts',{n:a.alts.length})));
    for(const x of a.alts){const row=el('div',null,'rc-alt');row.append(el('b',x.core),el('span',x.why,'muted'));if(s.core!==x.core)row.append(rcUse(s,x.core));d.append(row);}
    c.append(d);}
  return c;}
const rcHas=(s,core)=>s.fits.includes(core)||s.others.includes(core);
function rcUse(s,core){return btn(topText('rc.adv.use'),async()=>{
  if(rcHas(s,core))return rcSetSystem(s,core);
  if(!await ask(topFill('rc.adv.fetchQ',{core,name:s.name})))return;
  try{await api('/admin/api/retro-cores/install',{method:'POST',body:{core,system:s.id}});toast(topFill('rc.adv.fetching',{core,name:s.name}));loadRetroCores();}
  catch(err){toast(err.message);}});}
`;
