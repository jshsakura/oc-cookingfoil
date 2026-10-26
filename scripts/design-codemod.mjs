// Moves admin CSS onto the design tokens (src/routes/admin/styles.js SCALE): every px font size,
// px corner radius and in-between font weight in src/routes/admin/*.js is rewritten to the nearest
// step. Run it, then `node scripts/design-scan.mjs --lower`. Colours are left alone: each one needs a
// look at what it means.
//
//   node scripts/design-codemod.mjs [--dry]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./design-scan.mjs";

const DIR = path.join(ROOT, "src/routes/admin");

export function fontStep(px) {
  if (px < 11.75) return "--fs-2xs";
  if (px < 12.75) return "--fs-xs";
  if (px < 13.75) return "--fs-sm";
  if (px < 15.5) return "--fs-md";
  if (px < 17.5) return "--fs-lg";
  if (px < 21) return "--fs-xl";
  if (px < 26) return "--fs-2xl";
  return "--fs-3xl";
}

export function radiusStep(px) {
  if (px <= 0) return null;
  if (px <= 5) return "--r-xs";
  if (px <= 8) return "--r-sm";
  if (px <= 11) return "--r-md";
  if (px <= 13) return "--r-lg";
  if (px <= 15) return "--r-xl";
  if (px <= 22) return "--r-2xl";
  return "--r-pill";
}

// The client draws Regular and Bold only: 600 and up is bold, below is regular.
export const weightStep = (w) => (Number(w) >= 600 ? "var(--fw-bold)" : "var(--fw)");

export function rewrite(source) {
  let n = 0;
  const out = source
    .replace(/font-size(\s*):(\s*)([\d.]+)px/g, (_m, a, b, px) => (n++, `font-size${a}:${b}var(${fontStep(Number(px))})`))
    .replace(/(border-(?:[a-z]+-)*radius)(\s*):(\s*)([\d.]+)px/g, (m, prop, a, b, px) => {
      const step = radiusStep(Number(px));
      return step ? (n++, `${prop}${a}:${b}var(${step})`) : m;
    })
    .replace(/font-weight(\s*):(\s*)(500|600|800|900)\b/g, (_m, a, b, w) => (n++, `font-weight${a}:${b}${weightStep(w)}`));
  return { out, n };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const dry = process.argv.includes("--dry");
  let total = 0;
  for (const name of readdirSync(DIR).sort()) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(DIR, name);
    const { out, n } = rewrite(readFileSync(file, "utf-8"));
    if (!n) continue;
    total += n;
    console.log(String(n).padStart(4), name);
    if (!dry) writeFileSync(file, out);
  }
  console.log(String(total).padStart(4), dry ? "would change" : "changed");
}
