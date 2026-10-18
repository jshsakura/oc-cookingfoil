/**
 * Screenshots of retro games, kept beside the box art in the retro folder:
 *
 *   screenshots/<folder>/<ROM name>/<n>.png|jpg     n = 1..8, in the record's order
 *
 * <folder> is the system's server folder (systems.js `folder`), <ROM name> the
 * name its metadata is filed under (build.js metaKey). They are downloaded in
 * the background from the hosts the records name, and only ever read on
 * request. Only PNG and JPEG bytes from LaunchBox's or IGDB's image hosts are
 * written.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileVersion } from "../file-version.js";
import { MAX_SHOTS } from "./fields.js";

const HOSTS = new Set(["images.launchbox-app.com", "images.igdb.com"]);
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const FILE_RE = /^([1-8])\.(png|jpg)$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** The folder of one game's screenshots, or null for a key that isn't a plain file name. */
export function shotDir(dir, system, key) {
  const name = key.slice(key.indexOf("/") + 1);
  if (!system?.folder || !name || name.includes("/") || name.includes("\\") || name === "." || name === "..") return null;
  return path.join(dir, "screenshots", system.folder, name);
}

/** The screenshots on disk: [{ n, file }], in order. */
export function localShots(dir, system, key) {
  const folder = shotDir(dir, system, key);
  if (!folder) return [];
  let names;
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  return names.map((f) => [FILE_RE.exec(f), f]).filter(([m]) => m)
    .map(([m, f]) => ({ n: Number(m[1]), file: path.join(folder, f) }))
    .sort((a, b) => a.n - b.n)
    .filter((s, i, list) => i === 0 || list[i - 1].n !== s.n)
    .slice(0, MAX_SHOTS);
}

/** Versioned URLs of the screenshots on disk, under a game's API base. */
export function shotUrls(dir, system, key, base) {
  return localShots(dir, system, key).map(({ n, file }) => `${base}/screenshot/${n}?v=${fileVersion(file)}`);
}

/** One screenshot file by its number, or null. */
export const shotFile = (dir, system, key, n) => localShots(dir, system, key).find((s) => s.n === n)?.file ?? null;

/** "png", "jpg" or null for the bytes. */
export function imageType(body) {
  if (body.subarray(0, 4).equals(PNG)) return "png";
  if (body.subarray(0, 3).equals(JPEG)) return "jpg";
  return null;
}

const allowed = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTS.has(u.hostname);
  } catch {
    return false;
  }
};

/** How many screenshots a record names, at most MAX_SHOTS. Pure. */
export const wantedShots = (record) => Math.min(record?.shots?.length ?? 0, MAX_SHOTS);

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

/**
 * The response for `url`, following a redirect only to another allowed host;
 * null when a hop leaves the allow list or there are too many. A network
 * error is thrown.
 */
export async function fetchAllowed(url, fetchImpl = fetch) {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(at)) return null;
    const res = await fetchImpl(at, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
    if (!REDIRECT.has(res.status)) return res;
    const next = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    if (!next) return null;
    at = new URL(next, at).href;
  }
  return null;
}

/** The body as a Buffer, or null once it passes `max` bytes (read no further than that). */
export async function readCapped(res, max) {
  if (Number(res.headers.get("content-length")) > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) return null; // leaving the loop cancels the rest of the body
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Whether a game still lacks screenshots its record names. */
export function needsShots(dir, system, key, record) {
  const want = wantedShots(record);
  return want > 0 && shotDir(dir, system, key) !== null && localShots(dir, system, key).length < want;
}

/** Distinct screenshot numbers among a folder's file names. Pure. */
const countShots = (names) => Math.min(new Set(names.map((f) => FILE_RE.exec(f)?.[1]).filter(Boolean)).size, MAX_SHOTS);

const readdirOrEmpty = (p, opts) => fsp.readdir(p, opts).catch((err) => (err.code === "ENOENT" || err.code === "ENOTDIR" ? [] : Promise.reject(err)));

/**
 * Every game folder under screenshots/ with how many screenshots it holds:
 * Map(shotDir path → count). Async, one directory read per folder.
 */
export async function indexShots(dir) {
  const root = path.join(dir, "screenshots");
  const counts = new Map();
  for (const sys of await readdirOrEmpty(root, { withFileTypes: true })) {
    if (!sys.isDirectory()) continue;
    for (const game of await readdirOrEmpty(path.join(root, sys.name), { withFileTypes: true })) {
      if (!game.isDirectory()) continue;
      const folder = path.join(root, sys.name, game.name);
      counts.set(folder, countShots(await readdirOrEmpty(folder)));
    }
  }
  return counts;
}

/**
 * Downloads the record's screenshots that are not on disk yet. Returns
 * { saved, skipped, have } (have: how many are on disk now); a network error is thrown so the game is tried again later.
 */
export async function downloadShots(dir, system, key, record, { fetchImpl = fetch } = {}) {
  const folder = shotDir(dir, system, key);
  if (!folder) return { saved: 0, skipped: 0, have: 0 };
  const have = new Set(localShots(dir, system, key).map((s) => s.n));
  let saved = 0;
  let skipped = 0;
  for (const [i, url] of (record?.shots ?? []).slice(0, MAX_SHOTS).entries()) {
    const n = i + 1;
    if (have.has(n)) continue;
    const res = await fetchAllowed(url, fetchImpl);
    if (!res?.ok) { skipped++; continue; }
    const body = await readCapped(res, MAX_BYTES);
    const type = body ? imageType(body) : null;
    if (!type) { skipped++; continue; }
    await fsp.mkdir(folder, { recursive: true });
    const dest = path.join(folder, `${n}.${type}`);
    await fsp.writeFile(`${dest}.part`, body);
    await fsp.rename(`${dest}.part`, dest);
    saved++;
  }
  return { saved, skipped, have: Math.min(have.size + saved, MAX_SHOTS) };
}

/** Removes a game's screenshots (its record now names other ones). */
export async function removeShots(dir, system, key) {
  const folder = shotDir(dir, system, key);
  if (folder) await fsp.rm(folder, { recursive: true, force: true });
}
