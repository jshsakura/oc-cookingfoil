/**
 * Game patches and saves after they are uploaded, from the library tab:
 *
 *   GET  /admin/api/saves                     { saves: [{ id, titleId, game, name, ko, description, gameVersion, saveType, source, size, files }] }
 *   POST /admin/api/content/:kind/meta        { id, name, nameKo, description, descriptionKo, version, author, gameVersion, saveType, sourceName, sourceUrl }
 *   POST /admin/api/content/:kind/move        { id, titleId }  to another game; a patch's own paths follow it
 *   POST /admin/api/content/:kind/remove      { id }           delete it from disk
 *
 * :kind is patch or save. A game's own patches and saves are handled here;
 * a homebrew app's patch has its information edited here too (from the
 * homebrew tab), while moving and deleting it are on that tab. A patch's
 * information goes into the server's patch store (meta/patch-info.js), which
 * a move carries to the new game and a delete forgets; a save's meta.json is
 * rewritten with the fields given.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import * as userPatches from "../../meta/user-patches.js";
import * as patchInfo from "../../meta/patch-info.js";
import { SAVE_TYPES } from "../../meta/shop-saves.js";
import { patchesDir, savesDir } from "../../helpers/envs.js";
import { savesCatalog, savesEnabled } from "../saves.js";
import { inside } from "./homebrew-apps-api.js";
import { libraryGames } from "./upload-api.js";
import { editedInfo } from "./patches-api.js";
import debug from "../../debug.js";

const BASE_RE = /^[0-9A-F]{16}$/;
const isBase = (tid) => BASE_RE.test(tid) && (BigInt(`0x${tid}`) & 0x1fffn) === 0n;
const LIMITS = { name: 120, nameKo: 120, description: 2000, descriptionKo: 2000, gameVersion: 40, sourceName: 120, sourceUrl: 300 };

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
 * A patch's information after an edit from the dialog's fields (nameKo,
 * gameVersion, updateVersion, ...): checked against the store's limits, empty
 * fields dropped, `required` kept. The game version and the update the patch
 * is for stay as they were when the edit leaves them out. Pure.
 */
export function patchMeta(old, input) {
  const str = (v) => (v === undefined || v === null ? undefined : String(v));
  const body = {
    name: str(input?.name) ?? "",
    version: str(input?.version),
    author: str(input?.author),
    description: str(input?.description),
    ko: { name: str(input?.nameKo), description: str(input?.descriptionKo) },
    ...(input?.gameVersion === undefined ? {} : { game_version: str(input.gameVersion) }),
    ...(input?.updateVersion === undefined ? {} : { update_version: input.updateVersion }),
  };
  try {
    return editedInfo(old, body);
  } catch (err) {
    if (err instanceof patchInfo.InfoError) throw new ContentError(400, err.message);
    throw err;
  }
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
    if (kind === "patch") {
      // A game's or a homebrew app's patch: into the store, shown at once.
      const id = String(req.body?.id ?? "");
      const where = userPatches.locate(id);
      if (!where?.key) throw new ContentError(404, "목록에 없는 항목입니다");
      patchInfo.set(where.key, patchMeta(userPatches.infoOf(id), req.body));
      debug.log("admin: patch %s edited", where.key);
      return res.json({ ok: true });
    }
    const { dir } = await find(kind, String(req.body?.id ?? ""));
    const file = path.join(dir, "meta.json");
    let old = {};
    try {
      old = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw new ContentError(409, `${path.basename(file)} 을 읽지 못했습니다. 파일을 고친 뒤 다시 합니다`);
    }
    await fsp.writeFile(file, `${JSON.stringify(saveMeta(old, req.body), null, 1)}\n`);
    await refreshed(kind);
    debug.log("admin: save %s edited", path.relative(savesDir, dir));
    res.json({ ok: true });
  }));

  router.post("/api/content/:kind/move", handle(async (req, res) => {
    const { kind } = req.params;
    const { root, dir, titleId, folder } = await find(kind, String(req.body?.id ?? ""));
    const to = String(req.body?.titleId ?? "").trim().toUpperCase();
    if (!isBase(to)) throw new ContentError(400, "옮길 게임의 타이틀 ID(16자리, 본편)를 고릅니다");
    if (to === titleId) throw new ContentError(400, "이미 그 게임에 있습니다");
    const dest = inside(root, to, folder);
    if (!dest || fs.existsSync(dest)) throw new ContentError(409, "그 게임에 같은 이름의 폴더가 이미 있습니다. 이름을 바꾸거나 그쪽을 먼저 삭제합니다");
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
    // Before the rescan, so an old patch.json that travelled along is not imported over the edits.
    if (kind === "patch") patchInfo.move(patchInfo.keyOf(titleId, folder), patchInfo.keyOf(to, folder));
    await refreshed(kind);
    debug.log("admin: %s %s/%s moved to %s", kind, titleId, folder, to);
    res.json({ ok: true });
  }));

  router.post("/api/content/:kind/remove", handle(async (req, res) => {
    const { kind } = req.params;
    const { dir, titleId, folder } = await find(kind, String(req.body?.id ?? ""));
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rmdir(path.dirname(dir)).catch(() => {});
    if (kind === "patch") patchInfo.remove(patchInfo.keyOf(titleId, folder));
    await refreshed(kind);
    debug.log("admin: %s %s/%s removed", kind, titleId, folder);
    res.json({ ok: true });
  }));
}
