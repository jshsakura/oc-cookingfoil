/**
 * Pictures for each homebrew app, laid out as a game's: a wide banner behind its
 * header and a row of screenshots. Ports are filled in on their own (the banner
 * from SteamGridDB's "heroes", screenshots from IGDB when its key is set); any
 * app may get both uploaded from the admin page.
 *
 *   ${COOK_DATA_DIR}/homebrew/media/<id>/banner.webp     at most BANNER_W × BANNER_H
 *   ${COOK_DATA_DIR}/homebrew/media/<id>/shot-<n>.webp   n = 1 … MAX_SHOTS, at most SHOT_W × SHOT_H
 *   ${COOK_DATA_DIR}/homebrew/media.json                 { <id>: { banner?, shots? } }
 *
 * banner / shots: { source: "sgdb" | "igdb" | "upload", game?, count?, at }, or
 * { miss: at } (a search that found nothing, tried again after MISS_RETRY_MS), or
 * { off: true } (removed by the admin: never filled in automatically again).
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";
import * as activity from "../tasks/activity.js";
import * as igdb from "./igdb-client.js";
import { fetchSgdbImage, sgdbHeroes, sgdbSearch } from "../retro/art/sync.js";

const DIR = path.join(dataDir, "homebrew", "media");
const FILE = path.join(dataDir, "homebrew", "media.json");
const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
const BANNER_W = 1280;
const BANNER_H = 720;
const SHOT_W = 1280;
const SHOT_H = 720;
export const MAX_SHOTS = 8;
const AUTO_SHOTS = 6;
const MISS_RETRY_MS = 30 * 24 * 3_600_000;
const PAUSE_MS = 1000;
const IGDB_IMAGES = "https://images.igdb.com/igdb/image/upload/t_screenshot_big/";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export class MediaImageError extends Error {}

let saved = null;
function all() {
  if (saved) return saved;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (err) {
    if (err.code && err.code !== "ENOENT") throw err;
    // A file that no longer parses is kept aside, not left to break every listing.
    if (!err.code) {
      debug.error("homebrew media: %s does not parse (%s); kept as .corrupt, starting empty", FILE, err.message);
      try { fs.renameSync(FILE, `${FILE}.corrupt`); } catch { /* gone already */ }
    }
    saved = {};
  }
  return saved;
}

function persist(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(next, null, 1)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
}

/** Sets one part ("banner" | "shots") of an app's record. */
function put(id, part, value) {
  const cur = all();
  persist({ ...cur, [id]: { ...cur[id], [part]: value } });
}

const check = (id) => {
  if (!ID_RE.test(String(id))) throw new MediaImageError("앱 번호가 맞지 않습니다");
};

const dirOf = (id) => path.join(DIR, id);
export const bannerPath = (id) => path.join(dirOf(id), "banner.webp");
export const shotPath = (id, n) => path.join(dirOf(id), `shot-${n}.webp`);

/** What is on file for one app: { banner?, shots? }. */
export const record = (id) => all()[id] ?? {};

const stamp = (part) => (part?.source && part.at ? part.at.toString(36) : null);

/** The banner's version (?v=), or null when the app has none. */
export const bannerVersion = (id) => stamp(record(id).banner);

/** The app's screenshot addresses, in order: [] when it has none. */
export function shotUrls(id) {
  const s = record(id).shots;
  const v = stamp(s);
  return v ? Array.from({ length: s.count }, (_, i) => `/api/homebrew/${id}/screenshot/${i + 1}?v=${v}`) : [];
}

/** What the listing carries for an app. */
export function urls(id) {
  const v = bannerVersion(id);
  return { banner_url: v ? `/api/homebrew/${id}/banner?v=${v}` : null, screenshots: shotUrls(id) };
}

async function encode(raw, w, h) {
  try {
    return await sharp(raw, { failOn: "none", limitInputPixels: 50e6 })
      .rotate()
      .resize({ width: w, height: h, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 5 })
      .toBuffer();
  } catch (err) {
    throw new MediaImageError(`이미지를 읽지 못했습니다: ${err.message}`);
  }
}

function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, buf);
  fs.renameSync(`${file}.tmp`, file);
}

/** Saves `raw` as the app's banner. Returns the bytes written. */
export async function saveBanner(id, raw, { source = "upload", game = null, now = Date.now() } = {}) {
  check(id);
  const webp = await encode(raw, BANNER_W, BANNER_H);
  writeAtomic(bannerPath(id), webp);
  put(id, "banner", { source, ...(game ? { game } : {}), at: now });
  return webp.length;
}

/** Saves a SteamGridDB picture (its own image host only) as the banner. */
export async function saveBannerFromSgdb(id, url, game = null, { fetchImpl = fetch } = {}) {
  return saveBanner(id, await fetchSgdbImage(url, { fetchImpl }), { source: "sgdb", game });
}

/** Removes the banner; it is not filled in automatically again. */
export function removeBanner(id) {
  check(id);
  fs.rmSync(bannerPath(id), { force: true });
  put(id, "banner", { off: true });
}

/**
 * Sets the app's screenshots to `raws`, in that order (replacing the ones it had).
 * Images that cannot be read are skipped; none readable throws.
 */
export async function saveShots(id, raws, { source = "upload", game = null, now = Date.now() } = {}) {
  check(id);
  const encoded = [];
  for (const raw of raws.slice(0, MAX_SHOTS)) {
    try {
      encoded.push(await encode(raw, SHOT_W, SHOT_H));
    } catch (err) {
      if (raws.length === 1) throw err;
      debug.error("homebrew media: %s: a screenshot left out: %s", id, err.message);
    }
  }
  if (!encoded.length) throw new MediaImageError("읽을 수 있는 이미지가 없습니다");
  encoded.forEach((buf, i) => writeAtomic(shotPath(id, i + 1), buf));
  for (let n = encoded.length + 1; n <= MAX_SHOTS; n++) fs.rmSync(shotPath(id, n), { force: true });
  put(id, "shots", { source, count: encoded.length, ...(game ? { game } : {}), at: now });
  return encoded.length;
}

/** Adds uploaded screenshots after the ones the app has (up to MAX_SHOTS); those stay as they are, never encoded again. */
export async function addShots(id, raws, { now = Date.now() } = {}) {
  check(id);
  const have = record(id).shots?.count ?? 0;
  if (have + raws.length > MAX_SHOTS) throw new MediaImageError(`스크린샷은 ${MAX_SHOTS}장까지 둡니다`);
  const encoded = [];
  for (const raw of raws) encoded.push(await encode(raw, SHOT_W, SHOT_H));
  encoded.forEach((buf, i) => writeAtomic(shotPath(id, have + i + 1), buf));
  put(id, "shots", { source: "upload", count: have + encoded.length, at: now });
  return have + encoded.length;
}

/** Removes one screenshot (n from 1), or all of them with n = null; removing all stops automatic filling. */
export function removeShots(id, n = null) {
  check(id);
  const s = record(id).shots;
  if (n == null || !s?.count || s.count <= 1) {
    for (let i = 1; i <= MAX_SHOTS; i++) fs.rmSync(shotPath(id, i), { force: true });
    put(id, "shots", { off: true });
    return 0;
  }
  if (!Number.isInteger(n) || n < 1 || n > s.count) throw new MediaImageError("없는 스크린샷입니다");
  // The ones left, in order, from what is actually on disk: a missing file never leaves the set out of step.
  const keep = [];
  for (let i = 1; i <= s.count; i++) if (i !== n && fs.existsSync(shotPath(id, i))) keep.push(fs.readFileSync(shotPath(id, i)));
  keep.forEach((buf, i) => writeAtomic(shotPath(id, i + 1), buf));
  for (let i = keep.length + 1; i <= MAX_SHOTS; i++) fs.rmSync(shotPath(id, i), { force: true });
  put(id, "shots", keep.length ? { ...s, count: keep.length, at: Date.now() } : { off: true });
  return keep.length;
}

async function download(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) throw new Error("image too large");
  return body;
}

/**
 * Names to look an app up by, best first. A port is usually named after the game:
 * "롤러코스터 타이쿤 2 (OpenRCT2)" tries "OpenRCT2". Only names in Latin letters are
 * asked: SteamGridDB and IGDB know games by their English names.
 */
export function searchNames(entry) {
  const out = [];
  const add = (s) => {
    const v = String(s ?? "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
    // A name that still holds Korean, Japanese or Chinese text finds nothing there.
    if (v && /[A-Za-z]/.test(v) && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(v) && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  const name = String(entry?.name ?? "");
  for (const m of name.matchAll(/\(([^)]+)\)|\[([^\]]+)\]/g)) add(m[1] ?? m[2]);
  add(name.replace(/\([^)]*\)|\[[^\]]*\]/g, ""));
  add(name);
  if (entry?.repo_url) add(String(entry.repo_url).split("/").pop());
  add(String(entry?.file_name ?? "").replace(/\.(nro|nsp)$/i, "").replace(/[-.]v?\d[\d.]*$/i, ""));
  return out.slice(0, 4);
}

/** Banners SteamGridDB has for `query`: [{ game: { id, name }, url, thumb }], a few per game. */
export async function bannerCandidates(query, apiKey, { fetchImpl = fetch } = {}) {
  const games = (await sgdbSearch(String(query).slice(0, 100), apiKey, { fetchImpl })).slice(0, 3);
  const out = [];
  for (const g of games) {
    for (const h of (await sgdbHeroes(g.id, apiKey, { fetchImpl })).slice(0, 8)) out.push({ game: { id: g.id, name: g.name }, url: h.url, thumb: h.thumb });
  }
  return out;
}

/** The first banner found under any of the names, or null. */
async function findBanner(names, apiKey, fetchImpl) {
  for (const q of names) {
    for (const g of (await sgdbSearch(q, apiKey, { fetchImpl })).slice(0, 2)) {
      const [hero] = await sgdbHeroes(g.id, apiKey, { fetchImpl });
      if (hero) return { url: hero.url, game: { id: g.id, name: g.name } };
    }
  }
  return null;
}

const quoted = (s) => String(s).replace(/["\\]/g, " ").slice(0, 100);

/** IGDB screenshot addresses for the first game found under any of the names, or null. */
export async function findShots(names, { fetchImpl = fetch } = {}) {
  for (const q of names) {
    const games = await igdb.query("games", `search "${quoted(q)}"; fields name,screenshots.image_id; limit 3;`, { fetchImpl });
    for (const g of games ?? []) {
      const shots = (g.screenshots ?? []).map((s) => s.image_id).filter((x) => /^\w+$/.test(x ?? "")).slice(0, AUTO_SHOTS).map((x) => `${IGDB_IMAGES}${x}.jpg`);
      if (shots.length) return { urls: shots, game: { id: g.id, name: g.name } };
    }
  }
  return null;
}

/** Whether a part is still to be filled in automatically. */
function due(part, now) {
  if (part?.off) return false;
  if (part?.source) return false;
  return !(part?.miss && now - part.miss < MISS_RETRY_MS);
}

let filling = null;
/**
 * Fills in what each port is missing: a banner (SteamGridDB, with `apiKey`) and
 * screenshots (IGDB, when it is set up). Never what the admin removed, nor what
 * was searched in vain within MISS_RETRY_MS. One at a time, paced. Returns how many pictures it saved.
 */
export function fillPorts(entries, { apiKey = "", fetchImpl = fetch, now = Date.now, pauseMs = PAUSE_MS, igdbReady = igdb.configured } = {}) {
  const shotsOn = igdbReady();
  if (!apiKey && !shotsOn) return Promise.resolve(0);
  filling ??= (async () => {
    const todo = entries.filter((e) => {
      if (e.kind !== "port" || !ID_RE.test(e.id)) return false;
      const r = record(e.id);
      const bannerLost = r.banner?.source && !fs.existsSync(bannerPath(e.id));
      return (apiKey && (due(r.banner, now()) || bannerLost)) || (shotsOn && due(r.shots, now()));
    });
    if (!todo.length) return 0;
    const job = activity.begin("homebrew-art", { title: "포트 그림을 찾습니다", total: todo.length });
    let got = 0;
    for (const [i, e] of todo.entries()) {
      job.step(i, e.name);
      let names = searchNames(e);
      // Each part on its own: a banner that fails never keeps the screenshots from being looked for.
      // An answer that will not change (a picture that cannot be read, a 4xx) is a miss, not a retry every pass.
      const failed = (part, err) => {
        debug.error("homebrew media: %s %s: %s", e.id, part, err.message);
        if (err instanceof MediaImageError || /\b4\d\d\b/.test(err.message)) put(e.id, part, { miss: now() });
      };
      const bannerDue = () => due(record(e.id).banner, now()) || (record(e.id).banner?.source && !fs.existsSync(bannerPath(e.id)));
      if (apiKey && bannerDue()) {
        try {
          const found = await findBanner(names, apiKey, fetchImpl);
          // Asked again after the download: the admin may have removed or uploaded one meanwhile.
          if (!found) put(e.id, "banner", { miss: now() });
          else {
            const raw = await fetchSgdbImage(found.url, { fetchImpl });
            if (bannerDue()) { await saveBanner(e.id, raw, { source: "sgdb", game: found.game }); got++; }
          }
        } catch (err) {
          failed("banner", err);
        }
      }
      // SteamGridDB's name for the game ("RollerCoaster Tycoon 2") is the best IGDB search there is.
      const sgdbName = record(e.id).banner?.game?.name;
      if (sgdbName) names = [sgdbName, ...names.filter((n) => n.toLowerCase() !== sgdbName.toLowerCase())];
      if (shotsOn && due(record(e.id).shots, now())) {
        try {
          const found = await findShots(names, { fetchImpl });
          if (!found) put(e.id, "shots", { miss: now() });
          else {
            // A screenshot that cannot be fetched is left out, not the whole set.
            const raws = [];
            for (const url of found.urls) {
              try { raws.push(await download(url, fetchImpl)); } catch (err) { debug.error("homebrew media: %s screenshot: %s", e.id, err.message); }
            }
            if (!raws.length) put(e.id, "shots", { miss: now() });
            else if (due(record(e.id).shots, now())) got += await saveShots(e.id, raws, { source: "igdb", game: found.game });
          }
        } catch (err) {
          failed("shots", err);
        }
      }
      if (pauseMs) await new Promise((res) => setTimeout(res, pauseMs));
    }
    job.done(`그림 ${got}장`);
    return got;
  })().finally(() => { filling = null; });
  return filling;
}

/** Test seam. */
export function resetForTests() {
  saved = null;
  filling = null;
}
