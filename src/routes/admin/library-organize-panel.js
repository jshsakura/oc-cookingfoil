/**
 * The library tab's drop box area: what the drop box (helpers/storage-layout.js) sorted
 * lately and what it keeps with why. Talks to /admin/api/library/organize. Its words are
 * the lo.* keys of top-i18n.js and the hold reasons of meta/library-organize.js, in the
 * page's language.
 */
import { top } from "./top-i18n.js";
import { REASON_TEXT } from "../../meta/library-organize.js";

export const ORGANIZE_HTML = `  <div class="hd"><h2 class="first">${top("lo.title")}</h2><div class="actions"><button type="button" class="primary" id="lo-sweep">${top("lo.sweep")}</button></div></div>
  <p class="muted">${top("lo.lead")}</p>
  <p class="muted">${top("lo.where")} <code id="lo-path"></code></p>
  <ul class="muted lo-rules">
    <li><b>${top("lo.gameH")}</b>: ${top("lo.game")}</li>
    <li><b>${top("lo.retroH")}</b>: ${top("lo.retro")}</li>
    <li><b>${top("lo.nroH")}</b>: ${top("lo.nro")}</li>
  </ul>
  <details class="lo-systems"><summary>${top("lo.systems")}</summary><p class="muted">${top("lo.systemsHelp")}</p><div id="lo-systems"></div></details>
  <p class="muted" id="lo-state"></p>
  <h3>${top("lo.held")}</h3><div id="lo-held"></div>
  <h3>${top("lo.recent")}</h3><div id="lo-recent"></div>`;

export const ORGANIZE_CSS = `.lo-rules{margin:4px 0 12px;padding-left:20px;line-height:1.6}.lo-rules li{margin:2px 0}
.lo-systems{margin:0 0 12px}.lo-systems summary{cursor:pointer;font-weight:600}
#lo-systems{display:flex;flex-wrap:wrap;gap:6px}#lo-systems code{font-size:12.5px}`;

export const ORGANIZE_SCRIPT = /* js */ `
const loReasons=${JSON.stringify(REASON_TEXT)};
const loT=(k,v)=>{let s=topText('lo.'+k);if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
const LO_KIND={base:'kBase',update:'kUpdate',dlc:'kDlc',delta:'kDelta'};
const LO_ROOT={games:'inGames',retro:'inRetro',homebrew:'inHomebrew'};
// A hold reason in the page's language when the server gave its code; detail is what the code leaves open.
// vars fill its {placeholders}; a value given per language ({ ko, en, ... }) is read in the page's.
const loVar=(v)=>v&&typeof v==='object'?(v[adminLang]??v.en??''):String(v??'');
const loReason=(code,detail,text,vars)=>{let t=code&&(loReasons[adminLang]?.[code]??loReasons.ko[code]);
  if(t&&vars)t=t.replace(/\\{(\\w+)\\}/g,(m,k)=>k in vars?loVar(vars[k]):m);
  return t?t+(detail?': '+detail:''):text||'';};
let loLast=null;
function loCell(main,sub){const c=td();c.append(el('b',main));if(sub)c.append(el('div',sub,'muted'));return c;}
function loKind(m){return LO_KIND[m.kind]?loT(LO_KIND[m.kind]):m.root==='retro'?loT('kRetro'):m.root==='homebrew'?loT('kHomebrew'):'-';}
function loRender(d){loLast=d;
  $('lo-sweep').disabled=d.running;
  $('lo-path').textContent=d.incoming||'';
  $('lo-systems').replaceChildren(...(d.systems||[]).map((s)=>{const p=pill('');p.replaceChildren(el('code',s.folder),document.createTextNode(' '+s.name));return p;}));
  $('lo-state').textContent=d.error?loReason(d.errorCode,d.errorDetail,d.error):(d.sweptAt?loT('checked',{at:new Date(d.sweptAt).toLocaleString()})+(d.waiting?' '+loT('waiting',{n:num(d.waiting)}):''):loT('notYet'));
  table('lo-held',[loT('colFile'),loT('colReason'),loT('colKind')],(d.held||[]).map((h)=>{const tr=el('tr');tr.append(loCell(h.rel.split('/').pop(),'incoming/'+h.rel),td(loReason(h.code,h.detail,h.reason,h.vars)),td(LO_KIND[h.kind]?loT(LO_KIND[h.kind]):'-'));return tr;}),loT('empty'),{tall:true});
  table('lo-recent',[loT('colFile'),loT('colTo'),loT('colKind'),loT('colAt')],(d.recent||[]).map((m)=>{const tr=el('tr');tr.append(loCell(m.to.split('/').pop(),'incoming/'+m.from),loCell(m.to,[LO_ROOT[m.root]&&loT(LO_ROOT[m.root]),m.folderIsNew&&loT('newFolder')].filter(Boolean).join(' · ')),td(loKind(m)),td(new Date(m.at).toLocaleString()));return tr;}),loT('noRecent'));
}
// The language menu calls this so the tables follow the new language.
function loRelabel(){if(loLast)loRender(loLast);}
async function loLoad(){try{loRender(await api('/admin/api/library/organize'));}catch(err){toast(err.message);}}
admInterval(async()=>{if((loLast?.running||loLast?.waiting)&&$('lo-held').offsetParent!==null)await loLoad();},5000);
$('lo-sweep').addEventListener('click',async()=>{$('lo-sweep').disabled=true;
  try{const d=await api('/admin/api/library/organize/sweep',{method:'POST',body:{}});toast(d.moved?loT('moved',{n:num(d.moved)}):loT('nothing'));loRender(d);}
  catch(err){toast(err.message);loLoad();}});
`;
