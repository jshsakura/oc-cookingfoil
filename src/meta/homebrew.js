/**
 * Homebrew (.nro apps) for a client to keep in sdmc:/switch/<app>/.
 *
 * Two sources, one listing:
 *   manual  <homebrewDir>/<folder>/<app>.nro, dropped there by hand
 *   github  repositories the admin follows (homebrew-sources.js), through their
 *           latest release: a .nro, or a .zip with a .nro inside
 *
 * GitHub is asked at most once per check interval (six hours by default) per repository, with the
 * last ETag, so an unchanged release costs one 304. A new release is only
 * announced: its build is fetched when a console first downloads it, then
 * kept under <data dir>/homebrew/<id>/. The one exception is a repository
 * seen for the first time, whose build is fetched at once for its name and
 * icon. What was learned is saved, so a restart asks GitHub nothing new.
 *
 * Each entry's `hash` is opaque: it changes when the build changes, which is
 * all a client needs to show an update.
 */
import { execFile, spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import debug from "../debug.js";
import { leftOutOfFolder, normalizeLayout } from "./homebrew-layout.js";
import { describeProblems, pathProblems } from "./console-paths.js";
import { nroProblem } from "./client-build.js";
import { parseAssets } from "./extract-providers/nro.js";
import { decodeNacp } from "./nacp-decode.js";

/** How often a healthy repository is asked again, unless the server sets COOK_HOMEBREW_CHECK_HOURS. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_NRO_BYTES = 128 * 1024 * 1024;
// Bumped whenever how a release is laid out changes (homebrew-layout.js), so every cached build is decided again once.
const LAYOUT_RULES = 2;
const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const ERROR_RETRY_MS = 60 * 60 * 1000;
const UNZIP_TIMEOUT_MS = 5 * 60 * 1000;
// Builds for other platforms that share a release with the homebrew one.
const OTHER_PLATFORMS = new Set(["windows", "win", "win32", "win64", "linux", "mac", "macos", "osx", "darwin", "android", "ios",
  "wiiu", "3ds", "vita", "psp", "ps4", "x86", "x64", "x86_64", "amd64", "arm64", "aarch64", "i386", "appimage", "clangarm64", "ucrt64", "oldgpu"]);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FILE_RE = /^[A-Za-z0-9_.-]+\.nro$/i;
const DOWNLOAD_PREFIX = "https://github.com/";
const USER_AGENT = "oc-cookingfoil";
const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const digestOf = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
const idFor = (source, key) => `${source === "github" ? "gh" : "m"}-${digestOf(key.toLowerCase())}`;

/** "owner/name" from "owner/name" or a github.com address, else null. Pure. */
export function parseRepo(text) {
  const s = String(text ?? "").trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i) ?? s.match(/^([^/:]+)\/([^/]+)$/);
  const repo = m ? `${m[1]}/${m[2].replace(/\.git$/i, "")}` : "";
  return REPO_RE.test(repo) && !repo.split("/").some((p) => /^\.+$/.test(p)) ? repo : null;
}

/** `name` when it is a plain .nro file name, else `<fallback>.nro` with the fallback made plain too. Pure. */
export function safeFileName(name, fallback) {
  if (FILE_RE.test(name ?? "") && !name.startsWith(".")) return name;
  const base = String(fallback ?? "").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 60);
  return `${base || "app"}.nro`;
}

/** A glob ("*" and "?") over a file name, case-insensitive. Pure. */
export function globRegExp(pattern) {
  const body = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

const otherPlatform = (name) => name.replace(/\.zip$/i, "").toLowerCase().split(/[-_. ]+/).some((t) => OTHER_PLATFORMS.has(t));

/** A release's files a client could use (.nro and .zip from GitHub), sorted by name. Pure. */
export function usableAssets(release) {
  return (release?.assets ?? [])
    .filter((a) => /\.(nro|zip)$/i.test(a?.name ?? "") && String(a.browser_download_url ?? "").startsWith(DOWNLOAD_PREFIX))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The release file to use. With `pattern`, the first that matches it.
 * Otherwise a .nro, preferring the one named after the repository; failing
 * that a .zip that isn't another platform's build. Pure.
 */
export function pickAsset(release, repo, pattern = null) {
  const assets = usableAssets(release);
  if (pattern) {
    const re = globRegExp(pattern);
    return assets.find((a) => re.test(a.name)) ?? null;
  }
  const repoName = repo.split("/")[1].toLowerCase();
  const nros = assets.filter((a) => /\.nro$/i.test(a.name));
  if (nros.length) return nros.find((a) => a.name.toLowerCase() === `${repoName}.nro`) ?? nros[0];
  const zips = assets.filter((a) => /\.zip$/i.test(a.name) && !otherPlatform(a.name));
  return zips.find((a) => a.name.toLowerCase().startsWith(repoName)) ?? zips[0] ?? null;
}

/**
 * The release files worth comparing when the server chooses by itself: every
 * zip that isn't another platform's build, plus the chosen .nro. Fewer than two
 * means there is nothing to compare. Pure.
 */
export function assetCandidates(release, chosen) {
  const zips = usableAssets(release).filter((a) => /\.zip$/i.test(a.name) && !otherPlatform(a.name));
  const list = /\.nro$/i.test(chosen?.name ?? "") ? [chosen, ...zips] : zips;
  return list.length > 1 ? list : [];
}

/** The .nro to take out of a zip's entry names: the one named after the repository, else the first. Pure. */
export function pickZipEntry(names, repo) {
  const nros = names.filter((n) => /\.nro$/i.test(n) && !n.endsWith("/")).sort();
  const repoName = repo.split("/")[1].toLowerCase();
  return nros.find((n) => path.posix.basename(n).toLowerCase() === `${repoName}.nro`) ?? nros[0] ?? null;
}

// unzip reads its file arguments as wildcards; brackets make each special character literal.
const literal = (name) => name.replace(/[[\]*?\\]/g, (c) => `[${c}]`);

// "-rw-r--r--  3.0 unx  1234 tx defN 24-Jan-01 12:00 name": a permission field first, the name last.
const ZIPINFO_LINE = /^([-?dlbcps][-rwxsStTa?]{5,9})\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s(.*)$/;
/** A zip's entries as { name, size, dir, link } (from zipinfo, without unpacking anything). */
export async function zipEntries(zip) {
  const out = await new Promise((resolve, reject) => {
    execFile("unzip", ["-Z", zip], { timeout: UNZIP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, text) => (err ? reject(new Error("the zip can't be read")) : resolve(text)));
  });
  const entries = [];
  for (const line of out.split("\n")) {
    const m = ZIPINFO_LINE.exec(line);
    if (m) entries.push({ name: m[3], size: Number(m[2]), dir: m[1].startsWith("d") || m[3].endsWith("/"), link: m[1].startsWith("l") });
  }
  return entries;
}

const APP_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/**
 * Where the console keeps an app: always its own folder, switch/<app>/<file>.nro.
 * `appDir` is a zip's switch/<app> when it had one; otherwise the folder is named
 * after the file. Pure.
 */
export function installPathFor(fileName, appDir = null) {
  const dir = appDir && /^switch\/[^/]+$/i.test(appDir) && APP_NAME_RE.test(appDir.slice(7)) ? appDir : `switch/${String(fileName).replace(/\.nro$/i, "")}`;
  return `${dir}/${fileName}`;
}


/** How well a zip serves the console: a whole app folder beats a lone .nro; nothing usable is -1. Pure. */
export function zipScore(entries, repo) {
  const layout = normalizeLayout(entries, { repoName: repo.split("/")[1] });
  if (layout.mode === "folder") return 1000 + layout.files.length;
  return layout.nro ? 1 : -1;
}

/** Streams one entry of `zip` into `dest` (never to a path the zip names), cut off past `maxBytes`. Returns the bytes written. */
function extractEntry(zip, entry, dest, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zip, literal(entry)], { stdio: ["ignore", "pipe", "ignore"] });
    const out = fs.createWriteStream(dest);
    let written = 0;
    let failed = null;
    // A full disk must fail this copy, not take the whole server down.
    out.on("error", (err) => { failed ??= err; child.kill(); });
    const timer = setTimeout(() => { failed = new Error("unzip took too long"); child.kill(); }, UNZIP_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      written += chunk.length;
      if (written > maxBytes) {
        failed ??= new Error(`the build is larger than ${maxBytes} bytes unpacked`);
        child.kill();
        return;
      }
      out.write(chunk);
    });
    child.on("error", (err) => { failed ??= err; });
    child.on("close", (code) => {
      clearTimeout(timer);
      const done = (err) => {
        const problem = failed ?? err ?? (code ? new Error(`unzip exited ${code}`) : null);
        if (!problem) return resolve(written);
        fsp.rm(dest, { force: true }).finally(() => reject(problem));
      };
      if (out.destroyed) done(null);
      else out.end(done);
    });
  });
}

/**
 * Unpacks a folder layout under `destDir`: each zip entry to the switch/<app>/
 * path normalizeLayout gave it (already checked to stay inside that folder). The whole folder counts against `maxBytes`.
 * Returns [{ path, size, sha256 }].
 */
export async function extractPackage(zip, folder, destDir, maxBytes = MAX_NRO_BYTES) {
  const root = path.resolve(destDir);
  let left = maxBytes;
  const out = [];
  for (const f of folder.files) {
    const target = path.resolve(root, ...f.path.split("/"));
    if (!target.startsWith(root + path.sep)) throw new Error(`the zip entry ${f.path} leaves its folder`);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const written = await extractEntry(zip, f.entry, target, left);
    left -= written;
    out.push({ path: f.path, size: written, sha256: await sha256File(target) });
  }
  return out;
}

/**
 * Copies one .nro out of `zip` into `dest`. The entry is streamed into our own
 * file (never unpacked to a path the zip names) and cut off past `maxBytes`.
 * Returns the entry's base name.
 */
export async function extractNro(zip, repo, dest, maxBytes = MAX_NRO_BYTES) {
  const names = await new Promise((resolve, reject) => {
    execFile("unzip", ["-Z1", zip], { timeout: UNZIP_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, out) => (err ? reject(new Error("the zip can't be read")) : resolve(out.split("\n").filter(Boolean))));
  });
  const entry = pickZipEntry(names, repo);
  if (!entry) throw new Error("the zip holds no .nro");
  await extractEntry(zip, entry, dest, maxBytes);
  return path.posix.basename(entry);
}

/** Name, author and version from an NRO's NACP, or null when it is not an NRO. */
export async function readNro(file) {
  const assets = await parseAssets(file).catch(() => null);
  const meta = assets?.nacp ? decodeNacp(assets.nacp) : null;
  return meta ? { name: meta.name || null, author: meta.publisher || null, version: meta.version } : null;
}

// abs path → { key, hash }, so a rescan only reads changed files. Kept on disk
// (setManualHashFile), so a restart doesn't read a large app's data again.
let manualHashes = null;
let hashFile = null;
let hashesChanged = false;

/** Where hand-placed apps' file hashes are remembered across restarts. */
export function setManualHashFile(file) {
  hashFile = file;
  manualHashes = null;
}

function hashes() {
  if (manualHashes) return manualHashes;
  manualHashes = new Map();
  try {
    if (hashFile) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(hashFile, "utf8")))) manualHashes.set(k, v);
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("homebrew: %s unreadable, hashing again: %s", hashFile, err.message);
  }
  return manualHashes;
}

async function saveHashes(seen) {
  for (const k of [...hashes().keys()]) if (!seen.has(k)) { hashes().delete(k); hashesChanged = true; }
  if (!hashFile || !hashesChanged) return;
  hashesChanged = false;
  await fsp.mkdir(path.dirname(hashFile), { recursive: true });
  await fsp.writeFile(`${hashFile}.tmp`, JSON.stringify(Object.fromEntries(hashes())));
  await fsp.rename(`${hashFile}.tmp`, hashFile);
}

async function cachedSha256(file, st, seen = null) {
  seen?.add(file);
  const key = `${st.size}:${st.mtimeMs}:${st.ino}`;
  const known = hashes().get(file);
  if (known?.key === key) return known.hash;
  const hash = await sha256File(file);
  hashes().set(file, { key, hash });
  hashesChanged = true;
  return hash;
}

export async function sha256File(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

/** Every hand-placed app: the first .nro of each folder under `root`. */
/** What an admin upload decided for a hand-placed app, kept in its folder: { nro, mode, reason, rules, excluded }. */
export const MANIFEST = ".cookingfoil.json";

/** Every file under `dir` (relative, "/"-separated), skipping the manifest and links. */
async function filesUnder(dir, rel = "") {
  const out = [];
  for (const e of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await filesUnder(dir, r)));
    else if (e.isFile() && r !== MANIFEST) out.push(r);
  }
  return out.sort();
}

/**
 * Registers hand-placed folders that have no manifest yet: a folder holding a .nro
 * plus other files becomes a folder install (everything in it goes to switch/<folder>/),
 * so dropping a ported game into the homebrew folder and pressing the admin button is
 * all it takes. A lone .nro needs nothing; unsafe names are reported, not guessed at.
 * Returns { registered: [folder], skipped: [{ folder, reason }] }.
 */
export async function adoptFolders(root) {
  const registered = [];
  const skipped = [];
  let folders;
  try {
    folders = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") return { registered, skipped };
    throw err;
  }
  for (const folder of folders.sort()) {
    const dir = path.join(root, folder);
    const hasManifest = await fsp.stat(path.join(dir, MANIFEST)).then(() => true, () => false);
    if (hasManifest) continue;
    const nro = (await fsp.readdir(dir)).filter((f) => /\.nro$/i.test(f)).sort()[0];
    if (!nro) continue;
    const files = await filesUnder(dir);
    if (files.length < 2) continue;
    if (!APP_NAME_RE.test(folder) || !APP_NAME_RE.test(nro)) {
      skipped.push({ folder, reason: "폴더나 .nro 이름에 영문, 숫자, - _ . 만 쓸 수 있습니다" });
      continue;
    }
    // The same check every install goes through: guides are left out, any other name the card can't create stops it.
    const problems = pathProblems(files.filter((r) => !leftOutOfFolder(r)).map((r) => `switch/${folder}/${r}`));
    if (problems.length) {
      skipped.push({ folder, reason: `콘솔 SD 에 만들 수 없는 이름이 있습니다: ${describeProblems(problems)}` });
      continue;
    }
    const manifest = { nro, mode: "folder", reason: "게임 데이터가 함께 있어야 실행됩니다", rules: [], excluded: [] };
    await fsp.writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest));
    registered.push(folder);
  }
  return { registered, skipped };
}

export async function scanManual(root) {
  let folders;
  try {
    folders = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("homebrew: cannot read %s: %s", root, err.message);
    return [];
  }
  const out = [];
  const seen = new Set();
  const held = [];
  for (const folder of folders.sort()) {
    try {
      const entry = await readManual(root, folder, seen, held);
      if (entry) out.push(entry);
    } catch (err) {
      debug.error("homebrew: %s left out: %s", path.join(root, folder), err.message);
    }
  }
  await saveHashes(seen).catch((err) => debug.error("homebrew: hashes not saved: %s", err.message));
  heldBack = held;
  return out;
}

// Hand-placed apps the last scan kept off the consoles' list, with why: [{ folder, reason }].
let heldBack = [];
const heldLogged = new Map(); // folder → the reason last logged, so a minutely rescan logs it once

/** The hand-placed apps the last scan left out of the list, for the admin page. */
export function heldManual() {
  return heldBack;
}

function hold(held, folder, reason) {
  held?.push({ folder, reason });
  if (heldLogged.get(folder) !== reason) debug.error("homebrew: %s left out: %s", folder, reason);
  heldLogged.set(folder, reason);
}

async function readManual(root, folder, seen = null, held = null) {
  const dir = path.join(root, folder);
  const manifest = await fsp.readFile(path.join(dir, MANIFEST), "utf8").then(JSON.parse).catch(() => null);
  const names = await fsp.readdir(dir);
  const file = manifest?.nro && names.includes(manifest.nro) ? manifest.nro : names.filter((f) => /\.nro$/i.test(f)).sort()[0];
  if (!file) {
    // A folder holding a release zip as it is: served whole, never unpacked here.
    const zip = names.filter((f) => /\.zip$/i.test(f)).sort()[0];
    return zip ? readManualZip(dir, folder, zip, seen, held) : null;
  }
  const abs = path.join(dir, file);
  const meta = await readNro(abs);
  if (!meta) {
    debug.error("homebrew: %s is not an NRO", abs);
    return null;
  }
  const st = await fsp.stat(abs);
  const hash = await cachedSha256(abs, st, seen);
  // An uploaded folder install lists every file of switch/<folder>/; a hand-placed folder is its .nro alone.
  let folderInstall = null;
  if (manifest?.mode === "folder" && APP_NAME_RE.test(folder) && APP_NAME_RE.test(file)) {
    const files = [];
    // Install guides and desktop clutter stay on the server; the console gets what the app runs on.
    for (const rel of (await filesUnder(dir)).filter((r) => !leftOutOfFolder(r))) {
      const fileAbs = path.join(dir, ...rel.split("/"));
      const fst = await fsp.stat(fileAbs);
      files.push({ path: `switch/${folder}/${rel}`, size: fst.size, sha256: await cachedSha256(fileAbs, fst, seen), abs: fileAbs, key: `${fst.size}:${fst.mtimeMs}:${fst.ino}` });
    }
    // A name the card can't create would fail at the very end of the install; the app waits until it is renamed.
    const problems = pathProblems(files.map((f) => f.path));
    if (problems.length) {
      hold(held, folder, `콘솔 SD 에 만들 수 없는 이름이 있어 기기 목록에서 뺐습니다. 이름을 바꾸면 다시 나옵니다: ${describeProblems(problems)}`);
      return null;
    }
    folderInstall = { install_dir: `switch/${folder}`, install_path: `switch/${folder}/${file}`, files };
  }
  return {
    ...(folderInstall ?? {}),
    install: manifest ? { mode: manifest.mode, reason: manifest.reason ?? null, rules: manifest.rules ?? [], excluded: manifest.excluded ?? [] } : null,
    id: idFor("manual", folder),
    name: meta.name ?? folder,
    version: meta.version,
    author: meta.author,
    size: st.size,
    hash,
    file_name: safeFileName(file, folder),
    source: "manual",
    released_at: new Date(st.mtimeMs).toISOString(),
    repo_url: null,
    path: abs,
    sha256: hash,
  };
}

// zip path → { key, layout, sizes, failed }, so the minutely rescan reads each zip
// once: its listing, and a zip that could not be used stays skipped until it changes.
const zipLayouts = new Map();

/** Where the .nro of a kept zip is copied for its name and icon: beside the hash file, or a folder of this process in tests. */
const zipNroDir = () => path.join(hashFile ? path.dirname(hashFile) : path.join(os.tmpdir(), `cookingfoil-${process.pid}`), "zip-nro");

/** Forget the .nro copies of a removed app, so a new app in the same folder starts clean. */
export async function forgetZipCopies(id) {
  const dir = zipNroDir();
  const names = await fsp.readdir(dir).catch(() => []);
  await Promise.all(names.filter((n) => n.startsWith(`${id}-`)).map((n) => fsp.rm(path.join(dir, n), { force: true })));
}

/**
 * A hand-placed app kept as a zip: listed like any app, its .nro copied out for
 * the name, version and icon, and the zip itself sent as `archive` with the map
 * of which entry goes where on the card.
 */
async function readManualZip(dir, folder, zipName, seen, held = null) {
  const abs = path.join(dir, zipName);
  const st = await fsp.stat(abs);
  const key = `${st.size}:${st.mtimeMs}:${st.ino}`;
  let known = zipLayouts.get(abs);
  if (known?.key !== key) {
    known = { key, layout: null, sizes: null, failed: null };
    zipLayouts.set(abs, known);
    try {
      const entries = await zipEntries(abs);
      // The admin's own zip: as many files as it holds.
      known.layout = normalizeLayout(entries, { repoName: folder, maxFiles: Infinity });
      known.sizes = new Map(entries.map((e) => [e.name, e.size]));
      // A name the card can't take (spaces, other scripts, :?) would install only the .nro, or under a mangled path.
      if (known.layout.reason === "console-path") known.failed = `the card can't create ${describeProblems(known.layout.problems)}`;
      else if (known.layout.reason === "unsafe-path") known.failed = `a path in it can't go on the card as it is${known.layout.nro ? ` (${known.layout.nro.path})` : ""}; app folder and .nro names take ASCII letters, digits, - _ and .`;
      else if (!known.layout.nro) known.failed = "it holds no .nro for switch/<app>/";
    } catch (err) {
      known.failed = err.message;
    }
    if (known.failed) debug.error("homebrew: %s left out: %s", abs, known.failed);
  }
  if (known.failed) {
    held?.push({ folder, reason: known.failed });
    return null;
  }
  const { layout } = known;
  const id = idFor("manual", folder);
  const hash = await cachedSha256(abs, st, seen);
  // Named after the zip's hash: a different zip, older or newer, never reuses another one's copy.
  const nro = path.join(zipNroDir(), `${id}-${hash.slice(0, 16)}.nro`);
  if (!(await fsp.stat(nro).catch(() => null))) {
    await fsp.mkdir(path.dirname(nro), { recursive: true });
    try {
      await extractEntry(abs, layout.nro.entry, `${nro}.tmp`, MAX_NRO_BYTES);
      await fsp.rename(`${nro}.tmp`, nro);
    } catch (err) {
      known.failed = `its .nro can't be copied out: ${err.message}`;
      debug.error("homebrew: %s left out: %s", abs, known.failed);
      return null;
    }
    // The copies of earlier zips in this folder are no longer needed.
    for (const n of await fsp.readdir(path.dirname(nro))) if (n.startsWith(`${id}-`) && n !== path.basename(nro)) await fsp.rm(path.join(path.dirname(nro), n), { force: true });
  }
  const meta = await readNro(nro);
  if (!meta) {
    known.failed = `${layout.nro.entry} is not an NRO`;
    debug.error("homebrew: %s left out: %s", abs, known.failed);
    return null;
  }
  const nroSt = await fsp.stat(nro);
  const nroHash = await cachedSha256(nro, nroSt, seen);
  const folderMode = layout.mode === "folder";
  const files = folderMode ? layout.files : [{ ...layout.nro, size: known.sizes.get(layout.nro.entry) ?? 0 }];
  return {
    install_dir: folderMode ? layout.appDir : null,
    install_path: layout.nro.path,
    install: { mode: layout.mode, reason: layout.reason ?? null, rules: layout.rules ?? [], excluded: layout.excluded ?? [] },
    archive: { format: "zip", abs, key, size: st.size, sha256: hash, entries: files.map((f) => ({ entry: f.entry, path: f.path, size: f.size })) },
    id,
    name: meta.name ?? folder,
    version: meta.version,
    author: meta.author,
    size: nroSt.size,
    hash,
    file_name: safeFileName(path.posix.basename(layout.nro.path), folder),
    source: "manual",
    released_at: new Date(st.mtimeMs).toISOString(),
    repo_url: null,
    path: nro,
    folder: dir,
    sha256: nroHash,
  };
}

/**
 * Follows the latest release of each repository in `repos`.
 * `fetchImpl` and `now` are injectable for tests.
 */
export function createTracker({ repos = [], sources = null, stateDir, fetchImpl = fetch, token = "", now = Date.now, checkIntervalMs = CHECK_INTERVAL_MS }) {
  const wanted = new Map(); // id → repo
  const patterns = new Map(); // id → release-file pattern, or null
  const states = new Map(); // id → saved state
  const downloads = new Map(); // id → in-flight download
  const dirOf = (id) => path.join(stateDir, id);

  /** Follow exactly these sources ([{ repo, asset }]); saved state is read, not fetched again. */
  function setSources(list) {
    const next = new Map(list.map((s) => [idFor("github", s.repo), s]));
    for (const id of [...wanted.keys()]) if (!next.has(id)) { wanted.delete(id); patterns.delete(id); states.delete(id); }
    for (const [id, s] of next) {
      wanted.set(id, s.repo);
      patterns.set(id, s.asset ?? null);
      if (states.has(id)) continue;
      try {
        states.set(id, JSON.parse(fs.readFileSync(path.join(dirOf(id), "state.json"), "utf8")));
      } catch (err) {
        if (err.code !== "ENOENT") debug.error("homebrew: ignoring saved state of %s: %s", s.repo, err.message);
      }
    }
  }
  setSources(sources ?? repos.map((repo) => ({ repo, asset: null })));

  const save = (id, state) => {
    states.set(id, state);
    fs.mkdirSync(dirOf(id), { recursive: true });
    const file = path.join(dirOf(id), "state.json");
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
    fs.renameSync(`${file}.tmp`, file);
  };

  // The token may be a function so a key saved on the admin page applies without a restart.
  const headers = (extra = {}) => {
    const auth = typeof token === "function" ? token() : token;
    return { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...extra };
  };

  async function check(id, { force = false } = {}) {
    const repo = wanted.get(id);
    const prev = states.get(id);
    // A failing repository is retried hourly (not on every poll), a healthy one once per check interval.
    if (!force && prev?.error && now() - prev.error.at < ERROR_RETRY_MS) return;
    // A build decided under older layout rules is looked at again right away, once.
    const legacy = Boolean(prev?.cached && prev.cached.layout !== LAYOUT_RULES);
    if (!force && !legacy && !prev?.error && prev?.checked_at != null && now() - prev.checked_at < checkIntervalMs) return;
    const pattern = patterns.get(id) ?? null;
    // A changed pattern needs the release itself, not a 304.
    const conditional = !force && !legacy && prev?.etag && (prev.pattern ?? null) === pattern;
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: headers(conditional ? { "If-None-Match": prev.etag } : {}),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 304) {
      save(id, { ...prev, checked_at: now(), error: null });
      // The first build may have failed to arrive; without it the app is not listed.
      if (prev.cached?.layout !== LAYOUT_RULES) await ensureDownloaded(id);
      return;
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = await res.json();
    let asset = pickAsset(release, repo, pattern);
    const assets = usableAssets(release).map((a) => a.name);
    const candidates = pattern ? [] : assetCandidates(release, asset);
    const candidateKey = candidates.map((a) => a.id).join(",") || null;
    // Several zips were already compared for this exact release: keep the winner.
    if (candidateKey && prev?.candidate_key === candidateKey) asset = candidates.find((a) => a.id === prev.asset?.id) ?? asset;
    const brief = (a) => ({ id: a.id, name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest ?? null });
    if (!asset) {
      save(id, { ...prev, repo, assets, tag: release.tag_name, checked_at: now() });
      throw new Error(pattern ? `release ${release.tag_name} has no file matching ${pattern}` : `release ${release.tag_name} has no .nro or usable .zip`);
    }
    save(id, {
      ...prev,
      repo,
      pattern,
      assets,
      error: null,
      etag: res.headers.get("etag"),
      checked_at: now(),
      tag: release.tag_name,
      released_at: release.published_at ?? null,
      asset: brief(asset),
      candidates: candidates.map(brief),
      candidate_key: candidateKey && prev?.candidate_key === candidateKey ? candidateKey : null,
    });
    if (prev?.cached?.layout !== LAYOUT_RULES) await ensureDownloaded(id);
  }

  /** Fetches one release file to `part`, checking its size and digest against the release. */
  async function fetchAsset(asset, part) {
    const zipped = /\.zip$/i.test(asset.name);
    if (asset.size > (zipped ? MAX_ZIP_BYTES : MAX_NRO_BYTES)) throw new Error(`build is larger than ${zipped ? MAX_ZIP_BYTES : MAX_NRO_BYTES} bytes`);
    const res = await fetchImpl(asset.url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`download answered ${res.status}`);
    // Stop as soon as the body runs past what the release promised.
    let received = 0;
    const capped = async function* (source) {
      for await (const chunk of source) {
        received += chunk.length;
        if (received > asset.size) throw new Error(`body is larger than the release's ${asset.size} bytes`);
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(res.body), capped, fs.createWriteStream(part));
    const sha = await sha256File(part);
    const size = (await fsp.stat(part)).size;
    if (size !== asset.size) throw new Error(`size ${size} differs from the release's ${asset.size}`);
    if (asset.digest && asset.digest !== `sha256:${sha}`) throw new Error("digest differs from the release's");
    return sha;
  }

  /**
   * With several candidate files, fetches the zips and keeps the one that installs
   * best (a whole app folder over a lone .nro). Returns { asset, part, sha } with
   * the winner already on disk when it is a zip.
   */
  async function chooseAsset(id, state) {
    const zips = state.candidates.filter((a) => /\.zip$/i.test(a.name));
    let best = { score: /\.nro$/i.test(state.asset.name) ? 1 : -Infinity, asset: state.asset, part: null, sha: null };
    for (const [i, cand] of zips.entries()) {
      const part = path.join(dirOf(id), `candidate-${i}.zip.part`);
      try {
        const sha = await fetchAsset(cand, part);
        const score = zipScore(await zipEntries(part), state.repo);
        if (score > best.score) {
          if (best.part) await fsp.rm(best.part, { force: true });
          best = { score, asset: cand, part, sha };
          continue;
        }
      } catch (err) {
        debug.error("homebrew: %s: skipping %s: %s", state.repo, cand.name, err.message);
      }
      await fsp.rm(part, { force: true });
    }
    save(id, { ...states.get(id), asset: best.asset, candidate_key: state.candidates.map((a) => a.id).join(",") });
    return best;
  }

  async function download(id) {
    let state = states.get(id);
    fs.mkdirSync(dirOf(id), { recursive: true });
    let part = null;
    let assetSha = null;
    if (state.candidates?.length > 1 && !state.candidate_key) {
      const best = await chooseAsset(id, state);
      state = states.get(id);
      ({ part, sha: assetSha } = best);
    }
    const { asset } = state;
    const zipped = /\.zip$/i.test(asset.name);
    const repoName = state.repo.split("/")[1];
    part ??= path.join(dirOf(id), `download.${zipped ? "zip" : "nro"}.part`);
    const nroPart = path.join(dirOf(id), "inner.nro.part");
    const pkgPart = path.join(dirOf(id), "pkg.part");
    try {
      assetSha ??= await fetchAsset(asset, part);
      let nro = part;
      let fileName = safeFileName(asset.name, repoName);
      let folder = null;
      let appDir = null;
      let install = { mode: "nro", reason: zipped ? null : "nro-release" };
      if (zipped) {
        const layout = normalizeLayout(await zipEntries(part), { repoName });
        if (!layout.nro) throw new Error(`the zip has no usable .nro (${layout.reason}${layout.problems ? `: ${describeProblems(layout.problems)}` : ""})`);
        const decided = { rules: layout.rules, excluded: layout.excluded };
        if (layout.mode === "folder") {
          await fsp.rm(pkgPart, { recursive: true, force: true });
          const files = await extractPackage(part, { files: layout.files }, pkgPart);
          folder = { dir: layout.appDir, nro: layout.nro.path, files };
          nro = path.join(pkgPart, ...layout.nro.path.split("/"));
          install = { mode: "folder", reason: layout.reason, ...decided };
        } else {
          await extractEntry(part, layout.nro.entry, nroPart, MAX_NRO_BYTES);
          nro = nroPart;
          appDir = layout.appDir;
          install = { mode: "nro", reason: layout.reason, ...decided };
        }
        fileName = safeFileName(path.posix.basename(layout.nro.path), repoName);
        debug.log("homebrew: %s %s → %s %s; %s", state.repo, asset.name, install.mode, layout.appDir ?? fileName, [...layout.rules, ...layout.excluded.map((x) => `${x.rule}: ${x.paths.join(", ")}`)].join("; ") || "as it is");
      }
      const problem = nroProblem(await fsp.readFile(nro));
      if (problem) throw new Error(`the .nro is not a whole NRO (${problem})`);
      const sha = zipped ? await sha256File(nro) : assetSha;
      const size = (await fsp.stat(nro)).size;
      const meta = await readNro(nro);
      if (!meta) throw new Error("the build is not an NRO");
      const old = states.get(id).cached?.file;
      const pkgDir = path.join(dirOf(id), "pkg");
      await fsp.rm(pkgDir, { recursive: true, force: true });
      let stored = fileName;
      if (folder) {
        await fsp.rename(pkgPart, pkgDir);
        stored = path.posix.join("pkg", folder.nro);
      } else {
        await fsp.rename(nro, path.join(dirOf(id), fileName));
      }
      if (old && old !== stored && !old.startsWith("pkg/")) await fsp.rm(path.join(dirOf(id), old), { force: true });
      save(id, { ...states.get(id), cached: { layout: LAYOUT_RULES, asset_id: asset.id, file: stored, file_name: fileName, app_dir: appDir, sha256: sha, size, install, folder, ...meta } });
      debug.log("homebrew: %s %s cached (%s)", state.repo, state.tag, install.mode);
    } finally {
      await fsp.rm(part, { force: true });
      await fsp.rm(nroPart, { force: true });
      await fsp.rm(pkgPart, { recursive: true, force: true });
    }
  }

  /** The current build on disk ({ path, sha256 }), fetching it first when needed. */
  async function ensureDownloaded(id) {
    const state = states.get(id);
    if (!wanted.has(id) || !state?.asset) throw new Error("unknown homebrew");
    const current = () => {
      const c = states.get(id).cached;
      // A build decided under older layout rules is fetched once more.
      return c?.layout === LAYOUT_RULES && c.asset_id === states.get(id).asset.id ? { path: path.join(dirOf(id), c.file), sha256: c.sha256 } : null;
    };
    if (current() && fs.existsSync(current().path)) return current();
    if (!downloads.has(id)) downloads.set(id, download(id).finally(() => downloads.delete(id)));
    await downloads.get(id);
    const file = current();
    if (!file) throw new Error("a newer release arrived during the download");
    return file;
  }

  /** Checks one repository, remembering a failure for the admin page. */
  async function checkOne(id, opts) {
    try {
      await check(id, opts);
    } catch (err) {
      debug.error("homebrew: %s: %s", wanted.get(id), err.message);
      if (wanted.has(id)) save(id, { ...states.get(id), repo: wanted.get(id), error: { message: String(err.message).slice(0, 300), at: now() } });
    }
  }

  let checking = null;
  /** Checks every repository that is due (all of them with `force`); a call while one runs joins it. */
  function checkAll({ force = false } = {}) {
    checking ??= (async () => {
      for (const id of [...wanted.keys()]) await checkOne(id, { force });
    })().finally(() => { checking = null; });
    return checking;
  }

  /** Checks one repository now, ignoring the check interval. */
  const checkNow = (repo) => checkOne(idFor("github", repo), { force: true });

  /** What the admin page shows for each followed repository. */
  function status() {
    return [...wanted].map(([id, repo]) => {
      const s = states.get(id) ?? {};
      const c = s.cached;
      return {
        id, repo, pattern: patterns.get(id) ?? null, tag: s.tag ?? null, released_at: s.released_at ?? null,
        checked_at: s.checked_at ?? null, assets: s.assets ?? [], chosen: s.asset?.name ?? null,
        cached: c ? { file: c.file_name ?? c.file, size: c.size ?? s.asset?.size ?? null, name: c.name, version: c.version, current: c.asset_id === s.asset?.id } : null,
        install: c?.install ?? (c ? { mode: "nro", reason: null } : null),
        folder_files: c?.folder?.files.length ?? null,
        error: s.error ?? null,
        repo_description: s.repo_description ?? null,
      };
    });
  }

  /**
   * Learns each repository's own description once (the admin can still write
   * their own). Kept apart from checkAll so release checks stay one request each.
   */
  async function fetchDescriptions() {
    for (const [id, repo] of [...wanted]) {
      const s = states.get(id);
      if (!s || s.repo_description !== undefined) continue;
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}`, { headers: headers(), signal: AbortSignal.timeout(API_TIMEOUT_MS) });
        if (!res.ok) continue;
        const text = String((await res.json()).description ?? "").trim();
        if (wanted.has(id)) save(id, { ...states.get(id), repo_description: text ? text.slice(0, 2000) : null });
      } catch {
        // tried again next time
      }
    }
  }

  /** Drops a repository's saved state and cached build. */
  async function forget(repo) {
    const id = idFor("github", repo);
    states.delete(id);
    await fsp.rm(dirOf(id), { recursive: true, force: true });
  }

  function entries() {
    const out = [];
    for (const [id, repo] of wanted) {
      const s = states.get(id);
      if (!s?.asset || !s.cached) continue;
      const fresh = s.cached.asset_id === s.asset.id;
      out.push({
        id,
        name: s.cached.name ?? repo.split("/")[1],
        version: fresh && s.cached.version ? s.cached.version : String(s.tag ?? "").replace(/^v/i, "") || null,
        author: s.cached.author,
        // A zipped build is served as the .nro inside it.
        size: /\.zip$/i.test(s.asset.name) ? s.cached.size ?? s.asset.size : s.asset.size,
        hash: s.asset.digest ?? `asset-${s.asset.id}`,
        file_name: s.cached.file_name ?? (/\.zip$/i.test(s.asset.name) ? s.cached.file : safeFileName(s.asset.name, repo.split("/")[1])),
        // A folder install: every file of switch/<app>/, the .nro among them.
        install_dir: s.cached.folder?.dir ?? null,
        install_path: s.cached.folder?.nro ?? installPathFor(s.cached.file_name ?? (/\.zip$/i.test(s.asset.name) ? s.cached.file : safeFileName(s.asset.name, repo.split("/")[1])), s.cached.app_dir),
        files: s.cached.folder ? s.cached.folder.files.map(({ path: p, size, sha256 }) => ({ path: p, size, sha256 })) : null,
        source: "github",
        description: s.repo_description ?? null,
        released_at: s.released_at,
        repo_url: `https://github.com/${repo}`,
      });
    }
    return out;
  }

  /** The cached build of an entry (for its icon), or null before the first download. */
  function cachedPath(id) {
    const c = states.get(id)?.cached;
    return wanted.has(id) && c ? path.join(dirOf(id), c.file) : null;
  }

  /** One file of a folder install, by its exact listed path, or null. */
  function packageFile(id, relPath) {
    const c = states.get(id)?.cached;
    const f = wanted.has(id) ? c?.folder?.files.find((x) => x.path === relPath) : null;
    return f ? { path: path.join(dirOf(id), "pkg", ...f.path.split("/")), sha256: f.sha256, size: f.size } : null;
  }

  /** Every file of a fetched folder package as { path, size, sha256, abs }, or null. */
  function packageFiles(id) {
    const files = wanted.has(id) ? states.get(id)?.cached?.folder?.files : null;
    return files ? files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, abs: path.join(dirOf(id), "pkg", ...f.path.split("/")) })) : null;
  }

  return { checkAll, checkNow, entries, ensureDownloaded, cachedPath, packageFile, packageFiles, setSources, status, forget, fetchDescriptions };
}
