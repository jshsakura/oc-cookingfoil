// Counts admin CSS that bypasses the design tokens in src/routes/admin/styles.js: a colour written
// as hex, a font size or corner radius in px, a font weight other than the two the client uses
// (400 and 700). test/unit/design-ratchet.test.js holds the counts to
// test/fixtures/design-ceilings.json so they only go down while panels move onto the tokens.
//
//   node scripts/design-scan.mjs           counts per file, largest first
//   node scripts/design-scan.mjs --lower   lowers the ceilings to the counts (never raises one)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CEILINGS_FILE = path.join(ROOT, "test/fixtures/design-ceilings.json");
const DIR = "src/routes/admin";

export const RULES = {
  hex: /(?:^|[;{\s"'`])(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline|fill|stroke|box-shadow|text-shadow)\s*:[^;}"'`]*#[0-9a-fA-F]{3,8}\b/g,
  fontSize: /font-size\s*:\s*[\d.]+px/g,
  radius: /border-(?:[a-z]+-)*radius\s*:\s*[\d.]+px/g,
  weight: /font-weight\s*:\s*(?!400\b|700\b|normal\b|bold\b|var\()[^;}"'`\s]+/g,
};

// The token definitions themselves are where raw values belong.
const isTokenLine = (line) => /--[a-z0-9-]+\s*:/.test(line) && !/(?:^|[;{\s])[a-z][a-z-]*\s*:/.test(line.replace(/--[a-z0-9-]+\s*:[^;`]*;?/g, ""));

export function scanSource(source) {
  const counts = Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
  for (const line of source.split("\n")) {
    if (isTokenLine(line)) continue;
    for (const [k, re] of Object.entries(RULES)) counts[k] += line.match(re)?.length ?? 0;
  }
  return counts;
}

export function scanTree() {
  const out = {};
  for (const name of readdirSync(path.join(ROOT, DIR)).sort()) {
    if (!name.endsWith(".js")) continue;
    const c = scanSource(readFileSync(path.join(ROOT, DIR, name), "utf-8"));
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    if (total) out[`${DIR}/${name}`] = c;
  }
  return out;
}

export const readCeilings = () => JSON.parse(readFileSync(CEILINGS_FILE, "utf-8"));

/** Every file and rule whose count went over its ceiling (a file with no ceiling has 0). */
export function over(counts, ceilings) {
  const bad = [];
  for (const [file, c] of Object.entries(counts))
    for (const [k, n] of Object.entries(c)) if (n > (ceilings[file]?.[k] ?? 0)) bad.push({ file, rule: k, count: n, ceiling: ceilings[file]?.[k] ?? 0 });
  return bad;
}

export function lowerCeilings(counts, ceilings) {
  const next = {};
  for (const [file, c] of Object.entries(ceilings)) {
    const now = counts[file] ?? {};
    const row = Object.fromEntries(Object.entries(c).map(([k, n]) => [k, Math.min(n, now[k] ?? 0)]));
    if (Object.values(row).some(Boolean)) next[file] = row;
  }
  return next;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const counts = scanTree();
  if (process.argv.includes("--lower")) {
    writeFileSync(CEILINGS_FILE, JSON.stringify(lowerCeilings(counts, readCeilings()), null, 2) + "\n");
  } else if (process.argv.includes("--init")) {
    writeFileSync(CEILINGS_FILE, JSON.stringify(counts, null, 2) + "\n");
  }
  const rows = Object.entries(counts).map(([f, c]) => [f, c, Object.values(c).reduce((a, b) => a + b, 0)]).sort((a, b) => b[2] - a[2]);
  for (const [f, c, t] of rows) console.log(String(t).padStart(4), f, JSON.stringify(c));
  console.log(String(rows.reduce((s, r) => s + r[2], 0)).padStart(4), "total");
}
