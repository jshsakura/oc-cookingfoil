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

/** A page: the section (tab) it opens, the sub-view inside it when there is one, and its sidebar icon. */
export const ADMIN_PAGES = [
  { path: "/admin", tab: "overview", label: "m.overview", icon: "home" },
  // games group
  { path: "/admin/games", tab: "library", label: "m.library", group: "games", icon: "folder" },
  { path: "/admin/upload", tab: "upload", label: "m.upload", group: "games", icon: "upload" },
  { path: "/admin/convert", tab: "nsz", label: "m.nsz", group: "games", icon: "shrink" },
  { path: "/admin/inbox", tab: "inbox", label: "m.inbox", group: "games", icon: "inbox", count: "inbox-count" },
  { path: "/admin/featured", tab: "featured", label: "m.featured", group: "games", icon: "star" },
  { path: "/admin/trash", tab: "trash", label: "m.trash", group: "games", icon: "trash" },
  // retro: the eight jobs are items of their own, not a hidden tab row
  {
    path: "/admin/retro", tab: "retro", group: "retro", tasks: [
      { view: "art", label: "rt.art", icon: "image" }, { view: "ratings", label: "rt.ratings", icon: "thumbs-up" },
      { view: "cores", label: "rt.cores", icon: "monitor" }, { view: "names", label: "rt.names", icon: "tag" },
      { view: "patch", label: "rt.patch", icon: "globe" }, { view: "dups", label: "rt.dups", icon: "copy" },
      { view: "sets", label: "rt.sets", icon: "layers" }, { view: "trash", label: "rt.rtrash", icon: "trash" },
    ],
  },
  { path: "/admin/homebrew", tab: "homebrew", group: "homebrew", param: "tab", tasks: [
    { view: "apps", label: "ht.apps", icon: "grid" }, { view: "reco", label: "ht.reco", icon: "sparkle" }, { view: "sources", label: "ht.sources", icon: "globe" },
  ] },
  // people
  { path: "/admin/users", tab: "users", label: "s.users", group: "people", icon: "users", count: "account-count" },
  { path: "/admin/devices", tab: "devices", label: "s.devices", group: "people", icon: "device", count: "pending-count" },
  // records and operations
  { path: "/admin/logs/downloads", tab: "logs", sub: "xfer", label: "m.xfer", group: "ops", icon: "download" },
  { path: "/admin/logs/clients", tab: "logs", sub: "client", label: "m.clients", group: "ops", icon: "device" },
  { path: "/admin/logs/security", tab: "logs", sub: "deny", label: "m.deny", group: "ops", icon: "lock", count: "lock-count" },
  { path: "/admin/client", tab: "overview", label: "m.client", anchor: "client-release", icon: "download" },
  // settings
  { path: "/admin/settings/server", tab: "settings", sub: "server", label: "m.setServer", group: "set", icon: "sliders" },
  { path: "/admin/settings/integrations", tab: "settings", sub: "integrations", label: "m.setIntegrations", group: "set", icon: "package" },
  // login and admin security still share the old "security" area until Stage B splits it.
  { path: "/admin/settings/login", tab: "settings", sub: "security", label: "m.setLogin", group: "set", icon: "login", shared: true },
  { path: "/admin/settings/admin", tab: "settings", sub: "security", label: "m.setAdmin", group: "set", icon: "lock", shared: true },
  { path: "/admin/settings/automation", tab: "settings", sub: "tokens", label: "m.setAuto", group: "set", icon: "key" },
  { path: "/admin/settings/plugins", tab: "settings", sub: "plugins", label: "m.setPlugins", group: "set", icon: "puzzle" },
  { path: "/admin/settings/notifications", tab: "alerts", label: "m.alerts", group: "set", icon: "bell" },
];

export const ADMIN_PAGE_BY_PATH = new Map(ADMIN_PAGES.map((p) => [p.path, p]));

const GROUPS = {
  games: { label: "m.grpGames", sum: "games", icon: "grid" },
  retro: { label: "m.retro", icon: "joystick" },
  homebrew: { label: "g.homebrew", icon: "package" },
  people: { label: "m.people", sum: "people", icon: "users" },
  ops: { label: "m.grpOps", sum: "ops", icon: "log" },
  set: { label: "m.grpSet", icon: "sliders" },
};

/** The page a legacy "#tab" hash belongs to, so old links land on real paths. */
export const PATH_FOR_TAB = {
  overview: "/admin", users: "/admin/users", devices: "/admin/devices", settings: "/admin/settings/server",
  alerts: "/admin/settings/notifications", logs: "/admin/logs/downloads", featured: "/admin/featured",
  library: "/admin/games", nsz: "/admin/convert", upload: "/admin/upload", inbox: "/admin/inbox",
  homebrew: "/admin/homebrew", retro: "/admin/retro", trash: "/admin/trash",
};

const item = (page, current, withIds) => {
  const on = current?.path === page.path;
  const count = page.count
    ? `<span class="count"${withIds ? ` id="${page.count}"` : ` data-count-id="${page.count}"`} hidden></span>`
    : "";
  return `<a class="adm-item" href="${page.path}"${on ? ' aria-current="page"' : ""}>${page.icon ? icon(page.icon) : ""}${top(page.label)}${count}</a>`;
};

const taskItem = (page, task, current) => {
  const href = `${page.path}?${page.param === "tab" ? "tab" : "view"}=${task.view}`;
  const on = current?.path === page.path && (current?.view || page.tasks[0].view) === task.view;
  return `<a class="adm-item adm-task" href="${href}"${on ? ' aria-current="page"' : ""}>${task.icon ? icon(task.icon) : ""}${top(task.label)}</a>`;
};

/**
 * The sidebar tree. One list per group; the current group is the open one, and
 * the current item carries aria-current. Rendered once for the desktop aside
 * (withIds, the count spans the panels fill by id) and once for the phone
 * drawer (mirrors, so the ids stay unique in the document).
 */
export function sidebarNav(current, withIds = true) {
  const rows = [];
  const grouped = new Map(Object.keys(GROUPS).map((g) => [g, []]));
  for (const page of ADMIN_PAGES) {
    if (!page.group) rows.push(item(page, current, withIds));
    else grouped.get(page.group).push(page);
  }
  for (const [key, pages] of grouped) {
    if (!pages.length) continue;
    const g = GROUPS[key];
    const open = pages.some((p) => p.path === current?.path) ? " open" : "";
    const sum = g.sum ? `<span class="count" data-sum="${g.sum}" hidden></span>` : "";
    rows.push(`<details class="adm-grp" data-grp="${key}"${open}><summary>${icon(g.icon)}${top(g.label)}${sum}${CHEV}</summary><div class="adm-grp-in">`);
    for (const page of pages) {
      if (!page.tasks) rows.push(item(page, current, withIds));
      else for (const task of page.tasks) rows.push(taskItem(page, task, current));
    }
    rows.push(`</div></details>`);
  }
  return rows.join("");
}

/** The phone drawer: the same tree inside a dialog, so Esc and the focus trap come free. */
export function drawerHtml(current) {
  return `<dialog id="adm-drawer" class="adm-drawer" data-top-label="nav">
<div class="adm-drawer-hd"><img class="logo brand-motion" src="/assets/cookingfoil.svg" alt="" width="28" height="28"><b>cookingfoil</b>
<button type="button" id="adm-drawer-close" data-top-label="acc.close">✕</button></div>
<nav class="adm-side-in" data-top-label="nav">${sidebarNav(current, false)}</nav></dialog>`;
}

/** The button that opens the drawer; the header shows it below the desktop width. */
export const MENU_BUTTON_HTML = `<button class="icon-btn" id="adm-menu" type="button" aria-haspopup="dialog" aria-expanded="false" data-top-label="m.menu"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>`;

/** The little chevron a group summary carries: it says the group opens. */
const CHEV = `<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

export const ADM_SHELL_CSS = /* css */ `
body.adm-shell{padding:0}
/* width:100% keeps every page the same width: a grid item with auto margins otherwise shrinks to its content. */
.adm-shell>.wrap{width:100%;box-sizing:border-box;max-width:1240px;margin:0 auto;padding:24px 32px 80px;min-width:0}
@media (max-width:899px){.adm-shell>.wrap{padding:18px 16px 72px}}
/* One frame: the brand, upload, language and account live in the sidebar, so a page starts at its own title.
   On a phone the same block is a top bar and the menu opens in the drawer. */
.adm-side{position:sticky;top:0;z-index:40;box-sizing:border-box;background:var(--bg)}
.adm-side>.adm-hdr{margin:0}
#adm-menu{display:none}
@media (max-width:899px){
.adm-side{padding:8px 16px;border-bottom:1px solid var(--line)}
.adm-side>.adm-side-in{display:none}
#adm-menu{display:inline-flex;order:-1}
.adm-side>.adm-hdr{flex-wrap:nowrap;gap:8px}
.adm-side .hdr-right{display:contents}
.adm-side .up-entry{margin-left:auto}
.adm-side .brand .wm{font-size:20px}.adm-side .brand img{width:32px;height:32px}}
@media (max-width:479px){.adm-side .brand .wm{display:none}}
/* The account menu spans the phone's width under the bar, inside the same gutter the page keeps. */
@media (max-width:640px){.adm-side .activity-account>.pop-list{left:12px;right:12px;width:auto}}
/* Desktop: the sidebar is its own pane, cut from the page by its colour like the console client.
   The brand sits on top, the menu fills the middle, upload, language and account stay at the bottom. */
@media (min-width:900px){
body.adm-shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}
.adm-side{display:flex;flex-direction:column;align-self:start;height:100vh;padding:0;background:var(--panel);border-right:1px solid var(--line)}
.adm-side>.adm-hdr{display:contents}
.adm-side .brand{order:0;padding:26px 24px 18px}
.adm-side .brand a{gap:10px}.adm-side .brand img{width:36px;height:36px}.adm-side .brand .wm{font-size:25px}
.adm-side>.adm-side-in{order:1;display:grid;align-content:start;gap:2px;flex:1;min-height:0;overflow:auto;padding:4px 14px 20px}
.adm-side .hdr-right{order:2;position:relative;display:flex;align-items:center;gap:8px;padding:14px 16px 18px;background:var(--sunk)}
.adm-side .up-entry{flex:1;min-width:0}
/* The menus open upward and toward the page, never off the sidebar's edges. */
.adm-side .acct-menu{position:static}
.adm-side :is(.pop-list,.lang-list){left:12px;right:auto;top:auto;bottom:calc(100% + 6px)}}
.adm-grp{border:0}
.adm-grp summary{display:flex;align-items:center;gap:12px;list-style:none;cursor:pointer;padding:10px 12px;border-radius:12px;
  color:var(--text);font-weight:700;font-size:14.5px}
/* Icons on the top rows, as in the console client's menu; the rows inside a group line up with the label. */
.adm-side-in .ico{width:20px;height:20px}
.adm-grp summary::-webkit-details-marker{display:none}
.adm-grp summary:hover{background:var(--sunk)}
.adm-grp summary:focus-visible{outline:2px solid var(--text);outline-offset:2px}
.adm-grp summary .chev{width:14px;height:14px;margin-left:auto;flex:none;fill:none;stroke:currentColor;stroke-width:2;
  stroke-linecap:round;stroke-linejoin:round;color:var(--muted);transition:transform .15s}
.adm-grp[open] summary .chev{transform:rotate(180deg)}
.adm-item:focus-visible{outline:2px solid var(--text);outline-offset:-2px}
.adm-grp summary .count{margin-left:auto}
.adm-grp-in{display:grid;gap:2px;margin:0 0 8px;padding-left:20px}
.adm-grp-in .ico{width:17px;height:17px}
.adm-item{display:flex;align-items:center;gap:12px;min-width:0;padding:9px 12px;border-radius:12px;position:relative;
  color:var(--text);font-weight:600;font-size:13.5px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.adm-item:hover{background:var(--sunk)}
.adm-side-in>.adm-item{font-size:14.5px;font-weight:700}
.adm-item[aria-current="page"]{background:var(--text);color:var(--bg)}
.adm-item[aria-current="page"] .count{background:var(--bg);color:var(--text)}
.adm-item .count{margin-left:auto}
.adm-task{font-size:12.5px;font-weight:600;color:var(--muted);padding:7px 12px}
.adm-drawer{position:fixed;left:0;top:0;width:min(320px,86vw);height:100vh;max-height:100vh;margin:0;border:0;
  border-right:1px solid var(--line);border-radius:0 20px 20px 0;padding:0;background:var(--bg);color:var(--text)}
.adm-drawer::backdrop{background:rgb(0 0 0 / .38)}
.adm-drawer .adm-side-in{display:grid;gap:2px;align-content:start;grid-auto-rows:min-content;overflow:auto;height:calc(100vh - 58px);padding:10px 12px 24px;box-sizing:border-box}
/* Phone menu rows keep a real touch height without stretching to fill. */
.adm-drawer .adm-item{min-height:44px}
.adm-drawer .adm-grp summary{min-height:44px;box-sizing:border-box}
.adm-drawer-hd{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:1px solid var(--line);font-weight:800}
.adm-drawer-hd b{font-size:16px;letter-spacing:-.01em}
.adm-drawer-hd .logo{display:block}
#adm-drawer-close{margin-left:auto;border:0;background:none;color:var(--muted);font-size:16px;cursor:pointer;width:44px;height:44px;border-radius:10px}
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
  const conf = { path: page.path, tab: page.tab, sub: page.sub ?? "", param: page.param ?? "", anchor: page.anchor ?? "" };
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
const legacy=location.hash.slice(1).split('/');
if(H2P[legacy[0]]&&(legacy[0]!==PAGE.tab||(['settings','logs'].includes(legacy[0])&&legacy[1]&&pathForHash(legacy)!==PAGE.path))){
  location.replace(pathForHash(legacy)+location.search+location.hash);return;}
function activePath(){let p=location.pathname;
  const parts=location.hash.slice(1).split('/');
  if(parts[0]==='settings'){const sub=parts[1];
    if(sub==='integrations')p='/admin/settings/integrations';
    else if(sub==='tokens')p='/admin/settings/automation';
    else if(sub==='plugins')p='/admin/settings/plugins';
    else if(sub==='security')p=(p==='/admin/settings/admin')?p:'/admin/settings/login';}
  return p;}
function mark(){const p=activePath(),q=new URLSearchParams(location.search);
  for(const a of document.querySelectorAll('.adm-item')){const u=new URL(a.href,location.origin);let on=u.pathname===p;
    // A task item (retro ?view, homebrew ?tab) is on only for its own task.
    if(on&&(u.searchParams.has('view')||u.searchParams.has('tab'))){
      const key=u.searchParams.has('tab')?'tab':'view';
      const def=key==='tab'?'apps':'art';
      on=u.searchParams.get(key)===(q.get(key)||def);}
    if(on){a.setAttribute('aria-current','page');const g=a.closest('details.adm-grp');if(g)g.open=true;}
    else a.removeAttribute('aria-current');}}
window.__admMark=mark;
function sums(){
  // The group sums sit inside the observed tree, so every write is made only
  // when the value really changes; an unconditional write would reissue the
  // observer and spin the page.
  for(const g of document.querySelectorAll('.adm-grp')){let n=0;
    for(const c of g.querySelectorAll('.adm-item>.count'))n+=c.hidden?0:(Number(c.textContent)||0);
    const s=g.querySelector('summary .count');
    if(s){const t=String(n),h=!n;
      if(s.textContent!==t)s.textContent=t;
      if(s.hidden!==h)s.hidden=h;}}
  for(const d of document.querySelectorAll('[data-count-id]')){const s=document.getElementById(d.dataset.countId);
    if(s){if(d.textContent!==s.textContent)d.textContent=s.textContent;
      if(d.hidden!==s.hidden)d.hidden=s.hidden;}}}
window.__admSums=sums;
(function(){const q=new URLSearchParams(location.search);let tab=PAGE.tab,sub=PAGE.sub;
  if(!sub){if(tab==='library'&&q.get('view'))sub=q.get('view');
    else if(tab==='settings'&&q.get('view'))sub=q.get('view');
    else if(q.get('tab'))sub=q.get('tab');}
  if(tab==='retro'&&q.get('view'))window.__admRetro=q.get('view');
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
})();`;
}
