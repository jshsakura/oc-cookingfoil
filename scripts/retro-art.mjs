#!/usr/bin/env node
/**
 * Fetch box art (libretro-thumbnails) and bezels (The Bezel Project) for the
 * retro games in a CookingFoil retro folder.
 *
 *   node scripts/retro-art.mjs <retro dir> [--dry]
 *
 * Game files are often renamed (translations, patches), so their names rarely
 * match the No-Intro / Redump names the artwork is filed under. The mapping
 * from a game's file name to that name lives in <retro dir>/art-map/<system>.json:
 *
 *   { "<ROM file name without extension>": "<No-Intro name>" | null, … }
 *
 * For WonderSwan, prefix the name with "WSC:" or "WS:" to pick the console.
 * Art lands where the server looks for it, named after the ROM:
 *
 *   thumbnails/<system folder>/Named_Boxarts/<ROM name>.png
 *   bezels/<system folder>/<ROM name>.png      (and _default.png per system)
 *
 * Files that already exist are kept, so the script can be rerun as games are added.
 */
import fs from "fs";
import path from "path";
import { loadSystems } from "../src/retro/systems.js";

const THUMBS = "https://raw.githubusercontent.com/libretro-thumbnails";
const BEZELS = "https://raw.githubusercontent.com/thebezelproject";
const CONCURRENCY = 6;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const MAX_LINK_HOPS = 3;

// Bezel Project collections per system, Japanese ones first: most translated
// games are Japanese originals. Each is [repo, GameBezels folder, default image].
const BEZEL_SOURCES = {
  nes: [["bezelproject-Famicom", "Famicom", "Nintendo-Famicom"], ["bezelproject-NES", "NES", "Nintendo-Entertainment-System"]],
  snes: [["bezelproject-SFC", "SFC", "Nintendo-Super-Famicom"], ["bezelproject-SNES", "SNES", "Super-Nintendo-Entertainment-System"]],
  gb: [["bezelproject-GB", "GB", "Nintendo-Game-Boy"]],
  gbc: [["bezelproject-GBC", "GBC", "Nintendo-Game-Boy-Color"]],
  gba: [["bezelproject-GBA", "GBA", "Nintendo-Game-Boy-Advance"]],
  n64: [["bezelproject-N64", "N64", "Nintendo-64"]],
  nds: [["bezelproject-NDS", "NDS", "Nintendo-DS"]],
  md: [["bezelproject-MegaDrive", "MegaDrive", "Sega-Mega-Drive"]],
  sms: [["bezelproject-MasterSystem", "MasterSystem", "Sega-Master-System"]],
  gg: [["bezelproject-GameGear", "GameGear", "Sega-Game-Gear"]],
  pce: [["bezelproject-PCEngine", "PCEngine", "NEC-PC-Engine"]],
  ps1: [["bezelproject-PSX", "PSX", null]],
  segacd: [["bezelproject-SegaCD", "SegaCD", "Sega-CD"]],
  pcecd: [["bezelproject-PCE-CD", "PCE-CD", "NEC-PC-Engine-CD"]],
  saturn: [["bezelproject-Saturn", "Saturn", "Sega-Saturn"]],
  ngp: [["bezelproject-NGPC", "NGP", "SNK-Neo-Geo-Pocket-Color"]],
  ws: [["bezelproject-WonderSwanColor", "WonderSwanColor", "Bandai-WonderSwan—Color-Horizontal"]],
};

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
const repoOf = (folder) => folder.replaceAll(" ", "_");

/**
 * Download a PNG. libretro-thumbnails stores some covers as Git symlinks, which
 * raw.githubusercontent.com serves as a short text file holding the target's
 * name; those are followed (within the same folder). Anything that isn't a PNG
 * is never written.
 */
async function download(url, dest, dry) {
  if (dry) return "dry";
  let current = url;
  for (let hop = 0; hop <= MAX_LINK_HOPS; hop++) {
    const res = await fetch(current);
    if (res.status === 404) return "missing";
    if (!res.ok) throw new Error(`${res.status} ${current}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.subarray(0, 4).equals(PNG_MAGIC)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, dest);
      return "ok";
    }
    const target = body.length < 512 ? body.toString("utf8").trim() : "";
    if (!target.endsWith(".png") || target.includes("..")) return "not-png";
    current = new URL(target.split("/").map(encodeURIComponent).join("/"), current).href;
  }
  return "not-png";
}

/** Try each URL in turn until one exists. */
async function firstOf(urls, dest, dry) {
  for (const url of urls) {
    const r = await download(url, dest, dry);
    if (r !== "missing") return r;
  }
  return "missing";
}

async function pool(jobs) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = await jobs[i]();
      } catch (err) {
        results[i] = `error: ${err.message}`;
      }
    }
  }));
  return results;
}

function jobsFor(dir, id, system, map, dry) {
  const jobs = [];
  const sources = BEZEL_SOURCES[id] ?? [];
  const bezelDir = path.join(dir, "bezels", system.folder);
  const defaultSrc = sources.find(([, , d]) => d);
  const defaultDest = path.join(bezelDir, "_default.png");
  if (defaultSrc && !fs.existsSync(defaultDest)) {
    const [repo, , name] = defaultSrc;
    jobs.push(async () => ["default", await download(`${BEZELS}/${repo}/master/${enc(`retroarch/overlay/${name}.png`)}`, defaultDest, dry)]);
  }
  for (const [rom, target] of Object.entries(map)) {
    if (!target) continue;
    let name = target;
    let thumbRepo = repoOf(system.folder);
    if (id === "ws") {
      const [console, ...rest] = target.split(":");
      name = rest.join(":");
      thumbRepo = console === "WS" ? "Bandai_-_WonderSwan" : "Bandai_-_WonderSwan_Color";
    }
    const boxDest = path.join(dir, "thumbnails", system.folder, "Named_Boxarts", `${rom}.png`);
    if (!fs.existsSync(boxDest)) {
      jobs.push(async () => ["boxart", await download(`${THUMBS}/${thumbRepo}/master/${enc(`Named_Boxarts/${name}.png`)}`, boxDest, dry)]);
    }
    const bezelDest = path.join(bezelDir, `${rom}.png`);
    if (sources.length && !fs.existsSync(bezelDest)) {
      const urls = sources.map(([repo, folder]) => `${BEZELS}/${repo}/master/${enc(`retroarch/overlay/GameBezels/${folder}/${name}.png`)}`);
      jobs.push(async () => ["bezel", await firstOf(urls, bezelDest, dry)]);
    }
  }
  return jobs;
}

async function main() {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: node scripts/retro-art.mjs <retro dir> [--dry]");
    process.exit(2);
  }
  const dry = flags.includes("--dry");
  const systems = loadSystems(dir);
  const mapDir = path.join(dir, "art-map");
  for (const file of fs.existsSync(mapDir) ? fs.readdirSync(mapDir).filter((f) => f.endsWith(".json")) : []) {
    const id = path.basename(file, ".json");
    const system = systems[id];
    if (!system) {
      console.error(`${file}: no system "${id}"`);
      continue;
    }
    const map = JSON.parse(fs.readFileSync(path.join(mapDir, file), "utf8"));
    const results = await pool(jobsFor(dir, id, system, map, dry));
    const tally = {};
    for (const [kind, outcome] of results.filter(Array.isArray)) tally[`${kind} ${outcome}`] = (tally[`${kind} ${outcome}`] ?? 0) + 1;
    const errors = results.filter((r) => typeof r === "string");
    console.log(`${id}: ${JSON.stringify(tally)}${errors.length ? ` errors ${errors.length}: ${errors.slice(0, 3).join("; ")}` : ""}`);
  }
}

main();
