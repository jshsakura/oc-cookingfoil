/**
 * Game patches and saves after they are uploaded, from the library tab:
 *
 *   GET  /admin/api/saves                     { saves: [{ id, titleId, game, name, ko, description, gameVersion, saveType, source, size, files, verified }] }
 *   POST /admin/api/content/:kind/meta        { id, name, nameKo, description, descriptionKo, version, author, gameVersion, saveType, sourceName, sourceUrl }
 *   POST /admin/api/content/:kind/move        { id, titleId }  to another game; a patch's own paths follow it
 *   POST /admin/api/content/:kind/remove      { id }           move it to the trash (<patches|saves>/.cookingfoil-trash)
 *   POST /admin/api/content/:kind/verified    { id, verified } the 검수됨 badge on or off, kept in the edit history
 *   POST /admin/api/votes/clear               { kind, id }     drops the item's 잘 돼요 / 안 돼요 votes
 *                                             (kind homebrew | retro | patch | save)
 *
 * :kind is patch or save. A game's own patches and saves are handled here;
 * a homebrew app's patch has its information edited here too (from the
 * homebrew tab), while moving and deleting it are on that tab. A patch's
 * information goes into the server's patch store (meta/patch-info.js), which
 * a move carries to the new game and a delete forgets (the trash entry keeps
 * it and a restore puts it back); a save's meta.json is rewritten with the
 * fields given. Moving or deleting one forgets its 검수됨 mark and its votes:
 * the id they were kept under is gone. A move is written to the operations
 * journal (library/journal.js) and can be undone from the trash page.
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
import { libraryGames } from "../../meta/library-games.js";
import { editedInfo } from "./patches-api.js";
import * as itemVerified from "../../meta/item-verified.js";
import * as itemVotes from "../../meta/item-votes.js";
import { setField, FieldError } from "../../meta/item-fields.js";
import debug from "../../debug.js";
import * as trashService from "../../library/trash-service.js";
import { forgetMarks, marksOf } from "../../library/trash-marks.js";
import { moveNoClobber } from "../../library/safe-move.js";
import { API_WORDS, apiWord } from "./api-words.js";

/** Removes `dir` and the folders under it once they hold no file: anything written into it meanwhile stays. */
async function dropEmptyTree(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) if (e.isDirectory()) await dropEmptyTree(path.join(dir, e.name));
  await fsp.rmdir(dir).catch(() => {});
}

const BASE_RE = /^[0-9A-F]{16}$/;
const isBase = (tid) => BASE_RE.test(tid) && (BigInt(`0x${tid}`) & 0x1fffn) === 0n;
const LIMITS = { name: 120, nameKo: 120, description: 2000, descriptionKo: 2000, gameVersion: 40, sourceName: 120, sourceUrl: 300 };

class ContentError extends Error {
  /** `key` names an api-words.js message, answered in the request's language. */
  constructor(status, message, key = null) {
    super(message);
    this.status = status;
    this.key = key;
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

/**
 * Renames, inside a patch folder, the paths that name the game (`from` → `to`),
 * as a move between games does; the folders it leaves empty go.
 */
export async function rewritePatchPaths(dir, from, to) {
  for (const rel of await filesUnder(dir)) {
    const next = movedPatchPath(rel, from, to);
    if (next === rel) continue;
    await fsp.mkdir(path.dirname(path.join(dir, next)), { recursive: true });
    await fsp.rename(path.join(dir, rel), path.join(dir, next));
    for (let d = path.dirname(path.join(dir, rel)); d.startsWith(dir + path.sep); d = path.dirname(d)) {
      if (!(await fsp.rmdir(d).then(() => true, () => false))) break;
    }
  }
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
      if (err instanceof ContentError || err instanceof FieldError) return res.status(err.status).json({ error: err.key ? apiWord(req, err.key) : err.message });
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
        ({ id, titleId, game: names.get(titleId) ?? null, name, ko, description, gameVersion, saveType: saveType ?? null, source, size, files,
          verified: itemVerified.verifiedAt("save", id) !== null })),
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
    if (!dest || fs.existsSync(dest)) throw new ContentError(409, API_WORDS.ko["content.folderTaken"], "content.folderTaken");
    // Built beside the destination, then renamed into place in one step.
    const work = path.join(root, to, `.moving-${crypto.randomBytes(4).toString("hex")}`);
    await fsp.mkdir(work, { recursive: true });
    try {
      for (const rel of await filesUnder(dir)) {
        const next = kind === "patch" ? movedPatchPath(rel, titleId, to) : rel;
        await fsp.mkdir(path.dirname(path.join(work, next)), { recursive: true });
        await fsp.rename(path.join(dir, rel), path.join(work, next));
      }
      // Never onto a folder that appeared meanwhile.
      if (!(await moveNoClobber(work, dest))) throw new ContentError(409, API_WORDS.ko["content.folderTaken"], "content.folderTaken");
    } catch (err) {
      // What was moved into the work folder goes back first; only an empty work folder is removed.
      for (const rel of await filesUnder(work).catch(() => [])) {
        const back = kind === "patch" ? movedPatchPath(rel, to, titleId) : rel;
        await fsp.mkdir(path.dirname(path.join(dir, back)), { recursive: true }).catch(() => {});
        await moveNoClobber(path.join(work, rel), path.join(dir, back)).catch(() => false);
      }
      await dropEmptyTree(work);
      throw err;
    }
    await dropEmptyTree(dir);
    await fsp.rmdir(path.dirname(dir)).catch(() => {}); // the old game's folder, when it is left empty
    // Before the rescan, so an old patch.json that travelled along is not imported over the edits.
    if (kind === "patch") patchInfo.move(patchInfo.keyOf(titleId, folder), patchInfo.keyOf(to, folder));
    // The marks stay with the line, so undoing the move brings them back.
    const marks = marksOf(kind, String(req.body.id));
    forgetMarks(kind, String(req.body.id));
    await trashService.recordMove({
      action: `${kind}-move`, by: trashService.actorOf(req), from: dir, to: dest,
      extra: { ...(kind === "patch" ? { rewrite: { type: "patch-title", from: titleId, to, folder } } : {}), ...(marks ? { marks } : {}) },
    });
    await refreshed(kind);
    debug.log("admin: %s %s/%s moved to %s", kind, titleId, folder, to);
    res.json({ ok: true });
  }));

  router.post("/api/content/:kind/remove", handle(async (req, res) => {
    const { kind } = req.params;
    const { root, dir, titleId, folder } = await find(kind, String(req.body?.id ?? ""));
    const key = kind === "patch" ? patchInfo.keyOf(titleId, folder) : null;
    const marks = marksOf(kind, String(req.body.id));
    let out;
    try {
      out = await trashService.trash(kind === "patch" ? "patches" : "saves", [{ rel: path.relative(root, dir).split(path.sep).join("/") }], {
        kind, action: `${kind}-remove`, by: trashService.actorOf(req), name: folder,
        // The patch store's entry goes with it, so a restore brings its information back.
        extra: { ...(key && patchInfo.has(key) ? { patchInfo: { titleId, folder, info: patchInfo.get(key) } } : {}), ...(marks ? { marks } : {}) },
      });
    } catch (err) {
      if (err instanceof trashService.TrashError) throw new ContentError(err.status, err.message);
      throw err;
    }
    await fsp.rmdir(path.dirname(dir)).catch(() => {});
    if (key) patchInfo.remove(key);
    // Kept in the manifest above: a restore puts them back.
    forgetMarks(kind, String(req.body.id));
    await refreshed(kind);
    debug.log("admin: %s %s/%s moved to the trash", kind, titleId, folder);
    res.json({ ok: true, trash: out.id });
  }));

  router.post("/api/content/:kind/verified", handle(async (req, res) => {
    const { kind } = req.params;
    if (kind !== "patch" && kind !== "save") throw new ContentError(404, "patch 나 save 여야 합니다");
    if (typeof req.body?.verified !== "boolean") throw new ContentError(400, "verified 는 true 나 false 입니다");
    const id = String(req.body?.id ?? "");
    await setField(kind, id, "verified", req.body.verified, { via: "dashboard", device: null, deviceName: null });
    debug.log("admin: %s %s %s", kind, id, req.body.verified ? "verified" : "no longer verified");
    res.json({ ok: true, verified: req.body.verified });
  }));

  router.post("/api/votes/clear", handle(async (req, res) => {
    const kind = String(req.body?.kind ?? "");
    const id = String(req.body?.id ?? "");
    if (!itemVotes.KINDS.includes(kind)) throw new ContentError(404, "homebrew, retro, patch, save 중 하나여야 합니다");
    const before = itemVotes.tally(kind, id);
    itemVotes.forget(kind, id);
    debug.log("admin: votes on %s:%s cleared (%d up, %d down)", kind, id.slice(0, 64), before.up, before.down);
    res.json({ ok: true, up: 0, down: 0 });
  }));
}
