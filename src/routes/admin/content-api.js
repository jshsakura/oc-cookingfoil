/**
 * Game patches and saves after they are uploaded, from the library tab:
 *
 *   GET  /admin/api/saves                     { saves: [{ id, titleId, game, name, ko, description, gameVersion, saveType, source, size, files }] }
 *   POST /admin/api/content/:kind/meta        { id, name, nameKo, description, descriptionKo, version, author, gameVersion, saveType, sourceName, sourceUrl }
 *   POST /admin/api/content/:kind/move        { id, titleId }  to another game; a patch's own paths follow it
 *   POST /admin/api/content/:kind/remove      { id }           delete it from disk
 *
 * :kind is patch or save. Only a game's own patches and saves are handled
 * here; a homebrew app's are on the homebrew tab. The metadata file
 * (patch.json, meta.json) is rewritten with the fields given and keeps the
 * others (a patch's `required`).
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import * as userPatches from "../../meta/user-patches.js";
import { SAVE_TYPES } from "../../meta/shop-saves.js";
import { patchesDir, savesDir } from "../../helpers/envs.js";
import { savesCatalog, savesEnabled } from "../saves.js";
import { inside } from "./homebrew-apps-api.js";
import { libraryGames } from "./upload-api.js";
import debug from "../../debug.js";

const BASE_RE = /^[0-9A-F]{16}$/;
const isBase = (tid) => BASE_RE.test(tid) && (BigInt(`0x${tid}`) & 0x1fffn) === 0n;
const LIMITS = { name: 120, nameKo: 120, description: 2000, descriptionKo: 2000, version: 40, author: 120, gameVersion: 40, sourceName: 120, sourceUrl: 300 };

class ContentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The input's text fields, trimmed and capped; a missing one is "". Pure. */
function texts(input) {
  const out = {};
  for (const [k, max] of Object.entries(LIMITS)) out[k] = String(input?.[k] ?? "").trim().slice(0, max);
  return out;
}

const withKo = (name, description) => {
  const ko = { ...(name ? { name } : {}), ...(description ? { description } : {}) };
  return Object.keys(ko).length ? { ko } : {};
};

/**
 * patch.json after an edit: the fields given, `required` kept. The game
 * version and the update the patch is for stay as they were when the edit
 * leaves them out. Pure.
 */
export function patchMeta(old, input) {
  const t = texts(input);
  if (!t.name) throw new ContentError(400, "이름을 적습니다");
  const gameVersion = input?.gameVersion === undefined ? String(old?.game_version ?? "").trim().slice(0, LIMITS.gameVersion) : t.gameVersion;
  const rawUpdate = input?.updateVersion === undefined ? old?.update_version : input.updateVersion;
  const update = userPatches.updateVersionOf(rawUpdate);
  if (!update && rawUpdate !== undefined && rawUpdate !== null && String(rawUpdate).trim() !== "") {
    throw new ContentError(400, "필요한 업데이트는 v 뒤의 숫자(예: 2097152)로 고릅니다");
  }
  return {
    name: t.name,
    ...(t.version ? { version: t.version } : {}),
    ...(gameVersion ? { game_version: gameVersion } : {}),
    ...(update ? { update_version: update } : {}),
    ...(t.author ? { author: t.author } : {}),
    ...(t.description ? { description: t.description } : {}),
    ...withKo(t.nameKo, t.descriptionKo),
    ...(old?.required === true ? { required: true } : {}),
  };
}

/** meta.json after an edit. Pure. */
export function saveMeta(old, input) {
  const t = texts(input);
  if (!t.name) throw new ContentError(400, "이름을 적습니다");
  if (t.sourceUrl && !/^https?:\/\/\S+$/i.test(t.sourceUrl)) throw new ContentError(400, "출처 주소는 http 나 https 로 시작합니다");
  const saveType = SAVE_TYPES.includes(input?.saveType) ? input.saveType : null;
  return {
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    ...(t.gameVersion ? { gameVersion: t.gameVersion } : {}),
    ...(saveType ? { saveType } : {}),
    ...(t.sourceName ? { source: { name: t.sourceName, ...(t.sourceUrl ? { url: t.sourceUrl } : {}) } } : {}),
    ...withKo(t.nameKo, t.descriptionKo),
  };
}

/**
 * A patch file's path once the patch belongs to `to` instead of `from`: the
 * game's own folders under atmosphere/contents (each program keeps its offset
 * from the base id) and the fpslocker folder follow; anything else stays. Pure.
 */
export function movedPatchPath(rel, from, to) {
  const parts = rel.split("/");
  const lower = parts.map((p) => p.toLowerCase());
  const swap = (dir) => {
    const offset = BigInt(`0x${dir}`) - BigInt(`0x${from}`);
    const hex = (BigInt(`0x${to}`) + offset).toString(16).padStart(16, "0");
    return dir === dir.toLowerCase() ? hex : hex.toUpperCase();
  };
  const owns = (dir) => /^[0-9a-f]{16}$/.test(dir) && BigInt(`0x${dir}`) >> 13n === BigInt(`0x${from}`) >> 13n;
  if (lower[0] === "atmosphere" && lower[1] === "contents" && owns(lower[2])) parts[2] = swap(parts[2]);
  else if (lower.slice(0, 4).join("/") === "saltysd/plugins/fpslocker/patches" && lower[4] === from.toLowerCase()) parts[4] = swap(parts[4]);
  return parts.join("/");
}

async function filesUnder(dir, rel = "", out = []) {
  for (const e of await fsp.readdir(rel ? path.join(dir, rel) : dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await filesUnder(dir, r, out);
    else out.push(r);
  }
  return out;
}

export function mountContentApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ContentError) return res.status(err.status).json({ error: err.message });
      debug.error("admin: content: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };

  /** The folder of a game's patch or save, its root and title id, or a ContentError. */
  async function find(kind, id) {
    if (kind !== "patch" && kind !== "save") throw new ContentError(404, "patch 나 save 여야 합니다");
    const root = kind === "patch" ? patchesDir : savesDir;
    const where = kind === "patch" ? userPatches.locate(id) : savesEnabled() ? await savesCatalog().locate(id) : null;
    const dir = where && !where.dir.startsWith("homebrew/") ? inside(root, where.dir, where.folder) : null;
    if (!dir) throw new ContentError(404, "목록에 없는 항목입니다");
    return { root, dir, titleId: where.dir.toUpperCase(), folder: where.folder };
  }
  const refreshed = async (kind) => {
    if (kind === "patch") await userPatches.scan();
    else savesCatalog().invalidate();
  };

  router.get("/api/saves", handle(async (req, res) => {
    if (!savesEnabled()) return res.json({ saves: [] });
    const [saves, games] = await Promise.all([savesCatalog().list(), libraryGames().catch(() => [])]);
    const names = new Map(games.map((g) => [g.titleId, g.name]));
    res.json({
      saves: saves.filter((s) => s.titleId).map(({ id, titleId, name, ko, description, gameVersion, saveType, source, size, files }) =>
        ({ id, titleId, game: names.get(titleId) ?? null, name, ko, description, gameVersion, saveType: saveType ?? null, source, size, files })),
    });
  }));

  router.post("/api/content/:kind/meta", handle(async (req, res) => {
    const { kind } = req.params;
    const { dir } = await find(kind, String(req.body?.id ?? ""));
    const file = path.join(dir, kind === "patch" ? "patch.json" : "meta.json");
    let old = {};
    try {
      old = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw new ContentError(409, `${path.basename(file)} 을 읽지 못했습니다. 파일을 고친 뒤 다시 합니다`);
    }
    const next = kind === "patch" ? patchMeta(old, req.body) : saveMeta(old, req.body);
    await fsp.writeFile(file, `${JSON.stringify(next, null, 1)}\n`);
    await refreshed(kind);
    debug.log("admin: %s %s edited", kind, path.relative(kind === "patch" ? patchesDir : savesDir, dir));
    res.json({ ok: true });
  }));

  router.post("/api/content/:kind/move", handle(async (req, res) => {
    const { kind } = req.params;
    const { root, dir, titleId, folder } = await find(kind, String(req.body?.id ?? ""));
    const to = String(req.body?.titleId ?? "").trim().toUpperCase();
    if (!isBase(to)) throw new ContentError(400, "옮길 게임의 타이틀 ID(16자리, 본편)를 고릅니다");
    if (to === titleId) throw new ContentError(400, "이미 그 게임에 있습니다");
    const dest = inside(root, to, folder);
    if (!dest || fs.existsSync(dest)) throw new ContentError(409, "그 게임에 같은 이름의 폴더가 이미 있습니다. 이름을 바꾸거나 그쪽을 먼저 지웁니다");
    // Built beside the destination, then renamed into place in one step.
    const work = path.join(root, to, `.moving-${crypto.randomBytes(4).toString("hex")}`);
    await fsp.mkdir(work, { recursive: true });
    try {
      for (const rel of await filesUnder(dir)) {
        const next = kind === "patch" ? movedPatchPath(rel, titleId, to) : rel;
        await fsp.mkdir(path.dirname(path.join(work, next)), { recursive: true });
        await fsp.rename(path.join(dir, rel), path.join(work, next));
      }
      await fsp.rename(work, dest);
    } catch (err) {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rmdir(path.dirname(dir)).catch(() => {}); // the old game's folder, when it is left empty
    await refreshed(kind);
    debug.log("admin: %s %s/%s moved to %s", kind, titleId, folder, to);
    res.json({ ok: true });
  }));

  router.post("/api/content/:kind/remove", handle(async (req, res) => {
    const { kind } = req.params;
    const { dir, titleId, folder } = await find(kind, String(req.body?.id ?? ""));
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rmdir(path.dirname(dir)).catch(() => {});
    await refreshed(kind);
    debug.log("admin: %s %s/%s removed", kind, titleId, folder);
    res.json({ ok: true });
  }));
}
