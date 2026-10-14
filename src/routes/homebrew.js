/**
 * GET /api/homebrew                every app the admin left on  { homebrew: [H…] }, with ETag
 * GET /api/homebrew/:id/icon?v=&size=sm|md   the app's icon from its NRO (404 before its first fetch):
 *                                  at most 160 or 256 px (md, the default), never enlarged; WebP for
 *                                  Accept: image/webp, else the NRO's own JPEG. icon_url carries
 *                                  ?v= of the build: that v is immutable, anything else
 *                                  `public, max-age=300` with an ETag
 * GET /api/homebrew/:id/download   the .nro (Content-Length, ETag = its sha256)
 * GET /api/homebrew/:id/file?path=  one file of a folder install, by its listed path
 * GET /api/homebrew/:id/bundle     every file of a folder install as one uncompressed tar, Range-able
 * GET /api/homebrew/:id/archive    the zip of an app the admin keeps zipped, as it is (Range, ETag = its sha256)
 * GET /api/homebrew/:id/forwarder  the app's HOME-menu shortcut NSP (starts sdmc:/<install_path>)
 *
 * H = { id, name, version, author, description, size, hash, file_name, icon_url,
 *       download_url, source: "github" | "manual", released_at, repo_url,
 *       install_path, install_dir, files, bundle_url, archive,
 *       forwarder_url, forwarder_title_id, forwarder_size }
 *
 * `size` is what lands on the card: every file of a folder install (the .nro
 * alone is then `nro_size`), or the .nro.
 *
 * `install_path` is where the console keeps the .nro: always its own folder,
 * switch/<app>/<file>.nro, which the shortcut also starts. A client that finds
 * an older copy straight under switch/ removes it after installing.
 *
 * `files` is null for a single .nro. For a release whose zip is exactly one
 * switch/<app>/ folder (one .nro, nothing for other systems), it lists every file
 * of that folder as { path, size, sha256, url }, the .nro among them, and
 * `install_dir` is that folder; `download_url` still serves just the .nro, so a
 * client that ignores `files` keeps working.
 *
 * `bundle_url` (null for a single .nro) sends the same files in one request, in
 * `files` order after their folders, so a console over a slow round trip does not
 * pay one per file. Its ETag is a hash of the paths and sha256s, for If-Range.
 *
 * `archive` is null unless the admin keeps the app as a zip; then `files` and
 * `bundle_url` are null and archive = { format: "zip", url, size, sha256,
 * entries: [{ entry, path, size }] }: download the zip once and write each listed
 * entry to its SD path; anything else in the zip stays out. `size` is then what
 * lands on the card.
 *
 * `description` is what the admin wrote (Korean for ?lang=ko or a Korean
 * Accept-Language, else English), the GitHub repository's own when the admin
 * wrote nothing, or null. The forwarder fields are null when this server can't
 * build shortcuts (no prod.keys or hacBrewPack); forwarder_size is null until
 * the NSP has been built, which happens in the background.
 *
 * Every download URL (download_url, bundle_url, archive.url, each file's url,
 * forwarder_url) has a direct twin (download_direct_url, bundle_direct_url,
 * direct_url, forwarder_direct_url) when the list was asked for from the home
 * network and a direct address is set (security/download-links.js).
 *
 * `hash` changes whenever the build does; a client compares it with the one it
 * installed to show an update. A GitHub build announced but not yet fetched is
 * fetched by its first download, so that request can take a while.
 */
import crypto from "crypto";
import path from "path";
import express from "express";
import debug from "../debug.js";
import { dataDir, homebrewDir, homebrewCheckHours, keysDir } from "../helpers/envs.js";
import * as integrations from "../security/integrations.js";
import { directFields, forRequest } from "../security/download-links.js";
import { requestLang } from "../meta/categories.js";
import * as descriptions from "../meta/homebrew-descriptions.js";
import * as kinds from "../meta/homebrew-kinds.js";
import * as disabled from "../meta/homebrew-disabled.js";
import { sendTar } from "../helpers/tar-stream.js";
import { ensureForwarder, forwarderPath, forwarderSpec, forwardersAvailable, homebrewTarget, prewarmForwarders } from "../retro/forwarder.js";
import fs from "fs";
import fsp from "fs/promises";
import { createTracker, installPathFor, scanManual, setManualHashFile } from "../meta/homebrew.js";
import * as sources from "../meta/homebrew-sources.js";
import { parseAssets } from "../meta/extract-providers/nro.js";
import { iconVariant } from "../meta/icon-variant.js";
import { ART_PIPELINE } from "../meta/artwork-version.js";
import { IMMUTABLE, UNVERSIONED } from "../meta/image-cache.js";

const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
const POLL_MS = 15 * 60 * 1000; // the tracker itself asks GitHub once per COOK_HOMEBREW_CHECK_HOURS
const MANUAL_STALE_MS = 30_000;
const MANUAL_RESCAN_MS = 60_000; // keeps the "homebrew" feature flag current

let tracker = null;
setManualHashFile(path.join(dataDir, "homebrew", "manual-hashes.json"));
let manual = { at: 0, entries: [] };
let manualScan = null;

/**
 * On while at least one app is listed, so a client never shows an empty menu.
 * Answered from what is already known: the saved GitHub state and the last
 * scan of the hand-placed folder, which start() keeps fresh.
 */
export function homebrewEnabled() {
  return manual.entries.length > 0 || githubTracker().entries().length > 0;
}

/** Rescans the hand-placed folder now (one scan at a time). */
export function refreshManual() {
  manualScan ??= scanManual(homebrewDir)
    .then((entries) => { manual = { at: Date.now(), entries }; })
    .finally(() => { manualScan = null; });
  return manualScan;
}

/**
 * Hand-placed apps. Only the very first scan is waited for; after that a stale
 * list (older than 30 seconds) is answered at once while a rescan runs behind it.
 */
async function manualEntries() {
  if (!manual.at) await refreshManual();
  else if (Date.now() - manual.at > MANUAL_STALE_MS) refreshManual().catch((err) => debug.error("homebrew: scan failed: %s", err.message));
  return manual.entries;
}

export const githubTracker = () =>
  (tracker ??= createTracker({ sources: sources.list(), stateDir: path.join(dataDir, "homebrew"), token: () => integrations.get("github").token, checkIntervalMs: homebrewCheckHours * 60 * 60 * 1000 }));

/** Hand-placed apps for the admin page (read-only there). */
export const manualApps = () => manualEntries();

/** After the admin changes the list: follow it, and check what is new or changed now. */
export async function sourcesChanged(repo = null) {
  githubTracker().setSources(sources.list());
  if (repo) await githubTracker().checkNow(repo);
  await githubTracker().fetchDescriptions();
}

const forwarderDir = path.join(dataDir, "homebrew-forwarders");
const NO_FORWARDER = { forwarder_url: null, forwarder_title_id: null, forwarder_size: null };

/** What the forwarder module needs to know about an app. */
const forwarderApp = (e) => ({ id: `homebrew-${e.id}`, name: e.name, publisher: e.author || "Homebrew", target: homebrewTarget(e.file_name, e.install_path), artKey: e.hash });

let prewarming = null;
/** Builds the shortcuts that are missing (icons read from each app's .nro), and drops stale ones. */
function prewarmShortcuts(entries) {
  prewarming ??= (async () => {
    const apps = [];
    for (const e of entries) apps.push({ ...forwarderApp(e), icon: await defaultService.icon(e.id).catch(() => null) });
    await prewarmForwarders(forwarderDir, apps, keysDir);
  })().catch((err) => debug.error("homebrew: shortcuts: %s", err.message)).finally(() => { prewarming = null; });
  return prewarming;
}

/** The service backed by this server's folders and repositories. */
export const defaultService = {
  async list(lang = "en") {
    const manualList = (await manualEntries()).map(({ path: _p, sha256: _s, install: _i, folder: _f, ...e }) => ({
      ...e,
      files: e.files ? e.files.map(({ abs: _a, key: _k, ...f }) => f) : null,
      ...(e.archive ? { archive: (({ abs: _a, key: _k, ...a }) => a)(e.archive) } : {}),
    }));
    const entries = [...githubTracker().entries(), ...manualList];
    if (forwardersAvailable(keysDir) && entries.some((e) => !this.forwarderInfo(e).forwarder_size && forwarderSpec(forwarderApp(e)))) prewarmShortcuts(entries);
    return entries.map((e) => ({ ...e, description: descriptions.describe(e.id, lang, e.description ?? null), kind: kinds.kindOf(e.id), enabled: !disabled.isDisabled(e.id) }));
  },
  /** forwarder_url, forwarder_title_id and forwarder_size (null until built). */
  forwarderInfo(e) {
    const spec = forwardersAvailable(keysDir) ? forwarderSpec(forwarderApp(e)) : null;
    if (!spec) return NO_FORWARDER;
    let size = null;
    try {
      size = fs.statSync(forwarderPath(forwarderDir, `homebrew-${e.id}`, spec)).size;
    } catch {
      // built in the background
    }
    return { forwarder_url: `/api/homebrew/${e.id}/forwarder`, forwarder_title_id: spec.titleId, forwarder_size: size };
  },
  async forwarder(id) {
    if (!forwardersAvailable(keysDir)) return null;
    const e = (await this.list()).find((x) => x.id === id);
    if (!e) return null;
    return ensureForwarder(forwarderDir, { ...forwarderApp(e), icon: await this.icon(id) }, keysDir);
  },
  async icon(id) {
    const file = id.startsWith("m-")
      ? (await manualEntries()).find((e) => e.id === id)?.path
      : githubTracker().cachedPath(id);
    if (!file) return null;
    return (await parseAssets(file).catch(() => null))?.icon ?? null;
  },
  async download(id) {
    if (id.startsWith("m-")) {
      const e = (await manualEntries()).find((x) => x.id === id);
      return e ? { path: e.path, sha256: e.sha256, file_name: e.file_name } : null;
    }
    const e = githubTracker().entries().find((x) => x.id === id);
    if (!e) return null;
    return { ...(await githubTracker().ensureDownloaded(id)), file_name: e.file_name };
  },
  /** A hand-placed app kept as a zip: { path, sha256, file_name } of the zip itself, or null. */
  async archive(id) {
    const e = id.startsWith("m-") ? (await manualEntries()).find((x) => x.id === id) : null;
    return e?.archive ? { path: e.archive.abs, abs: e.archive.abs, key: e.archive.key, sha256: e.archive.sha256, file_name: path.basename(e.archive.abs) } : null;
  },
  /** Every file of a folder install as { path, size, sha256, abs }, in listed order, or null. */
  async bundle(id) {
    if (!id.startsWith("m-")) return githubTracker().packageFiles(id);
    const files = (await manualEntries()).find((x) => x.id === id)?.files;
    return files ? files.map(({ path: p, size, sha256, abs, key }) => ({ path: p, size, sha256, abs, key })) : null;
  },
  /** One file of a folder install, or null. */
  async file(id, relPath) {
    if (!id.startsWith("m-")) return githubTracker().packageFile(id, relPath);
    const f = (await manualEntries()).find((x) => x.id === id)?.files?.find((x) => x.path === relPath);
    return f ? { path: f.abs, sha256: f.sha256, size: f.size } : null;
  },
};

/**
 * Scans the hand-placed folder now and every minute, and checks the
 * repositories now and every 15 minutes (each one asks GitHub at most once per COOK_HOMEBREW_CHECK_HOURS).
 */
export function start() {
  const scan = () => refreshManual().catch((err) => debug.error("homebrew: scan failed: %s", err.message));
  scan();
  setInterval(scan, MANUAL_RESCAN_MS).unref();
  // Always scheduled: the admin can add a repository at any time.
  const run = () => githubTracker().checkAll()
    .then(() => githubTracker().fetchDescriptions())
    .catch((err) => debug.error("homebrew: check failed: %s", err.message));
  run();
  setInterval(run, POLL_MS).unref();
}

/** icon_url's v: 12 hex of the build's hash (the icon lives in the .nro), or null without one. */
export function homebrewIconVersion(e) {
  return e?.hash ? crypto.createHash("sha1").update(`${ART_PIPELINE}\0${e.hash}`).digest("hex").slice(0, 12) : null;
}
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

/**
 * Whether files still are what the last scan saw (each { abs, key } of
 * "size:mtimeMs:ino"; one without a key is the server's own copy and can't
 * change). The ETag comes from that scan, so sending newer bytes under it would
 * let a resume join two versions.
 */
async function unchanged(files) {
  const keyed = files.filter((f) => f.key);
  // A few dozen at a time: thousands of small files are checked in a moment, not one by one.
  for (let i = 0; i < keyed.length; i += 64) {
    const same = await Promise.all(keyed.slice(i, i + 64).map(async (f) => {
      const st = await fsp.stat(f.abs).catch(() => null);
      return st && `${st.size}:${st.mtimeMs}:${st.ino}` === f.key;
    }));
    if (same.includes(false)) return false;
  }
  return true;
}

/** A URL field and its direct twin (when `link` is set); a null URL has none. */
const withDirect = (name, url, link) => ({ [name]: url, ...(url ? directFields(name, url, link) : {}) });

/** The forwarder fields with forwarder_direct_url after forwarder_url when there is one. Pure. */
const forwarderWithDirect = ({ forwarder_url: url, ...rest }, link) => ({ ...withDirect("forwarder_url", url, link), ...rest });

/** Ask for a retry once the folder has been read again. */
function changedSinceScan(res) {
  refreshManual().catch((err) => debug.error("homebrew: scan failed: %s", err.message));
  res.set("Retry-After", "5");
  return res.status(503).json({ error: "the files changed since they were listed; list again in a few seconds" });
}

export function homebrewRouter({ service = defaultService } = {}) {
  const router = express.Router();

  router.get("/", wrap(async (req, res) => {
    const link = forRequest(req);
    // An app the admin turned off is left out.
    const list = (await service.list(requestLang(req))).filter((e) => e.enabled !== false).map(({ enabled: _on, ...e }) => ({
      description: null,
      install_dir: null,
      ...e,
      // A folder install is everything that lands on the card; nro_size is the .nro alone.
      ...(e.files ? { size: e.files.reduce((n, f) => n + (f.size ?? 0), 0), nro_size: e.size } : {}),
      install_path: e.install_path ?? installPathFor(e.file_name),
      // Its switch/<app>/ folder name: what its patches and saves are filed under (`homebrew` on them).
      app: (e.install_path ?? installPathFor(e.file_name)).split("/")[1],
      files: e.files ? e.files.map((f) => ({ ...f, ...withDirect("url", `/api/homebrew/${e.id}/file?path=${encodeURIComponent(f.path)}`, link) })) : null,
      ...withDirect("bundle_url", e.files ? `/api/homebrew/${e.id}/bundle` : null, link),
      // A zip kept as it is comes whole, with which entry goes where on the card.
      ...(e.archive ? { size: e.archive.entries.reduce((n, f) => n + (f.size ?? 0), 0), nro_size: e.size, archive: { ...e.archive, ...withDirect("url", `/api/homebrew/${e.id}/archive`, link) } } : { archive: null }),
      icon_url: `/api/homebrew/${e.id}/icon${homebrewIconVersion(e) ? `?v=${homebrewIconVersion(e)}` : ""}`,
      ...withDirect("download_url", `/api/homebrew/${e.id}/download`, link),
      ...forwarderWithDirect(service.forwarderInfo?.(e) ?? NO_FORWARDER, link),
    }));
    const body = JSON.stringify({ homebrew: list });
    res.set({
      "Content-Type": "application/json",
      ETag: `"${crypto.createHash("sha1").update(body).digest("hex")}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
      Vary: "Accept-Language",
    });
    if (req.fresh) return res.status(304).end();
    res.status(200).end(body);
  }));

  router.param("id", (req, res, next, id) => {
    if (!ID_RE.test(id)) return res.status(400).json({ error: "invalid homebrew id" });
    if (disabled.isDisabled(id)) return res.status(404).json({ error: "no such homebrew" });
    next();
  });

  router.get("/:id/icon", wrap(async (req, res) => {
    const icon = await service.icon(req.params.id);
    if (!icon) return res.status(404).json({ error: "no icon" });
    const v = homebrewIconVersion((await service.list()).find((e) => e.id === req.params.id));
    const webp = (req.get("accept") || "").includes("image/webp");
    const key = `${req.params.id}\0${v ?? crypto.createHash("sha1").update(icon).digest("hex")}`;
    const { body, type } = await iconVariant(key, icon, { size: req.query.size, webp });
    res.set({
      "Content-Type": type,
      "Cache-Control": v && req.query.v === v ? IMMUTABLE : UNVERSIONED,
      ETag: `"${crypto.createHash("sha1").update(body).digest("base64url")}"`,
      Vary: "Accept",
    });
    if (req.fresh) return res.status(304).end();
    res.end(body);
  }));

  router.get("/:id/download", wrap(async (req, res) => {
    let file;
    try {
      file = await service.download(req.params.id);
    } catch (err) {
      debug.error("homebrew: %s download failed: %s", req.params.id, err.message);
      return res.status(502).json({ error: "the build could not be fetched" });
    }
    if (!file) return res.status(404).json({ error: "no such homebrew" });
    res.set({ "Cache-Control": "no-cache", ETag: `"${file.sha256}"` });
    res.attachment(file.file_name);
    res.sendFile(file.path, { etag: false, lastModified: false, acceptRanges: true });
  }));

  router.get("/:id/file", wrap(async (req, res) => {
    const file = typeof req.query.path === "string" ? await service.file?.(req.params.id, req.query.path) : null;
    if (!file) return res.status(404).json({ error: "no such file" });
    res.set({ "Cache-Control": "no-cache", ETag: `"${file.sha256}"` });
    res.attachment(path.posix.basename(req.query.path));
    res.sendFile(file.path, { etag: false, lastModified: false, acceptRanges: true });
  }));

  router.get("/:id/archive", wrap(async (req, res) => {
    const zip = await service.archive?.(req.params.id);
    if (!zip) return res.status(404).json({ error: "no zip for this homebrew" });
    if (!(await unchanged([zip]))) return changedSinceScan(res);
    res.set({ "Cache-Control": "no-cache", ETag: `"${zip.sha256}"` });
    res.attachment(zip.file_name);
    res.sendFile(zip.path, { etag: false, lastModified: false, acceptRanges: true });
  }));

  router.get("/:id/bundle", wrap(async (req, res) => {
    const files = await service.bundle?.(req.params.id);
    if (!files?.length) return res.status(404).json({ error: "no folder install" });
    if (!(await unchanged(files))) return changedSinceScan(res);
    // The bytes follow from the paths and contents alone, so their hashes are the ETag.
    const etag = crypto.createHash("sha1").update(JSON.stringify(files.map((f) => [f.path, f.sha256]))).digest("hex");
    const app = files[0].path.split("/")[1] || req.params.id;
    sendTar(res, files.map(({ path: p, size, abs }) => ({ path: p, size, abs, mtime: 0 })), { filename: `${app}.tar`, etag, label: "homebrew", fixedTimes: true });
  }));

  router.get("/:id/forwarder", wrap(async (req, res) => {
    let built;
    try {
      built = await service.forwarder?.(req.params.id);
    } catch (err) {
      debug.error("homebrew: %s shortcut failed: %s", req.params.id, err.message);
      return res.status(502).json({ error: "the shortcut could not be built" });
    }
    if (!built) return res.status(404).json({ error: "no shortcut for this homebrew" });
    res.attachment(`${built.spec.name.replace(/[^\w .-]+/g, "") || "shortcut"}.nsp`);
    res.set({ "Cache-Control": "no-cache", "X-Forwarder-Title-Id": built.spec.titleId });
    res.sendFile(built.path, { etag: true, lastModified: false });
  }));

  return router;
}
