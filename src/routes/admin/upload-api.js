/**
 * /admin/api/upload — the operator adds files to the libraries from the admin page.
 *
 *   GET  /admin/api/upload/targets   { targets: { game|retro|patch|save: { writable } }, systems, games }
 *   POST /admin/api/upload/:kind     multipart: `files` (+ `paths`, a JSON list of folder-relative
 *                                    paths when a folder was picked) and the fields below
 *
 *     game    one .nsp/.nsz/.xci/.xcz          → <games>/<file name>
 *     retro   system; the ROM and its discs    → <retro>/roms/<console folder>/<file name>
 *     patch   titleId, name; a .zip or folder  → <patches>/<title id>/<name>/ in SD-root layout (+ patch.json)
 *     save    titleId, name, description, descriptionKo; a .zip or the save folder
 *                                              → <saves>/<title id>/<name>/ (+ meta.json)
 *
 * Behind the admin 2FA session and a same-origin check. Files are received into
 * a staging folder on the destination's own disk, checked, and moved into place
 * at once; a name that is already taken is refused, never overwritten. A new
 * retro ROM gets its box art and bezel fetched in the background.
 */
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import debug from "../../debug.js";
import { dataDir, patchesDir, publicBaseUrl, retroDir, romsDirPath, savesDir, uploadMaxBytes } from "../../helpers/envs.js";
import { resolveOrigin } from "../../helpers/origin.js";
import * as shopCache from "../../meta/shop-cache.js";
import * as userPatches from "../../meta/user-patches.js";
import * as retroCatalog from "../../retro/catalog.js";
import { loadSystems } from "../../retro/systems.js";
import {
  GAME_EXT_RE, UploadError, baseTitleId, moveFile, mustBeFree, patchLayout, retroLayout,
  safeName, safeRelPath, saveLayout, unzip, walk,
} from "../../meta/library-upload.js";

const KINDS = ["game", "retro", "patch", "save"];
const MAX_FILES = 5000;
const FILE_NAME_TAIL_RE = /\s*\[[0-9A-F]{16}\]\[v\d+\]$/i;
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(here, "../../../scripts");

const rootOf = (kind) => ({ game: romsDirPath, retro: retroDir, patch: patchesDir, save: savesDir })[kind];
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

/** Base games in the library: [{ titleId, name }]. */
async function libraryGames() {
  const index = await shopCache.get();
  const seen = new Map();
  for (const f of index?.files ?? []) {
    if (f.kind !== "base" || !f.baseTitleId || seen.has(f.baseTitleId)) continue;
    seen.set(f.baseTitleId, String(f.name ?? "").replace(FILE_NAME_TAIL_RE, ""));
  }
  return [...seen].map(([titleId, name]) => ({ titleId, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** Box art and bezels for one console's new ROMs, after the upload has answered. */
function fetchRetroArt(systemId) {
  const run = (script) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), retroDir, "--system", systemId], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err = (err + d).slice(-500); });
    child.on("close", (code) => {
      if (code) debug.error("upload: %s %s exited %d: %s", script, systemId, code, err.trim());
      resolve();
    });
    child.on("error", (e) => { debug.error("upload: %s: %s", script, e.message); resolve(); });
  });
  if (!fs.existsSync(path.join(SCRIPTS, "retro-art.mjs"))) return;
  run("retro-art-match.mjs")
    .then(() => run("retro-art.mjs"))
    .then(() => retroCatalog.scan(retroDir))
    .catch((err) => debug.error("upload: retro art for %s: %s", systemId, err.message));
}

/** The uploaded files with their paths inside the upload; a lone .zip is unpacked. */
async function received(req, work) {
  const files = req.files ?? [];
  if (!files.length) throw new UploadError(400, "파일이 없습니다");
  let paths = null;
  try {
    paths = req.body.paths ? JSON.parse(req.body.paths) : null;
  } catch {
    throw new UploadError(400, "paths 가 JSON 이 아닙니다");
  }
  const fromFolder = Array.isArray(paths) && paths.length === files.length;
  if (files.length === 1 && /\.zip$/i.test(files[0].originalname) && req.params.kind !== "retro") {
    const dir = path.join(work, "unzipped");
    await fsp.mkdir(dir);
    await unzip(files[0].path, dir);
    await fsp.rm(files[0].path, { force: true });
    return { items: await walk(dir), fromFolder: false };
  }
  const items = files.map((f, i) => {
    const rel = safeRelPath(fromFolder ? paths[i] : f.originalname);
    if (!rel) throw new UploadError(400, `쓸 수 없는 경로입니다: ${fromFolder ? paths[i] : f.originalname}`);
    return { abs: f.path, rel };
  });
  return { items, fromFolder };
}

async function placeGame(items) {
  if (items.length !== 1) throw new UploadError(400, "스위치 게임은 파일 하나씩 올립니다");
  const name = safeName(path.posix.basename(items[0].rel));
  if (!name || !GAME_EXT_RE.test(name)) throw new UploadError(400, "nsp·nsz·xci·xcz 파일만 받습니다");
  const dest = path.join(romsDirPath, name);
  mustBeFree(dest, name);
  await moveFile(items[0].abs, dest);
  return { where: name, files: 1 };
}

async function placeRetro(items, body) {
  const systems = loadSystems(retroDir);
  const system = systems[String(body.system ?? "")];
  if (!system) throw new UploadError(400, "기종을 고릅니다");
  const names = retroLayout(items.map((i) => i.rel), system);
  const dir = path.join(retroDir, "roms", system.folder);
  for (const n of names) mustBeFree(path.join(dir, n), n);
  for (const [i, it] of items.entries()) await moveFile(it.abs, path.join(dir, names[i]));
  retroCatalog.scan(retroDir).catch(() => {});
  fetchRetroArt(body.system);
  return { where: `roms/${system.folder}/${names[0]}`, files: names.length };
}

/** Build the folder in staging, then rename it into place in one step. */
async function placeFolder(kind, items, body, work, fromFolder) {
  const tid = baseTitleId(body.titleId);
  if (!tid) throw new UploadError(400, "게임(타이틀 ID)을 고릅니다");
  const name = safeName(body.name);
  if (!name) throw new UploadError(400, "이름을 적습니다 (100자 이내, / 없이)");
  const rels = kind === "patch" ? patchLayout(items.map((i) => i.rel), tid) : saveLayout(items.map((i) => i.rel), fromFolder);
  const metaName = kind === "patch" ? "patch.json" : "meta.json";
  if (rels.some((r) => r.toLowerCase() === metaName)) throw new UploadError(400, `${metaName} 는 서버가 만듭니다. 빼고 올립니다`);
  const dest = path.join(rootOf(kind), tid, name);
  mustBeFree(dest, `${tid}/${name}`);
  const out = path.join(work, "out");
  for (const [i, it] of items.entries()) await moveFile(it.abs, path.join(out, ...rels[i].split("/")));
  const description = String(body.description ?? "").trim().slice(0, 2000);
  const descriptionKo = String(body.descriptionKo ?? "").trim().slice(0, 2000);
  const meta = kind === "patch"
    ? { name, ...(description || descriptionKo ? { description: descriptionKo || description } : {}) }
    : { name, ...(description ? { description } : {}), ...(descriptionKo ? { ko: { description: descriptionKo } } : {}) };
  await fsp.writeFile(path.join(out, metaName), `${JSON.stringify(meta, null, 1)}\n`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(out, dest);
  if (kind === "patch") userPatches.scan().catch(() => {});
  return { where: `${tid}/${name}`, files: rels.length };
}

export function mountUploadApi(router, guard) {
  router.get("/api/upload/targets", async (req, res) => {
    if (!guard(req, res)) return;
    res.set("Cache-Control", "no-store");
    const targets = {};
    for (const kind of KINDS) targets[kind] = { writable: fs.existsSync(rootOf(kind)) && (await writable(rootOf(kind))) };
    const systems = fs.existsSync(retroDir)
      ? Object.entries(loadSystems(retroDir)).map(([id, s]) => ({ id, name: s.names?.ko ?? s.name, extensions: s.extensions }))
      : [];
    res.json({ targets, systems, games: await libraryGames().catch(() => []), maxBytes: uploadMaxBytes });
  });

  router.post("/api/upload/:kind", async (req, res) => {
    if (!guard(req, res)) return;
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, publicBaseUrl)) return res.status(403).json({ error: "origin mismatch" });
    const kind = req.params.kind;
    if (!KINDS.includes(kind)) return res.status(404).json({ error: "unknown kind" });
    if (!fs.existsSync(rootOf(kind)) || !(await writable(rootOf(kind)))) {
      return res.status(409).json({ error: "읽기 전용입니다. compose 에서 이 폴더의 read_only 를 false 로 바꿉니다" });
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
        : await placeFolder(kind, items, req.body, work, fromFolder);
      debug.log("upload: %s → %s (%d files)", kind, placed.where, placed.files);
      body = { ok: true, kind, ...placed };
    } catch (err) {
      status = err instanceof UploadError ? err.status : err.code === "LIMIT_FILE_SIZE" ? 413 : err.code?.startsWith?.("LIMIT_") ? 400 : 500;
      if (status === 500) debug.error("upload: %s failed: %s", kind, err.message);
      body = { error: status === 500 ? "올리지 못했습니다. 서버 기록을 봅니다" : err.message };
    }
    // Leftovers of a refused upload go before the answer does.
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    res.status(status).json(body);
  });
}
