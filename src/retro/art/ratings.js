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

/** platform → title key → LaunchBox games, over their names and alternate names. Pure. */
export function titleIndex({ games, alternates }) {
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
  return index;
}

/** The distinct games a ROM's original title names on a system's platforms. Pure. */
export function gamesFor(index, system, original) {
  const key = titleKey(String(original).replace(/^WSC?:/, ""));
  if (!key) return [];
  const platforms = PLATFORMS[system] ?? [];
  return [...new Map(platforms.flatMap((p) => index.get(p)?.get(key) ?? []).map((g) => [g.DatabaseID, g])).values()];
}

/** ratings.json's content for every art-map of the retro dir, and per system "rated/mapped". Pure apart from reading art-map. */
export function buildRatings(dir, data) {
  const index = titleIndex(data);
  const out = {};
  const summary = {};
  const mapDir = path.join(dir, "art-map");
  const files = fs.existsSync(mapDir) ? fs.readdirSync(mapDir).filter((f) => f.endsWith(".json")) : [];
  for (const file of files) {
    const system = path.basename(file, ".json");
    const map = JSON.parse(fs.readFileSync(path.join(mapDir, file), "utf8"));
    let rated = 0;
    for (const [rom, original] of Object.entries(map)) {
      if (!original) continue;
      const unique = gamesFor(index, system, original);
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

// A new read is applied only when it has at least this share of what the last one had.
export const MIN_KEEP_RATIO = 0.8;
// Below this many earlier records the comparison says nothing.
const MIN_COMPARED = 10;

/** Whether `next` records are too few beside `previous` to be a real update (a cut-off read). Pure. */
export const shrankTooMuch = (previous, next, ratio = MIN_KEEP_RATIO) => previous >= MIN_COMPARED && next < previous * ratio;

// The ratings and the details both read Metadata.zip: one download at a time per
// file, the others wait for it, and each writes its own temporary name.
const downloading = new Map(); // zip path → promise of it

async function download(zip, cacheDir, fetchImpl) {
  const have = await fsp.stat(zip).catch(() => null);
  const res = await fetchImpl(METADATA_URL, { headers: have ? { "If-Modified-Since": have.mtime.toUTCString() } : {} });
  if (res.status === 304) return zip;
  if (!res.ok) throw new Error(`LaunchBox ${res.status}`);
  await fsp.mkdir(cacheDir, { recursive: true });
  const part = `${zip}.${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
    await fsp.rename(part, zip);
  } catch (err) {
    await fsp.rm(part, { force: true });
    throw err;
  }
  return zip;
}

/** Downloads Metadata.zip into `cacheDir` unless the copy there is current. Returns its path. */
export function fetchMetadata(cacheDir, fetchImpl = fetch) {
  const zip = path.join(cacheDir, "Metadata.zip");
  if (downloading.has(zip)) return downloading.get(zip);
  const job = download(zip, cacheDir, fetchImpl).finally(() => downloading.delete(zip));
  downloading.set(zip, job);
  return job;
}

/**
 * One XML file (Metadata.xml, Mame.xml) out of the zip, as a stream. Its
 * `done` settles when unzip exits: rejected for a nonzero exit, so a broken
 * or cut-off zip is never taken for a short file.
 */
export function xmlFrom(zip, entry = "Metadata.xml") {
  const child = spawn("unzip", ["-p", zip, entry], { stdio: ["ignore", "pipe", "ignore"] });
  child.stdout.setEncoding("utf8");
  child.stdout.done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => (code === 0 ? resolve() : reject(new Error(`unzip ${entry} from ${path.basename(zip)} failed (${signal ?? `exit ${code}`})`))));
  });
  child.stdout.done.catch(() => {}); // awaited by readXml; never an unhandled rejection
  return child.stdout;
}

/** `parse(stream)` over one XML file of the zip; throws when unzip failed, whatever was parsed. */
export async function readXml(zip, entry, parse) {
  const opened = [];
  const open = () => {
    const s = xmlFrom(zip, entry);
    opened.push(s);
    return s;
  };
  const out = await parse(open);
  await Promise.all(opened.map((s) => s.done));
  return out;
}

/** How many of `previous`'s ratings are for ROMs `next` covers (systems and ROMs still mapped). Pure. */
export function comparableCount(previous, mapped) {
  let n = 0;
  for (const [system, roms] of Object.entries(previous ?? {})) {
    for (const rom of Object.keys(roms ?? {})) if (mapped.has(`${system}\0${rom}`)) n++;
  }
  return n;
}

/** The ROM names every art-map of the retro dir maps, as "<system>\0<rom>". */
function mappedRoms(dir) {
  const mapDir = path.join(dir, "art-map");
  const out = new Set();
  const files = fs.existsSync(mapDir) ? fs.readdirSync(mapDir).filter((f) => f.endsWith(".json")) : [];
  for (const file of files) {
    const map = JSON.parse(fs.readFileSync(path.join(mapDir, file), "utf8"));
    for (const [rom, original] of Object.entries(map)) if (original) out.add(`${path.basename(file, ".json")}\0${rom}`);
  }
  return out;
}

const countRatings = (ratings) => Object.values(ratings).reduce((n, roms) => n + Object.keys(roms).length, 0);

/** Fetches LaunchBox's data if newer, rates every mapped ROM and writes ratings.json. Returns per system "rated/mapped". */
export async function refreshRatings(dir, cacheDir, { fetchImpl = fetch } = {}) {
  const zip = await fetchMetadata(cacheDir, fetchImpl);
  const data = await readXml(zip, "Metadata.xml", (open) => readLaunchBox(open(), new Set(Object.values(PLATFORMS).flat())));
  if (!data.games.size) throw new Error("LaunchBox 자료를 읽지 못했습니다");
  const { ratings, summary } = buildRatings(dir, data);
  const dest = path.join(dir, "ratings.json");
  const previous = await fsp.readFile(dest, "utf8").then(JSON.parse).catch(() => null);
  const before = comparableCount(previous, mappedRoms(dir));
  const after = countRatings(ratings);
  if (shrankTooMuch(before, after)) {
    throw new Error(`LaunchBox 평점이 지난번 ${before}개에서 ${after}개로 크게 줄어 적용하지 않았습니다`);
  }
  await fsp.writeFile(`${dest}.tmp`, JSON.stringify(ratings, null, 1));
  await fsp.rename(`${dest}.tmp`, dest);
  return summary;
}
