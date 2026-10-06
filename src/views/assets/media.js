import { el, button, t } from "./widgets.js";
import { safeUrl } from "./catalog.js";
let viewer = null;
export function closeMedia() {
  if (viewer) { viewer.close(); viewer.remove(); viewer = null; }
  document.querySelectorAll(".trailer-player").forEach((node) => node.remove());
  document.querySelectorAll(".trailer-launch").forEach((node) => { node.hidden = false; });
}
export function screenshotButton(url, index, urls) {
  const node = button("", () => showScreenshots(urls, index));
  const img = el("img"); img.alt = t("screens") + " " + (index + 1);
  img.loading = "lazy"; img.src = url;
  node.append(img);
  return node;
}
function showScreenshots(urls, initial) {
  closeMedia();
  const focus = document.activeElement;
  const dialog = el("dialog", "media-viewer");
  dialog.setAttribute("aria-label", t("screens"));
  const header = el("div", "media-heading"), count = el("strong");
  const image = el("img", "media-image");
  const close = button(t("back"), () => dialog.close(), "button secondary");
  header.append(count, close);
  const controls = el("div", "media-controls");
  const previous = button(t("previous"), () => change(-1), "button secondary");
  const next = button(t("next"), () => change(1), "button secondary");
  previous.disabled = next.disabled = urls.length < 2;
  controls.append(previous, next);
  dialog.append(header, image, controls);
  let index = initial;
  function paint() { image.src = urls[index]; image.alt = t("screens") + " " + (index + 1); count.textContent = (index + 1) + " / " + urls.length; }
  function change(amount) { index = (index + amount + urls.length) % urls.length; paint(); }
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); change(event.key === "ArrowLeft" ? -1 : 1); }
    if (event.key === "Tab") {
      const nodes = [close, previous, next].filter((node) => !node.disabled);
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
    }
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (viewer === dialog) { viewer = null; focus?.focus(); }
  });
  document.body.append(dialog); viewer = dialog; paint(); dialog.showModal(); close.focus();
}
export function renderVideos(container, videos) {
  const valid = (Array.isArray(videos) ? videos : []).slice(0, 8).filter((v) =>
    (v.type === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(v.id)) || (v.type === "video" && safeUrl(v.url)));
  if (!valid.length) return;
  container.append(el("h2", "trailer-title", t("trailers")));
  for (const video of valid) {
    const frame = el("div", "trailer-frame");
    const launch = button("▶  " + (video.title || t("playTrailer")), () => {
      closeMedia(); launch.hidden = true;
      let player;
      if (video.type === "youtube") {
        player = el("iframe", "trailer-player");
        player.title = video.title || t("playTrailer");
        player.referrerPolicy = "strict-origin-when-cross-origin";
        player.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
        player.allowFullscreen = true;
        player.src = "https://www.youtube-nocookie.com/embed/" + video.id + "?autoplay=1&origin=" + encodeURIComponent(location.origin);
      } else {
        player = el("video", "trailer-player"); player.controls = true;
        player.preload = "metadata"; player.src = video.url;
      }
      frame.append(player);
      if (video.type === "video") player.play().catch(() => {});
    }, "trailer-launch");
    frame.append(launch); container.append(frame);
  }
}
