/**
 * /admin/api/upload — the operator adds files to the libraries from the admin page.
 *
 *   GET  /admin/api/upload/targets   { targets: { game|retro|patch|save|homebrew|client: { exists, writable } }, systems, games }
 *   POST /admin/api/upload/:kind     multipart: `files` (+ `paths`, a JSON list of folder-relative
 *                                    paths when a folder was picked) and the fields below
 *
 *     game    one .nsp/.nsz/.xci/.xcz          → <games>/<file name>
 *     retro   system; the ROM and its discs    → <retro>/roms/<console folder>/<file name>
 *     patch   titleId (or homebrew; left out, the patch's own title folder names the game), name, description,
 *             descriptionKo, required ("true" when the game won't start without it); a .zip or folder however it was
 *             packed (meta/patch-intake.js)  → <patches>/<title id>/<name>/ in SD-root layout; the information goes
 *                                              into the server's patch store (meta/patch-info.js), no patch.json
 *     save    titleId, name, description, descriptionKo, saveType (device|account); a .zip or the save folder
 *             (a save-keeper backup's .meta is read for saveType and left out)
 *                                              → <saves>/<title id>/<name>/ (+ meta.json)
 *     homebrew  port ("true" marks the placed app a port); a .nro, a release .zip or the app folder
 *                                              → <homebrew>/<app>/; with replace=<id>, one .nro or .nsp
 *                                              that becomes that hand-placed app's file (homebrew-upload.js)
 *     core    one <core>_libretro_libnx.nro    → <retro>/retroarch/cores/; replace ("true") swaps a core of that
 *             name, which goes to the retro trash first (retro/core-files.js)
 *     client  the CookingFoil client build, one .nro → <data>/client/cookingfoil.nro, replacing the one
 *             there; checked as client-update.js checks a dropped-in build (an NRO with a version not
 *             lower than the one offered) and offered to consoles at once
 *
 * Behind the admin 2FA session and a same-origin check. Files are received into
 * a staging folder on the destination's own disk, checked, and moved into place
 * at once; a name that is already taken is refused, never overwritten (the
 * client build is the one file that is replaced, by design). A new
 * retro ROM gets its box art and bezel fetched in the background.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import * as patchInfo from "../../meta/patch-info.js";
import multer from "multer";
import debug from "../../debug.js";
import { dataDir, homebrewDir, patchesDir, publicBaseUrl, retroDir, romsDirPath, savesDir } from "../../helpers/envs.js";
import { resolveOrigin } from "../../helpers/origin.js";
import { libraryGames } from "../../meta/library-games.js";
import { savesCatalog } from "../saves.js";
import * as retroCatalog from "../../retro/catalog.js";
import { syncArt } from "../../retro/art/sync.js";
import * as integrations from "../../security/integrations.js";
import { romKey } from "./retro-art-api.js";
import { HomebrewUploadError, placeHomebrew, replaceHomebrewFile } from "./homebrew-upload.js";
import { defaultService } from "../homebrew.js";
import { installPathFor } from "../../meta/homebrew.js";
import { loadSystems } from "../../retro/systems.js";
import { CoreError, placeCore } from "../../retro/core-files.js";
import { coreError } from "../../retro/core-messages.js";
import { isMetaCode, metaError } from "../../meta/meta-messages.js";
import { packDirOf } from "../../retro/pack-status.js";
import { ClientBuildError, compareVersions, inspectNro } from "../../meta/client-build.js";
import { CLIENT_NRO, clientBuildStatus, latestBuild } from "../client-update.js";
import { actorOf } from "../../library/trash-service.js";
import { apiWord } from "./api-words.js";
import {
  GAME_EXT_RE, UploadError, moveFile, mustBeFree, retroLayout,
  safeName, safeRelPath, unzip, walk, MAX_UPLOAD_FILES as MAX_FILES,
} from "../../meta/library-upload.js";
import * as chunks from "../../meta/upload-chunks.js";
import { FILE_ROOT_KEYS } from "../../library/file-roots.js";
import { placeFolderKind, refuse } from "../../meta/folder-place.js";

const KINDS = ["game", "retro", "patch", "save", "homebrew", "client", "core"];

const FIELD_NAMES = ["system", "homebrew", "titleId", "name", "description", "descriptionKo", "saveType", "required", "port", "replace"];


const rootOf = (kind) => ({ game: romsDirPath, retro: retroDir, patch: patchesDir, save: savesDir, homebrew: homebrewDir, client: path.dirname(CLIENT_NRO), core: path.join(packDirOf(retroDir), "cores") })[kind];
// Staging sits on the destination's disk so the final move is a rename. Games
// are watched as they land, so theirs stays in the data folder.
const stagingOf = (kind) => (kind === "game" ? path.join(dataDir, "uploads") : path.join(rootOf(kind), ".upload-staging"));

async function writable(dir) {
  try {
    await fsp.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Box art and bezels for one console's new ROMs, after the upload has answered. */
async function fetchRetroArt(systemId) {
  try {
    const catalog = await retroCatalog.scan(retroDir);
    const roms = { [systemId]: catalog.games.filter((g) => g.system === systemId).map(romKey) };
    await syncArt(retroDir, catalog.systems, roms, { only: [systemId], token: integrations.get("github").token });
    await retroCatalog.scan(retroDir);
  } catch (err) {
    debug.error("upload: retro art for %s: %s", systemId, err.message);
  }
}

/** The uploaded files with their paths inside the upload; a lone .zip is unpacked. */
async function received(req, work) {
  const files = req.files ?? [];
  if (!files.length) throw refuse(400, "upload.noFiles");
  let paths = null;
  try {
    paths = req.body.paths ? JSON.parse(req.body.paths) : null;
  } catch {
    throw refuse(400, "upload.badPaths");
  }
  const fromFolder = Array.isArray(paths) && paths.length === files.length;
  if (files.length === 1 && /\.zip$/i.test(files[0].originalname) && req.params.kind !== "retro" && req.params.kind !== "homebrew") {
    const dir = path.join(work, "unzipped");
    await fsp.mkdir(dir);
    // No size cap on what an archive holds: the disk is the limit.
    await unzip(files[0].path, dir, { maxBytes: Math.max(0, (await chunks.freeBytes(work)) - chunks.FREE_MARGIN_BYTES) });
    await fsp.rm(files[0].path, { force: true });
    return { items: await walk(dir), fromFolder: false };
  }
  const items = files.map((f, i) => {
    const rel = safeRelPath(fromFolder ? paths[i] : f.originalname);
    if (!rel) throw refuse(400, "upload.badPath", { path: fromFolder ? paths[i] : f.originalname });
    return { abs: f.path, rel };
  });
  return { items, fromFolder };
}

async function placeGame(items) {
  if (items.length !== 1) throw refuse(400, "upload.onePackage");
  const name = safeName(path.posix.basename(items[0].rel));
  if (!name || !GAME_EXT_RE.test(name)) throw refuse(400, "upload.gameExt");
  const dest = path.join(romsDirPath, name);
  mustBeFree(dest, name);
  await moveFile(items[0].abs, dest);
  return { where: name, files: 1 };
}

/** The client build: checked before it replaces the one offered, then offered at once. `req` picks the language of `where`. */
async function placeClient(items, req) {
  if (items.length !== 1 || !/\.nro$/i.test(items[0].rel)) throw refuse(400, "upload.clientOne");
  let version;
  try {
    ({ version } = inspectNro(await fsp.readFile(items[0].abs)));
  } catch (err) {
    if (err instanceof ClientBuildError) throw refuse(400, "upload.notClient", { why: err.message });
    throw err;
  }
  // Older than the manual build on offer is an old file picked by mistake; a newer GitHub build is no reason to refuse.
  const before = clientBuildStatus().published;
  if (before?.source === "manual" && compareVersions(version, before.version) < 0) throw refuse(400, "upload.clientOlder", { got: version, want: before.version });
  await fsp.rename(items[0].abs, CLIENT_NRO);
  await latestBuild();
  const { published, rejected } = clientBuildStatus();
  if (published?.source === "github" && compareVersions(published.version, version) > 0) {
    return { where: apiWord(req, "upload.githubNewer", { got: version, newer: published.version }), files: 1, version };
  }
  if (published?.version !== version) throw rejected?.message ? refuse(400, "upload.clientRejected", { why: rejected.message }) : refuse(400, "upload.clientUnchecked");
  return { where: `client/cookingfoil.nro · ${version}`, files: 1, version };
}

async function placeCoreUpload(items, body) {
  if (items.length !== 1) throw refuse(400, "upload.coreOne");
  const placed = await placeCore(retroDir, { abs: items[0].abs, name: path.posix.basename(items[0].rel) }, { replace: body?.replace === "true" });
  return { where: `retroarch/${placed.file}`, files: 1, ...placed };
}

async function placeRetro(items, body) {
  const systems = loadSystems(retroDir);
  const system = systems[String(body.system ?? "")];
  if (!system) throw refuse(400, "upload.pickSystem");
  const names = retroLayout(items.map((i) => i.rel), system);
  const dir = path.join(retroDir, "roms", system.folder);
  for (const n of names) mustBeFree(path.join(dir, n), n);
  for (const [i, it] of items.entries()) await moveFile(it.abs, path.join(dir, names[i]));
  retroCatalog.scan(retroDir).catch((err) => debug.error("upload: retro rescan failed: %s", err.message));
  fetchRetroArt(body.system);
  return { where: `roms/${system.folder}/${names[0]}`, files: names.length };
}

/**
 * Removes an upload's work folder, except a homebrew folder an upload replaced
 * (work/previous) that could not be moved to the trash: that one is a person's
 * file and stays where it is until someone moves it.
 */
async function dropWork(work) {
  const previous = path.join(work, "previous");
  if (!(await fsp.lstat(previous).then(() => true, () => false))) return fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  for (const name of await fsp.readdir(work).catch(() => [])) {
    if (name !== "previous") await fsp.rm(path.join(work, name), { recursive: true, force: true }).catch(() => {});
  }
  debug.error("upload: %s kept: it could not be moved to the trash", previous);
}

export function mountUploadApi(router, guard) {
  router.get("/api/upload/targets", async (req, res) => {
    if (!guard(req, res)) return;
    res.set("Cache-Control", "no-store");
    const targets = {};
    for (const kind of KINDS) {
      const exists = fs.existsSync(rootOf(kind));
      targets[kind] = { exists, writable: exists && (await writable(rootOf(kind))) };
    }
    const systems = fs.existsSync(retroDir)
      ? Object.entries(loadSystems(retroDir)).map(([id, s]) => ({ id, name: s.names?.ko ?? s.name, extensions: s.extensions }))
      : [];
    // An installable title (.nsp) has no switch/<app>/ folder for patches and saves to go under.
    const homebrew = (await defaultService.list("ko").catch(() => []))
      .filter((e) => e.install_type !== "title")
      .map((e) => ({ app: (e.install_path ?? installPathFor(e.file_name)).split("/")[1], name: e.name, kind: e.kind }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "port" ? -1 : 1));
    res.json({ targets, systems, games: await libraryGames().catch(() => []), homebrew });
  });

  router.post("/api/upload/:kind", async (req, res) => {
    if (!guard(req, res)) return;
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, publicBaseUrl)) return res.status(403).json({ error: "origin mismatch" });
    const kind = req.params.kind;
    if (!(await ready(req, res, kind))) return;
    // No size cap: a body the disk cannot hold is the only refusal, so its length must be known first.
    const length = Number(req.headers["content-length"]);
    if (!Number.isSafeInteger(length) || length < 0) return res.status(411).json({ error: apiWord(req, "upload.failed"), code: "length-required" });
    const free = await chunks.freeBytes(rootOf(kind)).catch(() => Infinity);
    if (length + chunks.FREE_MARGIN_BYTES > free) return res.status(507).json({ error: apiWord(req, "upload.noSpace", { need: gib(Number(req.headers["content-length"])), free: gib(free) }) });
    const work = await newWork(kind);
    let n = 0;
    const upload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, path.join(work, "in")),
        filename: (_req, _file, cb) => cb(null, `f${n++}`),
      }),
      limits: { files: MAX_FILES, fieldSize: 4 * 1024 * 1024 },
    }).array("files", MAX_FILES);
    const { status, body } = await handleUpload(req, kind, work, async () => {
      await new Promise((resolve, reject) => upload(req, res, (err) => (err ? reject(err) : resolve())));
      // multer hands back names as latin1; the browser sent UTF-8.
      for (const f of req.files ?? []) f.originalname = Buffer.from(f.originalname, "latin1").toString("utf8");
    });
    res.status(status).json(body);
  });

  mountChunkRoutes(router, guard);
}

const gib = (n) => `${(n / 1024 ** 3).toFixed(1)} GiB`;

/** The kind's folder is there and can be written (made first for the kinds that make their own); answers 404/409 when not. */
async function ready(req, res, kind) {
  if (!KINDS.includes(kind)) return void res.status(404).json({ error: "unknown kind" });
  if (kind === "client" || (kind === "core" && fs.existsSync(retroDir))) await fsp.mkdir(rootOf(kind), { recursive: true }).catch(() => {});
  if (!fs.existsSync(rootOf(kind)) || !(await writable(rootOf(kind)))) return void res.status(409).json({ error: apiWord(req, "upload.readOnly") });
  return true;
}

async function newWork(kind) {
  const work = path.join(stagingOf(kind), crypto.randomBytes(8).toString("hex"));
  await fsp.mkdir(path.join(work, "in"), { recursive: true });
  return work;
}

/**
 * Receives (`receive` fills req.files and req.body), places and answers an upload: the one path both the
 * multipart request and a finished chunked upload take. Leftovers go before the answer does.
 */
async function handleUpload(req, kind, work, receive) {
  let status = 201;
  let body;
  try {
    await receive();
    const { items, fromFolder } = await received(req, work);
    const placed = kind === "game" ? await placeGame(items)
      : kind === "retro" ? await placeRetro(items, req.body)
      : kind === "homebrew" && req.body?.replace ? await replaceHomebrewFile(items, req.body.replace, { by: actorOf(req) })
      : kind === "homebrew" ? await placeHomebrew(items, work, { port: req.body?.port === "true", by: actorOf(req) })
      : kind === "client" ? await placeClient(items, req)
      : kind === "core" ? await placeCoreUpload(items, req.body)
      : await placeFolderKind({ kind, items, body: req.body, work, fromFolder, rootOf });
    debug.log("upload: %s → %s (%d files)", kind, placed.where, placed.files);
    // The saves listing is refreshed in the background; one uploaded here shows on the next list.
    if (kind === "save") savesCatalog().invalidate();
    body = { ok: true, kind, ...placed };
  } catch (err) {
    status = err instanceof UploadError || err instanceof CoreError || err instanceof chunks.ChunkError ? err.status : err instanceof HomebrewUploadError ? 400 : err.code === "LIMIT_FILE_SIZE" ? 413 : err.code?.startsWith?.("LIMIT_") ? 400 : 500;
    if (status === 500) debug.error("upload: %s failed: %s", kind, err.message);
    const keyed = (err instanceof UploadError || err instanceof HomebrewUploadError) && err.key;
    // A meta module's refusal (library-upload.js) carries its key as `code`: said in the request's language, with the code.
    body = err instanceof CoreError ? { ...coreError(req, err), ...err.extra }
      : err instanceof chunks.ChunkError ? chunkBody(req, err)
      : status === 500 ? { error: apiWord(req, "upload.failed") }
      : keyed ? { error: apiWord(req, err.key, err.vars) }
      : isMetaCode(err.code) ? metaError(req, err)
      : { error: err.message };
  }
  await dropWork(work);
  return { status, body };
}

const chunkBody = (req, err) => ({ error: apiWord(req, err.key, err.vars), code: err.key, ...err.extra });
const chunksDir = (kind) => (kind === chunks.FILE_KIND ? chunks.fileChunksDir()
  : chunks.isDropKind(kind) ? chunks.dropChunksDir(kind.slice(chunks.DROP_PREFIX.length))
  : path.join(stagingOf(kind), "chunks"));
const { accountOf, rawBody } = chunks;

/**
 * One mechanism for every admin upload (meta/upload-chunks.js). :kind is a library kind, or "file" for a file
 * one other route takes by naming it in X-Chunk-Id (takeFile, rawOrChunk).
 *
 *   POST   /api/upload/:kind/chunks     { name, size, lastModified } → { id, offset, size }   start, or pick up where it stopped
 *   GET    /api/upload/chunks/:id?kind=  → { offset, size }                                    where it stands
 *   PUT    /api/upload/chunks/:id?kind=&offset=N   raw bytes (≤ 32 MiB) → { offset }           409 + the real offset when N is wrong
 *   DELETE /api/upload/chunks/:id?kind=                                                        drop the partial
 *   POST   /api/upload/:kind/finish     { ids, paths?, fields? } → what the multipart request answers
 */
function mountChunkRoutes(router, guard) {
  const dropKinds = () => FILE_ROOT_KEYS.map((k) => chunks.DROP_PREFIX + k).filter((k) => chunksDir(k));
  const swept = () => Promise.all([...KINDS, chunks.FILE_KIND, ...dropKinds()].map((k) => chunks.sweep(chunksDir(k)))).catch(() => {});
  swept();
  setInterval(swept, 3600_000).unref();

  const kindOf = (req, res) => {
    const kind = req.params.kind ?? req.query.kind;
    // A drop kind is started by the file browser (files-api.js) and only goes on here, piece by piece.
    const dropping = chunks.isDropKind(kind) && !req.params.kind && chunks.dropChunksDir(kind.slice(chunks.DROP_PREFIX.length));
    if (!KINDS.includes(kind) && kind !== chunks.FILE_KIND && !dropping) return void res.status(404).json({ error: "unknown kind" });
    return kind;
  };
  /** A kind an automation token may not upload (client, homebrew, patch) is closed to it in every chunk route too. */
  const tokenRefused = async (req, kind) => {
    if (!req.apiToken || kind === chunks.FILE_KIND) return false;
    if (chunks.isDropKind(kind)) return true;
    const { tokenBlocked } = await import("../admin-page.js");
    return tokenBlocked("POST", `/api/upload/${kind}`);
  };
  /** Wraps a chunk route: admin only, the kind checked, a refusal said in the request's language. */
  const route = (handler) => async (req, res) => {
    if (!guard(req, res)) return;
    const kind = kindOf(req, res);
    if (!kind) return;
    if (await tokenRefused(req, kind)) return void res.status(403).json({ error: apiWord(req, "upload.failed"), code: "token-blocked" });
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res, kind, chunksDir(kind));
    } catch (err) {
      if (!(err instanceof chunks.ChunkError)) {
        debug.error("upload chunk: %s", err.message);
        return res.status(500).json({ error: apiWord(req, "upload.failed") });
      }
      res.status(err.status).json(chunkBody(req, err));
    }
  };

  router.post("/api/upload/:kind/chunks", route(async (req, res, kind, dir) => {
    if (kind !== chunks.FILE_KIND && !(await ready(req, res, kind))) return;
    const { name, size, lastModified } = req.body ?? {};
    res.json(await chunks.begin(dir, { account: accountOf(req), kind, name, size, lastModified }));
  }));

  router.get("/api/upload/chunks/:id", route(async (req, res, _kind, dir) => {
    const have = await chunks.offsetOf(dir, req.params.id, accountOf(req));
    if (!have) throw new chunks.ChunkError(404, "upload.unknownChunk");
    res.json({ offset: have.offset, size: have.size });
  }));

  router.put("/api/upload/chunks/:id", route(async (req, res, _kind, dir) => {
    const offset = Number(req.query.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new chunks.ChunkError(400, "upload.badOffset");
    res.json({ offset: await chunks.append(dir, req.params.id, accountOf(req), offset, await rawBody(req, chunks.MAX_CHUNK_BYTES)) });
  }));

  router.delete("/api/upload/chunks/:id", route(async (req, res, _kind, dir) => {
    if (!(await chunks.offsetOf(dir, req.params.id, accountOf(req)))) throw new chunks.ChunkError(404, "upload.unknownChunk");
    await chunks.discard(dir, req.params.id, accountOf(req));
    res.json({ ok: true });
  }));

  router.post("/api/upload/:kind/finish", route(async (req, res, kind, dir) => {
    if (!(await ready(req, res, kind))) return;
    const { ids, paths, fields } = req.body ?? {};
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_FILES || new Set(ids).size !== ids.length) throw new chunks.ChunkError(400, "upload.badName");
    // Everything is checked before anything moves, so a short file leaves the others in place to resume.
    const parts = [];
    for (const id of ids) parts.push(await chunks.completed(dir, String(id), accountOf(req)));
    const work = await newWork(kind);
    const files = [];
    try {
      for (const [i, part] of parts.entries()) {
        const dest = path.join(work, "in", `f${i}`);
        await fsp.rename(part.path, dest);
        await chunks.discard(dir, ids[i], accountOf(req));
        files.push({ path: dest, originalname: part.name, size: part.size });
      }
    } catch (err) {
      // A part another finish took first: nothing is placed, and the work folder does not stay behind.
      await dropWork(work);
      if (err.code === "ENOENT") throw new chunks.ChunkError(404, "upload.unknownChunk");
      throw err;
    }
    const body = {};
    for (const key of FIELD_NAMES) if (typeof fields?.[key] === "string") body[key] = fields[key];
    if (Array.isArray(paths)) body.paths = JSON.stringify(paths);
    req.params.kind = kind;
    const { status, body: answer } = await handleUpload(req, kind, work, async () => {
      req.files = files;
      req.body = body;
    });
    res.status(status).json(answer);
  }));
}

/**
 * The drop box's way into the upload page's own placing: a folder of `kind` ("patch" | "homebrew"), its files as
 * { abs, rel }. The result carries where the folder landed (`abs`) and, for a patch, what an undo has to forget (`rewrite`).
 */
export async function placeDropFolder(kind, items, body) {
  const work = await newWork(kind);
  try {
    if (kind === "homebrew") {
      const res = await placeHomebrew(items, work, { by: null });
      return { ...res, abs: path.join(rootOf("homebrew"), ...res.where.split("/")) };
    }
    const res = await placeFolderKind({ kind, items, body, work, fromFolder: true, rootOf });
    return {
      ...res,
      abs: path.join(rootOf(kind), ...res.where.split("/")),
      ...(kind === "patch" ? { rewrite: { type: "drop-patch", key: patchInfo.keyOf(path.posix.dirname(res.where), path.posix.basename(res.where)) } } : {}),
    };
  } finally {
    await dropWork(work);
  }
}
