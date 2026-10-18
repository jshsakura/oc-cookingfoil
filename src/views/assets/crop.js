/* global window, document */
// The artwork editor's crop view: a picture with a box the admin drags and
// resizes (mouse, touch or arrow keys), held to the slot's shape.
//   cfCrop({ host, src, aspect, crop, labels }) → Promise<{ x, y, w, h } | null>
// The area is a fraction 0..1 of the picture as shown (upright), which is what
// the server cuts. null means the admin cancelled. Styles live with the page (.crop*).
(() => {
  "use strict";
  const MIN_PX = 28; // the smallest box, in screen pixels
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const el = (tag, cls, attrs = {}) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, attrs);

  window.cfCrop = function cfCrop({ host, src, aspect, crop = null, labels = {} }) {
    return new Promise((resolve) => {
      const view = el("div", "crop", { tabIndex: -1 });
      view.setAttribute("role", "group");
      view.setAttribute("aria-label", labels.title || "Crop");
      const head = el("div", "crop-head");
      head.append(el("h4", "", { textContent: labels.title || "" }), el("span", "", { textContent: labels.hint || "" }));
      const stage = el("div", "crop-stage");
      const img = el("img", "", { alt: "", draggable: false });
      const box = el("div", "crop-box", { tabIndex: 0 });
      box.setAttribute("role", "slider");
      box.setAttribute("aria-label", labels.box || labels.title || "Crop");
      for (const c of ["nw", "ne", "sw", "se"]) box.append(el("span", "crop-h " + c, { ariaHidden: "true" }));
      stage.append(img, box);
      const actions = el("div", "crop-actions");
      const cancel = el("button", "btn ghost", { type: "button", textContent: labels.cancel || "Cancel" });
      const apply = el("button", "btn", { type: "button", textContent: labels.apply || "Apply", disabled: true });
      actions.append(cancel, apply);
      view.append(head, stage, actions);
      host.append(view);

      // The box as fractions of the picture; drawn in percentages, so it follows any resize.
      let r = null, W = 1, H = 1;
      const draw = () => {
        Object.assign(box.style, { left: r.x * 100 + "%", top: r.y * 100 + "%", width: r.w * 100 + "%", height: r.h * 100 + "%" });
        box.setAttribute("aria-valuetext", `${Math.round(r.x * 100)}%, ${Math.round(r.y * 100)}%, ${Math.round(r.w * 100)}%`);
      };
      // h as a fraction from w as a fraction, so the box keeps the slot's shape in pixels.
      const hOf = (w) => (w * W) / (H * aspect);
      const fit = () => {
        let w = 1, h = hOf(1);
        if (h > 1) { h = 1; w = (H * aspect) / W; }
        return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
      };
      img.addEventListener("load", () => {
        W = img.naturalWidth || 1; H = img.naturalHeight || 1;
        // A saved area is shown as it was, nudged back to the slot's shape and inside the picture.
        if (crop && crop.w > 0) {
          const w = Math.min(crop.w, 1, (H * aspect) / W), h = hOf(w);
          r = { x: clamp(crop.x, 0, 1 - w), y: clamp(crop.y, 0, 1 - h), w, h };
        } else r = fit();
        draw();
        apply.disabled = false;
        view.classList.add("ready");
        view.scrollIntoView({ block: "nearest" });
        box.focus({ preventScroll: true });
      });
      img.addEventListener("error", () => finish(null));
      img.src = src;

      let drag = null;
      const size = () => { const b = stage.getBoundingClientRect(); return { dw: b.width || 1, dh: b.height || 1, left: b.left, top: b.top }; };
      box.addEventListener("pointerdown", (e) => {
        if (!r || e.button > 0) return;
        e.preventDefault();
        const s = size();
        const corner = e.target.classList.contains("crop-h") ? [...e.target.classList].find((c) => c.length === 2) : null;
        drag = { id: e.pointerId, corner, sx: e.clientX, sy: e.clientY, start: { ...r }, s };
        box.setPointerCapture(e.pointerId);
        view.classList.add("dragging");
      });
      box.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const { dw, dh, left, top } = drag.s, st = drag.start;
        if (!drag.corner) {
          r = { ...st, x: clamp(st.x + (e.clientX - drag.sx) / dw, 0, 1 - st.w), y: clamp(st.y + (e.clientY - drag.sy) / dh, 0, 1 - st.h) };
        } else {
          // The opposite corner stays put; the box grows toward the pointer, in shape and inside the picture.
          const east = drag.corner[1] === "e", south = drag.corner[0] === "s";
          const ax = (east ? st.x : st.x + st.w) * dw, ay = (south ? st.y : st.y + st.h) * dh;
          const px = e.clientX - left, py = e.clientY - top;
          const ratio = dw / dh / (W / H) * aspect; // box width / height on screen
          const room = Math.min(east ? dw - ax : ax, (south ? dh - ay : ay) * ratio);
          const minW = Math.min(room, Math.max(MIN_PX, MIN_PX * ratio));
          const w = clamp(Math.max(east ? px - ax : ax - px, (south ? py - ay : ay - py) * ratio), minW, room);
          const h = w / ratio;
          r = { x: (east ? ax : ax - w) / dw, y: (south ? ay : ay - h) / dh, w: w / dw, h: h / dh };
        }
        draw();
      });
      const end = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        view.classList.remove("dragging");
      };
      box.addEventListener("pointerup", end);
      box.addEventListener("pointercancel", end);

      // Arrows move the box, Shift + arrows by more; + and - change its size around its middle.
      box.addEventListener("keydown", (e) => {
        if (!r) return;
        const step = e.shiftKey ? 0.1 : 0.01;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
          const [dx, dy] = moves[e.key];
          r = { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) };
        } else if (e.key === "+" || e.key === "=" || e.key === "-") {
          const max = Math.min(1, (H * aspect) / W);
          const w = clamp(r.w * (e.key === "-" ? 0.95 : 1.05), Math.min(max, MIN_PX / size().dw), max), h = hOf(w);
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          r = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
        } else return;
        e.preventDefault();
        draw();
      });
      view.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
        else if (e.key === "Enter" && e.target === box) { e.preventDefault(); finish(r); }
      });

      function finish(result) {
        view.remove();
        const round = (n) => Math.round(n * 1e6) / 1e6;
        resolve(result ? { x: round(result.x), y: round(result.y), w: round(result.w), h: round(result.h) } : null);
      }
      cancel.addEventListener("click", () => finish(null));
      apply.addEventListener("click", () => finish(r));
    });
  };
})();
