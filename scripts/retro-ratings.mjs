#!/usr/bin/env node
/**
 * Community ratings for retro games, from the LaunchBox Games Database.
 *
 *   node scripts/retro-ratings.mjs <retro dir> <LaunchBox Metadata.xml>
 *
 * Metadata.xml comes in https://gamesdb.launchbox-app.com/Metadata.zip. Each
 * ROM's original title (the No-Intro / Redump name in art-map/<system>.json)
 * is matched against LaunchBox's game names and alternate names on the same
 * platforms, and the result is written to <retro dir>/ratings.json:
 *
 *   { "<system>": { "<ROM name>": { "rating": 0-100, "count": n } } }
 *
 * LaunchBox rates out of 5; rating = round(stars × 20). A rating needs at least
 * MIN_VOTES votes to count, and titles that match more than one game with
 * different ratings are left out rather than guessed.
 */
import fs from "fs";
import path from "path";
import readline from "readline";

const PLATFORMS = {
  nes: ["Nintendo Entertainment System", "Nintendo Famicom Disk System"],
  snes: ["Super Nintendo Entertainment System", "Nintendo Satellaview"],
  gb: ["Nintendo Game Boy"],
  gbc: ["Nintendo Game Boy Color"],
  gba: ["Nintendo Game Boy Advance"],
  n64: ["Nintendo 64"],
  nds: ["Nintendo DS"],
  md: ["Sega Genesis"],
  sms: ["Sega Master System"],
  gg: ["Sega Game Gear"],
  segacd: ["Sega CD"],
  saturn: ["Sega Saturn"],
  pce: ["NEC TurboGrafx-16"],
  pcecd: ["NEC TurboGrafx-CD"],
  ps1: ["Sony Playstation"],
  psp: ["Sony PSP"],
  ngp: ["SNK Neo Geo Pocket Color", "SNK Neo Geo Pocket"],
  ws: ["WonderSwan Color", "WonderSwan"],
  arcade: ["Arcade"],
};
const MIN_VOTES = 3;
const ROMAN = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/** A title reduced to what matching compares: no tags, accents, punctuation or articles. Pure. */
export function titleKey(raw) {
  let s = String(raw)
    .replace(/\s*[[(][^\])]*[\])]/g, "") // (Japan) (Rev 1) [b] …
    .replace(/_/g, " ") // libretro-thumbnails writes & / : as _
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/^(.*), the\b/, "the $1")
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // "&", "and" and the "_" thumbnails write for "&" all mean the same; so does a leading "the".
  s = s.split(" ").map((w) => ROMAN[w] ?? w).filter((w) => w !== "the" && w !== "and").join(" ");
  return s;
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

async function readLaunchBox(file, wanted) {
  const games = new Map(); // DatabaseID → { name, platform, rating, count }
  const alternates = []; // [DatabaseID, name]
  let block = null;
  let cur = {};
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t === "<Game>" || t === "<GameAlternateName>") { block = t; cur = {}; continue; }
    if (t === "</Game>") {
      if (wanted.has(cur.Platform) && cur.DatabaseID && cur.CommunityRating && Number(cur.CommunityRatingCount) >= MIN_VOTES) {
        games.set(cur.DatabaseID, cur);
      }
      block = null;
      continue;
    }
    if (t === "</GameAlternateName>") {
      if (cur.DatabaseID && cur.AlternateName) alternates.push([cur.DatabaseID, cur.AlternateName]);
      block = null;
      continue;
    }
    if (!block) continue;
    const m = t.match(/^<(\w+)>(.*)<\/\1>$/);
    if (m) cur[m[1]] = decode(m[2]);
  }
  return { games, alternates };
}

async function main() {
  const [dir, xml] = process.argv.slice(2);
  if (!dir || !xml) {
    console.error("usage: node scripts/retro-ratings.mjs <retro dir> <Metadata.xml>");
    process.exit(2);
  }
  const wanted = new Set(Object.values(PLATFORMS).flat());
  const { games, alternates } = await readLaunchBox(xml, wanted);
  // platform → title key → ratings seen under that title
  const index = new Map();
  const add = (platform, title, g) => {
    const key = titleKey(title);
    if (!key) return;
    if (!index.has(platform)) index.set(platform, new Map());
    const byTitle = index.get(platform);
    byTitle.set(key, [...(byTitle.get(key) ?? []), g]);
  };
  for (const g of games.values()) add(g.Platform, g.Name, g);
  for (const [id, name] of alternates) {
    const g = games.get(id);
    if (g) add(g.Platform, name, g);
  }

  const out = {};
  const mapDir = path.join(dir, "art-map");
  for (const file of fs.readdirSync(mapDir).filter((f) => f.endsWith(".json"))) {
    const system = path.basename(file, ".json");
    const platforms = PLATFORMS[system] ?? [];
    const map = JSON.parse(fs.readFileSync(path.join(mapDir, file), "utf8"));
    let rated = 0;
    for (const [rom, original] of Object.entries(map)) {
      if (!original) continue;
      const key = titleKey(original.replace(/^WSC?:/, ""));
      const found = platforms.flatMap((p) => index.get(p)?.get(key) ?? []);
      const unique = [...new Map(found.map((g) => [g.DatabaseID, g])).values()];
      if (!unique.length) continue;
      const ratings = new Set(unique.map((g) => Math.round(Number(g.CommunityRating) * 20)));
      if (ratings.size !== 1) continue; // two different games share the title: don't guess
      const best = unique.reduce((a, b) => (Number(b.CommunityRatingCount) > Number(a.CommunityRatingCount) ? b : a));
      (out[system] ??= {})[rom] = { rating: [...ratings][0], count: Number(best.CommunityRatingCount) || 0 };
      rated++;
    }
    console.log(`${system}: ${rated}/${Object.values(map).filter(Boolean).length} rated`);
  }
  const dest = path.join(dir, "ratings.json");
  fs.writeFileSync(`${dest}.tmp`, JSON.stringify(out, null, 1));
  fs.renameSync(`${dest}.tmp`, dest);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
