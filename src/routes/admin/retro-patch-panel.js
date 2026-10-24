/**
 * The retro tab's patch block: the games patched on the server with what went on them, a search
 * for any other game, and per game an upload button for a patch file and, when an original is
 * backed up, a button that puts it back. Talks to /admin/api/retro-patch (retro-patch-api.js).
 */
import { top, topPh } from "./top-i18n.js";

export const RETRO_PATCH_HTML = `
  <div class="hd"><h2 class="first">${top("rpt.tab")}</h2></div>
  <p class="muted">${top("rpt.lead")}</p>
  <div class="row"><input type="search" id="rpt-q" ${topPh("rpt.search")} data-top-label="rpt.search" autocomplete="off"><button type="button" id="rpt-find">${top("rpt.find")}</button></div>
  <input type="file" id="rpt-file" accept=".ips,.bps,.ups,.xdelta,.vcdiff,.delta,.ppf" hidden>
  <h3>${top("rpt.patchedH")}</h3>
  <div class="scroll" id="rpt-patched" data-skel></div>
  <div id="rpt-found-box" hidden><h3>${top("rpt.foundH")}</h3><div class="scroll" id="rpt-found"></div></div>`;

export const RETRO_PATCH_SCRIPT = /* js */ `
let rptTarget=null;
function rptFile(g){const c=td();c.append(g.name);c.append(el('div',g.file,'muted'));return c;}
function rptState(g){if(g.patch)return pill(topText('rpt.patched'),'on');if(g.missing)return pill(topText('rpt.missing'),'warn');
  return pill(topText(g.unpatchable?'rpt.no.'+g.unpatchable:'rpt.original'),'');}
function rptPatches(g){const c=td();for(const p of g.patch?.patches??[])c.append(el('div',p.name+' · '+p.format.toUpperCase()+' · '+topText(p.verified?'rpt.verified':'rpt.unverified')+' · '+fmt(p.at),p.verified?'':'muted'));return c;}
function rptRow(g){const tr=el('tr');const acts=el('div',null,'row-actions');
  if(!g.unpatchable&&!g.missing)acts.append(btn(topText('rpt.apply'),()=>{rptTarget=g;$('rpt-file').click();}));
  if(g.patch)acts.append(btn(topText('rpt.restore'),()=>rptRestore(g),'danger'));
  tr.append(rptFile(g),td(g.systemName),raCell(rptState(g)),rptPatches(g),raCell(acts));return tr;}
const rptCols=()=>[topText('rpt.colFile'),topText('rpt.colSystem'),topText('rpt.colState'),topText('rpt.colPatches'),''];
async function loadRetroPatch(){const q=$('rpt-q').value.trim();let d;
  try{d=await api('/admin/api/retro-patch?q='+encodeURIComponent(q));}catch(err){toast(err.message);return;}
  table('rpt-patched',rptCols(),d.patched.map(rptRow),topText('rpt.noPatched'),{tall:true});
  $('rpt-found-box').hidden=!q;
  if(q)table('rpt-found',rptCols(),d.games.map(rptRow),topText('rpt.noFound'),{tall:true});}
async function rptApply(g,file){toast(topFill('rpt.applying',{file:g.file}));
  const fd=new FormData();fd.append('file',file,file.name);
  try{const r=await fetch('/admin/api/retro-patch/'+encodeURIComponent(g.id)+'/apply',{method:'POST',headers:{Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'},body:fd});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){toast(d.error||('HTTP '+r.status));return;}
    const last=d.game?.patch?.patches?.at(-1);toast(topText(last&&!last.verified?'rpt.appliedUnverified':'rpt.applied'));loadRetroPatch();
  }catch(err){toast(err.message);}}
async function rptRestore(g){if(!await ask(topFill('rpt.askRestore',{file:g.file})))return;
  try{await api('/admin/api/retro-patch/'+encodeURIComponent(g.id)+'/restore',{method:'POST',body:{}});toast(topText('rpt.restored'));loadRetroPatch();}catch(err){toast(err.message);}}
$('rpt-file').addEventListener('change',(e)=>{const f=e.target.files[0];e.target.value='';const g=rptTarget;rptTarget=null;if(f&&g)rptApply(g,f);});
$('rpt-find').addEventListener('click',loadRetroPatch);
$('rpt-q').addEventListener('keydown',(e)=>{if(e.key==='Enter')loadRetroPatch();});
`;
