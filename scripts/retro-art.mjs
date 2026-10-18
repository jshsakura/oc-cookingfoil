#!/usr/bin/env node
/**
 * Fetch box art (libretro-thumbnails) and bezels (The Bezel Project) for the
 * retro games in a CookingFoil retro folder.
 *
 *   node scripts/retro-art.mjs <retro dir> [--dry] [--system <id>]
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
import { BEZEL_SOURCES, pool } from "../src/retro/art/sources.js";
import { jobsFor } from "../src/retro/art/sync.js";








async function main() {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: node scripts/retro-art.mjs <retro dir> [--dry]");
    process.exit(2);
  }
  const dry = flags.includes("--dry");
  const sysAt = flags.indexOf("--system");
  const only = sysAt >= 0 ? flags[sysAt + 1] : null;
  const systems = loadSystems(dir);
  const mapDir = path.join(dir, "art-map");
  const mapped = fs.existsSync(mapDir) ? fs.readdirSync(mapDir).filter((f) => f.endsWith(".json")).map((f) => path.basename(f, ".json")) : [];
  for (const id of mapped.filter((m) => !systems[m])) console.error(`${id}.json: no system "${id}"`);
  // Every system gets its default bezel, mapped games or not.
  for (const id of new Set([...mapped, ...Object.keys(BEZEL_SOURCES)])) {
    const system = systems[id];
    if (!system || (only && id !== only)) continue;
    const file = path.join(mapDir, `${id}.json`);
    const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    const results = await pool(jobsFor(dir, id, system, map, dry));
    const tally = {};
    for (const [kind, outcome] of results.filter(Array.isArray)) tally[`${kind} ${outcome}`] = (tally[`${kind} ${outcome}`] ?? 0) + 1;
    const errors = results.filter((r) => typeof r === "string");
    console.log(`${id}: ${JSON.stringify(tally)}${errors.length ? ` errors ${errors.length}: ${errors.slice(0, 3).join("; ")}` : ""}`);
  }
}

main();
