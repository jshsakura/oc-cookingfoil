/**
 * The retro tab's versions block: files that are one game (a patch beside an
 * official release, an arcade parent and its clones), the file each group
 * shows, arcade sets that can't run, and the trash. Talks to
 * /admin/api/retro-variants.
 */

import { top, topLabel, topPh } from "./top-i18n.js";

export const RETRO_VARIANTS_HTML = `
  <div class="hd"><h2 class="first" id="rv-title">${top("rv.title")}</h2></div>
  <p class="muted" id="rv-help"></p>
  <div class="row-actions" id="rv-tools"><input id="rv-filter" ${topPh("pg.search")} ${topLabel("pg.search")}><label id="rv-broken-wrap" hidden><input type="checkbox" id="rv-broken"> ${top("rv.brokenOnly")}</label></div>
  <p class="muted" id="rv-summary"></p>
  <div class="scroll" id="rv-list" data-skel></div>`;

export const RETRO_VARIANTS_CSS = `
#rv-list tr.rv-head td{background:var(--sunk);font-weight:700}
#rv-list tr.rv-head .muted{font-weight:500;margin-left:8px}
#rv-list .pill{margin:0 4px 2px 0}
#rv-list .pill.warn{background:rgba(217,164,0,.16);color:var(--text)}
#rv-filter{max-width:220px}
#rv-list .rv-nw{white-space:nowrap}
#rv-tools{display:flex;gap:12px;align-items:center;margin:6px 0}
`;

export const RETRO_VARIANTS_SCRIPT = /* js */ `
let rvView='dups',rvData={},rvSeq=0;
const rvT=(v)=>typeof v==='function'?v():v;
const RV_HELP={
  dups:()=>topText('rv.helpDups'),
  sets:()=>topText('rv.helpSets'),
  trash:()=>topText('rv.helpTrash')};
const RV_TAGS={bootleg:()=>topText('rv.tag.bootleg'),hack:()=>topText('rv.tag.hack'),prototype:()=>topText('rv.tag.prototype'),demo:()=>topText('rv.tag.demo'),decrypted:()=>topText('rv.tag.decrypted'),'cps-changer':()=>topText('rv.tag.cps'),'4p':()=>topText('rv.tag.p4'),'3p':()=>topText('rv.tag.p3'),resale:()=>topText('rv.tag.resale'),mvs:'MVS',aes:'AES'};
const RV_REGION={kr:()=>topText('rv.reg.kr'),world:()=>topText('rv.reg.world'),us:()=>topText('rv.reg.us'),eu:()=>topText('rv.reg.eu'),jp:()=>topText('rv.reg.jp'),asia:()=>topText('rv.reg.asia'),hisp:()=>topText('rv.reg.hisp'),br:()=>topText('rv.reg.br')};
const RV_HIDDEN={missing:()=>topText('rv.hid.missing'),bootleg:()=>topText('rv.tag.bootleg'),hack:()=>topText('rv.tag.hack'),prototype:()=>topText('rv.tag.prototype'),demo:()=>topText('rv.tag.demo')};
const rvMb=(n)=>n==null?'—':n<1048576?Math.max(1,Math.round(n/1024))+' KB':(n/1048576).toFixed(1)+' MB';
const rvDate=(s)=>s?new Date(s*1000).toLocaleDateString(typeof adminLang==='string'?adminLang:'ko'):'—';
function rvEdition(m){const e=m.edition;if(!e)return m.region?rvT(RV_REGION[m.region])||m.region:'—';
  return (e.source==='official'?topText('rv.officialKo'):topText('rpt.patched'))+(e.version?' '+e.version:'');}
function rvTags(m){const box=el('div');
  if(m.representative)box.append(pill(topText('rv.picked'),'on'));
  if(m.class){if(m.class.region)box.append(pill(rvT(RV_REGION[m.class.region])||m.class.region));
    if(m.class.date)box.append(pill(String(m.class.date).replace(/(\\d{4})(\\d{2})(\\d{2})/,'$1.$2.$3')));
    for(const t of [...m.class.flags,...m.class.hardware])box.append(pill(rvT(RV_TAGS[t])||t,['bootleg','hack','prototype','demo'].includes(t)?'warn':''));}
  if(m.hidden&&!m.representative)box.append(pill(topFill('rv.hiddenPill',{v:rvT(RV_HIDDEN[m.hidden])||m.hidden}),'off'));
  if(m.missing)box.append(pill(topFill('rv.missingPill',{v:m.missing.map((s)=>s+'.zip').join(', ')}),'off'));
  return box;}
function rvHead(text,sub,cols){const tr=el('tr','', 'rv-head');const c=el('td');c.colSpan=cols;c.append(text);if(sub)c.append(el('span',sub,'muted'));tr.append(c);return tr;}
function rvMemberRow(g,m,withSize){const tr=el('tr');
  const n=td();n.append(m.name);n.append(el('div',m.file,'muted'));
  const acts=el('div',null,'row-actions');
  const pick=btn(m.representative?topText('rv.isPick'):topText('rv.makePick'),()=>rvPick(g,m));pick.disabled=m.representative;pick.classList.toggle('picked',m.representative);
  const trash=tbtn('delete','pp.delete',()=>rvTrash(m),'danger');trash.setAttribute('aria-label',m.file+' '+topText('pp.delete'));
  acts.append(pick,trash);
  tr.append(n,td(m.variant||'—'),raCell(rvTags(m)),td(rvEdition(m)));
  if(withSize)tr.append(td(rvMb(m.size),'rv-nw'),td(rvDate(m.addedAt),'rv-nw'));
  tr.append(raCell(acts));return tr;}
function rvMatch(g,q){return !q||g.members.some((m)=>(m.name+' '+m.file).toLowerCase().includes(q));}
const RV_TITLE={dups:()=>topText('rv.title'),sets:()=>topText('rt.sets'),trash:()=>topText('s.trash')};
function rvShow(){
  $('rv-title').textContent=rvT(RV_TITLE[rvView]);
  $('rv-help').textContent=rvT(RV_HELP[rvView]);$('rv-broken-wrap').hidden=rvView!=='sets';
  const q=$('rv-filter').value.trim().toLowerCase();
  if(rvView==='trash'){
    const items=(rvData.trash?.items||[]).filter((i)=>!q||(i.name+' '+i.file).toLowerCase().includes(q));
    $('rv-summary').textContent=items.length?topFill('rv.trashN',{n:items.length}):'';
    table('rv-list',[topText('pp.name'),topText('rv.colSystem'),topText('rv.colSize'),topText('lo.colAt'),''],items.map((i)=>{const tr=el('tr');
      const n=td();n.append(i.name);n.append(el('div',topFill('rv.filesN',{n:i.files.length}),'muted'));
      tr.append(n,td(i.system==='core'?topText('rv.coreItem'):i.system),td(rvMb(i.size)),td(fmt(i.trashedAt)),raCell(tbtn('restore','rv.restoreBtn',()=>rvRestore(i))));return tr;}),topText('rv.trashEmpty'));
    return;}
  if(rvView==='sets'){
    const d=rvData.sets;if(!d){$('rv-list').replaceChildren();return;}
    const s=d.summary;const hid=Object.entries(s.hidden).map(([k,v])=>(rvT(RV_HIDDEN[k])||k)+' '+v).join(', ');
    $('rv-summary').textContent=topFill('rv.setsSummary',{g:s.groups,s:s.sets,l:s.listed,b:s.broken})+(hid?topFill('rv.setsHidden',{list:hid}):'');
    const only=$('rv-broken').checked;
    const groups=d.groups.filter((g)=>rvMatch(g,q)&&(!only||g.members.some((m)=>m.missing)));
    const rows=groups.flatMap((g)=>[rvHead(g.members[0].name,(g.listed?'':topText('rv.notListed'))+g.reason,5),...g.members.map((m)=>rvMemberRow(g,m,false))]);
    table('rv-list',[topText('rv.colName'),topText('rv.colVer'),topText('rv.colTags'),topText('rv.colRegion'),''],rows,only?topText('rv.noBroken'):topText('rv.noSets'));
    return;}
  const d=rvData.dups;if(!d){$('rv-list').replaceChildren();return;}
  const groups=d.groups.filter((g)=>rvMatch(g,q));
  $('rv-summary').textContent=topFill('rv.dupsSummary',{g:d.groups.length,n:d.groups.reduce((n,g)=>n+g.members.length,0)});
  const rows=groups.flatMap((g)=>[rvHead(g.systemName,g.reason,7),...g.members.map((m)=>rvMemberRow(g,m,true))]);
  table('rv-list',[topText('rv.colName'),topText('rv.colVerInfo'),topText('rv.colTags'),topText('rv.colKind'),topText('rv.colSize'),topText('rv.colAdded'),''],rows,topText('rv.noDups'));
}
async function loadRetroVariants(){
  const n=++rvSeq;
  try{const url=rvView==='sets'?'/admin/api/retro-variants/sets':rvView==='trash'?'/admin/api/retro-variants/trash':'/admin/api/retro-variants';
    const d=await api(url);if(n!==rvSeq)return;rvData[rvView]=d;rvShow();}catch(err){toast(err.message);}
}
async function rvPick(g,m){
  try{await api('/admin/api/retro-variants/pick',{method:'POST',body:{group:g.id,game:m.id}});toast(topText('rv.pickDone'));loadRetroVariants();}catch(err){toast(err.message);}
}
async function rvTrash(m,force=false){
  if(!force&&!await ask(topFill('t.askVariant',{file:m.file}),{danger:true}))return;
  try{const r=await api('/admin/api/retro-variants/trash',{method:'POST',body:{game:m.id,force}});toast(topFill('t.movedFiles',{n:r.files.length}));rvData={};loadRetroVariants();}
  catch(err){if(err.code==='in-use'&&!force){
      if(await ask(topText('rv.askForce'),{danger:true}))rvTrash(m,true);return;}
    toast(err.message);}
}
async function rvRestore(i){
  try{const r=await api('/admin/api/retro-variants/restore',{method:'POST',body:{entry:i.entry,home:i.home}});
    toast(r.renamed&&r.renamed.length?topFill('t.restoredRenamed',{names:r.renamed.map((x)=>x.to.split('/').pop()).join(', ')}):topText('rv.restored'));rvData={};loadRetroVariants();}catch(err){toast(err.message);}
}

let rvFilterT=0;$('rv-filter').addEventListener('input',()=>{clearTimeout(rvFilterT);rvFilterT=setTimeout(rvShow,200);});
$('rv-broken').addEventListener('change',rvShow);
`;
