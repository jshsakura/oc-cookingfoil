import { $, t, el, button, badges, setImage, toast } from "./widgets.js";
import { bytes, versionLabel, safeUrl } from "./catalog.js";
import { addDownloads, canEditArt } from "./transfers.js";
import { closeMedia, screenshotButton, renderVideos } from "./media.js";
let group = null, returnFocus = null, controller = null, selected = new Set();
let onQueue = () => {};
const cache = new Map();
export function initDetail(queueAction) {
  onQueue = queueAction;
  $("detail-back").addEventListener("click", closeDetail);
  $("detail-add").addEventListener("click", () => {
    if (!group) return;
    addDownloads(group, [group.base, group.update, ...group.dlc].filter((f) => f && selected.has(f.url)));
    closeDetail(); onQueue();
  });
  document.addEventListener("keydown", (event) => {
    if ($("detail").hidden) return;
    if (event.key === "Escape") { event.preventDefault(); closeDetail(); }
    if (event.key === "Tab") {
      const nodes = [...$("detail").querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), summary")].filter((n) => n.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
}
export function closeDetail() {
  if ($("detail").hidden) return;
  closeMedia();
  controller?.abort(); controller = null; group = null;
  $("detail").hidden = true; $("content").inert = false; $("navigation").inert = false;
  document.body.style.overflow = ""; returnFocus?.focus();
}
export async function openDetail(value, force = false) {
  closeMedia();
  controller?.abort(); controller = new AbortController();
  const request = controller;
  const changing = group?.id !== value.id;
  group = value;
  if (changing) {
    returnFocus = document.activeElement;
    selected = new Set([group.base, group.update, ...group.dlc].filter(Boolean).map((f) => f.url));
  }
  $("detail").hidden = false; $("content").inert = true; $("navigation").inert = true;
  document.body.style.overflow = "hidden";
  if (changing) { $("detail").scrollTop = 0; $("detail-back").focus(); }
  $("detail-title").textContent = group.name;
  $("detail-publisher").textContent = group.publisher || t("unknownPublisher");
  setImage($("detail-cover"), group.icon); setImage($("detail-bg"), group.icon);
  $("detail-badges").replaceChildren(...badges(group).children);
  if (group.languages.includes("ko")) $("detail-badges").prepend(el("span", "pill", t("korean")));
  $("detail-description").textContent = t("loading");
  $("detail-meta").replaceChildren(); $("screenshots").replaceChildren(); $("extras").replaceChildren();
  $("art-editor").hidden = true; renderFiles();
  const valid = /^[0-9A-F]{16}$/i.test(group.id);
  if (!valid) { $("detail-description").textContent = t("noDesc"); return; }
  const key = group.id;
  let data = cache.get(key);
  if (force || !data || Date.now() - data.at > 60000) {
    const get = async (path) => {
      try { const r = await fetch(path, { signal: request.signal, cache: force ? "reload" : "default" }); return r.ok ? await r.json() : {}; } catch { return {}; }
    };
    const [detail, art, extras] = await Promise.all([get("/api/title/" + key), get("/api/art/" + key), get("/api/title/" + key + "/extras")]);
    if (request.signal.aborted || group?.id !== key) return;
    data = { detail, art, extras, at: Date.now() }; cache.set(key, data);
  }
  if (request.signal.aborted || group?.id !== key) return;
  paintMetadata(data);
}
function renderFiles() {
  const box = $("detail-files"); box.replaceChildren();
  const files = [group.base, group.update, ...group.dlc].filter(Boolean);
  for (const file of files) {
    const row = el("label", "content-row");
    const check = el("input"); check.type = "checkbox"; check.checked = selected.has(file.url);
    check.disabled = file === group.base;
    const copy = el("div", "content-text");
    copy.append(el("strong", "", file.app_type === "dlc" ? "DLC · " + file.name : t(file.app_type === "update" ? "update" : "base")),
      el("small", "", file.app_type === "dlc" ? t("extra") : versionLabel(file) + (file === group.update ? " · " + t("latest") : "")));
    check.addEventListener("change", () => { if (check.checked) selected.add(file.url); else selected.delete(file.url); updateTotal(); });
    row.append(check, copy, el("span", "size", bytes(file.size))); box.append(row);
  }
  $("alternatives").hidden = !group.alternatives.length;
  const alternatives = $("alternative-list"); alternatives.replaceChildren();
  for (const file of group.alternatives) {
    const link = el("a", "extra-row"); link.href = safeUrl(file.url); link.setAttribute("download", "");
    link.append(el("span", "", file.name), el("span", "", bytes(file.size))); alternatives.append(link);
  }
  updateTotal();
}
function updateTotal() {
  const files = [group.base, group.update, ...group.dlc].filter((f) => f && selected.has(f.url));
  $("detail-total").textContent = bytes(files.reduce((sum, f) => sum + (f.size || 0), 0));
  $("detail-add").disabled = !files.length;
}
function paintMetadata({ detail, art, extras }) {
  $("detail-description").textContent = detail.description || detail.intro || t("noDesc");
  $("detail-publisher").textContent = detail.publisher || group.publisher || t("unknownPublisher");
  if (detail.bannerUrl) setImage($("detail-bg"), detail.bannerUrl);
  const meta = $("detail-meta");
  const format = (group.base?.url || group.files[0].url).split("?")[0].split(".").pop().toUpperCase();
  const values = [["titleId", group.id], ["format", format]];
  if (detail.releaseDate) { const s = String(detail.releaseDate); values.push(["release", s.slice(0,4) + "." + s.slice(4,6) + "." + s.slice(6,8)]); }
  if (detail.numberOfPlayers) values.push(["players", detail.numberOfPlayers]);
  for (const [key, value] of values) { const pair = el("div"); pair.append(el("dt", "", t(key)), el("dd", "", value)); meta.append(pair); }
  const screens = $("screenshots");
  const urls = (detail.screenshots || []).filter(safeUrl);
  urls.forEach((url, index) => screens.append(screenshotButton(url, index, urls)));
  const extrasBox = $("extras");
  renderVideos(extrasBox, detail.videos);
  if (extras.extras?.length) extrasBox.append(el("h2", "", t("extra")));
  for (const file of extras.extras || []) {
    if (!safeUrl(file.url)) continue;
    const link = el("a", "extra-row"); link.href = file.url; link.setAttribute("download", "");
    link.append(el("span", "", file.name), el("span", "", bytes(file.size))); extrasBox.append(link);
  }
  renderArtwork(art);
}
function renderArtwork(art) {
  const box = $("art-editor"); box.replaceChildren(); box.hidden = !canEditArt();
  if (box.hidden) return;
  box.append(el("h2", "", t("artTitle")));
  for (const [kind, exists] of [["icon", art.icon], ["banner", art.banner], ["screenshot", false]]) {
    const row = el("div", "art-row"); row.append(el("strong", "", t(kind === "screenshot" ? "screens" : kind)));
    const input = el("input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/webp"; input.hidden = true;
    input.addEventListener("change", () => { if (input.files[0]) editArt(kind, input.files[0]); input.value = ""; });
    row.append(button(t(exists ? "replace" : "add"), () => input.click()), input);
    if (exists) row.append(button(t("remove"), () => editArt(kind, null), "remove-art"));
    box.append(row);
  }
  for (const index of art.screens || []) box.append(button(t("screens") + " " + (index + 1) + " · " + t("remove"), () => editArt("screenshot/" + index, null), "remove-art"));
}
async function editArt(kind, file) {
  const current = group;
  const body = file ? new FormData() : null;
  if (file) body.append("file", file);
  try {
    const response = await fetch("/api/art/" + current.id + "/" + kind, { method: file ? "POST" : "DELETE", body });
    if (!response.ok) throw new Error();
    cache.delete(current.id); toast(t("saved"));
    if (group?.id === current.id) {
      const updated = { ...current, icon: current.icon + (current.icon.includes("?") ? "&" : "?") + "_art=" + Date.now() };
      await openDetail(updated, true);
    }
  } catch { toast(t("failed")); }
}
