#!/usr/bin/env node
/**
 * Builds src/retro/data/fbneo-arcade.json from the FinalBurn Neo arcade DAT
 * (ClrMame Pro XML) and our translations of its titles.
 *
 *   node scripts/fbneo-arcade.mjs <arcade.dat> <names.json>…
 *
 * names.json: { "English base title": { "ko": "…", "ja": "…"|null, "zh": "…"|null } }
 * Only what the server needs is kept: description, parent, BIOS and whether a
 * set is a BIOS. No ROM data is read or written.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const [dat, ...nameFiles] = process.argv.slice(2);
if (!dat || !nameFiles.length) {
  console.error("usage: node scripts/fbneo-arcade.mjs <arcade.dat> <names.json>…");
  process.exit(2);
}

const xml = fs.readFileSync(dat, "utf8");
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (head, name) => head.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
const version = xml.match(/<version>([^<]*)<\/version>/)?.[1] ?? null;

const sets = {};
for (const m of xml.matchAll(/<game ([^>]*)>([\s\S]*?)<\/game>/g)) {
  const [, head, body] = m;
  const name = attr(head, "name");
  const desc = unescape(body.match(/<description>([^<]*)<\/description>/)?.[1] ?? name);
  sets[name] = [desc, attr(head, "cloneof"), attr(head, "romof"), attr(head, "isbios") === "yes" ? 1 : 0];
}

const names = {};
for (const file of nameFiles) {
  for (const [title, v] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))) {
    const clean = Object.fromEntries(["ko", "ja", "zh"].filter((l) => typeof v?.[l] === "string" && v[l].trim()).map((l) => [l, v[l].trim()]));
    if (clean.ko) names[unescape(title)] = clean;
  }
}

const LICENSE =
  "Derived from the FinalBurn Neo DAT. Not MIT: distributed under the FinalBurn Neo license (non-commercial), see licenses/FBNeo-LICENSE.txt.";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "retro", "data", "fbneo-arcade.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ source: `FinalBurn Neo ${version}`, license: LICENSE, sets, names }));
console.log(`${Object.keys(sets).length} sets, ${Object.keys(names).length} titles → ${path.relative(process.cwd(), out)}`);
