/**
 * GET /api/homebrew                every app  { homebrew: [H…] }, with ETag
 * GET /api/homebrew/:id/icon       the app's icon from its NRO (404 before its first fetch)
 * GET /api/homebrew/:id/download   the .nro (Content-Length, ETag = its sha256)
 *
 * H = { id, name, version, author, description, size, hash, file_name, icon_url,
 *       download_url, source: "github" | "manual", released_at, repo_url }
 *
 * `hash` changes whenever the build does; a client compares it with the one it
 * installed to show an update. A GitHub build announced but not yet fetched is
 * fetched by its first download, so that request can take a while.
 */
import crypto from "crypto";
import path from "path";
import express from "express";
import debug from "../debug.js";
import { dataDir, homebrewDir, githubToken } from "../helpers/envs.js";
import { createTracker, scanManual } from "../meta/homebrew.js";
import * as sources from "../meta/homebrew-sources.js";
import { parseAssets } from "../meta/extract-providers/nro.js";

const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
const POLL_MS = 15 * 60 * 1000; // the tracker itself only asks GitHub every three hours
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
  (tracker ??= createTracker({ sources: sources.list(), stateDir: path.join(dataDir, "homebrew"), token: githubToken }));

/** Hand-placed apps for the admin page (read-only there). */
export const manualApps = () => manualEntries();

/** After the admin changes the list: follow it, and check what is new or changed now. */
export async function sourcesChanged(repo = null) {
  githubTracker().setSources(sources.list());
  if (repo) await githubTracker().checkNow(repo);
}

/** The service backed by this server's folders and repositories. */
export const defaultService = {
  async list() {
    const manualList = (await manualEntries()).map(({ path: _p, sha256: _s, ...e }) => e);
    return [...githubTracker().entries(), ...manualList].map((e) => ({ description: null, ...e }));
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
};

/**
 * Scans the hand-placed folder now and every minute, and checks the
 * repositories now and every 15 minutes (each one asks GitHub at most every three hours).
 */
export function start() {
  const scan = () => refreshManual().catch((err) => debug.error("homebrew: scan failed: %s", err.message));
  scan();
  setInterval(scan, MANUAL_RESCAN_MS).unref();
  // Always scheduled: the admin can add a repository at any time.
  const run = () => githubTracker().checkAll().catch((err) => debug.error("homebrew: check failed: %s", err.message));
  run();
  setInterval(run, POLL_MS).unref();
}

const isPng = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export function homebrewRouter({ service = defaultService } = {}) {
  const router = express.Router();

  router.get("/", wrap(async (req, res) => {
    const list = (await service.list()).map((e) => ({
      ...e,
      icon_url: `/api/homebrew/${e.id}/icon`,
      download_url: `/api/homebrew/${e.id}/download`,
    }));
    const body = JSON.stringify({ homebrew: list });
    res.set({
      "Content-Type": "application/json",
      ETag: `"${crypto.createHash("sha1").update(body).digest("hex")}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
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

  return router;
}
