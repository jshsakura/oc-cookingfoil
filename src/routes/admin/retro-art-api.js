/**
 * Retro box art and bezels from the admin page (retro tab):
 *
 *   GET  /admin/api/retro-art                      per system: games, with box art (borrowed: an arcade set showing
 *                                                  another set's art of its game), with their own bezel;
 *                                                  the games still without box art; the running or last job;
 *                                                  bios: [{ id, name, missing: [[file…]] }] for consoles that have
 *                                                  games but lack firmware (src/retro/bios.js), never for the others
 *                                                  pack: RetroArch and the core files the games need (src/retro/pack-status.js)
 *                                                  requirements: the cores and firmware the games in the library
 *                                                  need, per system with games (src/retro/requirements.js)
 *                                                  unread: folder names under roms/ that no system reads
 *   POST /admin/api/retro-art/sync      { system? } match and download what is missing (one job at a time)
 *   GET  /admin/api/retro-art/candidates?game=&q=  libretro names to pick from, with preview addresses
 *   POST /admin/api/retro-art/match     { game, name }   use that name's box art and bezel (null: no art)
 *   GET  /admin/api/retro-art/sgdb?q=              SteamGridDB games for a title (needs its key)
 *   GET  /admin/api/retro-art/sgdb/:id             that game's covers
 *   POST /admin/api/retro-art/cover     { game, url }    use a SteamGridDB cover as the game's box art
 *   POST /admin/api/retro-art/cover/upload?game=   the image itself as the body (jpg, png, webp …):
 *                                                  shrunk to a small PNG and used as the game's box art
 *   GET  /admin/api/retro-art/games?q=             every game whose name matches, art or not (at most 500)
 *   POST /admin/api/retro-art/ratings              refresh LaunchBox ratings (one job at a time)
 *   GET  /admin/api/retro/requirements             the same requirements alone, read-only (an API token may read it):
 *                                                  what the operator still has to put in, and which core file each
 *                                                  system's games start with
 *
 * Ratings also refresh by themselves once ratings.json is a week old (COOK_RATING_SYNC).
 *
 * Every change rescans the catalog, so the list tiles follow at once.
 */
import fs from "fs";
import express from "express";
import path from "path";
import debug from "../../debug.js";
import { dataDir, publicBaseUrl, ratingSync, retroDir } from "../../helpers/envs.js";
import { resolveOrigin } from "../../helpers/origin.js";
import { refreshRatings } from "../../retro/art/ratings.js";
import * as retroCatalog from "../../retro/catalog.js";
import { firmwareDir, listFirmware, missingBios } from "../../retro/bios.js";
import { packDirOf, packStatus } from "../../retro/pack-status.js";
import { requirements } from "../../retro/requirements.js";
import { unreadReasons } from "../../retro/systems.js";
import * as retroNames from "../../retro/names.js";
import { rebuildRetroShortcut, retroMetaKey } from "../retro.js";
import * as metaStore from "../../retro/meta/store.js";
import * as metaEdits from "../../retro/meta/edits.js";
import { GENRE_LABELS } from "../../meta/categories.js";
import * as art from "../../retro/art/sync.js";
import * as integrations from "../../security/integrations.js";
import * as activity from "../../tasks/activity.js";

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
      retroCatalog.scan(retroDir).catch((err) => debug.error("retro: rescan after an art change failed: %s", err.message));
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
  if (ratingsTimer) return;
  const tick = () => {
    if (ratingSync && fs.existsSync(path.join(retroDir, "art-map")) && ratingsAge() > RATINGS_MAX_AGE_MS) startRatings();
  };
  setTimeout(tick, RATINGS_FIRST_CHECK_MS).unref();
  ratingsTimer = setInterval(tick, RATINGS_CHECK_MS);
  ratingsTimer.unref();
}

// The name a game's art is filed under (kept here too for the upload tab).
export const romKey = retroCatalog.romKey;

const ghToken = () => integrations.get("github").token;

function overview(catalog) {
  const systems = {};
  const missing = [];
  for (const g of catalog.games) {
    const s = (systems[g.system] ??= { id: g.system, name: catalog.systems[g.system]?.names?.ko ?? g.system, games: 0, boxart: 0, borrowed: 0, bezel: 0 });
    s.games++;
    if (g.icon) {
      s.boxart++;
      if (g.iconFrom) s.borrowed++;
    } else missing.push({ id: g.id, system: g.system, name: g.name, title: retroNames.get(g.id), rom: romKey(g), original: g.original ?? null });
    if (g.bezel && !g.bezel.generic) s.bezel++;
  }
  return { systems: Object.values(systems), missing };
}

/** The firmware missing for the consoles that have games, with their Korean names. `files` is the system folder's listing. */
function biosNotices(catalog, files) {
  const ids = catalog.games.map((g) => g.system);
  return missingBios(ids, files).map((x) => ({ ...x, name: catalog.systems[x.id]?.names?.ko ?? x.id }));
}

/** The old notices and the requirements view, from one listing of the system folder. */
async function firmwareViews(catalog) {
  const dir = firmwareDir(retroDir);
  const files = await listFirmware(dir);
  const req = await requirements({ games: catalog.games, systems: catalog.systems, packDir: packDirOf(retroDir), firmwareDir: dir, files });
  return { bios: biosNotices(catalog, files), requirements: req };
}

/** The cores and firmware the library's games need (GET /admin/api/retro/requirements; capabilities/retro.js). */
export async function retroRequirements() {
  return (await firmwareViews(await retroCatalog.current(retroDir))).requirements;
}

/**
 * Starts the cover and bezel download for every console with ROMs (or `only`). { job, done } with `done`
 * resolving to the summary, or { error, status } when one is already running or the console is unknown.
 * The one-go pack fill (retro-pack-api.js) runs the same job as its last step.
 */
export async function startArtSync(only = null) {
  if (job && !job.finishedAt) return { error: "이미 정리하고 있습니다", status: 409, job };
  const catalog = await retroCatalog.current(retroDir);
  if (only && !catalog.systems[only]) return { error: "없는 시스템입니다", status: 400 };
  const roms = {};
  for (const g of catalog.games) (roms[g.system] ??= []).push(romKey(g));
  const current = (job = { system: only, startedAt: Date.now(), progress: null });
  const act = activity.begin("retro-art", { title: only ? `레트로 그림을 정리합니다 (${only})` : "레트로 그림을 정리합니다" });
  const done = art.syncArt(retroDir, catalog.systems, roms, { only, token: ghToken(), onProgress: (p) => { current.progress = p; act.total(p.total); act.step(p.index, p.system); } })
    .then((summary) => { current.summary = summary; act.done(); return summary; })
    .catch((err) => { current.error = err.message; act.fail(err); throw err; })
    .finally(async () => {
      current.finishedAt = Date.now();
      await retroCatalog.scan(retroDir).catch((err) => debug.error("retro: rescan after an art change failed: %s", err.message));
      debug.log("admin retro-art: sync %s done", only ?? "all");
    });
  done.catch(() => {});
  return { job: current, done };
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

  // Folders under roms/ no system reads: unknown names, and look-alikes held back by a system folder that has games.
  const unreadNotices = (dir, systems) => {
    const all = unreadReasons(dir, systems);
    return {
      unread: all.filter((r) => !r.by).map((r) => r.folder),
      shadowed: all.filter((r) => r.by).map((r) => ({ folder: r.folder, by: r.by, system: r.system, names: systems[r.system].names })),
    };
  };

  router.get("/api/retro-art", guarded(async (_req, res) => {
    const age = ratingsAge();
    const catalog = await retroCatalog.current(retroDir);
    res.json({ ...overview(catalog), ...(await firmwareViews(catalog)), pack: packStatus(packDirOf(retroDir), catalog.games, catalog.systems), ...unreadNotices(retroDir, catalog.systems), job, ratings: { job: ratingsJob, updatedAt: Number.isFinite(age) ? Date.now() - age : null }, steamgriddb: integrations.configured("steamgriddb"), github: integrations.configured("github") });
  }));

  router.get("/api/retro/requirements", guarded(async (_req, res) => {
    res.json(await retroRequirements());
  }));

  router.post("/api/retro-art/sync", guarded(async (req, res) => {
    const started = await startArtSync(req.body?.system ? String(req.body.system) : null);
    if (started.error) return res.status(started.status).json({ error: started.error, ...(started.job ? { job: started.job } : {}) });
    res.status(202).json({ job: started.job });
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
    rebuildRetroShortcut(found.g.id);
    res.json({ boxart: "ok" });
  }));

  const imageBody = express.raw({ type: "image/*", limit: art.MAX_COVER_BYTES });
  // The session is checked before the body is read, so only an admin can send megabytes.
  router.post("/api/retro-art/cover/upload", guarded(async (req, res) => {
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, publicBaseUrl)) return res.status(403).json({ error: "origin mismatch" });
    const bad = await new Promise((resolve) => imageBody(req, res, resolve));
    if (bad) return res.status(bad.type === "entity.too.large" ? 413 : 400).json({ error: bad.type === "entity.too.large" ? "15 MB 보다 큰 이미지는 받지 않습니다" : "이미지를 받지 못했습니다" });
    if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: "이미지 파일을 올립니다" });
    const found = await gameOf(req.query.game);
    if (!found) return res.status(404).json({ error: "없는 항목입니다" });
    try {
      const bytes = await art.saveCoverImage(retroDir, found.system, romKey(found.g), req.body);
      await retroCatalog.scan(retroDir);
      rebuildRetroShortcut(found.g.id);
      debug.log("admin retro-art: %s cover uploaded (%d → %d bytes)", found.g.id, req.body.length, bytes);
      res.json({ boxart: "ok", from: req.body.length, bytes });
    } catch (err) {
      if (!(err instanceof art.CoverImageError)) throw err;
      res.status(400).json({ error: err.message });
    }
  }));

  // Deletes a game's ROM and the disc files it names; its box art stays for a re-upload.
  router.post("/api/retro-art/games/remove", guarded(async (req, res) => {
    const catalog = await retroCatalog.current(retroDir);
    const g = catalog.byId.get(String(req.body?.game ?? ""));
    if (!g) return res.status(404).json({ error: "목록에 없는 게임입니다" });
    const romsRoot = path.resolve(retroDir, "roms") + path.sep;
    const files = [g.abs, ...(g.extras ?? []).map((x) => x.abs)].filter((f) => f && path.resolve(f).startsWith(romsRoot));
    for (const f of files) await fs.promises.rm(f, { force: true });
    await retroCatalog.scan(retroDir);
    debug.log("admin: retro game %s/%s removed (%d files)", g.system, g.rel, files.length);
    res.json({ ok: true, files: files.length });
  }));

  // The name clients show for a game: { ko, en }, both empty = the file's own again.
  router.post("/api/retro-art/games/name", guarded(async (req, res) => {
    const catalog = await retroCatalog.current(retroDir);
    const g = catalog.byId.get(String(req.body?.game ?? ""));
    if (!g) return res.status(404).json({ error: "목록에 없는 게임입니다" });
    retroNames.set(g.id, { ko: req.body?.ko, en: req.body?.en });
    // The shortcut carries the name too: built again in the background.
    rebuildRetroShortcut(g.id);
    debug.log("admin: retro game %s named", g.id);
    res.json({ ok: true, title: retroNames.get(g.id) });
  }));

  // The details clients show for a game (its versions share them): what was collected, and the admin's edit over it.
  router.get("/api/retro-art/games/meta", guarded(async (req, res) => {
    const catalog = await retroCatalog.current(retroDir);
    const g = catalog.byId.get(String(req.query.game ?? ""));
    if (!g) return res.status(404).json({ error: "목록에 없는 게임입니다" });
    const key = retroMetaKey(catalog, g);
    const collected = metaStore.get(key);
    res.json({
      key,
      collected: collected && !collected.miss ? collected : null,
      edit: metaEdits.get(key),
      genres: Object.entries(GENRE_LABELS).map(([k, l]) => ({ key: k, name: l.ko ?? l.en })),
    });
  }));

  // { description: { ko, en }, publisher, developer, year, players, genres }; an empty field goes back to what was collected.
  router.post("/api/retro-art/games/meta", guarded(async (req, res) => {
    const catalog = await retroCatalog.current(retroDir);
    const g = catalog.byId.get(String(req.body?.game ?? ""));
    if (!g) return res.status(404).json({ error: "목록에 없는 게임입니다" });
    const { year, players } = req.body ?? {};
    if (year !== undefined && year !== null && year !== "" && !/^(19[5-9]\d|20\d\d|2100)$/.test(String(year))) return res.status(400).json({ error: "발매 연도는 1950에서 2100 사이의 네 자리 숫자로 넣습니다." });
    if (players !== undefined && players !== null && players !== "" && !/^([1-9]|[1-5]\d|6[0-4])$/.test(String(players))) return res.status(400).json({ error: "최대 인원은 1에서 64 사이의 숫자로 넣습니다." });
    const key = retroMetaKey(catalog, g);
    const edit = metaEdits.set(key, req.body ?? {});
    debug.log("admin: retro game %s details %s", key, edit ? "edited" : "back to collected");
    res.json({ key, edit });
  }));

  router.get("/api/retro-art/games", guarded(async (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase().slice(0, 100);
    if (!q) return res.json({ games: [] });
    const catalog = await retroCatalog.current(retroDir);
    const games = catalog.games
      .filter((g) => [g.name, g.original, ...Object.values(retroNames.get(g.id) ?? {})].some((s) => (s ?? "").toLowerCase().includes(q)))
      .slice(0, 500)
      .map((g) => ({ id: g.id, system: g.system, name: g.name, title: retroNames.get(g.id), rom: romKey(g), original: g.original ?? null, boxart: Boolean(g.icon) }));
    res.json({ games });
  }));
}
