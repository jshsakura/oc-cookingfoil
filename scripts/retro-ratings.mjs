#!/usr/bin/env node
/**
 * Community ratings for retro games, from the LaunchBox Games Database.
 *
 *   node scripts/retro-ratings.mjs <retro dir> <LaunchBox Metadata.xml>
 *
 * The admin page (retro tab) does the same, downloading Metadata.zip itself;
 * this is for running it by hand against an unpacked Metadata.xml. See
 * src/retro/art/ratings.js for how titles are matched.
 */
import fs from "fs";
import path from "path";
import { PLATFORMS, decode, titleKey } from "../src/retro/art/titles.js";
import { buildRatings, readLaunchBox } from "../src/retro/art/ratings.js";

export { PLATFORMS, decode, titleKey };

async function main() {
  const [dir, xml] = process.argv.slice(2);
  if (!dir || !xml) {
    console.error("usage: node scripts/retro-ratings.mjs <retro dir> <Metadata.xml>");
    process.exit(2);
  }
  const data = await readLaunchBox(fs.createReadStream(xml, { encoding: "utf8" }), new Set(Object.values(PLATFORMS).flat()));
  const { ratings, summary } = buildRatings(dir, data);
  for (const [system, s] of Object.entries(summary)) console.log(`${system}: ${s} rated`);
  const dest = path.join(dir, "ratings.json");
  fs.writeFileSync(`${dest}.tmp`, JSON.stringify(ratings, null, 1));
  fs.renameSync(`${dest}.tmp`, dest);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
