/**
 * 메타데이터: what the library shows about its items, one job a page (검토 필요, 아트워크, 제목) and the kind of
 * item chosen with a filter over the page. A game, homebrew app or patch is picked from a list beside its editor;
 * retro shows the retro page's own box art or Korean names view, which moved here from the retro page.
 *
 *   ?kind=game|retro|homebrew|patch   the filter, kept in the address
 *   ?id=<title id>                    on 제목 and 아트워크, the game opened at once (검토 필요 links here)
 */
import { icon } from "../../views/icons.js";
import { top, topLabel, topPh } from "./top-i18n.js";
import { picSlotHtml, PIC_SLOT_SCRIPT } from "./picture-slot.js";
import { RETRO_ART_SCRIPT, RETRO_PINNED_HTML } from "./retro-art-panel.js";

const KIND_LABEL = { game: "m.grpGames", retro: "mn.retro", homebrew: "g.homebrew", patch: "m.patches" };

const kindBar = (kinds) => `<div class="seg mt-kind" id="mt-kind" role="group" ${topLabel("mt.kind")}>${kinds.map((k) =>
  `<button type="button" data-kind="${k}" aria-pressed="false">${top(KIND_LABEL[k])}<span class="count" hidden></span></button>`).join("")}</div>`;

// The list of items on the left, the chosen one's editor on the right.
const picker = (editor) => `<div class="mt-pick" id="mt-pick">
  <div class="mt-list"><input type="search" id="mt-q" ${topPh("pg.search")} ${topLabel("pg.search")}><div class="mt-items" id="mt-items" role="listbox" data-skel></div></div>
  <template id="mt-noimg">${icon("puzzle")}</template>
  <div class="mt-edit"><p class="muted" id="mt-hint">${top("mt.pick")}</p><div id="mt-editor" hidden><h3 id="mt-name"></h3>${editor}</div></div></div>`;

export const METADATA_CSS = /* css */ `
.mt-kind{margin:0 0 12px}
.mt-kind .count{margin-left:6px}
.mt-lead{margin:0 0 12px}
.mt-pick{display:grid;grid-template-columns:minmax(240px,340px) minmax(0,1fr);gap:16px;align-items:start}
.mt-list{display:grid;gap:8px;min-width:0}
.mt-list input{width:100%}
.mt-items{display:grid;gap:2px;max-height:min(64vh,640px);overflow:auto;padding:4px;border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel)}
.mt-item{display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;min-width:0;padding:6px 8px;border:none;border-radius:var(--r-lg);background:none;color:var(--text);text-align:left}
.mt-item:hover{background:var(--sunk)}
.mt-item[aria-selected="true"]{background:var(--text);color:var(--bg)}
.mt-item[aria-selected="true"] .muted{color:inherit;opacity:.75}
.mt-thumb{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:var(--r-md);background:var(--sunk);overflow:hidden;color:var(--faint)}
.mt-thumb img{width:100%;height:100%;object-fit:cover}
.mt-thumb .ico{width:18px;height:18px}
.mt-item-t{display:grid;min-width:0}
.mt-item-t b,.mt-item-t span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-item-t b{font-weight:var(--fw-bold)}
.mt-edit{min-width:0}
.mt-edit h3{margin:0 0 10px}
.mt-form{display:grid;gap:10px;max-width:520px}
.mt-form label{display:grid;gap:4px}
.mt-form .row-actions{display:flex;gap:8px}
.mt-rows{display:grid;gap:2px}
.mt-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-lg);color:var(--text);text-decoration:none}
.mt-row:hover{background:var(--sunk)}
.mt-row b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:var(--fw-bold)}
.mt-row .mt-tid{color:var(--muted);font-size:var(--fs-xs);font-family:var(--mono,monospace)}
.mt-reasons{display:flex;gap:4px;flex-wrap:wrap}
.mt-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:10px}
.mt-card{display:grid;gap:8px;padding:14px;border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel)}
.mt-card b{font-size:var(--fs-md)}
@media (max-width:760px){.mt-pick{grid-template-columns:minmax(0,1fr)}.mt-items{max-height:40vh}}
`;

// The filter, the address and the list every page shares. A page sets mtShow(kind) and, with a list, mtOpen(item).
const METADATA_COMMON_SCRIPT = /* js */ `
let mtKinds=[...document.querySelectorAll('#mt-kind [data-kind]')].map((b)=>b.dataset.kind),mtKindNow='',mtItems=[],mtPicked=null,mtSeq=0;
function mtUrl(set){const u=new URL(location.href);for(const [k,v] of Object.entries(set)){if(v==null||v==='')u.searchParams.delete(k);else u.searchParams.set(k,v);}history.replaceState(null,'',u);}
function mtKind(kind){mtKindNow=mtKinds.includes(kind)?kind:mtKinds[0];
  for(const b of document.querySelectorAll('#mt-kind [data-kind]')){const on=b.dataset.kind===mtKindNow;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}
  mtUrl({kind:mtKindNow,view:null});mtShow(mtKindNow);}
for(const b of document.querySelectorAll('#mt-kind [data-kind]'))b.addEventListener('click',()=>{if(b.dataset.kind!==mtKindNow){mtUrl({id:null});mtKind(b.dataset.kind);}});
function mtCount(kind,n){const c=document.querySelector('#mt-kind [data-kind="'+kind+'"] .count');if(!c)return;c.textContent=n?String(n):'';c.hidden=!n;}
// The retro page's own views live in #tab-retro; a list page hides them, and they load the first time they show.
let mtRetroOpen=false;
function mtRetro(on,sub){const r=$('tab-retro'),p=$('mt-pick');if(r)r.hidden=!on;if(p)p.hidden=on;
  if(on&&!mtRetroOpen){mtRetroOpen=true;if(sub==='art')loadRetroArt();retroShowSub(sub);mtUrl({view:null});}}
function mtNoImg(t){t.replaceChildren($('mt-noimg').content.cloneNode(true));}
function mtThumb(src){const t=el('span',null,'mt-thumb');if(!src){mtNoImg(t);return t;}
  const i=el('img');i.alt='';i.loading='lazy';i.src=src;i.addEventListener('error',()=>mtNoImg(t));t.append(i);return t;}
function mtRender(){const box=$('mt-items');delete box.dataset.skel;
  if(!mtItems.length){box.replaceChildren(el('p',topText('mt.none'),'muted'));return;}
  box.replaceChildren(...mtItems.map((it)=>{const b=el('button',null,'mt-item');b.type='button';b.setAttribute('role','option');
    b.setAttribute('aria-selected',String(mtPicked!=null&&it.id===mtPicked.id));
    const t=el('span',null,'mt-item-t');t.append(el('b',it.name||it.id));if(it.sub)t.append(el('span',it.sub,'muted'));
    b.append(mtThumb(it.thumb),t);b.addEventListener('click',()=>mtPick(it));return b;}));}
function mtPick(it){mtPicked=it;mtRender();$('mt-hint').hidden=true;$('mt-editor').hidden=false;$('mt-name').textContent=it.name||it.id;
  if(mtKindNow==='game')mtUrl({id:it.id});mtOpen(it);}
// Each kind's items, as { id, name, sub, thumb }. Games are searched on the server; the others come whole.
let mtHb=null,mtPt=null;
async function mtFetch(kind,q){
  if(kind==='game'){const d=await api('/admin/api/games/search?limit=80&sort=name&q='+encodeURIComponent(q));
    return d.items.map((g)=>({id:g.titleId,name:g.name,sub:g.titleId,thumb:'/api/library/icon/'+g.titleId}));}
  const has=(it)=>!q||(it.name+' '+(it.sub||'')).toLowerCase().includes(q.toLowerCase());
  if(kind==='homebrew'){mtHb??=(await api('/admin/api/homebrew/apps')).apps.map((a)=>({id:a.id,name:a.name,sub:a.author||'',thumb:a.custom_icon_url||'/api/homebrew/'+encodeURIComponent(a.id)+'/icon'}));return mtHb.filter(has);}
  if(kind==='patch'){mtPt??=(await api('/admin/api/patches')).patches.map((p)=>({id:p.id,name:p.ko||p.name,sub:p.game||p.title_id,thumb:null}));return mtPt.filter(has);}
  return [];}
async function mtLoad(){const seq=++mtSeq,kind=mtKindNow,q=$('mt-q').value.trim();
  try{const items=await mtFetch(kind,q);if(seq!==mtSeq)return;mtItems=items;
    // An item opened from its address knows only its ID until the list names it.
    const named=mtPicked&&mtPicked.name===mtPicked.id&&items.find((it)=>it.id===mtPicked.id);
    if(named){mtPicked.name=named.name;$('mt-name').textContent=named.name;}
    mtRender();}catch(err){toast(err.message);}}
function mtList(kind){mtRetro(false);mtItems=[];mtPicked=null;$('mt-items').dataset.skel='';$('mt-items').replaceChildren();
  $('mt-hint').hidden=false;$('mt-editor').hidden=true;$('mt-q').value='';mtLoad();
  const id=kind==='game'&&new URLSearchParams(location.search).get('id');
  if(id&&/^[0-9A-F]{16}$/i.test(id))mtPick({id:id.toUpperCase(),name:id.toUpperCase()});}
{let t=null;const q=$('mt-q');if(q)q.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(mtLoad,200);});}
`;

export const METADATA_REVIEW_HTML = /* html */ `<section id="tab-meta-review">${kindBar(["game", "retro", "patch"])}
  <p class="muted mt-lead">${top("mt.reviewLead")}</p><div id="mt-review" data-skel></div></section>`;

export const METADATA_REVIEW_SCRIPT = METADATA_COMMON_SCRIPT + /* js */ `
let mtReview=null;
function mtReasons(rs){const box=el('span',null,'mt-reasons');box.append(...rs.map((r)=>pill(topText('mt.r.'+r),r==='noKo'?'':'warn')));return box;}
function mtMore(part,n){return part.total>n?el('p',topFill('mt.more',{n,total:part.total}),'muted'):null;}
function mtLink(href,name,sub,extra){const a=el('a',null,'mt-row');a.href=href;a.append(el('b',name));if(sub)a.append(el('span',sub,'mt-tid'));if(extra)a.append(extra);return a;}
function mtCard(text,go,href){const c=el('div',null,'mt-card');const a=el('a',go,'btn');a.href=href;c.append(el('b',text),a);return c;}
function mtShow(kind){const box=$('mt-review');if(!mtReview)return;delete box.dataset.skel;const d=mtReview;
  if(kind==='game'){const rows=d.game.items.map((g)=>mtLink('/admin/metadata/titles?kind=game&id='+g.titleId,g.name||g.titleId,g.titleId,mtReasons(g.reasons)));
    const list=el('div',null,'mt-rows');list.append(...rows);box.replaceChildren(...(rows.length?[list]:[el('p',topText('mt.noGame'),'muted')]),...[mtMore(d.game,rows.length)].filter(Boolean));}
  else if(kind==='retro'){const r=d.retro,cards=[];
    if(r.missingArt)cards.push(mtCard(topFill('mt.retroArt',{n:r.missingArt}),topText('mt.retroArtGo'),'/admin/metadata/artwork?kind=retro'));
    if(r.guesses)cards.push(mtCard(topFill('mt.retroKo',{n:r.guesses}),topText('mt.retroKoGo'),'/admin/metadata/titles?kind=retro'));
    const grid=el('div',null,'mt-cards');grid.append(...cards);box.replaceChildren(cards.length?grid:el('p',topText('mt.retroOk'),'muted'));}
  else{const rows=d.patch.items.map((p)=>mtLink('/admin/patches?tab=list',p.name||p.id,p.titleId));
    const list=el('div',null,'mt-rows');list.append(...rows);
    box.replaceChildren(el('p',topText('mt.patchLead'),'muted mt-lead'),rows.length?list:el('p',topText('mt.noPatch'),'muted'),...[mtMore(d.patch,rows.length)].filter(Boolean));}}
async function loadMetadataReview(){try{mtReview=await api('/admin/api/metadata/review');}catch(err){toast(err.message);return;}
  mtCount('game',mtReview.game.total);mtCount('retro',mtReview.retro.missingArt+mtReview.retro.guesses);mtCount('patch',mtReview.patch.total);
  mtKind(new URLSearchParams(location.search).get('kind'));}
`;

export const METADATA_ART_HTML = /* html */ `<section id="tab-meta-art">${kindBar(["game", "retro", "homebrew", "patch"])}
  ${picker(`<p class="muted mt-lead">${top("mt.artLead")}</p>${picSlotHtml("mt-pic")}`)}</section>${RETRO_PINNED_HTML}`;

export const METADATA_ART_SCRIPT = RETRO_ART_SCRIPT + PIC_SLOT_SCRIPT + METADATA_COMMON_SCRIPT + /* js */ `
function mtShow(kind){if(kind==='retro')mtRetro(true,'art');else mtList(kind);}
function mtOpen(it){picSlot($('mt-pic'),mtKindNow,it.id);}
`;

export const METADATA_TITLES_HTML = /* html */ `<section id="tab-meta-titles">${kindBar(["game", "retro"])}
  ${picker(`<p class="muted mt-lead">${top("mt.titlesLead")}</p><form class="mt-form" id="mt-form">
    <p class="muted" id="mt-orig" hidden></p>
    <label>${top("mt.ko")}<input id="mt-ko" autocomplete="off"></label>
    <label>${top("mt.en")}<input id="mt-en" autocomplete="off"></label>
    <div class="row-actions"><button type="submit" class="primary">${top("mt.save")}</button></div></form>`)}</section>${RETRO_PINNED_HTML}`;

export const METADATA_TITLES_SCRIPT = RETRO_ART_SCRIPT + METADATA_COMMON_SCRIPT + /* js */ `
function mtShow(kind){if(kind==='retro')mtRetro(true,'names');else mtList(kind);}
async function mtOpen(it){const f=$('mt-form');f.dataset.id=it.id;$('mt-ko').value='';$('mt-en').value='';$('mt-orig').textContent='';$('mt-orig').hidden=true;
  let d;try{d=await api('/admin/api/descriptions/'+it.id);}catch(err){toast(err.message);return;}
  if(f.dataset.id!==it.id)return;const own=d.own&&d.own.name||{};
  $('mt-ko').value=own.ko||'';$('mt-en').value=own.en||'';
  if(d.originalName){it.orig=d.originalName;$('mt-orig').textContent=topFill('mt.original',{name:d.originalName});$('mt-orig').hidden=false;if(it.name===it.id)$('mt-name').textContent=d.originalName;}}
$('mt-form').addEventListener('submit',async(e)=>{e.preventDefault();const id=e.currentTarget.dataset.id;if(!id)return;
  const ko=$('mt-ko').value.trim(),en=$('mt-en').value.trim();
  try{await api('/admin/api/descriptions/'+id,{method:'POST',body:{name:{ko,en}}});toast(topText('mt.saved'));}catch(err){toast(err.message);return;}
  // The list is searched from an index the server rebuilds later; the row shows the new name now.
  if(mtPicked&&mtPicked.id===id){mtPicked.name=ko||en||mtPicked.orig||mtPicked.name;$('mt-name').textContent=mtPicked.name;
    const row=mtItems.find((it)=>it.id===id);if(row)row.name=mtPicked.name;mtRender();}});
`;
