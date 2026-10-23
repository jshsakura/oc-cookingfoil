/**
 * An admin's homebrew upload (.nro, .zip, or a folder), placed the same way as a
 * GitHub release: normalizeLayout decides switch/<app>/ and what goes in it, the
 * chosen .nro must be a whole NRO with a NACP, and the result replaces
 * <homebrew dir>/<app>/ with a .cookingfoil.json saying what was decided. With
 * port set, the placed app is marked a port at once; otherwise its kind stays.
 * The folder it replaced goes to <homebrew dir>/.cookingfoil-trash, never away.
 *
 * replaceHomebrewFile swaps only the file of a hand-placed app, keeping its folder
 * and so its id, description, pictures, kind and choices.
 */
import fsp from "fs/promises";
import path from "path";
import debug from "../../debug.js";
import { homebrewDir } from "../../helpers/envs.js";
import { MANIFEST, META_APPLICATION, extractPackage, hasOwnMetadata, idFor, inspectNsp, noteManualHome, readNro, safeNspName, zipEntries } from "../../meta/homebrew.js";
import { META_DIR } from "../../meta/art-sidecar.js";
import { park } from "../../meta/homebrew-media.js";
import { normalizeLayout } from "../../meta/homebrew-layout.js";
import { describeProblems } from "../../meta/console-paths.js";
import { nroProblem } from "../../meta/client-build.js";
import { manualApps, refreshManual } from "../homebrew.js";
import * as kinds from "../../meta/homebrew-kinds.js";
import * as trashService from "../../library/trash-service.js";
import { moveNoClobber } from "../../library/safe-move.js";
import { apiText } from "./api-words.js";

/**
 * Copies the server's pictures out of the folder an upload replaces, into `into` (in the work folder),
 * before that folder goes to the trash whole. False when there are none to keep: the replaced
 * release's own metadata/ went with it.
 */
async function copyMetadata(previous, into) {
  const before = await fsp.readFile(path.join(previous, MANIFEST), "utf8").then(JSON.parse).catch(() => null);
  const from = path.join(previous, META_DIR);
  const entries = await fsp.readdir(from).then((names) => names.map((n) => `${META_DIR}/${n}`), () => []);
  if (!entries.length || (before ? before.own_metadata : hasOwnMetadata(entries))) return false;
  await fsp.cp(from, into, { recursive: true, preserveTimestamps: true });
  return true;
}

/**
 * Puts the kept pictures back: into the new folder's metadata/, or, when the new release brings a
 * metadata/ of its own, on the server's side. `copy` is the work folder's copy, so moving from it
 * leaves the trash entry as it was.
 */
async function keepMetadata(app, copy, dest, ownMetadata) {
  if (ownMetadata) return park(idFor("manual", app), copy);
  await moveNoClobber(copy, path.join(dest, META_DIR)).catch((err) => {
    debug.error("upload: keeping %s's %s: %s", dest, META_DIR, err.message);
  });
}

export class HomebrewUploadError extends Error {
  /** `key` and `vars` name an api-words.js message, answered in the request's language (upload-api.js). */
  constructor(message, key = null, vars = {}) {
    super(message);
    this.key = key;
    this.vars = vars;
  }
}

const uploadError = (key, vars) => new HomebrewUploadError(apiText("ko", key, vars), key, vars);

/** items: [{ abs, rel }] as received; a lone .zip is read as a zip. Returns { where, files, install, kind }. */
export async function placeHomebrew(items, work, { port = false, by = null } = {}) {
  const zip = items.length === 1 && /\.zip$/i.test(items[0].rel) ? items[0] : null;
  const repoName = path.posix.basename((zip ?? items.find((i) => /\.nro$/i.test(i.rel)) ?? items[0]).rel).replace(/\.(zip|nro)$/i, "");
  const entries = zip ? await zipEntries(zip.abs) : items.map((i) => ({ name: i.rel, size: 0, dir: false, link: false }));
  const layout = normalizeLayout(entries, { repoName });
  if (layout.reason === "console-path") {
    throw new HomebrewUploadError(`콘솔 SD 에 만들 수 없는 이름이 있어 등록하지 않았습니다. 이름을 바꾼 뒤 다시 올립니다: ${describeProblems(layout.problems, 20)}`);
  }
  if (!layout.nro || !layout.appDir) throw new HomebrewUploadError(`설치할 수 없습니다: ${layout.reason}`);
  const stage = path.join(work, "out");
  const take = layout.mode === "folder" ? layout.files : [{ entry: layout.nro.entry, path: layout.nro.path }];
  if (zip) {
    await extractPackage(zip.abs, { files: take }, stage);
  } else {
    const byRel = new Map(items.map((i) => [i.rel, i.abs]));
    for (const f of take) {
      const dest = path.join(stage, ...f.path.split("/"));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(byRel.get(f.entry), dest);
    }
  }
  const app = layout.appDir.slice("switch/".length);
  const built = path.join(stage, "switch", app);
  const nroFile = path.join(stage, ...layout.nro.path.split("/"));
  const problem = nroProblem(await fsp.readFile(nroFile));
  if (problem) throw new HomebrewUploadError(`올바른 NRO 가 아닙니다: ${problem}`);
  if (!(await readNro(nroFile))) throw new HomebrewUploadError("NRO 에 NACP 가 없습니다");
  const install = { mode: layout.mode, reason: layout.reason, rules: layout.rules, excluded: layout.excluded };
  // A metadata/ the release brings is its own and ships; else the app's pictures from before move into the new folder.
  const ownMetadata = (await fsp.readdir(built)).some((n) => n.toLowerCase() === META_DIR);
  await fsp.writeFile(path.join(built, MANIFEST), JSON.stringify({ nro: path.posix.basename(layout.nro.path), ...install, own_metadata: ownMetadata }, null, 1));
  const dest = path.join(homebrewDir, app);
  const pictures = path.join(work, "kept-metadata");
  let keep = false;
  // What the upload replaces goes to the trash whole, under the app's own path, before anything takes its
  // place. Nothing of it ever sits in the work folder, which is deleted after every upload.
  if (await fsp.lstat(dest).then(() => true, () => false)) {
    keep = await copyMetadata(dest, pictures);
    try {
      await trashService.trash("homebrew", [{ rel: app }], { kind: "homebrew", action: "homebrew-replace", by, name: app });
    } catch (err) {
      debug.error("upload: the replaced %s could not go to the trash: %s", app, err.message);
      throw uploadError("upload.replaceToTrash", { name: app, why: err.message });
    }
  }
  // Known before the folder is in place, so nothing looking at its pictures meanwhile takes a release's own metadata/ for them.
  noteManualHome(app, dest, ownMetadata);
  // Never onto a folder that appeared meanwhile.
  if (!(await moveNoClobber(built, dest))) throw uploadError("upload.folderAppeared", { name: app });
  if (keep) await keepMetadata(app, pictures, dest, ownMetadata);
  debug.log("upload: homebrew %s → %s (%s); %s", repoName, layout.appDir, layout.mode, [...layout.rules, ...layout.excluded.map((x) => `${x.rule}: ${x.paths.join(", ")}`)].join("; ") || "as it is");
  await refreshManual();
  const placed = (await manualApps()).find((e) => path.dirname(e.path) === path.resolve(dest));
  if (port && placed) kinds.set(placed.id, "port");
  return { where: layout.appDir, files: take.length, install, kind: placed ? kinds.kindOf(placed.id) : "tool" };
}

const pfs0 = async (file) => {
  const fh = await fsp.open(file, "r");
  try {
    const { buffer } = await fh.read(Buffer.alloc(4), 0, 4, 0);
    return buffer.toString("latin1") === "PFS0";
  } finally {
    await fh.close();
  }
};

/**
 * A new build of a hand-placed app (id from the manual list): one file of the format it has now.
 * An .nro keeps the old file's name, so the console overwrites switch/<app>/<name>.nro instead of
 * keeping a second one; an .nsp must be the same application title and takes the uploaded name.
 * The old file goes to the homebrew trash first. Returns { where, files, replaced }.
 */
export async function replaceHomebrewFile(items, id, { by = null } = {}) {
  if (items.length !== 1) throw uploadError("fileReplace.one");
  const app = (await manualApps()).find((m) => m.id === String(id ?? ""));
  const dir = app ? (app.folder ?? path.dirname(app.path)) : null;
  if (!dir || path.dirname(dir) !== path.resolve(homebrewDir) || app.archive) throw uploadError("fileReplace.unknown");
  const folder = path.basename(dir);
  const old = path.basename(app.path);
  const want = path.extname(old).toLowerCase();
  const name = app.name ?? folder;
  if (![".nro", ".nsp"].includes(want) || path.extname(items[0].rel).toLowerCase() !== want) throw uploadError("fileReplace.kind", { name, want });
  const file = items[0].abs;
  let fileName = old;
  if (want === ".nro") {
    const problem = nroProblem(await fsp.readFile(file));
    if (problem) throw uploadError("fileReplace.badNro", { why: problem });
    if (!(await readNro(file))) throw uploadError("fileReplace.badNro", { why: "no NACP" });
  } else {
    if (!(await pfs0(file))) throw uploadError("fileReplace.badNsp");
    const facts = await inspectNsp(file);
    if (!facts?.titleId) throw uploadError("fileReplace.nspUnread");
    if (facts.metaType != null && facts.metaType !== META_APPLICATION) throw uploadError("fileReplace.nspNotApp");
    if (app.title_id && facts.titleId.toUpperCase() !== app.title_id.toUpperCase()) throw uploadError("fileReplace.otherTitle", { got: facts.titleId, want: app.title_id });
    fileName = safeNspName(path.posix.basename(items[0].rel), folder);
  }
  // The new build waits in the app's folder under a name the scan skips, so it is in place before the
  // old one leaves: a failure from here on never leaves the app with no file.
  const target = path.join(dir, fileName);
  const waiting = path.join(dir, `.${fileName}.replacing`);
  if (fileName !== old && (await fsp.lstat(target).then(() => true, () => false))) throw uploadError("fileReplace.taken", { name: fileName });
  if (!(await moveNoClobber(file, waiting))) throw uploadError("fileReplace.taken", { name: fileName });
  try {
    await trashService.trash("homebrew", [{ rel: `${folder}/${old}` }], { kind: "homebrew", action: "homebrew-file-replace", by, name });
  } catch (err) {
    await fsp.rm(waiting, { force: true });
    debug.error("upload: %s could not go to the trash: %s", old, err.message);
    throw uploadError("upload.replaceToTrash", { name: old, why: err.message });
  }
  await fsp.rename(waiting, target);
  debug.log("upload: homebrew %s file %s → %s", folder, old, fileName);
  await refreshManual();
  return { where: `homebrew/${folder}/${fileName}`, files: 1, replaced: old };
}
