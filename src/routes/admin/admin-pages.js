/**
 * The admin pages: one URL per job, on top of the panels that already exist.
 *
 * Stage A of the admin redesign: every page below is a real route with its own
 * URL (back, reload and links work), a vertical sidebar on the desktop and the
 * same tree in a drawer on a phone. The page body still mounts the whole panel
 * DOM and activates the section the old hash system used, so no panel script is
 * rewritten yet; Stage B will split the pages for real. The bridge script at the
 * bottom keeps the old "#users" style links working by rewriting them to paths.
 *
 * Labels come from top-i18n (ko en ja zh); the sidebar renders Korean and the
 * page's language script swaps every [data-top] span on load and on change.
 */
import { icon } from "../../views/icons.js";
import { top } from "./top-i18n.js";

/**
 * A page: the section (tab) it opens, the sub-view inside it when there is one, and its sidebar icon.
 * A page with no row is a sidebar row of its own. A `row` puts pages under one sidebar row, linked as
 * tabs at the top of each page, so the sidebar holds eight entries and each one's jobs are its tabs.
 */
export const ADMIN_PAGES = [
  { path: "/admin", tab: "overview", label: "mn.dashboard", icon: "dashboard" },
  // The chat opens from the widget on every page, so it keeps its address without a sidebar row.
  { path: "/admin/chat", tab: "chat", label: "m.chat", icon: "chat", offMenu: true },
  // Uploading, the temp share and the temp folder, on one page.
  { path: "/admin/incoming", tab: "incoming", label: "mn.upload", icon: "upload", count: "inbox-count" },
  // the libraries: each page holds its own jobs as tabs
  { path: "/admin/games", tab: "library", label: "m.grpGames", row: "library", icon: "grid" },
  { path: "/admin/retro", tab: "retro", label: "mn.retro", row: "library", icon: "joystick" },
  { path: "/admin/homebrew", tab: "homebrew", label: "g.homebrew", row: "library", icon: "package", param: "tab" },
  { path: "/admin/patches", tab: "patches", label: "m.patches", row: "library", icon: "puzzle", param: "tab" },
  { path: "/admin/saves", tab: "saves", label: "m.saves", row: "library", icon: "save", param: "tab" },
  { path: "/admin/trash", tab: "trash", label: "m.trash", row: "library", icon: "trash" },
  // metadata: what the library shows about its items, the kind chosen with a filter on each page
  { path: "/admin/metadata/review", tab: "metaReview", label: "mn.review", row: "meta", icon: "check" },
  { path: "/admin/metadata/artwork", tab: "metaArt", label: "mn.artwork", row: "meta", icon: "image" },
  { path: "/admin/metadata/titles", tab: "metaTitles", label: "mn.titles", row: "meta", icon: "tag" },
  // users
  { path: "/admin/users", tab: "users", label: "s.users", row: "people", icon: "users", count: "account-count" },
  { path: "/admin/devices", tab: "devices", label: "s.devices", row: "people", icon: "device", count: "pending-count" },
  { path: "/admin/client", tab: "client", label: "mn.client", row: "people", icon: "download" },
  { path: "/admin/featured", tab: "featured", label: "mn.home", icon: "star" },
  // system: the jobs the server runs and what it recorded
  { path: "/admin/convert", tab: "nsz", label: "mn.compress", row: "ops", icon: "shrink" },
  { path: "/admin/system/requirements", tab: "requirements", label: "mn.reqFiles", row: "ops", icon: "package" },
  { path: "/admin/logs/downloads", tab: "logs", sub: "xfer", label: "mn.xfer", row: "ops", icon: "download" },
  { path: "/admin/logs/clients", tab: "logs", sub: "client", label: "mn.clientLog", row: "ops", icon: "device" },
  { path: "/admin/logs/security", tab: "logs", sub: "deny", label: "mn.secLog", row: "ops", icon: "lock", count: "lock-count" },
  { path: "/admin/logs/alerts", tab: "alerts", sub: "history", label: "m.alertLog", row: "ops", icon: "bell" },
  // settings: how the server runs, who may sign in, how the admin signs in, the tokens automation uses.
  // Login and admin security still share the old "security" area until Stage B splits it.
  { path: "/admin/settings/server", tab: "settings", sub: "server", label: "m.setServer", row: "set", icon: "sliders" },
  { path: "/admin/settings/login", tab: "settings", sub: "security", label: "m.setLogin", row: "set", icon: "login", shared: true },
  { path: "/admin/settings/admin", tab: "settings", sub: "security", label: "m.setAdmin", row: "set", icon: "lock", shared: true },
  { path: "/admin/settings/notifications", tab: "alerts", label: "m.alerts", row: "set", icon: "bell" },
  { path: "/admin/settings/integrations", tab: "settings", sub: "integrations", label: "m.setIntegrations", row: "set", icon: "package" },
  { path: "/admin/settings/plugins", tab: "settings", sub: "plugins", label: "m.setPlugins", row: "set", icon: "puzzle" },
  { path: "/admin/settings/automation", tab: "settings", sub: "tokens", label: "m.setAuto", row: "set", icon: "key" },
];

export const ADMIN_PAGE_BY_PATH = new Map(ADMIN_PAGES.map((p) => [p.path, p]));

const ROWS = {
  library: { label: "m.library", icon: "layers" },
  meta: { label: "mn.meta", icon: "image" },
  people: { label: "mn.users", icon: "users" },
  ops: { label: "mn.system", icon: "monitor" },
  set: { label: "m.grpSet", icon: "sliders" },
};

/** The page a legacy "#tab" hash belongs to, so old links land on real paths. */
export const PATH_FOR_TAB = {
  overview: "/admin", users: "/admin/users", devices: "/admin/devices", settings: "/admin/settings/server",
  alerts: "/admin/settings/notifications", logs: "/admin/logs/downloads", featured: "/admin/featured",
  library: "/admin/games", organize: "/admin/incoming", nsz: "/admin/convert", upload: "/admin/incoming", inbox: "/admin/incoming", incoming: "/admin/incoming",
  all: "/admin/games", files: "/admin/games", homebrew: "/admin/homebrew", retro: "/admin/retro", trash: "/admin/trash", client: "/admin/client", patches: "/admin/patches", saves: "/admin/saves",
};

const countSpan = (id, withIds) => `<span class="count"${withIds ? ` id="${id}"` : ` data-count-id="${id}"`} hidden></span>`;

const item = (page, current, withIds) => {
  const on = current?.path === page.path;
  const count = page.count ? countSpan(page.count, withIds) : "";
  return `<a class="adm-item" href="${page.path}"${on ? ' aria-current="page"' : ""}>${page.icon ? icon(page.icon) : ""}${top(page.label)}${count}</a>`;
};

/** A row that stands for several pages: it opens the first, and is the current row on any of them. */
const rowItem = (key, pages, current, withIds) => {
  const r = ROWS[key];
  const on = pages.some((p) => p.path === current?.path);
  const counts = pages.filter((p) => p.count).map((p) => countSpan(p.count, withIds)).join("");
  // The panels show and hide their own count spans; inside the hidden holder they only feed the row's sum.
  const sum = counts ? `<span class="adm-srcs" hidden>${counts}</span><span class="count" data-sum hidden></span>` : "";
  return `<a class="adm-item" href="${pages[0].path}" data-paths="${pages.map((p) => p.path).join(" ")}"${on ? ' aria-current="page"' : ""}>${icon(r.icon)}${top(r.label)}${sum}</a>`;
};

/** The tabs over a page that shares a sidebar row with others: one link per page, the open one marked. */
export function rowTabsHtml(page) {
  if (!page.row) return "";
  const pages = ADMIN_PAGES.filter((p) => p.row === page.row);
  const links = pages.map((p) => `<a href="${p.path}"${p.path === page.path ? ' aria-current="page"' : ""}>${icon(p.icon)}${top(p.label)}${p.count ? countSpan(p.count, false) : ""}</a>`).join("");
  return `<nav class="subtabs adm-rowtabs hide-bar" data-top-label="${ROWS[page.row].label}">${links}</nav>`;
}

/**
 * The sidebar: one link per entry, a row standing for all its pages. Rendered once for the desktop aside
 * (withIds, the count spans the panels fill by id) and once for the phone drawer (mirrors, so the ids
 * stay unique in the document).
 */
export function sidebarNav(current, withIds = true) {
  const rows = [];
  const seen = new Set();
  for (const page of ADMIN_PAGES) {
    if (page.offMenu) continue;
    if (!page.row) rows.push(item(page, current, withIds));
    else if (!seen.has(page.row)) {
      seen.add(page.row);
      rows.push(rowItem(page.row, ADMIN_PAGES.filter((p) => p.row === page.row), current, withIds));
    }
  }
  return rows.join("");
}

/** The phone drawer: the same tree inside a dialog, so Esc and the focus trap come free. */
export function drawerHtml(current) {
  return `<dialog id="adm-drawer" class="adm-drawer" data-top-label="nav">
<div class="adm-drawer-hd"><img class="logo brand-motion" src="/assets/cookingfoil.svg" alt="" width="28" height="28"><span class="wm">cookingfoil<span class="dot">.</span></span>
<button type="button" id="adm-drawer-close" data-top-label="acc.close">✕</button></div>
<nav class="adm-side-in" data-top-label="nav">${sidebarNav(current, false)}</nav></dialog>`;
}

/** The button that opens the drawer; the header shows it below the desktop width. */
export const MENU_BUTTON_HTML = `<button class="icon-btn" id="adm-menu" type="button" aria-haspopup="dialog" aria-expanded="false" data-top-label="m.menu"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>`;

export const ADM_SHELL_CSS = /* css */ `
body.adm-shell{padding:0}
/* width:100% keeps every page the same width: a grid item with auto margins otherwise shrinks to its content. */
.adm-shell>.wrap{width:100%;box-sizing:border-box;max-width:1240px;margin:0 auto;padding:24px 32px 80px;min-width:0}
@media (max-width:899px){.adm-shell>.wrap{padding:18px 16px 72px}}
/* One frame: the brand and the menu are the sidebar; upload, language and account are the header band.
   On a phone the brand and the band share one top bar and the menu opens in the drawer. */
.adm-side{position:sticky;top:0;z-index:40;box-sizing:border-box;background:var(--bg)}
.adm-side>.adm-hdr{margin:0}
#adm-menu{display:none}
/* The page's name in the header: its menu path on a desktop, the item alone in the phone bar. */
.adm-crumb{display:flex;align-items:center;gap:6px;min-width:0;margin:0;font-weight:700;white-space:nowrap}
.adm-crumb>span{overflow:hidden;text-overflow:ellipsis}
.adm-crumb-g{color:var(--muted);font-weight:var(--fw-bold)}
.adm-crumb-sep{flex:none;width:14px;height:14px;fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@media (max-width:899px){
.adm-crumb{flex:1;font-size:var(--fs-md)}
.adm-crumb-far{display:none}
.adm-crumb-g,.adm-crumb-sep{flex:none}
.adm-crumb-i{flex:0 1 auto;min-width:0}
.adm-crumb-tight>.adm-crumb-g,.adm-crumb-tight>.adm-crumb-sep{display:none}
.adm-side{padding:8px 16px;border-bottom:1px solid var(--line)}
.adm-side>.adm-side-in{display:none}
#adm-menu{display:inline-flex;order:-1}
.adm-side>.adm-hdr{flex-wrap:nowrap;gap:8px}
.adm-side .hdr-right{display:contents}
/* The brand lives in the menu, as on the desktop: the drawer carries it, so the bar doesn't repeat it (the heading stays for screen readers). */
.adm-side .brand{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}
/* The account menu spans the phone's width under the bar, inside the same gutter the page keeps. */
@media (max-width:640px){.adm-side .activity-account>.pop-list{left:12px;right:12px;width:auto}}
/* Desktop: the sidebar is its own pane, cut from the page by its colour like the console client. Its brand
   stays put and only the menu under it scrolls. Upload, language and account sit in a header band over the
   page, top right, the same place and the same downward menus as on a phone. The band and the brand row
   share one height and one bottom line. */
@media (min-width:900px){
body.adm-shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh;--adm-hdr-h:52px}
.adm-side{display:flex;flex-direction:column;align-self:start;height:100vh;height:100dvh;padding:0;background:var(--panel);border-right:1px solid var(--line)}
.adm-side>.adm-hdr{display:contents}
.adm-side .brand{order:0;flex:none;display:flex;align-items:center;height:var(--adm-hdr-h);margin:0;padding:0 22px;box-sizing:border-box;border-bottom:1px solid var(--line)}
.adm-side .brand a{gap:10px}.adm-side .brand img{width:32px;height:32px}.adm-side .brand .wm{font-size:var(--fs-2xl)}
.adm-side>.adm-side-in{order:1;display:grid;align-content:start;grid-auto-rows:min-content;gap:6px;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px 14px 24px}
.adm-side .hdr-right{position:fixed;top:0;left:260px;right:0;z-index:40;height:var(--adm-hdr-h);box-sizing:border-box;
  display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px 0 32px;background:var(--panel);border-bottom:1px solid var(--line)}
.adm-side .adm-crumb{margin-right:auto;font-size:var(--fs-lg)}
.adm-shell>.wrap{padding-top:calc(var(--adm-hdr-h) + 24px)}}
/* Icons on every entry, as in the console client's menu. */
.adm-side-in .ico{width:20px;height:20px}
.adm-item:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}
.adm-item{display:flex;align-items:center;gap:12px;min-width:0;padding:9px 14px;border-radius:var(--r-lg);position:relative;
  color:var(--text);font-weight:var(--fw-bold);font-size:var(--fs-sm);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.adm-item:not([aria-current]):hover{background:color-mix(in srgb,var(--sunk) 70%,transparent)}
.adm-side-in>.adm-item{font-size:var(--fs-md);font-weight:700}
.adm-rowtabs .count{margin-left:2px}
.adm-item[aria-current="page"]{background:var(--text);color:var(--bg)}
.adm-item[aria-current="page"] .count{background:var(--bg);color:var(--text)}
.adm-item .count{margin-left:auto}
/* The drawer is as tall as what the phone shows (dvh leaves out the browser bars) and square, so nothing at
   the top or the foot hides under a bar or a rounded corner; only the menu scrolls. */
.adm-drawer{position:fixed;left:0;top:0;width:min(320px,86vw);height:100vh;height:100dvh;max-height:none;margin:0;border:0;
  border-right:1px solid var(--line);border-radius:0;padding:0;background:var(--bg);color:var(--text);box-sizing:border-box}
.adm-drawer[open]{display:flex;flex-direction:column}
.adm-drawer::backdrop{background:rgb(0 0 0 / .38)}
.adm-drawer .adm-side-in{display:grid;gap:6px;align-content:start;grid-auto-rows:min-content;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;
  padding:12px 12px calc(32px + env(safe-area-inset-bottom, 0px));box-sizing:border-box}
/* Phone menu rows keep a real touch height without stretching to fill. */
.adm-drawer .adm-item{min-height:44px}
.adm-drawer-hd{flex:none;display:flex;align-items:center;gap:10px;padding:max(18px, env(safe-area-inset-top, 0px)) 16px 16px;border-bottom:1px solid var(--line);font-weight:var(--fw-bold)}
.adm-drawer-hd .wm{flex:1;font-family:'Baloo 2',system-ui,sans-serif;font-size:var(--fs-xl);font-weight:var(--fw-bold);letter-spacing:-.02em;line-height:1}
.adm-drawer-hd .wm .dot{color:var(--accent)}
.adm-drawer-hd .logo{display:block}
#adm-drawer-close{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;flex:none;width:38px;height:38px;padding:0;border:1px solid var(--line);border-radius:var(--r-pill);background:var(--panel);color:var(--text);font-size:var(--fs-sm);line-height:1;cursor:pointer}
#adm-drawer-close:hover{background:var(--sunk);color:var(--text)}
@media (prefers-reduced-motion:no-preference){.adm-drawer[open]{animation:adm-drawer-in .18s ease-out}
@keyframes adm-drawer-in{from{transform:translateX(-14px)}to{transform:none}}}
`;

/**
 * The path bridge. It runs before the dashboard script so the hash the panels
 * read is already the page's own tab, keeps "#tab" links working by pushing the
 * matching path, answers back and forward between paths, and marks the sidebar.
 */
export function admRouterScript(page) {
  const conf = { path: page.path, tab: page.tab, sub: page.sub ?? "", param: page.param ?? "", anchor: page.anchor ?? "", name: page.offMenu ? top(page.label) : "" };
  return /* js */ `
(function(){
const PAGE=${JSON.stringify(conf)};
const H2P=${JSON.stringify(PATH_FOR_TAB)};
const P2F=${JSON.stringify(Object.fromEntries(ADMIN_PAGES.map((p) => [p.path, "#" + p.tab + (p.sub ? "/" + p.sub : "")])))};
const TAB_OF=${JSON.stringify(Object.fromEntries(ADMIN_PAGES.map((p) => [p.path, p.tab])))};
function pathForHash(parts){const [tab,sub]=parts;
  if(tab==='settings')return ({integrations:'/admin/settings/integrations',security:PAGE.path==='/admin/settings/login'?PAGE.path:'/admin/settings/admin',tokens:'/admin/settings/automation',plugins:'/admin/settings/plugins'})[sub]||'/admin/settings/server';
  if(tab==='logs')return ({client:'/admin/logs/clients',deny:'/admin/logs/security'})[sub]||'/admin/logs/downloads';
  return H2P[tab]||'/admin';}
// The temp folder, patches and saves were tabs of the games page; each is a page of its own now.
if(PAGE.path==='/admin/games'){const gone={organize:'/admin/incoming',patches:'/admin/patches',saves:'/admin/saves',server:'/admin/settings/server'};
  const q=new URLSearchParams(location.search);
  const was=q.get('view')||location.hash.split('/')[1],to=gone[was];
  if(to&&(q.get('view')||location.hash.startsWith('#library/'))){q.delete('view');if(was==='patches'||was==='saves')q.set('tab','list');const s=q.toString();location.replace(to+(s?'?'+s:''));return;}}
const legacy=location.hash.slice(1).split('/');
if(H2P[legacy[0]]&&(legacy[0]!==PAGE.tab||(['settings','logs'].includes(legacy[0])&&legacy[1]))&&pathForHash(legacy)!==PAGE.path){
  location.replace(pathForHash(legacy)+location.search+location.hash);return;}
function activePath(){let p=location.pathname;
  const parts=location.hash.slice(1).split('/');
  if(parts[0]==='settings'){const sub=parts[1];
    if(sub==='integrations')p='/admin/settings/integrations';
    else if(sub==='tokens')p='/admin/settings/automation';
    else if(sub==='plugins')p='/admin/settings/plugins';
    else if(sub==='security')p=(p==='/admin/settings/admin')?p:'/admin/settings/login';}
  return p;}
function mark(){const p=activePath();
  for(const a of document.querySelectorAll('.adm-item')){const on=a.dataset.paths?a.dataset.paths.split(' ').includes(p):new URL(a.href,location.origin).pathname===p;
    if(on)a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');}
  crumb();}
// The header names the page by its menu path, from the sidebar's current item: "row > tab" on a page that
// shares its entry with others, and the open in-page tab as the last crumb. A phone keeps
// the last two, because 파일 alone does not say whose files. The label spans are copies, so the language switch
// relabels them with the rest.
function crumb(){const c=document.getElementById('adm-crumb'),a=document.querySelector('.adm-side .adm-item[aria-current="page"]');
  if(!c)return;c.replaceChildren();
  // A page with no sidebar row is named by itself.
  if(!a){if(PAGE.name){c.insertAdjacentHTML('beforeend',PAGE.name);c.lastElementChild.classList.add('adm-crumb-i');}return;}
  const label=(n)=>{const s=n&&n.querySelector(':scope>[data-top]');return s?s.cloneNode(true):null;};
  const plain=(n)=>{const s=n.querySelector('[data-top]');if(s)return s.cloneNode(true);const t=document.createElement('span');
    t.textContent=[...n.childNodes].filter((x)=>x.nodeType===3||(x.nodeType===1&&!x.classList.contains('count')&&!x.querySelector('svg')&&x.tagName!=='svg')).map((x)=>x.textContent).join('').trim();return t;};
  const rowTab=document.querySelector('main .adm-rowtabs [aria-current="page"]');
  // The holding area's parts each carry their heading, so its temp folder tabs do not name the page.
  const sec=document.querySelector('main .subtabs:not(.adm-rowtabs):not(.inc-sub):not([hidden]) :is([data-sub],[data-lsub])[aria-selected="true"]');
  const parts=[];
  // A tab whose name is already in the page's says nothing more: 알림 설정 is not also 알림 설정 › 설정.
  const said=(p)=>parts[parts.length-1]?.textContent.trim().toLowerCase().includes(p?.textContent.trim().toLowerCase());
  parts.push(label(a));if(rowTab)parts.push(plain(rowTab));
  if(sec&&!said(plain(sec)))parts.push(plain(sec));
  const shown=parts.filter(Boolean);
  shown.forEach((p,k)=>{const last=k===shown.length-1;
    const far=k<shown.length-2?' adm-crumb-far':'';
    if(!last){p.classList.add('adm-crumb-g');if(far)p.classList.add('adm-crumb-far');c.append(p);
      c.insertAdjacentHTML('beforeend','<svg class="adm-crumb-sep'+far+'" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>');}
    else{p.classList.add('adm-crumb-i');c.append(p);}});
  // Short of room the page's own name wins, whole, rather than its entry cut to one syllable.
  c.classList.remove('adm-crumb-tight');const i=c.querySelector('.adm-crumb-i');if(i&&i.scrollWidth>i.clientWidth)c.classList.add('adm-crumb-tight');}
window.__admMark=mark;
function sums(){
  // The row sums sit inside the observed tree, so every write is made only
  // when the value really changes; an unconditional write would reissue the
  // observer and spin the page. The mirrors are filled first, so a drawer row sums what its spans copied.
  for(const d of document.querySelectorAll('[data-count-id]')){const s=document.getElementById(d.dataset.countId);
    if(s){if(d.textContent!==s.textContent)d.textContent=s.textContent;
      if(d.hidden!==s.hidden)d.hidden=s.hidden;}}
  for(const g of document.querySelectorAll('.adm-item[data-paths]')){let n=0;
    for(const c of g.querySelectorAll('.adm-srcs>.count'))n+=c.hidden?0:(Number(c.textContent)||0);
    const s=g.querySelector('.count[data-sum]');
    if(s){const t=String(n),h=!n;
      if(s.textContent!==t)s.textContent=t;
      if(s.hidden!==h)s.hidden=h;}}}
window.__admSums=sums;
(function(){if(!H2P[PAGE.tab])return;const q=new URLSearchParams(location.search);let tab=PAGE.tab,sub=PAGE.sub;
  if(!sub){if(tab==='library'&&q.get('view'))sub=q.get('view');
    else if(tab==='settings'&&q.get('view'))sub=q.get('view');
    else if(q.get('tab'))sub=q.get('tab');}
  if(tab==='retro'&&(q.get('view')||q.get('tab')==='folder'))window.__admRetro=q.get('tab')==='folder'?'folder':q.get('view');
  if(tab==='logs'&&PAGE.sub)window.__admLogs=PAGE.sub;
  const h=location.hash.slice(1).split('/');
  if(h[0]&&H2P[h[0]]){tab=h[0];sub=h[1]||sub;history.replaceState(null,'',location.pathname+(location.search||''));}
  else{history.replaceState(null,'',location.pathname+location.search);}
  location.hash='#'+tab+(sub?'/'+sub:'');})();
addEventListener('hashchange',()=>{const parts=location.hash.slice(1).split('/'),t=parts[0],to=pathForHash(parts);
  // A "#tab" link for another page relabels the history entry the hash itself
  // just made, so back returns to where the visitor was, without a phantom stop.
  if(to!==location.pathname&&(TAB_OF[location.pathname]!==t||t==='settings'||t==='logs')){location.replace(to+(location.search||'')+location.hash);return;}
  mark();if(PAGE.anchor)scrollAnchor();});
function scrollAnchor(){const b=document.getElementById(PAGE.anchor);if(b){if(b.tagName==='DETAILS')b.open=true;b.scrollIntoView({block:'start'});}}
// A hash set is a fragment navigation, which fires popstate too: never answer
// those by rewriting the hash (that fights every "#tab" link). A traversal
// between relabelled entries can arrive without its hashchange, so the section
// is re-shown here from the address; showTab is the page's own global.
addEventListener('popstate',()=>{if(typeof showTab==='function')showTab();mark();if(PAGE.anchor)scrollAnchor();});
const side=document.querySelector('.adm-side');
if(side)new MutationObserver(sums).observe(side,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
// The phone drawer: the same tree, opened from the header, closed by its own button.
const drawer=document.getElementById('adm-drawer'),menu=document.getElementById('adm-menu');
if(menu&&drawer){const open=()=>{drawer.showModal();menu.setAttribute('aria-expanded','true');};
  menu.addEventListener('click',open);
  drawer.addEventListener('close',()=>menu.setAttribute('aria-expanded','false'));
  document.getElementById('adm-drawer-close').addEventListener('click',()=>drawer.close());
  drawer.addEventListener('click',(e)=>{if(e.target.closest('a'))drawer.close();});}
if(PAGE.anchor)setTimeout(scrollAnchor,300);
mark();sums();
// A tab switched inside the page changes the last crumb; the header is outside main, so this never feeds itself.
const mainEl=document.querySelector('main');let crumbQueued=false;
if(mainEl)new MutationObserver(()=>{if(crumbQueued)return;crumbQueued=true;queueMicrotask(()=>{crumbQueued=false;crumb();});})
  .observe(mainEl,{subtree:true,attributes:true,attributeFilter:['aria-selected','hidden','aria-current']});
})();`;
}
