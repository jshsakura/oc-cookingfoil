/**
 * GET /api/patches?lang=ko         every user patch  { patches: [P…] }, with ETag; the Korean
 *                                  name and description for ko (?lang= or Accept-Language). Never waits
 *                                  for a scan: while the first one runs it answers at once with
 *                                  what was read so far, `scanning: true` and Retry-After.
 *                                  A homebrew app's patch has title_id null and
 *                                  `homebrew` (its switch/<app>/ folder name); its
 *                                  files all go under switch/<app>/.
 *                                  Each P carries `game` { name, names, icon } when
 *                                  titledb or the game's own file knows the title,
 *                                  so a client can label patches for games it doesn't list.
 * GET /api/patches/:id/download    one patch as an uncompressed ustar archive
 *
 * Archive paths are relative to the SD card root, directories first, so a
 * client can unpack straight onto the card while it reads. Content-Length is
 * exact, for progress.
 */
import crypto from "crypto";
import express from "express";
import * as userPatches from "../meta/user-patches.js";
import { gameOf } from "../meta/game-info.js";
import { requestLang } from "../meta/categories.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import { sendTar, tarEntries } from "../helpers/tar-stream.js";

export { tarEntries, gameOf };

const ID_RE = /^([0-9A-F]{16}|hb-[0-9a-f]{12})-[0-9a-f]{12}$/;

async function listRoute(req, res) {
  // Never waits for a scan: before the first one finishes this is what has been read so far.
  const listing = await userPatches.list();
  if (listing.scanning) res.set("Retry-After", "30");
  const origin = resolveOrigin(req, publicBaseUrl);
  const lang = requestLang(req);
  const body = JSON.stringify({
    patches: listing.map((p) => {
      const game = p.title_id ? gameOf(p.title_id, origin) : null;
      const own = userPatches.localizePatch(p, lang);
      return game ? { ...own, game } : own;
    }),
    ...(listing.scanning ? { scanning: true } : {}),
  });
  res.header("Content-Type", "application/json");
  res.header("Vary", "Accept-Language");
  res.header("ETag", `"${crypto.createHash("sha1").update(body).digest("hex")}"`);
  // A partial listing is never cached: the next request may have more.
  res.header("Cache-Control", listing.scanning ? "no-store" : "private, max-age=0, must-revalidate");
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  res.status(200).end(body);
}

// A patch still being hashed is sent at once, tagged so a changed file still breaks a resume.
const statTag = (entries) => `s-${crypto.createHash("sha256").update(JSON.stringify(entries.map((e) => [e.path, e.size, e.mtime]))).digest("hex")}`;

async function downloadRoute(req, res) {
  const id = String(req.params.id || "");
  if (!ID_RE.test(id)) {
    res.status(400).json({ error: "invalid patch id" });
    return;
  }
  const opened = await userPatches.openForDownload(id);
  if (!opened) {
    res.status(404).json({ error: "no such patch" });
    return;
  }
  sendTar(res, opened.entries, { filename: `${id}.tar`, etag: opened.patch.hash ?? statTag(opened.entries), label: "patches", fixedTimes: true });
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export default function patchesRouter() {
  const router = express.Router();
  router.get("/", wrap(listRoute));
  router.get("/:id/download", wrap(downloadRoute));
  return router;
}
