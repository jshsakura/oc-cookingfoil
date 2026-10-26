/** Shared patch/save editor. Callers own the list refresh callback. */
export const CONTENT_EDITOR_SCRIPT = /* js */ `
// One dialog edits a patch or a save: its text, its game, or deletes it.
// A homebrew app's patch (x.homebrew) gets its text only; onDone reloads the tab that opened it.
let ctItem=null,ctKind='',ctAfter=null;
function ctOpen(kind,x,onDone){ctKind=kind;ctItem=x;ctAfter=onDone||null;const hb=Boolean(x.homebrew);
  const tid=hb?'switch/'+x.homebrew+'/':kind==='patch'?x.title_id:x.titleId;
  $('ct-title').textContent=topFill(kind==='patch'?'ct.patchTitle':'ct.saveTitle',{name:x.name});
  $('ct-where').textContent=(x.game?x.game+' · ':'')+topFill('ct.where',{tid,files:x.files,size:mb(x.size)});
  for(const d of document.querySelectorAll('#ct-form [data-for]'))d.hidden=d.dataset.for!==kind;
  for(const d of document.querySelectorAll('#ct-form [data-game]'))if(hb)d.hidden=true;else if(!d.dataset.for||d.dataset.for===kind)d.hidden=false;
  $('ct-name').value=x.name||'';$('ct-name-ko').value=x.ko?.name||'';$('ct-desc').value=x.description||'';$('ct-desc-ko').value=x.ko?.description||'';
  $('ct-version').value=x.version||'';$('ct-author').value=x.author||'';$('ct-game-version').value=x.gameVersion||'';$('ct-save-type').value=x.saveType||'';
  $('ct-source-name').value=x.source?.name||'';$('ct-source-url').value=x.source?.url||'';$('ct-move').value='';
  $('ct-p-game-version').value=x.game_version||'';
  if(kind==='patch'&&!hb)ctUpdates(x);
  $('ct-json').hidden=true;ctJson=null;if(kind==='patch')ctPatchJson(x);
  $('ct-edit').showModal();}
// A patch.json the folder holds now (kpatch writes one when it updates a patch) is offered, never taken in unasked.
let ctJson=null;
async function ctPatchJson(x){let d;
  try{d=await api('/admin/api/patches/'+encodeURIComponent(x.id)+'/patch-json');}catch{return;}
  if(ctItem!==x||!d.found)return;
  if(d.error){$('ct-json-msg').textContent=d.error;$('ct-json-go').hidden=true;$('ct-json').hidden=false;return;}
  if(!d.differs)return;
  ctJson=d.info;$('ct-json-go').hidden=false;
  $('ct-json-msg').textContent=topText('ct.jsonDiff')+(Boolean(d.info.required)!==Boolean(x.required)?topText('ct.jsonRequired'):'');
  $('ct-json').hidden=false;}
$('ct-json-go').addEventListener('click',()=>{const j=ctJson;if(!j)return;
  const put=(id,v)=>{if(v!==undefined&&v!==null)$(id).value=v;};
  put('ct-name',j.name);put('ct-name-ko',j.ko?.name);put('ct-desc',j.description);put('ct-desc-ko',j.ko?.description);
  put('ct-version',j.version);put('ct-author',j.author);put('ct-p-game-version',j.game_version);
  $('ct-json').hidden=true;toast(topText('ct.jsonFilled'));});
// The updates titledb lists for the game and the ones in the library; the patch's own stays selectable.
let ctChoices=[];
async function ctUpdates(x){const s=$('ct-update');const keep=(list)=>{
  const opts=[el('option',topText('ct.noUpdate'))];opts[0].value='';
  const has=new Set(list.map((u)=>u.version));
  const all=x.update_version&&!has.has(x.update_version)?[{version:x.update_version,date:null,display:x.game_version||null,in_library:Boolean(x.update_in_library)},...list]:list;
  for(const u of all){const o=el('option',['v'+u.version,u.display,u.date,u.in_library?topText('ct.inLibrary'):''].filter(Boolean).join(' · '));o.value=String(u.version);opts.push(o);}
  s.replaceChildren(...opts);s.value=x.update_version?String(x.update_version):'';};
  keep([]);ctChoices=[];
  try{const r=await api('/admin/api/patches/updates?titleId='+encodeURIComponent(x.title_id));if(ctItem!==x)return;ctChoices=r.updates||[];keep(ctChoices);}
  catch(err){toast(err.message);}}
$('ct-update').addEventListener('change',()=>{const u=ctChoices.find((c)=>String(c.version)===$('ct-update').value);
  if(u&&u.display&&!$('ct-p-game-version').value)$('ct-p-game-version').value=u.display;});
const ctDone=(msg)=>{$('ct-edit').close();toast(msg);if(ctAfter)ctAfter();};
$('ct-close').addEventListener('click',()=>$('ct-edit').close());
$('ct-form').addEventListener('submit',async(e)=>{e.preventDefault();
  const body={id:ctItem.id,name:$('ct-name').value,nameKo:$('ct-name-ko').value,description:$('ct-desc').value,descriptionKo:$('ct-desc-ko').value,
    version:$('ct-version').value,author:$('ct-author').value,gameVersion:$(ctKind==='patch'?'ct-p-game-version':'ct-game-version').value,saveType:$('ct-save-type').value,
    ...(ctKind==='patch'&&!ctItem.homebrew?{updateVersion:$('ct-update').value}:{}),
    sourceName:$('ct-source-name').value,sourceUrl:$('ct-source-url').value};
  try{await api('/admin/api/content/'+ctKind+'/meta',{method:'POST',body});ctDone(topText('pp.saved'));}catch(err){toast(err.message);}});
gamePicker($('ct-move'),{fill:true,pick:()=>$('ct-move-go').focus()});
$('ct-move-go').addEventListener('click',async()=>{const m=$('ct-move').value.match(/[0-9A-Fa-f]{16}/);
  if(!m){toast(topText('ct.pickGame'));return;}const to=m[0].toUpperCase();
  if(!await ask(topFill('ct.moveAsk',{name:ctItem.name,to})+(ctKind==='patch'?topText('ct.movePatchSuffix'):'')))return;
  try{await api('/admin/api/content/'+ctKind+'/move',{method:'POST',body:{id:ctItem.id,titleId:to}});ctDone(topText('ct.moved'));}catch(err){toast(err.message);}});
$('ct-remove').addEventListener('click',async()=>{if(!await ask(topFill('t.askMove',{name:ctItem.name})))return;
  try{await api('/admin/api/content/'+ctKind+'/remove',{method:'POST',body:{id:ctItem.id}});ctDone(topText('t.movedToast'));}catch(err){toast(err.message);}});
`;
