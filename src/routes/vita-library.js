/**
 * The PS Vita library (library/vita-library.js) for a Vita and the web page:
 *
 *   GET /api/vita/library                  { success, data: { games }, error, meta: { total } }
 *   GET /api/vita/library/:id/icon         the app's icon0.png
 *   GET /api/vita/library/:id/:kind        the app (.vpk), patch or DLC zip, with Range; ETag "<crc32>" once read
 *
 * A Switch is refused: the Vita's files are not for it. A file changed since the list was read is 503,
 * and the list is read again.
 */
import crypto from "crypto";
import express from "express";
import fsp from "fs/promises";
import debug from "../debug.js";
import { vitaDir } from "../helpers/envs.js";
import { fileKey } from "../helpers/hash-cache.js";
import { vitaLibrary, VITA_KINDS } from "../library/vita-library.js";
import { directUrl, forRequest } from "../security/download-links.js";
import { requestPlatform } from "../platforms/switch-only.js";
import { iconVariant } from "../meta/icon-variant.js";

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const TITLE_ID_RE = /^[A-Z]{4}\d{5}$/;

export { vitaLibrary };

/** A game as the list gives it. Pure but for `crcOf`. */
export function gameRow(g, link, crcOf, hasIcon = g.files.app.icon) {
  const app = g.files.app;
  const base = `/api/vita/library/${g.id}`;
  return {
    id: g.id,
    name: app.name ?? g.id,
    version: app.version,
    patch_version: g.files.patch?.version ?? null,
    region: app.region,
    size: VITA_KINDS.reduce((n, k) => n + (g.files[k]?.size ?? 0), 0),
    icon_url: hasIcon ? `${base}/icon` : null,
    dlc_count: g.files.dlc?.count ?? 0,
    files: VITA_KINDS.filter((k) => g.files[k]).map((k) => ({
      kind: k,
      name: g.files[k].name,
      size: g.files[k].size,
      crc32: crcOf(g.files[k]),
      ...(k === "app" ? { license: app.license } : {}),
      url: directUrl(`${base}/${k}`, link),
    })),
  };
}

export function vitaLibraryRouter({ library = vitaLibrary, platformOf = requestPlatform } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const platform = platformOf(req);
    if (platform && platform !== "vita") return res.status(404).json({ success: false, data: null, error: "not for this platform" });
    next();
  });

  router.get("/", wrap(async (req, res) => {
    const lib = library();
    const link = forRequest(req);
    const all = await lib.list();
    const icons = await Promise.all(all.map((g) => lib.hasIcon(g)));
    const games = all.map((g, i) => gameRow(g, link, lib.crcOf, icons[i]));
    const body = JSON.stringify({ success: true, data: { games }, error: null, meta: { total: games.length } });
    res.set({
      "Content-Type": "application/json",
      ETag: `"${crypto.createHash("sha1").update(body).digest("hex")}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    });
    if (req.fresh) return res.status(304).end();
    res.status(200).end(body);
  }));

  router.param("id", (req, res, next, id) => {
    if (!TITLE_ID_RE.test(id)) return res.status(400).json({ success: false, data: null, error: "invalid title id" });
    next();
  });

  router.get("/:id/icon", wrap(async (req, res) => {
    const icon = await library().icon(req.params.id);
    if (!icon) return res.status(404).json({ success: false, data: null, error: "no icon" });
    const { body, type } = await iconVariant(`vita\0${req.params.id}\0${crypto.createHash("sha1").update(icon).digest("hex")}`, icon, { size: req.query.size });
    res.set({ "Content-Type": type, "Cache-Control": "private, max-age=0, must-revalidate", ETag: `"${crypto.createHash("sha1").update(body).digest("base64url")}"` });
    if (req.fresh) return res.status(304).end();
    res.end(body);
  }));

  router.get("/:id/:kind", wrap(async (req, res) => {
    if (!VITA_KINDS.includes(req.params.kind)) return res.status(404).json({ success: false, data: null, error: "no such file" });
    const lib = library();
    const file = await lib.file(req.params.id, req.params.kind);
    if (!file) return res.status(404).json({ success: false, data: null, error: "no such file" });
    const st = await fsp.stat(file.abs).catch(() => null);
    if (!st || fileKey(st) !== file.key) {
      lib.invalidate();
      res.set("Retry-After", "5");
      return res.status(503).json({ success: false, data: null, error: "the files changed since they were listed; list again in a few seconds" });
    }
    // The client tells a file replaced during a resumed download by this ETag: the file's CRC-32, once read.
    res.set("Cache-Control", "no-cache");
    if (file.crc32) res.set("ETag", `"${file.crc32}"`);
    res.attachment(file.name);
    res.sendFile(file.abs, { etag: false, lastModified: false, acceptRanges: true });
  }));

  return router;
}

const CRC_PASS_MS = 60 * 60 * 1000;

/** Reads the library, then the CRC of each file that has none yet, in the background: now and every hour. */
export function start() {
  if (!vitaDir) return;
  const pass = () => vitaLibrary().fillCrcs().then((n) => n && debug.log("vita library: read the CRC of %d files", n), (err) => debug.error("vita library: CRC pass failed: %s", err.message));
  pass();
  setInterval(pass, CRC_PASS_MS).unref();
}
