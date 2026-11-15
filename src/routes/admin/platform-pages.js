/**
 * The library pages of the PS Vita row (admin-pages.js): games and saves read from console backups, and a Vita's
 * homebrew and plugins from the homebrew folder. A PSP game backed up from a Vita is that Vita's, tagged PSP; the
 * retro folder's PSP games stay on the retro page.
 */
import { top } from "./top-i18n.js";

const section = (tab, title, lead, body) => /* html */ `<section id="tab-${tab}">
  <div class="hd"><h2 class="first">${top(title)}</h2></div>
  <p class="muted">${top(lead)}</p>
  ${body}
</section>`;

export const PLATFORM_HTML = {
  vitaGames: section("vita-games", "m.grpGames", "pf.vitaGamesLead", `<div id="pf-list" data-skel></div>`),
  vitaSaves: section("vita-saves", "m.saves", "pf.vitaSavesLead", `<div id="pf-list" data-skel></div>`),
  vitaRetroArch: section("vita-retroarch", "mn.retroarch", "pf.raLead", `<div id="pf-list" data-skel></div>`),
  vitaHomebrew: section("vita-homebrew", "g.homebrew", "pf.vitaHbLead", `<div id="pf-list" data-skel></div>`),
  vitaPlugins: section("vita-plugins", "mn.plugins", "pf.pluginsLead", `<div id="pf-list" data-skel></div>`),
};

/** The backed-up games' cards and the rows of a list; the people page used the same cards before. */
export const PLATFORM_CSS = /* css */ `
.bg-account{margin:16px 0 8px;font-weight:var(--fw-bold)}
.bg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.bg-card{border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;background:var(--panel)}
.bg-cover{aspect-ratio:480/272;background:var(--bg);display:flex;align-items:center;justify-content:center}
.bg-cover img{width:100%;height:100%;object-fit:cover;display:block}
.bg-cover img.bg-icon{width:64px;height:64px;border-radius:var(--r-lg);object-fit:cover}
.bg-body{padding:8px 12px 12px}
.bg-title{font-weight:var(--fw-bold);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.bg-meta{font-size:var(--fs-sm);color:var(--muted);margin-top:4px}
.pf-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.pf-tag{font-size:var(--fs-2xs);font-weight:var(--fw-bold);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 6px}
.pf-rows{display:grid;gap:8px}
.pf-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel)}
.pf-row img{width:40px;height:40px;border-radius:var(--r-md);object-fit:cover;flex:none}
.pf-row .pf-main{min-width:0;flex:1}
.pf-row .pf-name{font-weight:var(--fw-bold);overflow-wrap:anywhere}`;

export const PLATFORM_SCRIPT = /* js */ `
const pfSize=(n)=>n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil((n||0)/1024)+' KB';
const pfTags=(words)=>{const t=el('div','','pf-tags');for(const w of words)t.append(el('span',w,'pf-tag'));return t;};
// A game's card: its cover (else its icon), title, what it is, and where it runs.
function pfCard(g,meta,tags){const card=el('div','','bg-card'),cover=el('div','','bg-cover');
  const pic=g.cover||g.icon;if(pic){const img=document.createElement('img');img.src=pic;img.alt='';img.loading='lazy';if(!g.cover)img.className='bg-icon';cover.append(img);}
  const body=el('div','','bg-body');body.append(el('div',g.title||g.id,'bg-title'),el('div',meta,'bg-meta'));
  if(tags&&tags.length)body.append(pfTags(tags));card.append(cover,body);return card;}
function pfRow(name,meta,pic,tags){const row=el('div','','pf-row');
  if(pic){const img=document.createElement('img');img.src=pic;img.alt='';img.loading='lazy';row.append(img);}
  const main=el('div','','pf-main');main.append(el('div',name,'pf-name'),el('div',meta,'bg-meta'));if(tags&&tags.length)main.append(pfTags(tags));
  row.append(main);return row;}
const pfEmpty=(box,key)=>{box.replaceChildren(el('p',topText(key),'muted'));};
// Each account's backed-up games of one platform, as cards or rows, by the pick and draw given.
async function pfBackups(pick,draw,none){const box=$('pf-list');
  const d=await api('/admin/api/backups/games');box.replaceChildren();
  const accounts=(d.accounts||[]).map((a)=>({...a,games:a.games.filter(pick)})).filter((a)=>a.games.length);
  if(!accounts.length)return pfEmpty(box,none);
  for(const a of accounts){box.append(el('div',topFill('pp.gamesOf',{name:a.name,n:a.games.length}),'bg-account'));box.append(draw(a.games));}}
const pfHas=(g,kind)=>(g.units||[]).some((u)=>u.startsWith(kind+':'));
const pfGrid=(games)=>{const grid=el('div','','bg-grid');
  for(const g of games)grid.append(pfCard(g,[g.region,g.version,pfSize(g.bytes)].filter(Boolean).join(' · '),pfKind(g)));return grid;};
const pfSaves=(games)=>{const list=el('div','','pf-rows');
  for(const g of games)list.append(pfRow(g.title||g.id,topFill('pf.savedAt',{when:fmt(g.updatedAt)}),g.icon,pfKind(g)));return list;};
// What the Vita holds, its PSP games among them: a PSP game names its platform on its card.
const pfOnVita=(g)=>g.platform==='vita'||g.platform==='psp';
const pfKind=(g)=>g.platform==='psp'?['PSP']:[];
const pfVitaGame=(g)=>pfOnVita(g)&&['app','patch','psp-game','psp-iso'].some((k)=>pfHas(g,k));
const pfVitaSave=(g)=>pfOnVita(g)&&(pfHas(g,'savedata')||pfHas(g,'psp-save'));
async function loadVitaGames(){await pfBackups(pfVitaGame,pfGrid,'pp.gamesNone');}
async function loadVitaSaves(){await pfBackups(pfVitaSave,pfSaves,'pf.savesNone');}
// A Vita's apps or plugins, from the homebrew list the Switch's page reads too.
async function pfVitaApps(plugins){const box=$('pf-list');
  const d=await api('/admin/api/homebrew/apps');box.replaceChildren();
  const apps=(d.apps||[]).filter((a)=>a.platform==='vita'&&a.plugin===plugins);
  if(!apps.length)return pfEmpty(box,'pf.none');
  const list=el('div','','pf-rows');
  for(const a of apps){const meta=[a.display_version||a.version,a.title_id,pfSize(a.size)].filter(Boolean).join(' · ');
    const tags=plugins?[...(a.sections||[]),...(a.required?[topText('pf.required')]:[]),...(a.kernel?[topText('pf.kernel')]:[])]:[];
    list.append(pfRow(a.name,meta,null,tags));}
  box.append(list);}
// Each system with games: the core the Vita's RetroArch runs it on, and the firmware the server lacks for it.
async function loadVitaRetroArch(){const box=$('pf-list');
  const d=await api('/admin/api/retro-art/vita');box.replaceChildren();
  if(!(d.systems||[]).length)return pfEmpty(box,'pf.none');
  const list=el('div','','pf-rows');
  for(const s of d.systems){const name=(s.names&&(s.names[document.documentElement.lang]||s.names.en))||s.id;
    const fw=s.firmware.needed?topFill(s.firmware.missing?'pf.fwMissing':'pf.fwOk',{n:s.firmware.missing}):null;
    const meta=[s.core?s.core+'_libretro':topText('pf.noCore'),topFill('pf.gameCount',{n:s.romCount}),fw].filter(Boolean).join(' · ');
    list.append(pfRow(name,meta,null,s.core?[]:[topText('pf.notOnVita')]));}
  box.append(list);}
const loadVitaHomebrew=()=>pfVitaApps(false);
const loadVitaPlugins=()=>pfVitaApps(true);
`;
