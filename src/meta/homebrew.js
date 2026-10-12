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
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import debug from "../debug.js";
import { parseAssets } from "./extract-providers/nro.js";
import { decodeNacp } from "./nacp-decode.js";

/** How often a healthy repository is asked again, unless the server sets COOK_HOMEBREW_CHECK_HOURS. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_NRO_BYTES = 128 * 1024 * 1024;
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

const MAX_PACKAGE_FILES = 500;
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
// Files that mean the zip carries something besides the console app: we never install those.
const FOREIGN_FILE_RE = /\.(exe|dll|msi|bat|cmd|ps1|sh|so|dylib|dmg|pkg|app|apk|ipa|appimage|deb|rpm|jar)$/i;
const SAFE_SEGMENT_RE = /^[^\0-\x1f/\\]+$/;

/**
 * Whether a zip installs as a whole app folder, decided without a person.
 * Only when every file sits in one switch/<app>/ folder at the top, that folder
 * holds exactly one .nro, and nothing in it is a link, a strange path or a
 * program for another system. Anything else is served as its single .nro.
 * Returns { folder: { dir, nro, files: [{ entry, path, size }] } } or { folder: null, reason }. Pure.
 */
export function packageLayout(entries) {
  const files = entries.filter((e) => !e.dir);
  const dirs = new Set(files.map((e) => e.name.split("/").slice(0, 2).join("/")));
  if (dirs.size !== 1) return { folder: null, reason: "not-one-folder" };
  const [dir] = dirs;
  const parts = dir.split("/");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "switch" || !files.every((e) => e.name.startsWith(`${dir}/`))) return { folder: null, reason: "not-one-folder" };
  if (files.length > MAX_PACKAGE_FILES) return { folder: null, reason: "too-many-files" };
  const nros = files.filter((e) => /\.nro$/i.test(e.name));
  if (nros.length !== 1) return { folder: null, reason: nros.length ? "several-nro" : "no-nro" };
  if (!APP_NAME_RE.test(parts[1]) || !APP_NAME_RE.test(path.posix.basename(nros[0].name))) return { folder: null, reason: "unsafe-path" };
  if (files.length === 1) return { folder: null, reason: "only-nro" };
  for (const e of entries) {
    if (e.link) return { folder: null, reason: "link" };
    if (!e.name.split("/").filter(Boolean).every((p) => p !== "." && p !== ".." && SAFE_SEGMENT_RE.test(p))) return { folder: null, reason: "unsafe-path" };
    if (FOREIGN_FILE_RE.test(e.name)) return { folder: null, reason: "foreign-file" };
  }
  return { folder: { dir, nro: nros[0].name, files: files.map((e) => ({ entry: e.name, path: e.name, size: e.size })) } };
}

/** How well a zip serves the console: a whole app folder beats a lone .nro; nothing usable is -1. Pure. */
export function zipScore(entries, repo) {
  const layout = packageLayout(entries);
  if (layout.folder) return 1000 + layout.folder.files.length;
  return pickZipEntry(entries.filter((e) => !e.dir).map((e) => e.name), repo) ? 1 : -1;
}

/** Streams one entry of `zip` into `dest` (never to a path the zip names), cut off past `maxBytes`. Returns the bytes written. */
function extractEntry(zip, entry, dest, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zip, literal(entry)], { stdio: ["ignore", "pipe", "ignore"] });
    const out = fs.createWriteStream(dest);
    let written = 0;
    let failed = null;
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
      out.end(() => (failed || code ? reject(failed ?? new Error(`unzip exited ${code}`)) : resolve(written)));
    });
  });
}

/**
 * Unpacks a folder layout under `destDir`, keeping the zip's switch/<app>/ paths
 * (already checked by packageLayout). The whole folder counts against `maxBytes`.
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

const manualHashes = new Map(); // abs path → { key, hash }, so a rescan only reads changed files

async function cachedSha256(file, st) {
  const key = `${st.size}:${st.mtimeMs}:${st.ino}`;
  const known = manualHashes.get(file);
  if (known?.key === key) return known.hash;
  const hash = await sha256File(file);
  manualHashes.set(file, { key, hash });
  return hash;
}

export async function sha256File(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

/** Every hand-placed app: the first .nro of each folder under `root`. */
export async function scanManual(root) {
  let folders;
  try {
    folders = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("homebrew: cannot read %s: %s", root, err.message);
    return [];
  }
  const out = [];
  for (const folder of folders.sort()) {
    try {
      const entry = await readManual(root, folder);
      if (entry) out.push(entry);
    } catch (err) {
      debug.error("homebrew: %s left out: %s", path.join(root, folder), err.message);
    }
  }
  return out;
}

async function readManual(root, folder) {
  const dir = path.join(root, folder);
  const file = (await fsp.readdir(dir)).filter((f) => /\.nro$/i.test(f)).sort()[0];
  if (!file) return null;
  const abs = path.join(dir, file);
  const meta = await readNro(abs);
  if (!meta) {
    debug.error("homebrew: %s is not an NRO", abs);
    return null;
  }
  const st = await fsp.stat(abs);
  const hash = await cachedSha256(abs, st);
  return {
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

  const headers = (extra = {}) => ({
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });

  async function check(id, { force = false } = {}) {
    const repo = wanted.get(id);
    const prev = states.get(id);
    // A failing repository is retried hourly (not on every poll), a healthy one once per check interval.
    if (!force && prev?.error && now() - prev.error.at < ERROR_RETRY_MS) return;
    // A build cached before folder installs existed is looked at again right away.
    const legacy = Boolean(prev?.cached && !prev.cached.install);
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
      if (!prev.cached?.install) await ensureDownloaded(id);
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
    if (!prev?.cached?.install) await ensureDownloaded(id);
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
        const layout = packageLayout(await zipEntries(part));
        if (layout.folder) {
          await fsp.rm(pkgPart, { recursive: true, force: true });
          const files = await extractPackage(part, layout.folder, pkgPart);
          folder = { dir: layout.folder.dir, nro: layout.folder.nro, files };
          nro = path.join(pkgPart, ...layout.folder.nro.split("/"));
          fileName = safeFileName(path.posix.basename(layout.folder.nro), repoName);
          install = { mode: "folder", reason: null };
        } else {
          fileName = safeFileName(await extractNro(part, state.repo, nroPart), repoName);
          nro = nroPart;
          install = { mode: "nro", reason: layout.reason };
          const entry = pickZipEntry((await zipEntries(part)).filter((e) => !e.dir).map((e) => e.name), state.repo);
          appDir = /^switch\/[^/]+\/[^/]+$/i.test(entry ?? "") ? path.posix.dirname(entry) : null;
        }
      }
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
      save(id, { ...states.get(id), cached: { asset_id: asset.id, file: stored, file_name: fileName, app_dir: appDir, sha256: sha, size, install, folder, ...meta } });
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
      // A build cached before folder installs existed (no `install`) is fetched once more.
      return c?.install && c.asset_id === states.get(id).asset.id ? { path: path.join(dirOf(id), c.file), sha256: c.sha256 } : null;
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

  return { checkAll, checkNow, entries, ensureDownloaded, cachedPath, packageFile, setSources, status, forget, fetchDescriptions };
}
