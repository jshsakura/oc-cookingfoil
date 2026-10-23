/**
 * /admin/api/upload — the operator adds files to the libraries from the admin page.
 *
 *   GET  /admin/api/upload/targets   { targets: { game|retro|patch|save|homebrew|client: { exists, writable } }, systems, games }
 *   POST /admin/api/upload/:kind     multipart: `files` (+ `paths`, a JSON list of folder-relative
 *                                    paths when a folder was picked) and the fields below
 *
 *     game    one .nsp/.nsz/.xci/.xcz          → <games>/<file name>
 *     retro   system; the ROM and its discs    → <retro>/roms/<console folder>/<file name>
 *     patch   titleId (or homebrew), name, description, descriptionKo, required ("true" when the game won't start without it);
 *             a .zip or folder                 → <patches>/<title id>/<name>/ in SD-root layout; the information goes
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
import multer from "multer";
import debug from "../../debug.js";
import { dataDir, homebrewDir, patchesDir, publicBaseUrl, retroDir, romsDirPath, savesDir, uploadMaxBytes } from "../../helpers/envs.js";
import { resolveOrigin } from "../../helpers/origin.js";
import { libraryGames } from "../../meta/library-games.js";
import * as userPatches from "../../meta/user-patches.js";
import * as patchInfo from "../../meta/patch-info.js";
import { SAVE_TYPES } from "../../meta/shop-saves.js";
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
import { packDirOf } from "../../retro/pack-status.js";
import { ClientBuildError, compareVersions, inspectNro } from "../../meta/client-build.js";
import { CLIENT_NRO, clientBuildStatus, latestBuild } from "../client-update.js";
import { actorOf } from "../../library/trash-service.js";
import { apiText, apiWord } from "./api-words.js";
import {
  GAME_EXT_RE, UploadError, backupSaveType, baseTitleId, homebrewApp, homebrewLayout, moveFile, mustBeFree, patchLayout, retroLayout,
  safeName, safeRelPath, saveLayout, unzip, walk, MAX_UPLOAD_FILES as MAX_FILES,
} from "../../meta/library-upload.js";

const KINDS = ["game", "retro", "patch", "save", "homebrew", "client", "core"];

/** A refusal answered with the api-words.js message `key` in the request's language. */
const refuse = (status, key, vars = {}) => Object.assign(new UploadError(status, apiText("en", key, vars)), { key, vars });

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
    await syncArt(retroDir, catalog.systems, roms, { only: systemId, token: integrations.get("github").token });
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
    await unzip(files[0].path, dir);
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

const BACKUP_META_MAX = 64 * 1024;

/** A game save's backup .meta files dropped from `items`, with the save type the last one names. */
async function takeBackupMeta(items) {
  const kept = [];
  let saveType = null;
  for (const it of items) {
    const small = /\.meta$/i.test(it.rel) && (await fsp.stat(it.abs)).size <= BACKUP_META_MAX;
    const type = small ? backupSaveType(it.rel, await fsp.readFile(it.abs, "utf8")) : null;
    if (small && (type || /(^|\/)\.dropkeep\.meta$/i.test(it.rel))) saveType = type ?? saveType;
    else kept.push(it);
  }
  return { items: kept, saveType };
}

/** Build the folder in staging, then rename it into place in one step. */
async function placeFolder(kind, items, body, work, fromFolder) {
  // The target is a game (its base title id) or a homebrew app (its switch/<app>/ folder name).
  const app = body.homebrew ? homebrewApp(body.homebrew) : null;
  if (body.homebrew && !app) throw refuse(400, "upload.pickApp");
  const tid = app ? null : baseTitleId(body.titleId);
  if (!app && !tid) throw refuse(400, "upload.pickTarget");
  const name = safeName(body.name);
  if (!name) throw refuse(400, "upload.noName");
  let saveType = null;
  if (kind === "save" && !app) {
    ({ items, saveType } = await takeBackupMeta(items));
    if (SAVE_TYPES.includes(body.saveType)) saveType = body.saveType;
    if (!items.length) throw refuse(400, "upload.noSave");
  }
  const paths = items.map((i) => i.rel);
  const rels = app ? homebrewLayout(paths, app, fromFolder) : kind === "patch" ? patchLayout(paths, tid) : saveLayout(paths, fromFolder);
  const under = app ? `homebrew/${app}` : tid;
  const metaName = kind === "patch" ? "patch.json" : "meta.json";
  if (rels.some((r) => r.toLowerCase() === metaName)) {
    throw kind === "patch" ? refuse(400, "upload.noPatchJson") : refuse(400, "upload.serverMeta", { name: metaName });
  }
  const dest = path.join(rootOf(kind), ...under.split("/"), name);
  mustBeFree(dest, `${under}/${name}`);
  const out = path.join(work, "out");
  for (const [i, it] of items.entries()) await moveFile(it.abs, path.join(out, ...rels[i].split("/")));
  const description = String(body.description ?? "").trim().slice(0, 2000);
  const descriptionKo = String(body.descriptionKo ?? "").trim().slice(0, 2000);
  // The default text is the English one, or the Korean one when that is all
  // there is; the Korean text is kept apart when both are given.
  const text = {
    ...(description || descriptionKo ? { description: description || descriptionKo } : {}),
    ...(description && descriptionKo ? { ko: { description: descriptionKo } } : {}),
  };
  const meta = kind === "patch"
    ? { name, ...text, ...(!app && body.required === "true" ? { required: true } : {}) }
    : { name, ...text, ...(saveType ? { saveType } : {}) };
  // A save keeps its meta.json; a patch's information lives in the store, set once the folder is in place.
  if (kind !== "patch") await fsp.writeFile(path.join(out, metaName), `${JSON.stringify(meta, null, 1)}\n`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(out, dest);
  if (kind === "patch") {
    patchInfo.set(patchInfo.keyOf(under, name), meta);
    userPatches.scan().catch((err) => debug.error("upload: patch rescan failed: %s", err.message));
  }
  return { where: `${under}/${name}`, files: rels.length };
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
    res.json({ targets, systems, games: await libraryGames().catch(() => []), homebrew, maxBytes: uploadMaxBytes });
  });

  router.post("/api/upload/:kind", async (req, res) => {
    if (!guard(req, res)) return;
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, publicBaseUrl)) return res.status(403).json({ error: "origin mismatch" });
    const kind = req.params.kind;
    if (!KINDS.includes(kind)) return res.status(404).json({ error: "unknown kind" });
    if (kind === "client" || (kind === "core" && fs.existsSync(retroDir))) await fsp.mkdir(rootOf(kind), { recursive: true }).catch(() => {});
    if (!fs.existsSync(rootOf(kind)) || !(await writable(rootOf(kind)))) {
      return res.status(409).json({ error: apiWord(req, "upload.readOnly") });
    }
    const work = path.join(stagingOf(kind), crypto.randomBytes(8).toString("hex"));
    await fsp.mkdir(path.join(work, "in"), { recursive: true });
    let n = 0;
    const upload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, path.join(work, "in")),
        filename: (_req, _file, cb) => cb(null, `f${n++}`),
      }),
      limits: { fileSize: uploadMaxBytes, files: MAX_FILES, fieldSize: 4 * 1024 * 1024 },
    }).array("files", MAX_FILES);
    let status = 201;
    let body;
    try {
      await new Promise((resolve, reject) => upload(req, res, (err) => (err ? reject(err) : resolve())));
      // multer hands back names as latin1; the browser sent UTF-8.
      for (const f of req.files ?? []) f.originalname = Buffer.from(f.originalname, "latin1").toString("utf8");
      const { items, fromFolder } = await received(req, work);
      const placed = kind === "game" ? await placeGame(items)
        : kind === "retro" ? await placeRetro(items, req.body)
        : kind === "homebrew" && req.body?.replace ? await replaceHomebrewFile(items, req.body.replace, { by: actorOf(req) })
        : kind === "homebrew" ? await placeHomebrew(items, work, { port: req.body?.port === "true", by: actorOf(req) })
        : kind === "client" ? await placeClient(items, req)
        : kind === "core" ? await placeCoreUpload(items, req.body)
        : await placeFolder(kind, items, req.body, work, fromFolder);
      debug.log("upload: %s → %s (%d files)", kind, placed.where, placed.files);
      // The saves listing is refreshed in the background; one uploaded here shows on the next list.
      if (kind === "save") savesCatalog().invalidate();
      body = { ok: true, kind, ...placed };
    } catch (err) {
      status = err instanceof UploadError || err instanceof CoreError ? err.status : err instanceof HomebrewUploadError ? 400 : err.code === "LIMIT_FILE_SIZE" ? 413 : err.code?.startsWith?.("LIMIT_") ? 400 : 500;
      if (status === 500) debug.error("upload: %s failed: %s", kind, err.message);
      const keyed = (err instanceof UploadError || err instanceof HomebrewUploadError) && err.key;
      body = err instanceof CoreError ? { ...coreError(req, err), ...err.extra } : { error: status === 500 ? apiWord(req, "upload.failed") : keyed ? apiWord(req, err.key, err.vars) : err.message };
    }
    // Leftovers of a refused upload go before the answer does.
    await dropWork(work);
    res.status(status).json(body);
  });
}
