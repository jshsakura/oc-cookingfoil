/**
 * Retro box art and bezels from the admin page (retro tab):
 *
 *   GET  /admin/api/retro-art                      per system: games, with box art, with their own bezel;
 *                                                  the games without box art; the running or last job
 *   POST /admin/api/retro-art/sync      { system? } match and download what is missing (one job at a time)
 *   GET  /admin/api/retro-art/candidates?game=&q=  libretro names to pick from, with preview addresses
 *   POST /admin/api/retro-art/match     { game, name }   use that name's box art and bezel (null: no art)
 *   GET  /admin/api/retro-art/sgdb?q=              SteamGridDB games for a title (needs its key)
 *   GET  /admin/api/retro-art/sgdb/:id             that game's covers
 *   POST /admin/api/retro-art/cover     { game, url }    use a SteamGridDB cover as the game's box art
 *   POST /admin/api/retro-art/ratings              refresh LaunchBox ratings (one job at a time)
 *
 * Ratings also refresh by themselves once ratings.json is a week old (COOK_RATING_SYNC).
 *
 * Every change rescans the catalog, so the list tiles follow at once.
 */
import fs from "fs";
import path from "path";
import debug from "../../debug.js";
import { dataDir, ratingSync, retroDir } from "../../helpers/envs.js";
import { refreshRatings } from "../../retro/art/ratings.js";
import * as retroCatalog from "../../retro/catalog.js";
import * as art from "../../retro/art/sync.js";
import * as integrations from "../../security/integrations.js";

let job = null; // { system, startedAt, progress, finishedAt?, summary?, error? }
let ratingsJob = null; // { startedAt, finishedAt?, summary?, error? }

const RATINGS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RATINGS_CHECK_MS = 6 * 60 * 60 * 1000;
const RATINGS_FIRST_CHECK_MS = 10 * 60 * 1000;
const ratingsFile = () => path.join(retroDir, "ratings.json");

/** Starts a ratings refresh unless one is running; the catalog picks the new file up on its next scan. */
function startRatings() {
  if (ratingsJob && !ratingsJob.finishedAt) return ratingsJob;
  const current = (ratingsJob = { startedAt: Date.now() });
  refreshRatings(retroDir, path.join(dataDir, "launchbox"))
    .then((summary) => { current.summary = summary; })
    .catch((err) => { current.error = err.message; debug.error("retro ratings: %s", err.message); })
    .finally(() => {
      current.finishedAt = Date.now();
      retroCatalog.scan(retroDir).catch(() => {});
    });
  return current;
}

function ratingsAge() {
  try {
    return Date.now() - fs.statSync(ratingsFile()).mtimeMs;
  } catch {
    return Infinity;
  }
}

let ratingsTimer = null;
/** Weekly ratings, while the retro folder exists and COOK_RATING_SYNC is on. */
function scheduleRatings() {
  if (ratingsTimer || !ratingSync) return;
  const tick = () => {
    if (fs.existsSync(path.join(retroDir, "art-map")) && ratingsAge() > RATINGS_MAX_AGE_MS) startRatings();
  };
  setTimeout(tick, RATINGS_FIRST_CHECK_MS).unref();
  ratingsTimer = setInterval(tick, RATINGS_CHECK_MS);
  ratingsTimer.unref();
}

/** The name a game's art is filed under: its file name, or its first disc's for a multi-disc game. */
export function romKey(g) {
  if (g.keepFileName) return path.basename(g.rel, path.extname(g.rel)); // arcade: the set name
  const first = g.m3u ? g.extras[0]?.rel : null;
  return first ? path.basename(first, path.extname(first)) : g.name;
}

const ghToken = () => integrations.get("github").token;

function overview(catalog) {
  const systems = {};
  const missing = [];
  for (const g of catalog.games) {
    const s = (systems[g.system] ??= { id: g.system, name: catalog.systems[g.system]?.names?.ko ?? g.system, games: 0, boxart: 0, bezel: 0 });
    s.games++;
    if (g.icon) s.boxart++;
    else missing.push({ id: g.id, system: g.system, name: g.name, rom: romKey(g), original: g.original ?? null });
    if (g.bezel && !g.bezel.generic) s.bezel++;
  }
  return { systems: Object.values(systems), missing };
}

export function mountRetroArtApi(router, requireSession) {
  scheduleRatings();
  const guarded = (handler) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (err) {
      debug.error("admin retro-art: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  };
  const gameOf = async (id) => {
    const catalog = await retroCatalog.current(retroDir);
    const g = catalog.byId.get(String(id ?? ""));
    return g ? { g, system: catalog.systems[g.system] } : null;
  };

  router.get("/api/retro-art", guarded(async (_req, res) => {
    const age = ratingsAge();
    res.json({ ...overview(await retroCatalog.current(retroDir)), job, ratings: { job: ratingsJob, updatedAt: Number.isFinite(age) ? Date.now() - age : null }, steamgriddb: integrations.configured("steamgriddb") });
  }));

  router.post("/api/retro-art/sync", guarded(async (req, res) => {
    if (job && !job.finishedAt) return res.status(409).json({ error: "이미 정리하고 있습니다", job });
    const only = req.body?.system ? String(req.body.system) : null;
    const catalog = await retroCatalog.current(retroDir);
    if (only && !catalog.systems[only]) return res.status(400).json({ error: "없는 시스템입니다" });
    const roms = {};
    for (const g of catalog.games) (roms[g.system] ??= []).push(romKey(g));
    job = { system: only, startedAt: Date.now(), progress: null };
    res.status(202).json({ job });
    const current = job;
    art.syncArt(retroDir, catalog.systems, roms, { only, token: ghToken(), onProgress: (p) => { current.progress = p; } })
      .then((summary) => { current.summary = summary; })
      .catch((err) => { current.error = err.message; })
      .finally(async () => {
        current.finishedAt = Date.now();
        await retroCatalog.scan(retroDir).catch(() => {});
        debug.log("admin retro-art: sync %s done", only ?? "all");
      });
  }));

  router.post("/api/retro-art/ratings", guarded(async (_req, res) => {
    res.status(202).json({ job: startRatings() });
  }));

  router.get("/api/retro-art/candidates", guarded(async (req, res) => {
    const found = await gameOf(req.query.game);
    if (!found) return res.status(404).json({ error: "없는 항목입니다" });
    const q = String(req.query.q ?? "").trim() || found.g.original || found.g.name;
    const names = await art.candidates(found.g.system, found.system, q, { token: ghToken() });
    res.json({ q, names: names.map((name) => ({ name, preview: art.libretroUrl(found.system, name) })) });
  }));

  router.post("/api/retro-art/match", guarded(async (req, res) => {
    const found = await gameOf(req.body?.game);
    if (!found) return res.status(404).json({ error: "없는 항목입니다" });
    const name = req.body?.name == null ? null : String(req.body.name);
    if (name !== null && (!name.trim() || name.includes("/") || name.includes(".."))) return res.status(400).json({ error: "이름이 맞지 않습니다" });
    const result = await art.applyMatch(retroDir, found.g.system, found.system, romKey(found.g), name);
    await retroCatalog.scan(retroDir);
    debug.log("admin retro-art: %s → %s", found.g.id, name ?? "(none)");
    res.json(result);
  }));

  router.get("/api/retro-art/sgdb", guarded(async (req, res) => {
    const { apiKey } = integrations.get("steamgriddb");
    if (!apiKey) return res.status(409).json({ error: "SteamGridDB 키가 없습니다" });
    res.json({ games: await art.sgdbSearch(String(req.query.q ?? "").slice(0, 100), apiKey) });
  }));

  router.get("/api/retro-art/sgdb/:id", guarded(async (req, res) => {
    const { apiKey } = integrations.get("steamgriddb");
    if (!apiKey) return res.status(409).json({ error: "SteamGridDB 키가 없습니다" });
    if (!/^\d{1,10}$/.test(req.params.id)) return res.status(400).json({ error: "번호가 맞지 않습니다" });
    res.json({ covers: await art.sgdbCovers(req.params.id, apiKey) });
  }));

  router.post("/api/retro-art/cover", guarded(async (req, res) => {
    const found = await gameOf(req.body?.game);
    if (!found) return res.status(404).json({ error: "없는 항목입니다" });
    await art.saveCover(retroDir, found.system, romKey(found.g), String(req.body?.url ?? ""));
    await retroCatalog.scan(retroDir);
    res.json({ boxart: "ok" });
  }));
}
