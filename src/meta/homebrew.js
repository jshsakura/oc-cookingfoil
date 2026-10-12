/**
 * Homebrew (.nro apps) for a client to keep in sdmc:/switch/<app>/.
 *
 * Two sources, one listing:
 *   manual  <homebrewDir>/<folder>/<app>.nro, dropped there by hand
 *   github  repositories named in COOK_HOMEBREW_REPOS, followed through their
 *           latest release
 *
 * GitHub is asked at most once every three hours per repository, with the
 * last ETag, so an unchanged release costs one 304. A new release is only
 * announced: its build is fetched when a console first downloads it, then
 * kept under <data dir>/homebrew/<id>/. The one exception is a repository
 * seen for the first time, whose build is fetched at once for its name and
 * icon. What was learned is saved, so a restart asks GitHub nothing new.
 *
 * Each entry's `hash` is opaque: it changes when the build changes, which is
 * all a client needs to show an update.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import debug from "../debug.js";
import { parseAssets } from "./extract-providers/nro.js";
import { decodeNacp } from "./nacp-decode.js";

export const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
const MAX_NRO_BYTES = 128 * 1024 * 1024;
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

/** `name` when it is a plain .nro file name, else `<fallback>.nro`. Pure. */
export function safeFileName(name, fallback) {
  return FILE_RE.test(name ?? "") && !name.startsWith(".") ? name : `${fallback}.nro`;
}

/** The release's .nro, preferring the one named after the repository. Pure. */
export function pickAsset(release, repo) {
  const nros = (release?.assets ?? [])
    .filter((a) => /\.nro$/i.test(a?.name ?? "") && String(a.browser_download_url ?? "").startsWith(DOWNLOAD_PREFIX))
    .sort((a, b) => a.name.localeCompare(b.name));
  const repoName = repo.split("/")[1].toLowerCase();
  return nros.find((a) => a.name.toLowerCase() === `${repoName}.nro`) ?? nros[0] ?? null;
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
export function createTracker({ repos, stateDir, fetchImpl = fetch, token = "", now = Date.now }) {
  const wanted = new Map(repos.map((r) => [idFor("github", r), r]));
  const states = new Map(); // id → saved state
  const downloads = new Map(); // id → in-flight download
  const dirOf = (id) => path.join(stateDir, id);

  for (const id of wanted.keys()) {
    try {
      states.set(id, JSON.parse(fs.readFileSync(path.join(dirOf(id), "state.json"), "utf8")));
    } catch (err) {
      if (err.code !== "ENOENT") debug.error("homebrew: ignoring saved state of %s: %s", wanted.get(id), err.message);
    }
  }

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

  async function check(id) {
    const repo = wanted.get(id);
    const prev = states.get(id);
    if (prev && now() - prev.checked_at < CHECK_INTERVAL_MS) return;
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: headers(prev?.etag ? { "If-None-Match": prev.etag } : {}),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 304) {
      save(id, { ...prev, checked_at: now() });
      // The first build may have failed to arrive; without it the app is not listed.
      if (!prev.cached) await ensureDownloaded(id);
      return;
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = await res.json();
    const asset = pickAsset(release, repo);
    if (!asset) throw new Error(`release ${release.tag_name} has no .nro`);
    save(id, {
      ...prev,
      repo,
      etag: res.headers.get("etag"),
      checked_at: now(),
      tag: release.tag_name,
      released_at: release.published_at ?? null,
      asset: { id: asset.id, name: asset.name, size: asset.size, url: asset.browser_download_url, digest: asset.digest ?? null },
    });
    if (!prev?.cached) await ensureDownloaded(id);
  }

  async function download(id) {
    const state = states.get(id);
    const { asset } = state;
    if (asset.size > MAX_NRO_BYTES) throw new Error(`build is larger than ${MAX_NRO_BYTES} bytes`);
    const res = await fetchImpl(asset.url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`download answered ${res.status}`);
    const fileName = safeFileName(asset.name, state.repo.split("/")[1]);
    const dest = path.join(dirOf(id), fileName);
    const part = `${dest}.part`;
    fs.mkdirSync(dirOf(id), { recursive: true });
    try {
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
      const meta = await readNro(part);
      if (!meta) throw new Error("the build is not an NRO");
      const old = states.get(id).cached?.file;
      await fsp.rename(part, dest);
      if (old && old !== fileName) await fsp.rm(path.join(dirOf(id), old), { force: true });
      save(id, { ...states.get(id), cached: { asset_id: asset.id, file: fileName, sha256: sha, ...meta } });
      debug.log("homebrew: %s %s cached", state.repo, state.tag);
    } finally {
      await fsp.rm(part, { force: true });
    }
  }

  /** The current build on disk ({ path, sha256 }), fetching it first when needed. */
  async function ensureDownloaded(id) {
    const state = states.get(id);
    if (!wanted.has(id) || !state?.asset) throw new Error("unknown homebrew");
    const current = () => {
      const c = states.get(id).cached;
      return c?.asset_id === states.get(id).asset.id ? { path: path.join(dirOf(id), c.file), sha256: c.sha256 } : null;
    };
    if (current() && fs.existsSync(current().path)) return current();
    if (!downloads.has(id)) downloads.set(id, download(id).finally(() => downloads.delete(id)));
    await downloads.get(id);
    const file = current();
    if (!file) throw new Error("a newer release arrived during the download");
    return file;
  }

  let checking = null;
  /** Checks every repository that is due; a call while one runs joins it. */
  function checkAll() {
    checking ??= (async () => {
      for (const id of wanted.keys()) {
        await check(id).catch((err) => debug.error("homebrew: %s: %s", wanted.get(id), err.message));
      }
    })().finally(() => { checking = null; });
    return checking;
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
        size: s.asset.size,
        hash: s.asset.digest ?? `asset-${s.asset.id}`,
        file_name: safeFileName(s.asset.name, repo.split("/")[1]),
        source: "github",
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

  return { checkAll, entries, ensureDownloaded, cachedPath };
}
