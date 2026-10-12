/**
 * GET /api/homebrew                every app  { homebrew: [H…] }, with ETag
 * GET /api/homebrew/:id/icon       the app's icon from its NRO (404 before its first fetch)
 * GET /api/homebrew/:id/download   the .nro (Content-Length, ETag = its sha256)
 * GET /api/homebrew/:id/file?path=  one file of a folder install, by its listed path
 * GET /api/homebrew/:id/forwarder  the app's HOME-menu shortcut NSP (starts sdmc:/<install_path>)
 *
 * H = { id, name, version, author, description, size, hash, file_name, icon_url,
 *       download_url, source: "github" | "manual", released_at, repo_url,
 *       install_path, install_dir, files,
 *       forwarder_url, forwarder_title_id, forwarder_size }
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
 * `description` is what the admin wrote (Korean for ?lang=ko or a Korean
 * Accept-Language, else English), the GitHub repository's own when the admin
 * wrote nothing, or null. The forwarder fields are null when this server can't
 * build shortcuts (no prod.keys or hacBrewPack); forwarder_size is null until
 * the NSP has been built, which happens in the background.
 *
 * `hash` changes whenever the build does; a client compares it with the one it
 * installed to show an update. A GitHub build announced but not yet fetched is
 * fetched by its first download, so that request can take a while.
 */
import crypto from "crypto";
import path from "path";
import express from "express";
import debug from "../debug.js";
import { dataDir, homebrewDir, githubToken, homebrewCheckHours, keysDir } from "../helpers/envs.js";
import { requestLang } from "../meta/categories.js";
import * as descriptions from "../meta/homebrew-descriptions.js";
import { ensureForwarder, forwarderPath, forwarderSpec, forwardersAvailable, homebrewTarget, prewarmForwarders } from "../retro/forwarder.js";
import fs from "fs";
import { createTracker, installPathFor, scanManual } from "../meta/homebrew.js";
import * as sources from "../meta/homebrew-sources.js";
import { parseAssets } from "../meta/extract-providers/nro.js";

const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
const POLL_MS = 15 * 60 * 1000; // the tracker itself asks GitHub once per COOK_HOMEBREW_CHECK_HOURS
const MANUAL_STALE_MS = 30_000;
const MANUAL_RESCAN_MS = 60_000; // keeps the "homebrew" feature flag current

let tracker = null;
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

/** Hand-placed apps, rescanned when the last scan is older than 30 seconds. */
async function manualEntries() {
  if (Date.now() - manual.at > MANUAL_STALE_MS) await refreshManual();
  return manual.entries;
}

export const githubTracker = () =>
  (tracker ??= createTracker({ sources: sources.list(), stateDir: path.join(dataDir, "homebrew"), token: githubToken, checkIntervalMs: homebrewCheckHours * 60 * 60 * 1000 }));

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
    const manualList = (await manualEntries()).map(({ path: _p, sha256: _s, ...e }) => e);
    const entries = [...githubTracker().entries(), ...manualList];
    if (forwardersAvailable(keysDir) && entries.some((e) => !this.forwarderInfo(e).forwarder_size && forwarderSpec(forwarderApp(e)))) prewarmShortcuts(entries);
    return entries.map((e) => ({ ...e, description: descriptions.describe(e.id, lang, e.description ?? null) }));
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
  /** One file of a folder install, or null. */
  async file(id, relPath) {
    return id.startsWith("m-") ? null : githubTracker().packageFile(id, relPath);
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

const isPng = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export function homebrewRouter({ service = defaultService } = {}) {
  const router = express.Router();

  router.get("/", wrap(async (req, res) => {
    const list = (await service.list(requestLang(req))).map((e) => ({
      description: null,
      install_dir: null,
      ...e,
      install_path: e.install_path ?? installPathFor(e.file_name),
      files: e.files ? e.files.map((f) => ({ ...f, url: `/api/homebrew/${e.id}/file?path=${encodeURIComponent(f.path)}` })) : null,
      icon_url: `/api/homebrew/${e.id}/icon`,
      download_url: `/api/homebrew/${e.id}/download`,
      ...(service.forwarderInfo?.(e) ?? NO_FORWARDER),
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

  router.param("id", (req, res, next, id) => (ID_RE.test(id) ? next() : res.status(400).json({ error: "invalid homebrew id" })));

  router.get("/:id/icon", wrap(async (req, res) => {
    const icon = await service.icon(req.params.id);
    if (!icon) return res.status(404).json({ error: "no icon" });
    res.set({ "Content-Type": isPng(icon) ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=3600" });
    res.end(icon);
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
