/**
 * Firmware releases for the console (firmware/service.js keeps the list and the zips):
 *
 * GET /api/firmware                     { source: { name, reachable, checked_at }, versions: [V…] }, newest first, with ETag (304)
 *   V = { version, released, available, reason?, archive: { url, size, sha256, files, unpacked } }
 *   archive.url is always this server's own address; sha256 is "" until the server holds the zip;
 *   files and unpacked are 0 while the zip's directory has not been read. reason is "upstream_gone"
 *   (the source no longer lists it and the server does not hold it) or "bad_archive" (its zip failed
 *   the check; tried again after the next check of the list).
 * GET /api/firmware/:version/download   the zip (Range, 206, Content-Length, ETag = its sha256)
 *   503 + Retry-After: 30   { code: "caching", bytes, size }   not held yet; the server is fetching it
 *   410                     { code: "unavailable", reason }      available false in the list
 *   404                     { code: "unknown_version" }          not a version the list holds (or not a version)
 *   507                     { code: "no_space" }                 the server has no room to fetch it
 *
 * While no source is set (the firmwareRepo setting, empty by default) both answer
 * 404 { code: "firmware_off" }, and /api/library/info does not list "firmware".
 * Mounted behind the same sign-in and device guard as /api/homebrew.
 */
import crypto from "crypto";
import express from "express";
import path from "path";
import * as env from "../helpers/envs.js";
import * as integrations from "../security/integrations.js";
import debug from "../debug.js";
import { createFirmware } from "../firmware/service.js";
import { VERSION_RE } from "../firmware/versions.js";

// How long a console waits before asking again for a zip being fetched.
export const RETRY_AFTER_S = 30;

/** The firmware follower; one per process. Off (and idle) while firmwareRepo is empty. */
export const firmware = createFirmware({
  dir: path.join(env.dataDir, "firmware"),
  repo: () => env.firmwareRepo,
  keep: () => env.firmwareKeep,
  hours: () => env.firmwareHours,
  token: () => integrations.get("github").token,
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export function firmwareRouter({ service = firmware } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (service.enabled()) return next();
    res.status(404).set("Cache-Control", "no-store").json({ error: "this server offers no firmware", code: "firmware_off" });
  });

  router.get("/", (req, res) => {
    const body = JSON.stringify(service.list());
    res.set({
      "Content-Type": "application/json",
      ETag: `"${crypto.createHash("sha1").update(body).digest("hex")}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    });
    if (req.fresh) return res.status(304).end();
    res.status(200).end(body);
  });

  router.get("/:version/download", wrap(async (req, res) => {
    const { version } = req.params;
    // Checked before anything touches the disk: the version names the cached file.
    const got = VERSION_RE.test(version) ? await service.prepare(version) : { state: "unknown" };
    if (got.state === "unknown") return res.status(404).set("Cache-Control", "no-store").json({ error: "no such firmware version", code: "unknown_version" });
    if (got.state === "unavailable") return res.status(410).set("Cache-Control", "no-store").json({ error: "this firmware cannot be downloaded", code: "unavailable", reason: got.reason });
    if (got.state === "no_space") return res.status(507).set("Cache-Control", "no-store").json({ error: "the server has no room to fetch this firmware", code: "no_space" });
    if (got.state === "caching") {
      return res.status(503).set({ "Retry-After": String(RETRY_AFTER_S), "Cache-Control": "no-store" }).json({ error: "the server is still getting this firmware", code: "caching", bytes: got.bytes, size: got.size });
    }
    res.set({ "Cache-Control": "no-cache", ETag: `"${got.sha256}"` });
    if (req.fresh) return res.status(304).end();
    res.type("application/zip");
    res.attachment(`firmware-${version}.zip`);
    // send answers Range and If-Range against the ETag set above (as homebrew and client builds are served).
    res.sendFile(got.path, { etag: false, lastModified: false, acceptRanges: true, dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) {
        debug.error("firmware: sending %s failed: %s", version, err.message);
        res.status(404).json({ error: "no such firmware version", code: "unknown_version" });
      }
    });
  }));

  return router;
}

/** Tidies the cache and starts following the source (when one is set). */
export function start() {
  firmware.start();
}
