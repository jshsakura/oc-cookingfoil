/**
 * GET /api/patches                 every user patch  { patches: [P…] }, with ETag
 * GET /api/patches/:id/download    one patch as an uncompressed ustar archive
 *
 * Archive paths are relative to the SD card root, directories first, so a
 * client can unpack straight onto the card while it reads. Content-Length is
 * exact, for progress.
 */
import crypto from "crypto";
import fs from "fs";
import { Readable, pipeline } from "stream";
import express from "express";
import debug from "../debug.js";
import * as userPatches from "../meta/user-patches.js";
import { header, padding, TRAILER, archiveSize } from "../helpers/ustar.js";

const ID_RE = /^[0-9A-F]{16}-[0-9a-f]{12}$/;

/** Directory entries for every parent of the files, then the files. Pure. */
export function tarEntries(files) {
  const dirs = new Set();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") + "/");
  }
  return [
    ...[...dirs].sort().map((d) => ({ path: d, dir: true, mtime: 0 })),
    ...files.map((f) => ({ ...f, dir: false })),
  ];
}

async function* archive(entries) {
  for (const e of entries) {
    yield header(e);
    if (e.dir) continue;
    let sent = 0;
    if (e.size) {
      for await (const chunk of fs.createReadStream(e.abs, { start: 0, end: e.size - 1 })) {
        sent += chunk.length;
        yield chunk;
      }
    }
    // A file that shrank mid-download would corrupt every later entry.
    if (sent !== e.size) throw new Error(`${e.path} changed while sending`);
    yield padding(e.size);
  }
  yield TRAILER;
}

async function listRoute(req, res) {
  const body = JSON.stringify({ patches: await userPatches.list() });
  res.header("Content-Type", "application/json");
  res.header("ETag", `"${crypto.createHash("sha1").update(body).digest("hex")}"`);
  res.header("Cache-Control", "private, max-age=0, must-revalidate");
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  res.status(200).end(body);
}

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
  const entries = tarEntries(opened.entries);
  res.header("Content-Type", "application/x-tar");
  res.header("Content-Length", String(archiveSize(entries)));
  res.header("Content-Disposition", `attachment; filename="${id}.tar"`);
  res.header("ETag", `"${opened.patch.hash}"`);
  res.header("Cache-Control", "private, no-cache");
  pipeline(Readable.from(archive(entries)), res, (err) => {
    if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") debug.error("patches: download %s failed: %s", id, err.message);
  });
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export default function patchesRouter() {
  const router = express.Router();
  router.get("/", wrap(listRoute));
  router.get("/:id/download", wrap(downloadRoute));
  return router;
}
