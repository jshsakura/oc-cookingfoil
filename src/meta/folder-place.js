/**
 * Puts a folder-shaped upload in place: a patch (<patches>/<title id>/<name>/ in SD-root layout), a save
 * (<saves>/<title id>/<name>/), or a patch aimed at a homebrew app. The admin upload page and the drop
 * box (library-organize.js) both place folders through here, so the two cannot drift apart.
 */
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import * as userPatches from "./user-patches.js";
import * as patchInfo from "./patch-info.js";
import { SAVE_TYPES } from "./library-saves.js";
import { patchPlan } from "./patch-intake.js";
import { UploadError, backupSaveType, baseTitleId, homebrewApp, homebrewLayout, moveFile, mustBeFree, safeName, saveLayout } from "./library-upload.js";
import { apiText } from "../routes/admin/api-words.js";

/** A refusal answered with the api-words.js message `key` in the request's language. */
export const refuse = (status, key, vars = {}) => Object.assign(new UploadError(status, apiText("en", key, vars)), { key, vars });

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
export async function placeFolderKind({ kind, items, body, work, fromFolder = false, rootOf }) {
  // The target is a game (its base title id) or a homebrew app (its switch/<app>/ folder name).
  const app = body.homebrew ? homebrewApp(body.homebrew) : null;
  if (body.homebrew && !app) throw refuse(400, "upload.pickApp");
  // A patch may come without a game picked: its own title folder names the game (patch-intake.js).
  const plan = kind === "patch" && !app ? patchPlan(items.map((i) => i.rel), baseTitleId(body.titleId)) : null;
  if (plan) items = plan.files.map((f) => ({ ...items.find((i) => i.rel === f.from), rel: f.to }));
  const tid = app ? null : plan ? plan.titleId : baseTitleId(body.titleId);
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
  const rels = app ? homebrewLayout(paths, app, fromFolder) : plan ? paths : saveLayout(paths, fromFolder);
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

