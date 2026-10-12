/**
 * Community ratings for retro games, from the LaunchBox Games Database:
 *
 *   https://gamesdb.launchbox-app.com/Metadata.zip  (about 100 MB, refreshed by LaunchBox daily)
 *
 * The zip is kept in <data dir>/launchbox/ and fetched again only when LaunchBox
 * has a newer one. Metadata.xml is read straight out of it (unzip -p), never
 * unpacked to disk. Each ROM's original title (its No-Intro / Redump name in
 * art-map/<system>.json) is matched against LaunchBox's names and alternate names
 * on the same platforms, and the result goes to <retro dir>/ratings.json:
 *
 *   { "<system>": { "<ROM name>": { "rating": 0-100, "count": n } } }
 *
 * LaunchBox rates out of 5; rating = round(stars × 20). A rating needs MIN_VOTES
 * votes, and a title that matches games with different ratings is left out.
 */
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import readline from "readline";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { PLATFORMS, decode, titleKey } from "./titles.js";

export const METADATA_URL = "https://gamesdb.launchbox-app.com/Metadata.zip";
const MIN_VOTES = 3;

/** Games with enough votes on the wanted platforms, and their alternate names, from a Metadata.xml stream. */
export async function readLaunchBox(input, wanted) {
  const games = new Map(); // DatabaseID → { Name, Platform, CommunityRating, CommunityRatingCount }
  const alternates = []; // [DatabaseID, name]
  let block = null;
  let cur = {};
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t === "<Game>" || t === "<GameAlternateName>") { block = t; cur = {}; continue; }
    if (t === "</Game>") {
      if (wanted.has(cur.Platform) && cur.DatabaseID && cur.CommunityRating && Number(cur.CommunityRatingCount) >= MIN_VOTES) games.set(cur.DatabaseID, cur);
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

/** ratings.json's content for every art-map of the retro dir, and per system "rated/mapped". Pure apart from reading art-map. */
export function buildRatings(dir, { games, alternates }) {
  const index = new Map(); // platform → title key → games
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
  const summary = {};
  const mapDir = path.join(dir, "art-map");
  const files = fs.existsSync(mapDir) ? fs.readdirSync(mapDir).filter((f) => f.endsWith(".json")) : [];
  for (const file of files) {
    const system = path.basename(file, ".json");
    const platforms = PLATFORMS[system] ?? [];
    const map = JSON.parse(fs.readFileSync(path.join(mapDir, file), "utf8"));
    let rated = 0;
    for (const [rom, original] of Object.entries(map)) {
      if (!original) continue;
      const key = titleKey(original.replace(/^WSC?:/, ""));
      const unique = [...new Map(platforms.flatMap((p) => index.get(p)?.get(key) ?? []).map((g) => [g.DatabaseID, g])).values()];
      if (!unique.length) continue;
      const ratings = new Set(unique.map((g) => Math.round(Number(g.CommunityRating) * 20)));
      if (ratings.size !== 1) continue; // two different games share the title: don't guess
      const best = unique.reduce((a, b) => (Number(b.CommunityRatingCount) > Number(a.CommunityRatingCount) ? b : a));
      (out[system] ??= {})[rom] = { rating: [...ratings][0], count: Number(best.CommunityRatingCount) || 0 };
      rated++;
    }
    summary[system] = `${rated}/${Object.values(map).filter(Boolean).length}`;
  }
  return { ratings: out, summary };
}

/** Downloads Metadata.zip into `cacheDir` unless the copy there is current. Returns its path. */
async function fetchMetadata(cacheDir, fetchImpl) {
  const zip = path.join(cacheDir, "Metadata.zip");
  const have = await fsp.stat(zip).catch(() => null);
  const res = await fetchImpl(METADATA_URL, { headers: have ? { "If-Modified-Since": have.mtime.toUTCString() } : {} });
  if (res.status === 304) return zip;
  if (!res.ok) throw new Error(`LaunchBox ${res.status}`);
  await fsp.mkdir(cacheDir, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${zip}.part`));
  await fsp.rename(`${zip}.part`, zip);
  return zip;
}

/** Metadata.xml out of the zip, as a stream. */
function xmlFrom(zip) {
  const child = spawn("unzip", ["-p", zip, "Metadata.xml"], { stdio: ["ignore", "pipe", "ignore"] });
  child.stdout.setEncoding("utf8");
  return child.stdout;
}

/** Fetches LaunchBox's data if newer, rates every mapped ROM and writes ratings.json. Returns per system "rated/mapped". */
export async function refreshRatings(dir, cacheDir, { fetchImpl = fetch } = {}) {
  const zip = await fetchMetadata(cacheDir, fetchImpl);
  const data = await readLaunchBox(xmlFrom(zip), new Set(Object.values(PLATFORMS).flat()));
  if (!data.games.size) throw new Error("LaunchBox 자료를 읽지 못했습니다");
  const { ratings, summary } = buildRatings(dir, data);
  const dest = path.join(dir, "ratings.json");
  await fsp.writeFile(`${dest}.tmp`, JSON.stringify(ratings, null, 1));
  await fsp.rename(`${dest}.tmp`, dest);
  return summary;
}
