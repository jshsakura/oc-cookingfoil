/**
 * How a homebrew zip lands on the console, decided by fixed rules only: the same
 * zip always gives the same result, and every decision is written down in
 * `rules` and `excluded` for the admin page and the log.
 *
 * Whatever the zip looks like, everything installed sits under one switch/<app>/
 * folder; nothing is ever written outside it. In order:
 *
 *   1. unsafe   a link or a strange path anywhere: no folder install at all
 *   2. junk     __MACOSX/, .DS_Store, Thumbs.db, desktop.ini, ._* and README /
 *               LICENSE / CHANGELOG anywhere. Other .txt / .md files outside the
 *               app folder go with everything else outside it; inside, they can be
 *               the app's data (an item list beside the .nro) and stay
 *   3. wrapper  every file under one top folder that is not switch/ and holds no
 *               .nro of its own ("MyApp-v1.2/…"): that folder is peeled off, again
 *               if needed (at most WRAPPER_DEPTH times)
 *   4. app      with switch/: the switch/<app>/ holding the chosen .nro; anything
 *               outside switch/ (atmosphere/, config/ …) and other apps are left out.
 *               Without switch/: a top folder holding a .nro becomes switch/<that>/,
 *               and files at the root go under switch/<the .nro's name>/
 *   5. nro      among the .nro files directly in the app folder: the one named after
 *               the repository, else after the folder, else the first by name; the
 *               others stay as data
 *   6. foreign  programs for other systems (.exe, .dll …) are left out
 *
 * The result is a folder install when anything besides the .nro remains, else the
 * .nro alone; it falls back to the .nro alone when a name is unsafe or there are
 * too many files. Pure.
 */
import path from "path";

const WRAPPER_DEPTH = 3;
export const MAX_PACKAGE_FILES = 500;
const APP_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const SAFE_SEGMENT_RE = /^[^\0-\x1f/\\]+$/;
const FOREIGN_FILE_RE = /\.(exe|dll|msi|bat|cmd|ps1|sh|so|dylib|dmg|pkg|app|apk|ipa|appimage|deb|rpm|jar)$/i;
const JUNK_NAME_RE = /^(\.ds_store|thumbs\.db|desktop\.ini|\._.*)$/i;
const DOC_NAME_RE = /^(readme|licen[cs]e|changelog|changes|copying|authors)([._-].*)?$/i;
const isNro = (p) => /\.nro$/i.test(p);
const base = (p) => path.posix.basename(p);
const SAMPLE = 5;

/** "atmosphere/ (12)" style summaries of left-out paths, grouped by their top folder. Pure. */
function summarize(paths) {
  const groups = new Map();
  for (const p of paths) {
    const top = p.includes("/") ? `${p.split("/")[0]}/` : p;
    groups.set(top, (groups.get(top) ?? 0) + 1);
  }
  return [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([top, n]) => (n > 1 || top.endsWith("/") ? `${top} (${n})` : top));
}

function pickNro(nros, repoName, appName) {
  const sorted = [...nros].sort();
  const named = (n) => sorted.find((p) => base(p).toLowerCase() === `${String(n ?? "").toLowerCase()}.nro`);
  return (repoName && named(repoName)) || named(appName) || sorted[0];
}

/**
 * entries: [{ name, size, dir, link }] as zipEntries gives them; repoName: the
 * repository's name, for picking among several .nro files; maxFiles: past this
 * many files only the .nro is kept (a release from the web), unlimited for the admin's own.
 * Returns { mode: "folder" | "nro" | null, reason, appDir, nro: { entry, path },
 * files: [{ entry, path, size }], rules: [string], excluded: [{ rule, paths }] }.
 */
export function normalizeLayout(entries, { repoName = null, maxFiles = MAX_PACKAGE_FILES } = {}) {
  const rules = [];
  const excluded = [];
  const leaveOut = (rule, list) => {
    if (list.length) excluded.push({ rule, paths: summarize(list).slice(0, SAMPLE * 2) });
  };
  const result = (mode, reason, extra = {}) => ({ mode, reason, appDir: null, nro: null, files: [], rules, excluded, ...extra });

  // 1. unsafe
  for (const e of entries) {
    if (e.link) return result(null, "link");
    if (!e.name.split("/").filter(Boolean).every((p) => p !== "." && p !== ".." && SAFE_SEGMENT_RE.test(p)) || e.name.startsWith("/")) return result(null, "unsafe-path");
  }
  let files = entries.filter((e) => !e.dir).map((e) => ({ entry: e.name, path: e.name, size: e.size }));

  // 2. junk (text docs are judged again once the app folder is known)
  const junk = files.filter((f) => f.path.split("/").some((s) => s === "__MACOSX") || JUNK_NAME_RE.test(base(f.path)) || DOC_NAME_RE.test(base(f.path)));
  if (junk.length) {
    rules.push(`junk: left out ${junk.length} file(s) such as ${base(junk[0].path)}`);
    leaveOut("junk", junk.map((f) => f.path));
    files = files.filter((f) => !junk.includes(f));
  }
  if (!files.some((f) => isNro(f.path))) return result(null, "no-nro");

  // 3. wrapper
  for (let i = 0; i < WRAPPER_DEPTH; i++) {
    const tops = new Set(files.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")));
    const [top] = tops;
    if (tops.size !== 1 || !top || top.toLowerCase() === "switch") break;
    if (files.some((f) => isNro(f.path) && f.path === `${top}/${base(f.path)}`)) break; // it is the app folder itself
    rules.push(`wrapper: peeled off ${top}/`);
    files = files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) }));
  }

  // 4. app folder
  let appName;
  let inApp;
  const switched = files.filter((f) => /^switch\//i.test(f.path));
  if (switched.length) {
    const outside = files.filter((f) => !/^switch\//i.test(f.path));
    // An app is a switch/<app>/ folder with a .nro directly in it; a bare switch/<x>.nro counts as app <x>.
    const appOf = (p) => {
      const parts = p.split("/");
      return parts.length === 2 ? parts[1].replace(/\.nro$/i, "") : parts[1];
    };
    const apps = [...new Set(switched.filter((f) => isNro(f.path) && f.path.split("/").length <= 3).map((f) => appOf(f.path)))].sort();
    if (!apps.length) return result(null, "no-nro");
    const nroByApp = (a) => switched.filter((f) => isNro(f.path) && appOf(f.path) === a && f.path.split("/").length <= 3).map((f) => f.path);
    appName = (repoName && apps.find((a) => a.toLowerCase() === repoName.toLowerCase()))
      ?? (repoName && apps.find((a) => nroByApp(a).some((p) => base(p).toLowerCase() === `${repoName.toLowerCase()}.nro`)))
      ?? apps[0];
    rules.push(`app: switch/${appName}/${apps.length > 1 ? ` (of ${apps.join(", ")}, matching the repository or first by name)` : ""}`);
    const mine = (f) => {
      const parts = f.path.split("/");
      return parts.length === 2 ? parts[1].replace(/\.nro$/i, "") === appName : parts[1] === appName;
    };
    leaveOut("outside-switch", outside.map((f) => f.path));
    leaveOut("other-app", switched.filter((f) => !mine(f)).map((f) => f.path));
    if (outside.length) rules.push(`outside-switch: left out ${summarize(outside.map((f) => f.path)).join(", ")}`);
    inApp = switched.filter(mine).map((f) => {
      const parts = f.path.split("/");
      return { ...f, path: parts.length === 2 ? `switch/${appName}/${parts[1]}` : `switch/${appName}/${parts.slice(2).join("/")}` };
    });
  } else {
    const rootNros = files.filter((f) => !f.path.includes("/") && isNro(f.path)).map((f) => f.path);
    if (rootNros.length) {
      appName = pickNro(rootNros, repoName, null).replace(/\.nro$/i, "");
      rules.push(`app: no switch/ folder, the files at the root go under switch/${appName}/`);
      inApp = files.map((f) => ({ ...f, path: `switch/${appName}/${f.path}` }));
    } else {
      const holders = [...new Set(files.filter((f) => isNro(f.path) && f.path.split("/").length === 2).map((f) => f.path.split("/")[0]))].sort();
      if (!holders.length) return result(null, "no-nro");
      appName = (repoName && holders.find((h) => h.toLowerCase() === repoName.toLowerCase())) ?? holders[0];
      rules.push(`app: no switch/ folder, ${appName}/ holds the .nro and becomes switch/${appName}/`);
      leaveOut("other-folder", files.filter((f) => !f.path.startsWith(`${appName}/`)).map((f) => f.path));
      inApp = files.filter((f) => f.path.startsWith(`${appName}/`)).map((f) => ({ ...f, path: `switch/${f.path}` }));
    }
  }
  const appDir = `switch/${appName}`;

  // 6. foreign
  const foreign = inApp.filter((f) => FOREIGN_FILE_RE.test(f.path));
  if (foreign.length) {
    rules.push(`foreign: left out ${foreign.length} program(s) for other systems`);
    leaveOut("foreign-file", foreign.map((f) => f.entry));
    inApp = inApp.filter((f) => !foreign.includes(f));
  }

  // 5. nro
  const direct = inApp.filter((f) => isNro(f.path) && f.path.split("/").length === 3).map((f) => f.path);
  if (!direct.length) return result(null, "no-nro", { appDir });
  const nroPath = pickNro(direct, repoName, appName);
  if (direct.length > 1) rules.push(`nro: ${base(nroPath)} (of ${direct.map(base).join(", ")}); the others stay as data`);
  const nro = { entry: inApp.find((f) => f.path === nroPath).entry, path: nroPath };

  // Every path must stay inside switch/<app>/.
  if (!inApp.every((f) => f.path.startsWith(`${appDir}/`) && !f.path.split("/").includes(".."))) return result(null, "unsafe-path", { nro });
  if (!APP_NAME_RE.test(appName) || !APP_NAME_RE.test(base(nroPath))) return result("nro", "unsafe-path", { nro, appDir: null });
  if (inApp.length > maxFiles) return result("nro", "too-many-files", { nro, appDir });
  if (inApp.length === 1) return result("nro", "only-nro", { nro, appDir });
  const files_ = inApp.sort((a, b) => a.path.localeCompare(b.path));
  return result("folder", excluded.length ? "partial" : null, { appDir, nro, files: files_ });
}
