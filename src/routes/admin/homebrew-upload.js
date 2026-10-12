/**
 * An admin's homebrew upload (.nro, .zip, or a folder), placed the same way as a
 * GitHub release: normalizeLayout decides switch/<app>/ and what goes in it, the
 * chosen .nro must be a whole NRO with a NACP, and the result replaces
 * <homebrew dir>/<app>/ with a .cookingfoil.json saying what was decided.
 */
import fsp from "fs/promises";
import path from "path";
import debug from "../../debug.js";
import { homebrewDir } from "../../helpers/envs.js";
import { MANIFEST, extractPackage, readNro, zipEntries } from "../../meta/homebrew.js";
import { normalizeLayout } from "../../meta/homebrew-layout.js";
import { nroProblem } from "../../meta/client-build.js";
import { refreshManual } from "../homebrew.js";

export class HomebrewUploadError extends Error {}

/** items: [{ abs, rel }] as received; a lone .zip is read as a zip. Returns { where, files, install }. */
export async function placeHomebrew(items, work) {
  const zip = items.length === 1 && /\.zip$/i.test(items[0].rel) ? items[0] : null;
  const repoName = path.posix.basename((zip ?? items.find((i) => /\.nro$/i.test(i.rel)) ?? items[0]).rel).replace(/\.(zip|nro)$/i, "");
  const entries = zip ? await zipEntries(zip.abs) : items.map((i) => ({ name: i.rel, size: 0, dir: false, link: false }));
  const layout = normalizeLayout(entries, { repoName });
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
  await fsp.writeFile(path.join(built, MANIFEST), JSON.stringify({ nro: path.posix.basename(layout.nro.path), ...install }, null, 1));
  const dest = path.join(homebrewDir, app);
  await fsp.rm(path.join(work, "previous"), { recursive: true, force: true });
  await fsp.rename(dest, path.join(work, "previous")).catch((err) => { if (err.code !== "ENOENT") throw err; });
  await fsp.rename(built, dest);
  debug.log("upload: homebrew %s → %s (%s); %s", repoName, layout.appDir, layout.mode, [...layout.rules, ...layout.excluded.map((x) => `${x.rule}: ${x.paths.join(", ")}`)].join("; ") || "as it is");
  await refreshManual();
  return { where: layout.appDir, files: take.length, install };
}
