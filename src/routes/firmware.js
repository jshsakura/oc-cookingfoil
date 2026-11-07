/**
 * The console's firmware list (firmware/service.js), under /api/firmware behind
 * the console's own auth (index.js mounts it with the other /api routes):
 *
 *   GET /api/firmware   { source: { name, reachable, checked_at }, versions: [{ version, released,
 *                         available, reason?, archive: { url, size, sha256, files, unpacked } }] }
 *                       archive.url is the zip's own address at the source: the console downloads
 *                       from there, never from this server. ETag, 304 on If-None-Match.
 *
 * While no source is set (firmwareRepo empty, the default) the list answers
 * 404 { code: "firmware_off" }, and /api/library/info does not list "firmware".
 */
import crypto from "crypto";
import path from "path";
import express from "express";
import * as env from "../helpers/envs.js";
import { createFirmware } from "../firmware/service.js";
import * as integrations from "../security/integrations.js";

/** The firmware follower; one per process. Off (and idle) while firmwareRepo is empty. */
export const firmware = createFirmware({
  dir: path.join(env.dataDir, "firmware"),
  repo: () => env.firmwareRepo,
  hours: () => env.firmwareHours,
  token: () => integrations.get("github").token,
});

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

  return router;
}

/** Drops any cached zips and reads the list a few seconds after start, then every firmwareHours. */
export const start = () => firmware.start();
