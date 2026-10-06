import { $, t, el, button, toast, readSaved, save, empty } from "./widgets.js";
import { bytes, safeUrl } from "./catalog.js";
const queueKey = "cookingfoil:web-downloads:v1";
let queue = readSaved(queueKey, []);
if (!Array.isArray(queue)) queue = [];
queue = queue.filter((q) => q && safeUrl(q.file?.url) && typeof q.name === "string").slice(0, 500);
let currentFiles = new Set();
let change = () => {};
export function initTransfers(onChange) {
  change = onChange;
  $("file-input").addEventListener("change", () => {
    const file = $("file-input").files[0]; $("file-input").value = ""; if (file) uploadFile(file);
  });
  const zone = $("drop-zone");
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("drag"); const file = e.dataTransfer?.files[0]; if (file) uploadFile(file); });
}
export function setAvailableFiles(groups) { currentFiles = new Set(groups.flatMap((g) => g.files.map((f) => f.url))); }
export function addDownloads(group, files, quiet = false) {
  for (const file of files) {
    if (queue.length >= 500) break;
    if (currentFiles.has(file.url) && !queue.some((q) => q.file.url === file.url)) queue.push({ name: group.name, icon: group.icon, file, requested: false });
  }
  persist(); if (!quiet) toast(t("added"));
}
function persist() { save(queueKey, queue); renderDownloads(); change(); }
export const queueCount = () => queue.length;
export function renderDownloads() {
  const box = $("download-list"); box.replaceChildren();
  $("downloads-summary").textContent = queue.length + " · " + bytes(queue.reduce((sum, q) => sum + (q.file.size || 0), 0));
  if (!queue.length) { empty(box, "noQueue"); return; }
  queue.forEach((q, index) => {
    const row = el("article", "download-row");
    const icon = el("img", "cover"); icon.alt = ""; icon.src = safeUrl(q.icon) || "/assets/butter.svg";
    icon.onerror = () => { icon.onerror = null; icon.src = "/assets/butter.svg"; };
    const copy = el("div", "row-copy");
    copy.append(el("h3", "", q.name), el("small", "", (q.file.app_type === "dlc" ? "DLC" : t(q.file.app_type === "update" ? "update" : "base")) + " · " + bytes(q.file.size)), el("p", "muted", t(q.requested ? "requestedState" : "pending")));
    const actions = el("div", "row-actions");
    const up = button("↑", () => { [queue[index - 1], queue[index]] = [queue[index], queue[index - 1]]; persist(); });
    up.disabled = index === 0; up.setAttribute("aria-label", t("moveUp"));
    const down = button("↓", () => { [queue[index + 1], queue[index]] = [queue[index], queue[index + 1]]; persist(); });
    down.disabled = index === queue.length - 1; down.setAttribute("aria-label", t("moveDown"));
    const link = el("a", "button", t("download")); link.href = safeUrl(q.file.url); link.setAttribute("download", ""); link.rel = "noopener";
    link.addEventListener("click", (e) => {
      if (!currentFiles.has(q.file.url)) { e.preventDefault(); toast(t("downloadMissing")); return; }
      q.requested = true; save(queueKey, queue); toast(t("requested"));
      // Preserve the anchor through the browser's default download action.
      setTimeout(renderDownloads, 100);
    });
    actions.append(up, down, link, button(t("remove"), () => { queue.splice(index, 1); persist(); }));
    row.append(icon, copy, actions); box.append(row);
  });
}
let uploadsEnabled = false;
export const canEditArt = () => uploadsEnabled;
export async function refreshUploads() {
  try {
    const response = await fetch("/api/uploads");
    uploadsEnabled = response.ok;
    $("uploads-panel").hidden = !uploadsEnabled;
    if (!response.ok) return;
    const data = await response.json();
    const box = $("upload-list"); box.replaceChildren();
    if (!data.uploads?.length) { empty(box, "uploadEmpty"); return; }
    for (const u of data.uploads) {
      const row = el("div", "upload-row");
      const copy = el("div", "name", u.name); copy.append(el("small", "", " · " + bytes(u.size)));
      const actions = el("div", "actions");
      const request = async (method, suffix, message) => {
        try {
          const response = await fetch("/api/uploads/" + encodeURIComponent(u.id) + suffix, { method });
          if (!response.ok) throw new Error();
          toast(t(message)); await refreshUploads(); change(true);
        } catch { toast(t("failed")); }
      };
      actions.append(button(t("apply"), () => request("POST", "/apply", "applied"), "primary"), button(t("delete"), () => request("DELETE", "", "deleted")));
      row.append(copy, actions); box.append(row);
    }
  } catch { $("uploads-panel").hidden = true; }
}
function uploadFile(file) {
  if (!uploadsEnabled) return;
  const progress = $("upload-progress"); progress.hidden = false;
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/uploads");
  xhr.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) {
      const pct = Math.round(event.loaded / event.total * 100);
      $("upload-bar").style.width = pct + "%"; progress.setAttribute("aria-valuenow", String(pct));
    }
  });
  xhr.addEventListener("load", () => { progress.hidden = true; if (xhr.status >= 200 && xhr.status < 300) refreshUploads(); else toast(t("uploadFailed")); });
  xhr.addEventListener("error", () => { progress.hidden = true; toast(t("uploadFailed")); });
  const body = new FormData(); body.append("file", file); xhr.send(body);
}
