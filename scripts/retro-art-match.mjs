#!/usr/bin/env node
/**
 * Fill the gaps in art-map/<system>.json by looking each ROM's English title up
 * in libretro-thumbnails' list of box art names.
 *
 *   node scripts/retro-art-match.mjs <retro dir> [--dry] [--system <id>]
 *
 * Retro file names follow "한글명 (English Name) [patch info]". A ROM whose
 * art-map entry is missing or null has its English name matched against the
 * Named_Boxarts file names of its system (same normalisation as the ratings
 * script), preferring the Japanese release since most translations start from
 * one. Entries that are already set are never touched, and titles that match
 * nothing are listed so they can be mapped by hand. Run scripts/retro-art.mjs
 * afterwards to download what was found.
 *
 * With --launchbox <Metadata.xml>, ROMs that libretro has no box art for are
 * looked up in the LaunchBox Games Database (same file the ratings script reads),
 * and the front cover is saved straight to thumbnails/<folder>/Named_Boxarts/<ROM>.png.
 * libretro barely covers Japan-only PSP and Saturn releases; LaunchBox does.
 *
 * Set GITHUB_TOKEN to lift GitHub's anonymous rate limit (two requests per system).
 */
import fs from "fs";
import path from "path";
import { loadSystems } from "../src/retro/systems.js";
import { boxartNames, repoOf } from "../src/retro/art/sources.js";
import readline from "readline";
import sharp from "sharp";
import { PLATFORMS, decode, titleKey, englishTitle, regionRank, bestMatch } from "../src/retro/art/titles.js";

export { englishTitle, regionRank, bestMatch };

const LB_IMAGES = "https://images.launchbox-app.com";
// LaunchBox region labels, best first; covers with no region come after these.
const LB_REGIONS = ["Japan", "World", "North America", "United States", "Europe"];






function romsOf(dir, system) {
  const root = path.join(dir, "roms", system.folder);
  const out = [];
  const walk = (d, depth) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (e.isDirectory() && depth < 1) walk(path.join(d, e.name), depth + 1);
      else if (e.isFile() && system.extensions.some((x) => e.name.toLowerCase().endsWith(x))) out.push(e.name.replace(/\.[^.]+$/, ""));
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Front covers from LaunchBox for the given platforms:
 * platform → title key → [{ file, region }], best region first.
 */
async function launchBoxCovers(xml, platforms) {
  const games = new Map(); // DatabaseID → { platform, names[] }
  const covers = new Map(); // DatabaseID → [{ file, region }]
  let block = null;
  let cur = {};
  const rl = readline.createInterface({ input: fs.createReadStream(xml, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t === "<Game>" || t === "<GameAlternateName>" || t === "<GameImage>") { block = t; cur = {}; continue; }
    if (t === "</Game>") {
      if (platforms.has(cur.Platform) && cur.DatabaseID) games.set(cur.DatabaseID, { platform: cur.Platform, names: [cur.Name] });
    } else if (t === "</GameAlternateName>") {
      games.get(cur.DatabaseID)?.names.push(cur.AlternateName);
    } else if (t === "</GameImage>") {
      if (cur.Type === "Box - Front" && cur.FileName) covers.set(cur.DatabaseID, [...(covers.get(cur.DatabaseID) ?? []), { file: cur.FileName, region: cur.Region ?? "" }]);
    }
    if (t.startsWith("</")) { block = null; continue; }
    if (!block) continue;
    const m = t.match(/^<(\w+)>(.*)<\/\1>$/);
    if (m) cur[m[1]] = decode(m[2]);
  }
  const rank = (c) => { const i = LB_REGIONS.indexOf(c.region); return i < 0 ? LB_REGIONS.length : i; };
  const index = new Map();
  for (const [id, g] of games) {
    const list = covers.get(id);
    if (!list) continue;
    const sorted = [...list].sort((a, b) => rank(a) - rank(b));
    if (!index.has(g.platform)) index.set(g.platform, new Map());
    const byKey = index.get(g.platform);
    for (const name of g.names) {
      const key = titleKey(name ?? "");
      if (key && !byKey.has(key)) byKey.set(key, sorted);
    }
  }
  return index;
}

/** Download a LaunchBox cover and save it as PNG at `dest`. */
async function saveCover(file, dest) {
  const res = await fetch(`${LB_IMAGES}/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`${res.status} ${file}`);
  const png = await sharp(Buffer.from(await res.arrayBuffer()), { failOn: "none" }).png().toBuffer();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(`${dest}.part`, png);
  fs.renameSync(`${dest}.part`, dest);
}

async function main() {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: node scripts/retro-art-match.mjs <retro dir> [--dry]");
    process.exit(2);
  }
  const dry = flags.includes("--dry");
  const lbAt = flags.indexOf("--launchbox");
  const lbXml = lbAt >= 0 ? flags[lbAt + 1] : null;
  const sysAt = flags.indexOf("--system");
  const only = sysAt >= 0 ? flags[sysAt + 1] : null;
  const systems = loadSystems(dir);
  const mapDir = path.join(dir, "art-map");
  const lb = lbXml ? await launchBoxCovers(lbXml, new Set(Object.values(PLATFORMS).flat())) : null;
  for (const [id, system] of Object.entries(systems)) {
    if (id === "ws" || id === "arcade") continue; // WS needs a console prefix; arcade uses set names
    if (only && id !== only) continue;
    const file = path.join(mapDir, `${id}.json`);
    const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    const todo = [...new Set(romsOf(dir, system))].filter((rom) => !map[rom]);
    if (!todo.length) continue;
    const names = await boxartNames(repoOf(system.libretro), { token: process.env.GITHUB_TOKEN });
    const found = {};
    const missed = [];
    for (const rom of todo) {
      const hit = bestMatch(englishTitle(rom), names);
      if (hit) found[rom] = hit;
      else missed.push(rom);
    }
    const fromLb = [];
    const stillMissing = [];
    for (const rom of missed) {
      const dest = path.join(dir, "thumbnails", system.folder, "Named_Boxarts", `${rom}.png`);
      const key = titleKey(englishTitle(rom));
      const cover = lb && (PLATFORMS[id] ?? []).map((p) => lb.get(p)?.get(key)?.[0]).find(Boolean);
      if (fs.existsSync(dest)) continue;
      if (!cover) { stillMissing.push(rom); continue; }
      if (!dry) {
        try { await saveCover(cover.file, dest); } catch (err) { stillMissing.push(`${rom} (${err.message})`); continue; }
      }
      fromLb.push(rom);
    }
    console.log(`${id}: ${Object.keys(found).length} from libretro, ${fromLb.length} from LaunchBox, ${stillMissing.length} not found`);
    for (const [rom, hit] of Object.entries(found)) console.log(`  + ${rom}  →  ${hit}`);
    for (const rom of fromLb) console.log(`  L ${rom}`);
    for (const rom of stillMissing) console.log(`  - ${rom}`);
    if (!dry && Object.keys(found).length) {
      const next = { ...map, ...found };
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 1)}\n`);
      fs.renameSync(`${file}.tmp`, file);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
