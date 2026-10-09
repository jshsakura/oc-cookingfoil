import { $, t, el, button, image, badges, card, empty, toast, translate, setLanguage, language, slider } from "./widgets.js";
import { groupCatalog, selectCatalog, versionLabel } from "./catalog.js";
import { initDetail, openDetail, closeDetail } from "./detail.js";
import { initTransfers, addDownloads, renderDownloads, queueCount, setAvailableFiles, refreshUploads } from "./transfers.js";
let groups = [], files = [], health = null, loaded = false, loading = false;
let etag = "", view = "home", page = 1, filter = "all", query = "", sort = "recent";
const perPage = 24;
function navigate(next, focus = true) {
  closeDetail();
  view = ["home", "search", "library", "updates", "downloads", "settings"].includes(next) ? next : "home";
  for (const name of ["home", "library", "updates", "downloads", "settings"]) $(name + "-screen").hidden = !(name === view || (view === "search" && name === "library"));
  document.querySelectorAll(".nav-item").forEach((node) => {
    const active = node.dataset.view === view; node.classList.toggle("active", active);
    if (active) node.setAttribute("aria-current", "page"); else node.removeAttribute("aria-current");
  });
  history.replaceState(null, "", "#" + view);
  renderCurrent();
  if (focus) {
    if (view === "search") $("search").focus();
    else { const h = document.querySelector(".screen:not([hidden]) h1"); if (h) { h.tabIndex = -1; h.focus({ preventScroll:true }); } }
    window.scrollTo(0, 0);
  }
}
function renderCurrent() {
  updateCounts();
  if (!loaded && view !== "settings" && view !== "downloads") return;
  if (view === "home") renderHome();
  if (view === "library" || view === "search") renderLibrary();
  if (view === "updates") renderUpdates();
  if (view === "downloads") renderDownloads();
  if (view === "settings") renderSettings();
}
function updateCounts() {
  const updates = groups.filter((g) => g.update || g.dlc.length).length;
  for (const [id, count] of [["updates-count", updates], ["downloads-count", queueCount()]]) {
    $(id).hidden = !count; $(id).textContent = count;
  }
  $("connection-status").textContent = loaded ? groups.length.toLocaleString() + " " + t("games") : t("connecting");
  $("connection-dot").classList.toggle("ready", loaded);
}
function renderHome() {
  const box = $("home-content"); box.replaceChildren(); box.setAttribute("aria-busy", "false");
  if (!groups.length) { empty(box, "noGames"); return; }
  const sorted = selectCatalog(groups, { sort: "recent" });
  const featured = sorted.find((g) => g.base) || sorted[0];
  const hero = button("", () => openDetail(featured), "hero");
  hero.setAttribute("aria-label", featured.name);
  hero.append(image(featured.icon, "hero-bg"), image(featured.icon));
  const copy = el("div", "hero-copy");
  copy.append(el("span", "eyebrow", t(featured.addedAt ? "newGame" : "featured")), el("h1", "", featured.name), el("p", "", featured.publisher));
  const tags = badges(featured); if (featured.languages.includes("ko")) tags.prepend(el("span", "pill", t("korean")));
  copy.append(tags); hero.append(copy); box.append(hero);
  const recent = sorted.filter((g) => g.addedAt > 0 && g.id !== featured.id);
  const korean = sorted.filter((g) => g.languages.includes("ko"));
  if (recent.length) box.append(homeRow("recent", recent));
  if (korean.length) box.append(homeRow("korean", korean));
  // Older servers omit both metadata fields. Keep useful browsing available.
  if (!recent.length && !korean.length) box.append(homeRow("library", sorted));
}
function homeRow(title, list) {
  const section = el("section", "home-row"); const head = el("div", "section-head");
  const row = el("div", "row-grid");
  head.append(el("h2", "", t(title)));
  head.append(button(t("seeAll"), () => {
    filter = title === "korean" ? "ko" : "all"; sort = title === "recent" ? "recent" : "name"; page = 1;
    $("sort").value = sort; navigate("library");
  }, "text-button"));
  list.slice(0, 24).forEach((g) => row.append(card(g, openDetail)));
  section.append(head, slider(row)); return section;
}
function renderLibrary() {
  const list = selectCatalog(groups, { query, filter, sort });
  const pages = Math.max(1, Math.ceil(list.length / perPage)); page = Math.min(page, pages);
  const grid = $("games"); grid.replaceChildren(); grid.setAttribute("aria-busy", "false");
  $("games-count").textContent = list.length.toLocaleString() + " " + t("games");
  document.querySelectorAll("[data-filter]").forEach((b) => { b.classList.toggle("active", b.dataset.filter === filter); b.setAttribute("aria-pressed", String(b.dataset.filter === filter)); });
  if (!list.length) empty(grid, "noResults");
  else list.slice((page - 1) * perPage, page * perPage).forEach((g) => grid.append(card(g, openDetail)));
  const pager = $("pager"); pager.replaceChildren();
  if (pages <= 1) return;
  const pick = (n) => { page = n; renderLibrary(); $("library-screen").scrollIntoView(); const first = $("games").querySelector("button"); first?.focus({ preventScroll:true }); };
  const prev = button(t("previous"), () => pick(page - 1)); prev.disabled = page <= 1;
  const next = button(t("next"), () => pick(page + 1)); next.disabled = page >= pages;
  pager.append(prev, el("span", "", page + " / " + pages), next);
}
function renderUpdates() {
  const list = groups.filter((g) => g.update || g.dlc.length);
  const box = $("update-list"); box.replaceChildren();
  $("updates-summary").textContent = list.length + " " + t("games");
  $("queue-updates").disabled = !list.length;
  if (!list.length) empty(box, "noUpdates");
  for (const g of list) {
    const row = el("article", "update-row"); row.append(image(g.icon));
    const copy = el("div", "row-copy");
    copy.append(el("h3", "", g.name), el("p", "muted", g.update ? versionLabel(g.update) + " · " + t("latest") : "DLC " + g.dlc.length), badges(g));
    const actions = el("div", "row-actions");
    actions.append(button(t("select"), () => openDetail(g)), button(t("queue"), () => addDownloads(g, [g.update, ...g.dlc].filter(Boolean)), "button"));
    row.append(copy, actions); box.append(row);
  }
}
function renderSettings() {
  const box = $("server-stats"); box.replaceChildren();
  for (const [key, value] of [["games", groups.length], ["files", files.length], ["update", files.filter((f) => f.app_type === "update").length], ["withDlc", files.filter((f) => f.app_type === "dlc").length]]) {
    const stat = el("div", "setting-row"); const label = el("div", "", t(key)); label.append(el("strong", "", value.toLocaleString())); stat.append(label); box.append(stat);
  }
  $("metadata-status").textContent = t("metadata") + ": " + (health?.titledb?.titles ?? t("unknown"));
}
async function loadCatalog() {
  if (loading) return;
  loading = true;
  try {
    const headers = etag ? { "If-None-Match": etag } : {};
    const response = await fetch("/api/shop/sections", { headers, signal: AbortSignal.timeout(60000) });
    if (response.status !== 304) {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.sections)) throw new Error();
      files = data.sections.flatMap((s) => Array.isArray(s.items) ? s.items : []);
      groups = groupCatalog(files); etag = response.headers.get("etag") || "";
    }
    loaded = true; setAvailableFiles(groups); renderCurrent();
  } catch {
    $("connection-status").textContent = t("retry");
    if (!loaded) { empty($("home-content"), "loadFailed"); empty($("games"), "loadFailed"); }
    toast(t("loadFailed"));
  } finally { loading = false; }
}
async function loadInfo() {
  try { const r = await fetch("/healthz"); if (r.ok) { health = await r.json(); renderSettings(); } } catch { /* Catalog browsing remains available. */ }
  try { const r = await fetch("/api/connect-url"); if (r.ok) { const d = await r.json(); $("shop-url").textContent = d.url || location.origin + "/shop.tfl"; } } catch { /* Use the current origin. */ }
}
function connectLive() {
  let retry = 1000;
  const connect = () => {
    const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/library");
    let timer;
    socket.addEventListener("open", () => { retry = 1000; });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.version) $("version").textContent = "v" + message.version;
        if (message.type === "shop-updated") { clearTimeout(timer); timer = setTimeout(loadCatalog, 300); }
        if (message.type === "ping") socket.send(JSON.stringify({ type:"pong" }));
      } catch { /* Ignore malformed events. */ }
    });
    socket.addEventListener("close", () => { setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); });
  };
  connect();
}
initDetail(() => navigate("downloads"));
initTransfers((reload) => { updateCounts(); if (reload) setTimeout(loadCatalog, 800); });
translate();
$("shop-url").textContent = location.origin + "/shop.tfl";
document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.view)));
document.querySelector(".brand").addEventListener("click", (e) => { e.preventDefault(); navigate("home"); });
$("search").addEventListener("input", () => { query = $("search").value.trim(); page = 1; renderLibrary(); });
$("filters").addEventListener("click", (e) => { const b = e.target.closest("[data-filter]"); if (!b) return; filter = b.dataset.filter; page = 1; renderLibrary(); });
$("sort").addEventListener("change", () => { sort = $("sort").value; page = 1; renderLibrary(); });
$("queue-updates").addEventListener("click", () => { for (const g of groups.filter((g) => g.update || g.dlc.length)) addDownloads(g, [g.update, ...g.dlc].filter(Boolean), true); toast(t("added")); navigate("downloads"); });
$("refresh").addEventListener("click", async () => { $("refresh").disabled = true; await Promise.all([loadCatalog(), loadInfo(), refreshUploads()]); $("refresh").disabled = false; });
$("copy-url").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("shop-url").textContent); toast(t("copied")); }
  catch { const range = document.createRange(); range.selectNodeContents($("shop-url")); getSelection().removeAllRanges(); getSelection().addRange(range); toast(t("copyFailed")); }
});
document.querySelector(".lang-toggle").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-lang]"); if (!b) return;
  setLanguage(b.dataset.lang); translate(); renderCurrent(); refreshUploads();
});
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) || !$("detail").hidden) return;
  if (e.key === "/") { e.preventDefault(); navigate("search"); }
  if (e.key === "Escape" && view !== "home") navigate("home");
});
window.addEventListener("hashchange", () => navigate(location.hash.slice(1), false));
navigate(location.hash.slice(1) || "home", false);
Promise.all([loadCatalog(), loadInfo(), refreshUploads()]);
connectLive();
// Keep the current language stable when translated views are re-rendered.
document.documentElement.lang = language();
