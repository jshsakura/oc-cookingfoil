/**
 * An admin's homebrew upload (.nro, .zip, or a folder), placed the same way as a
 * GitHub release: normalizeLayout decides switch/<app>/ and what goes in it, the
 * chosen .nro must be a whole NRO with a NACP, and the result replaces
 * <homebrew dir>/<app>/ with a .cookingfoil.json saying what was decided. With
 * port set, the placed app is marked a port at once; otherwise its kind stays.
 * The folder it replaced goes to <homebrew dir>/.cookingfoil-trash, never away.
 */
import fsp from "fs/promises";
import path from "path";
import debug from "../../debug.js";
import { homebrewDir } from "../../helpers/envs.js";
import { MANIFEST, extractPackage, hasOwnMetadata, idFor, noteManualHome, readNro, zipEntries } from "../../meta/homebrew.js";
import { META_DIR } from "../../meta/art-sidecar.js";
import { park } from "../../meta/homebrew-media.js";
import { normalizeLayout } from "../../meta/homebrew-layout.js";
import { describeProblems } from "../../meta/console-paths.js";
import { nroProblem } from "../../meta/client-build.js";
import { manualApps, refreshManual } from "../homebrew.js";
import * as kinds from "../../meta/homebrew-kinds.js";
import * as trashService from "../../library/trash-service.js";

/**
 * Keeps the server's pictures from the folder an upload replaced: its metadata/ moves into the new
 * folder, or, when the new release brings a metadata/ of its own, the pictures move to the server's side.
 * Done before the replaced folder goes to the trash.
 */
async function keepMetadata(app, previous, dest, ownMetadata) {
  const before = await fsp.readFile(path.join(previous, MANIFEST), "utf8").then(JSON.parse).catch(() => null);
  const from = path.join(previous, META_DIR);
  const entries = await fsp.readdir(from).then((names) => names.map((n) => `${META_DIR}/${n}`), () => []);
  // The replaced release's own metadata/ went with it.
  if (before ? before.own_metadata : hasOwnMetadata(entries)) return;
  if (ownMetadata) return park(idFor("manual", app), from);
  await fsp.rename(from, path.join(dest, META_DIR)).catch((err) => {
    if (err.code !== "ENOENT") debug.error("upload: keeping %s's %s: %s", dest, META_DIR, err.message);
  });
}

export class HomebrewUploadError extends Error {}

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
  const previous = path.join(work, "previous");
  await fsp.rm(previous, { recursive: true, force: true });
  await fsp.rename(dest, previous).catch((err) => { if (err.code !== "ENOENT") throw err; });
  // Known before the folder is in place, so nothing looking at its pictures meanwhile takes a release's own metadata/ for them.
  noteManualHome(app, dest, ownMetadata);
  await fsp.rename(built, dest);
  await keepMetadata(app, previous, dest, ownMetadata);
  // What the upload replaced waits in the trash under the app's own path, not with the work folder.
  if (await fsp.lstat(previous).then(() => true, () => false)) {
    await trashService.trash("homebrew", [{ rel: app, from: previous }], { kind: "homebrew", action: "homebrew-replace", by, name: app })
      .catch((err) => debug.error("upload: the replaced %s stays in %s: %s", app, previous, err.message));
  }
  debug.log("upload: homebrew %s → %s (%s); %s", repoName, layout.appDir, layout.mode, [...layout.rules, ...layout.excluded.map((x) => `${x.rule}: ${x.paths.join(", ")}`)].join("; ") || "as it is");
  await refreshManual();
  const placed = (await manualApps()).find((e) => path.dirname(e.path) === path.resolve(dest));
  if (port && placed) kinds.set(placed.id, "port");
  return { where: layout.appDir, files: take.length, install, kind: placed ? kinds.kindOf(placed.id) : "tool" };
}
