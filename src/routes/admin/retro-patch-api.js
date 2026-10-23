/**
 * Patches the admin applies to one retro ROM of the library (retro/rom-patch.js), from the admin
 * page (retro tab):
 *
 *   GET  /admin/api/retro-patch?q=         { patched: [R…], games: [R…] }  the patched games, and
 *                                          up to 50 games whose name or file matches q (none without q)
 *   POST /admin/api/retro-patch/:id/apply  multipart "file": an IPS, BPS, UPS or xdelta patch;
 *                                          backs the original up on the first patch, then replaces
 *                                          the ROM under the same name: { ok, game: R }
 *   POST /admin/api/retro-patch/:id/restore  puts the original back and forgets the patches: { ok, game: R }
 *
 * R = { id, system, systemName, name, file, size, unpatchable?, missing?, patch? }
 * patch = { patches: [{ name, format, verified, at }], backup, original: { size } }
 * `unpatchable` says why a game takes no patch ("arcade", "multi-file"); `missing` marks a patched
 * game no longer in the catalog. Automation tokens cannot apply or restore (admin-page.js).
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import multer from "multer";
import debug from "../../debug.js";
import { retroDir, uploadMaxBytes } from "../../helpers/envs.js";
import { requestLang } from "../../meta/langs.js";
import * as retroCatalog from "../../retro/catalog.js";
import { folded, gameMatches } from "../../retro/game-view.js";
import { applyRomPatch, restoreOriginal, RomPatchError, unpatchable, validGameId } from "../../retro/rom-patch.js";
import { patchOf, patchedGames } from "../../retro/rom-patch-records.js";
import { apiWord } from "./api-words.js";

const SEARCH_MAX = 50;
const STAGING = ".upload-staging";

const systemName = (systems, id, lang) => systems[id]?.names?.[lang] ?? systems[id]?.names?.en ?? systems[id]?.name ?? id;

const patchFields = (record) => (record ? { patch: { patches: record.patches, backup: record.backup, original: record.original } } : {});

function row(g, systems, lang) {
  const why = unpatchable(g);
  return {
    id: g.id, system: g.system, systemName: systemName(systems, g.system, lang), name: g.name, file: g.file, size: g.size,
    ...(why ? { unpatchable: why } : {}), ...patchFields(patchOf(g.id)),
  };
}

/** A patched game the catalog no longer lists (moved or trashed), from its record alone. */
function missingRow(id, record, systems, lang) {
  return {
    id, system: record.system, systemName: systemName(systems, record.system, lang), name: path.parse(record.file).name, file: record.file,
    size: null, missing: true, ...patchFields(record),
  };
}

/** The patched games, and the games matching `q`, as GET /admin/api/retro-patch sends them. */
export async function retroPatchStatus({ q = "", lang = "en" } = {}) {
  const catalog = await retroCatalog.current(retroDir);
  const patched = patchedGames().map(([id, record]) => {
    const g = catalog.byId.get(id);
    return g ? row(g, catalog.systems, lang) : missingRow(id, record, catalog.systems, lang);
  });
  const needle = folded(q);
  const games = needle ? catalog.games.filter((g) => gameMatches(g, needle)).slice(0, SEARCH_MAX).map((g) => row(g, catalog.systems, lang)) : [];
  return { patched, games };
}

/** The upload of one patch file into a fresh staging folder of the retro dir; its path and name. */
async function receive(req, res) {
  const work = path.join(retroDir, STAGING, crypto.randomBytes(8).toString("hex"));
  await fsp.mkdir(work, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, work), filename: (_req, _file, cb) => cb(null, "patch") }),
    limits: { fileSize: uploadMaxBytes, files: 1, fields: 4 },
  }).single("file");
  try {
    await new Promise((resolve, reject) => upload(req, res, (err) => (err ? reject(err) : resolve())));
  } catch (err) {
    await fsp.rm(work, { recursive: true, force: true });
    throw err;
  }
  // multer hands back names as latin1; the browser sent UTF-8.
  const name = req.file ? Buffer.from(req.file.originalname, "latin1").toString("utf8") : null;
  return { work, file: req.file?.path ?? null, name };
}

const rescan = () => retroCatalog.rescan(retroDir).catch((err) => debug.error("retro: rescan after a ROM patch failed: %s", err.message));

export function mountRetroPatchApi(router, requireSession) {
  const guarded = (handler) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof RomPatchError) return res.status(err.status).json({ error: apiWord(req, `retroPatch.${err.code}`), code: err.code });
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: apiWord(req, "retroPatch.too-large"), code: "too-large" });
      if (err.code?.startsWith?.("LIMIT_")) return res.status(400).json({ error: apiWord(req, "retroPatch.oneFile"), code: "one-file" });
      debug.error("admin retro-patch: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed") });
    }
  };

  /** The catalog game `:id` names, or a 404 already sent. */
  async function gameOf(req, res) {
    const id = String(req.params.id ?? "");
    const g = validGameId(id) ? (await retroCatalog.current(retroDir)).byId.get(id) : null;
    if (!g) res.status(404).json({ error: apiWord(req, "retroPatch.noGame"), code: "no-game" });
    return g;
  }

  router.get("/api/retro-patch", guarded(async (req, res) => {
    res.json(await retroPatchStatus({ q: String(req.query.q ?? "").slice(0, 200), lang: requestLang(req) }));
  }));

  router.post("/api/retro-patch/:id/apply", guarded(async (req, res) => {
    const g = await gameOf(req, res);
    if (!g) return;
    const { work, file, name } = await receive(req, res);
    try {
      if (!file) return res.status(400).json({ error: apiWord(req, "retroPatch.oneFile"), code: "one-file" });
      const record = await applyRomPatch(retroDir, g, { patchPath: file, patchName: name });
      const last = record.patches.at(-1);
      debug.log("admin: retro game %s patched with %s (%s, %s)", g.id, last.name, last.format, last.verified ? "verified" : "unverified");
      await rescan();
      const catalog = await retroCatalog.current(retroDir);
      res.json({ ok: true, game: row(catalog.byId.get(g.id) ?? g, catalog.systems, requestLang(req)) });
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }
  }));

  router.post("/api/retro-patch/:id/restore", guarded(async (req, res) => {
    const id = String(req.params.id ?? "");
    const restored = await restoreOriginal(retroDir, id);
    debug.log("admin: retro game %s back to its original", restored.id);
    await rescan();
    const catalog = await retroCatalog.current(retroDir);
    const g = catalog.byId.get(id);
    res.json({ ok: true, game: g ? row(g, catalog.systems, requestLang(req)) : { id, file: restored.file } });
  }));
}
