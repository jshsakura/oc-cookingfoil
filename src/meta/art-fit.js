/**
 * The shape each art slot is cut to and the area of a picture that has it, as the page's crop
 * editor draws them (views/assets/crop.js, ART_ASPECT in views/landing.html), so an area chosen
 * without the editor comes out the same as one chosen with it.
 */

export const ART_ASPECT = Object.freeze({ icon: 1, banner: 16 / 9, screenshot: 16 / 9 });

const round = (n) => Math.round(n * 1e6) / 1e6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The area of a W x H picture in the slot's shape, as fractions 0..1. Without `crop` the largest
 * such area, centered. With one, its width (and place) kept as far as the shape allows, as the
 * editor nudges a saved area back into shape.
 */
export function fitCrop(W, H, aspect, crop = null) {
  const hOf = (w) => (w * W) / (H * aspect);
  let w;
  let h;
  if (crop && crop.w > 0) {
    w = Math.min(crop.w, 1, (H * aspect) / W);
    h = hOf(w);
  } else {
    w = 1;
    h = hOf(1);
    if (h > 1) { h = 1; w = (H * aspect) / W; }
  }
  const x = crop && crop.w > 0 ? clamp(crop.x, 0, 1 - w) : (1 - w) / 2;
  const y = crop && crop.w > 0 ? clamp(crop.y, 0, 1 - h) : (1 - h) / 2;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}
