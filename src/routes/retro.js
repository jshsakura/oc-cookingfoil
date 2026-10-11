/**
 * Retro games for RetroArch on the Switch. Off (404) until the retro folder
 * (COOK_RETRO_DIR, default <data dir>/retro) exists.
 *
 *   GET /api/retro/systems                       { systems: [{ id, name, names, defaultCore, coreName, romCount, iconUrl, iconMonoUrl }] }
 *   GET /api/retro/systems/:id/icon[?style=mono] the console's icon (from <retro dir>/system-icons/{color,mono}/<folder>.png)
 *   GET /api/retro/games?system=&q=&sort=name|added|size|rating&page=&pageSize=
 *                                                { total, page, pageSize, games: [G…] }  (search= is q's old name)
 *   GET /api/retro/home?limit=20                 { systems: [{ id, name, names, iconUrl, iconMonoUrl, defaultCore, romCount, games: [G…] }] }
 *                                                the best-rated games of every console that has any
 *   GET /api/retro/games/:id                     G
 *   GET /api/retro/games/:id/rom                 the game file (Range works)
 *   GET /api/retro/games/:id/icon?size=sm|md     square box art for tiles, 160 or 256 px JPEG (default md);
 *                                                drawn ahead of time, cached for a year with the ?v= of iconUrl
 *   GET /api/retro/games/:id/boxart              the box art as it is
 *   GET /api/retro/games/:id/bezel.png | overlay.cfg | game.cfg
 *   GET /api/retro/games/:id/bundle              tar of everything below, SD-root paths
 *   GET /api/retro/base-pack/manifest            { version, bundleUrl, bundleSize, files: [{ path, size, sha256, url, once? }] }
 *   GET /api/retro/base-pack/file/<sd path>      one pack file (Range works)
 *   GET /api/retro/base-pack/bundle              the whole pack as one tar, SD-root paths (also at /base-pack);
 *                                                X-Retro-Once lists the files to skip when already on the card
 *
 * G = { id, name, original?, rating?, ratingCount?, file, system, core, size, addedAt, iconUrl, boxartUrl, romUrl, bundleUrl,
 *       bezel: { hasBezel, generic?, imageUrl, overlayCfgUrl, gameCfgUrl },
 *       forwarderUrl: null, install: { rom, extras, bezelPng, overlayCfg, gameCfg } }
 *
 * Bundle and pack paths are relative to the SD root: roms/<system>/…,
 * retroarch/overlays/GameBezels/<System>/…, retroarch/config/<Core>/…,
 * switch/retroarch_switch.nro. A file marked `once` is only written when the
 * card doesn't have it yet (retroarch.cfg holds the player's own settings).
 * Home-screen forwarders are not built yet, so forwarderUrl is always null.
 */
import fs from "fs";
import path from "path";
import express from "express";
import debug from "../debug.js";
import { retroDir, dataDir } from "../helpers/envs.js";
import * as catalog from "../retro/catalog.js";
import { sdPaths, overlayCfg, gameCfg } from "../retro/bezel-config.js";
import { buildManifest, listPack, HashCache } from "../retro/base-pack.js";
import { sendTar, tarEntries } from "../helpers/tar-stream.js";
import { archiveSize } from "../helpers/ustar.js";
import { artKey, ensureSquare, prewarm, SQUARE_SIZES } from "../retro/square-art.js";

const ID_RE = /^[a-z0-9_-]{1,24}-[0-9a-f]{10}$/;
const PAGE_MAX = 200;
const MANIFEST_STALE_MS = 60_000;
const FIRST_HASH_WAIT_MS = 3000;
const byName = (a, b) => a.name.localeCompare(b.name);
const SORTS = {
  name: byName,
  // Rated games first, best first; the unrated after them by name.
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0) || byName(a, b),
  added: (a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name),
  size: (a, b) => b.size - a.size || a.name.localeCompare(b.name),
};

export const retroEnabled = () => fs.existsSync(retroDir);

// RetroArch itself: <retro dir>/retroarch/ (or base-pack/, the earlier name).
const artDir = path.join(dataDir, "retro-art");
const packDir = () => (fs.existsSync(path.join(retroDir, "retroarch")) ? path.join(retroDir, "retroarch") : path.join(retroDir, "base-pack"));
let hashCache = null;
let manifest = null; // { version, files, sources, builtAt }
let building = null;

function rebuildManifest() {
  if (building) return building;
  hashCache ??= new HashCache(path.join(dataDir, "retro-hashes.json"));
  building = buildManifest(packDir(), hashCache)
    .then((m) => (manifest = { ...m, builtAt: Date.now() }))
    .finally(() => (building = null));
  return building;
}

/** The manifest; stale ones refresh in the background, the first waits a little then reports pending. */
async function currentManifest() {
  if (manifest && Date.now() - manifest.builtAt <= MANIFEST_STALE_MS) return manifest;
  const running = rebuildManifest().catch((err) => {
    debug.error("retro: base pack manifest failed: %s", err.message);
    return null;
  });
  if (manifest) return manifest;
  const timeout = new Promise((resolve) => setTimeout(resolve, FIRST_HASH_WAIT_MS, "pending"));
  const result = await Promise.race([running, timeout]);
  return result === "pending" ? null : result;
}

/** A console's icon file, or null. Only names from the system table reach the disk. */
function systemIcon(system, style) {
  if (!system?.folder) return null;
  const file = path.join(retroDir, "system-icons", style, `${system.folder}.png`);
  return fs.existsSync(file) ? file : null;
}

/** Text for matching: NFC, lower case, no spaces. Pure. */
const folded = (s) => String(s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, "");
/** A game matches on its name, its original title or its file name. */
const gameMatches = (g, needle) => [g.name, g.original, g.file].some((s) => s && folded(s).includes(needle));

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

function publicGame(g, systems) {
  const system = systems[g.system];
  const paths = sdPaths(g, system);
  const base = `/api/retro/games/${g.id}`;
  return {
    id: g.id,
    name: g.name,
    ...(g.original ? { original: g.original } : {}),
    ...(g.rating !== undefined ? { rating: g.rating } : {}),
    ...(g.ratingCount ? { ratingCount: g.ratingCount } : {}),
    file: g.file,
    system: g.system,
    core: g.core,
    size: g.size,
    addedAt: g.addedAt,
    iconUrl: g.icon ? `${base}/icon?v=${artKey(g)}` : null,
    boxartUrl: g.icon ? `${base}/boxart` : null,
    romUrl: `${base}/rom`,
    bundleUrl: `${base}/bundle`,
    bezel: g.bezel
      ? { hasBezel: true, generic: g.bezel.generic, imageUrl: `${base}/bezel.png`, overlayCfgUrl: `${base}/overlay.cfg`, gameCfgUrl: paths.gameCfg ? `${base}/game.cfg` : null }
      : { hasBezel: false },
    forwarderUrl: null,
    install: {
      rom: paths.rom,
      extras: g.extras.map((x) => paths.extra(x.rel)),
      ...(g.bezel ? { bezelPng: paths.bezelPng, overlayCfg: paths.overlayCfg, gameCfg: paths.gameCfg } : {}),
    },
  };
}

/** Every file of one game's bundle, SD-relative. */
function bundleFiles(g, system) {
  const paths = sdPaths(g, system);
  const fileEntry = (sd, abs, size, mtimeMs) => ({ path: sd, abs, size, mtime: mtimeMs / 1000 });
  const now = Date.now() / 1000;
  const made = (sd, text) => {
    const data = Buffer.from(text);
    return { path: sd, data, size: data.length, mtime: now };
  };
  // A multi-disc game's .m3u is made up on the spot; its discs ride along as extras.
  const rom = g.m3u ? made(paths.rom, g.m3u) : fileEntry(paths.rom, g.abs, fs.statSync(g.abs).size, g.mtimeMs);
  const files = [rom, ...g.extras.map((x) => fileEntry(paths.extra(x.rel), x.abs, x.size, x.mtimeMs))];
  if (!g.bezel) return files;
  const disk = (abs) => fs.statSync(abs);
  files.push(fileEntry(paths.bezelPng, g.bezel.png, disk(g.bezel.png).size, disk(g.bezel.png).mtimeMs));
  files.push(g.bezel.cfg ? fileEntry(paths.overlayCfg, g.bezel.cfg, disk(g.bezel.cfg).size, disk(g.bezel.cfg).mtimeMs) : made(paths.overlayCfg, overlayCfg(g)));
  if (paths.gameCfg) {
    files.push(g.bezel.override ? fileEntry(paths.gameCfg, g.bezel.override, disk(g.bezel.override).size, disk(g.bezel.override).mtimeMs) : made(paths.gameCfg, gameCfg(g, system)));
  }
  return files;
}

function sendFile(res, abs, type) {
  res.set("Cache-Control", "private, no-cache");
  if (type) res.type(type);
  res.sendFile(abs, { dotfiles: "allow", acceptRanges: true });
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default function retroRouter() {
  const router = express.Router();

  // Draw square tiles ahead of time after every scan, starting with one at boot.
  catalog.onScan((state) => prewarm(artDir, state.games).catch((err) => debug.error("retro: square art: %s", err.message)));
  if (retroEnabled()) setImmediate(() => catalog.current(retroDir).catch(() => {}));

  router.use((req, res, next) => (retroEnabled() ? next() : res.status(404).json({ error: "retro games are not set up on this server" })));

  router.get("/systems", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    res.set("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({
      systems: catalog.systemsOf(cat).map((s) => ({
        ...s,
        iconUrl: systemIcon(cat.systems[s.id], "color") ? `/api/retro/systems/${s.id}/icon` : null,
        iconMonoUrl: systemIcon(cat.systems[s.id], "mono") ? `/api/retro/systems/${s.id}/icon?style=mono` : null,
      })),
    });
  }));

  router.get("/home", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const bySystem = new Map();
    for (const g of cat.games) bySystem.set(g.system, [...(bySystem.get(g.system) ?? []), g]);
    res.set("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({
      systems: catalog.systemsOf(cat)
        .filter((s) => s.romCount > 0)
        .map((s) => ({
          ...s,
          iconUrl: systemIcon(cat.systems[s.id], "color") ? `/api/retro/systems/${s.id}/icon` : null,
          iconMonoUrl: systemIcon(cat.systems[s.id], "mono") ? `/api/retro/systems/${s.id}/icon?style=mono` : null,
          games: [...(bySystem.get(s.id) ?? [])].sort(SORTS.rating).slice(0, limit).map((g) => publicGame(g, cat.systems)),
        })),
    });
  }));

  router.get("/systems/:system/icon", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const file = systemIcon(cat.systems[req.params.system], req.query.style === "mono" ? "mono" : "color");
    if (!file) return res.status(404).json({ error: "no icon" });
    sendFile(res, file, "png");
  }));

  router.get("/games", wrap(async (req, res) => {
    const cat = await catalog.current(retroDir);
    const system = typeof req.query.system === "string" ? req.query.system : "";
    const raw = typeof req.query.q === "string" ? req.query.q : typeof req.query.search === "string" ? req.query.search : "";
    const search = folded(raw);
    const sort = SORTS[req.query.sort] ?? SORTS.name;
    const pageSize = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 50));
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const matches = cat.games
      .filter((g) => (!system || g.system === system) && (!search || gameMatches(g, search)))
      .sort(sort);
    res.set("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({
      total: matches.length,
      page,
      pageSize,
      games: matches.slice((page - 1) * pageSize, page * pageSize).map((g) => publicGame(g, cat.systems)),
    });
  }));

  // Everything below names one game; an unknown or malformed id is a 404.
  router.param("id", (req, res, next, id) => {
    (ID_RE.test(id) ? catalog.current(retroDir) : Promise.resolve(null))
      .then((cat) => {
        const game = cat?.byId.get(id);
        if (!game) return res.status(404).json({ error: "no such game" });
        req.retro = { game, system: cat.systems[game.system], systems: cat.systems };
        next();
      })
      .catch(next);
  });

  router.get("/games/:id", (req, res) => res.json(publicGame(req.retro.game, req.retro.systems)));
  router.get("/games/:id/rom", (req, res) => {
    res.attachment(req.retro.game.file);
    if (req.retro.game.m3u) return res.type("text/plain").send(req.retro.game.m3u);
    sendFile(res, req.retro.game.abs);
  });
  router.get("/games/:id/icon", wrap(async (req, res) => {
    const size = Object.hasOwn(SQUARE_SIZES, req.query.size) ? req.query.size : "md";
    const square = await ensureSquare(artDir, req.retro.game, size);
    if (!square) return res.status(404).json({ error: "no icon" });
    // ?v= names one version of the cover, so that URL never changes underneath a cache.
    const versioned = req.query.v && req.query.v === artKey(req.retro.game);
    res.set("Cache-Control", versioned ? "public, max-age=31536000, immutable" : "private, no-cache");
    res.type("jpeg");
    res.sendFile(square, { dotfiles: "allow" });
  }));
  router.get("/games/:id/boxart", (req, res) => (req.retro.game.icon ? sendFile(res, req.retro.game.icon) : res.status(404).json({ error: "no box art" })));
  router.get("/games/:id/bezel.png", (req, res) => (req.retro.game.bezel ? sendFile(res, req.retro.game.bezel.png, "png") : res.status(404).json({ error: "no bezel" })));
  router.get("/games/:id/overlay.cfg", (req, res) => {
    const { game } = req.retro;
    if (!game.bezel) return res.status(404).json({ error: "no bezel" });
    if (game.bezel.cfg) return sendFile(res, game.bezel.cfg, "text/plain");
    res.type("text/plain").send(overlayCfg(game));
  });
  router.get("/games/:id/game.cfg", (req, res) => {
    const { game, system } = req.retro;
    if (!game.bezel || !system.coreName) return res.status(404).json({ error: "no bezel" });
    if (game.bezel.override) return sendFile(res, game.bezel.override, "text/plain");
    res.type("text/plain").send(gameCfg(game, system));
  });
  router.get("/games/:id/bundle", (req, res) => {
    const { game, system } = req.retro;
    sendTar(res, bundleFiles(game, system), { filename: `${game.id}.tar`, label: "retro" });
  });
  router.get("/games/:id/forwarder.nsp", (req, res) => res.status(404).json({ error: "forwarders are not built yet" }));

  router.get("/base-pack/manifest", wrap(async (req, res) => {
    const m = await currentManifest();
    if (!m) {
      res.set({ "Retry-After": "30", "Cache-Control": "no-store" });
      return res.status(503).json({ error: "the base pack is still being read", retryAfter: 30 });
    }
    res.set("Cache-Control", "private, max-age=0, must-revalidate");
    res.set("ETag", `"${m.version}"`);
    if (req.fresh) return res.status(304).end();
    res.json({
      version: m.version,
      bundleUrl: "/api/retro/base-pack/bundle",
      bundleSize: archiveSize(tarEntries(m.files)),
      files: m.files.map((f) => ({ ...f, url: `/api/retro/base-pack/file/${enc(f.path)}` })),
    });
  }));

  router.get("/base-pack/file/*", wrap(async (req, res) => {
    const sd = req.params[0];
    // Only paths the pack lists: a request never becomes a path on disk by itself.
    const listed = (manifest?.sources ?? new Map((await listPack(packDir())).map((f) => [f.path, f]))).get(sd);
    if (!listed || !fs.existsSync(listed.abs)) return res.status(404).json({ error: "not in the base pack" });
    res.attachment(path.basename(sd));
    sendFile(res, listed.abs);
  }));

  // One request for the whole pack: thousands of per-file GETs run into the rate limit.
  router.get(["/base-pack", "/base-pack/bundle"], wrap(async (req, res) => {
    const files = await listPack(packDir());
    if (!files.length) return res.status(404).json({ error: "the base pack is empty" });
    // A tar can't say "only if missing", so name those files for the client to skip.
    res.set("X-Retro-Once", files.filter((f) => f.once).map((f) => f.path).join(","));
    sendTar(res, files.map((f) => ({ path: f.path, abs: f.abs, size: f.size, mtime: f.mtimeMs / 1000 })), {
      filename: "retroarch-base-pack.tar",
      etag: manifest?.version,
      label: "retro",
    });
  }));

  return router;
}
