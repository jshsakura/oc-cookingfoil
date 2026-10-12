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
import fs from "fs";
import path from "path";
import express from "express";
import debug from "../debug.js";
import { dataDir, homebrewDir, homebrewRepos, githubToken } from "../helpers/envs.js";
import { createTracker, parseRepo, scanManual } from "../meta/homebrew.js";
import { parseAssets } from "../meta/extract-providers/nro.js";

const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
const POLL_MS = 15 * 60 * 1000; // the tracker itself only asks GitHub every three hours
const MANUAL_STALE_MS = 30_000;

const repos = homebrewRepos.map((r) => {
  const repo = parseRepo(r);
  if (!repo) debug.error("homebrew: ignoring %s, not a GitHub repository", r);
  return repo;
}).filter(Boolean);

let tracker = null;
let manual = { at: 0, entries: [] };
let manualScan = null;

/** On when a repository is named or the hand-placed folder exists. */
export function homebrewEnabled() {
  return repos.length > 0 || fs.existsSync(homebrewDir);
}

/** Hand-placed apps, rescanned at most every 30 seconds and one scan at a time. */
async function manualEntries() {
  if (Date.now() - manual.at > MANUAL_STALE_MS) {
    manualScan ??= scanManual(homebrewDir)
      .then((entries) => { manual = { at: Date.now(), entries }; })
      .finally(() => { manualScan = null; });
    await manualScan;
  }
  return manual.entries;
}

const githubTracker = () =>
  (tracker ??= createTracker({ repos, stateDir: path.join(dataDir, "homebrew"), token: githubToken }));

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

/** Check the repositories now, then keep checking (each one at most every three hours). */
export function start() {
  if (!repos.length) return;
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
