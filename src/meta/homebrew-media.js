/**
 * Pictures for each homebrew app, laid out as a game's: a wide banner behind its
 * header and a row of screenshots. Ports are filled in on their own (the banner
 * from SteamGridDB's "heroes", screenshots from IGDB when its key is set); any
 * app may get both uploaded from the admin page.
 *
 *   <app folder>/icon.webp …                 a hand-placed or uploaded app's pictures (meta/art-sidecar.js)
 *   ${COOK_DATA_DIR}/homebrew/media/<id>/…   an app followed on GitHub's pictures, and kept originals
 *   ${COOK_DATA_DIR}/homebrew/media.json     { <id>: { icon?, banner?, shots? } }
 *
 * A search that found nothing is { miss: at } and is tried again after MISS_RETRY_MS.
 */
import path from "path";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";
import * as activity from "../tasks/activity.js";
import * as igdb from "./igdb-client.js";
import { fetchSgdbImage, sgdbHeroes, sgdbSearch } from "../retro/art/sync.js";
import { createMediaStore, MediaImageError, MAX_SHOTS } from "./item-media.js";
import { manualHomeOf, manualOwnArtOf } from "./homebrew.js";

const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
const AUTO_SHOTS = 6;
const MISS_RETRY_MS = 30 * 24 * 3_600_000;
const PAUSE_MS = 1000;
const IGDB_IMAGES = "https://images.igdb.com/igdb/image/upload/t_screenshot_big/";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const store = createMediaStore({
  dir: path.join(dataDir, "homebrew", "media"),
  file: path.join(dataDir, "homebrew", "media.json"),
  idRe: ID_RE,
  urlBase: (id) => `/api/homebrew/${id}`,
  label: "homebrew media",
  homeOf: manualHomeOf,
  ignoreOf: manualOwnArtOf,
});
const put = store.put;
export { MediaImageError, MAX_SHOTS };
export const {
  idRe, record, pictures, iconPath, bannerPath, shotPath, shotCount, iconVersion, bannerVersion, shotsVersion, shotUrls, urls,
  saveIcon, saveBanner, removeIcon, removeBanner, saveShots, addShots, removeShots, recrop, forget, original, originals,
} = store;

/** Saves a SteamGridDB picture (its own image host only) as the banner. */
export async function saveBannerFromSgdb(id, url, game = null, { fetchImpl = fetch } = {}) {
  return saveBanner(id, await fetchSgdbImage(url, { fetchImpl }), { source: "sgdb", game });
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

/**
 * Whether a part is still to be filled in automatically: never one the folder has,
 * nor one found before and since taken out of the folder by hand.
 */
function due(id, key, now) {
  const p = pictures(id);
  if (key === "banner" ? p.banner : p.shots.length) return false;
  const part = record(id)[key];
  if (part?.source) {
    put(id, key, { off: true });
    return false;
  }
  if (part?.off) return false;
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
      return (apiKey && due(e.id, "banner", now())) || (shotsOn && due(e.id, "shots", now()));
    });
    if (!todo.length) return 0;
    const job = activity.begin("homebrew-art", { title: "포트 그림을 찾습니다", total: todo.length });
    let got = 0;
    for (const [i, e] of todo.entries()) {
      if (job.stopped) break;
      job.step(i, e.name);
      let names = searchNames(e);
      // Each part on its own: a banner that fails never keeps the screenshots from being looked for.
      // An answer that will not change (a picture that cannot be read, a 4xx) is a miss, not a retry every pass.
      const failed = (part, err) => {
        debug.error("homebrew media: %s %s: %s", e.id, part, err.message);
        if (err instanceof MediaImageError || /\b4\d\d\b/.test(err.message)) put(e.id, part, { miss: now() });
      };
      const bannerDue = () => due(e.id, "banner", now());
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
      if (shotsOn && due(e.id, "shots", now())) {
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
            else if (due(e.id, "shots", now())) got += await saveShots(e.id, raws, { source: "igdb", game: found.game });
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
  store.resetForTests();
  filling = null;
}
