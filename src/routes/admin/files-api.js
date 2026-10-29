/**
 * The admin file browser over the library folders (library/file-roots.js):
 *
 *   GET  /admin/api/files/roots                          [{ key, name }]: the folders there are
 *   GET  /admin/api/files/list?root=&path=&q=&sort=&order=&page=&perPage=
 *        { root, path, parent, items: [{ name, rel, type, size, mtime, ext }], total, page, perPage, pages, counts }
 *   GET  /admin/api/files/download?root=&path=           the file itself
 *   POST /admin/api/files/mkdir   { root, path, name }   → { root, rel }
 *   POST /admin/api/files/rename  { root, path, name }   → { root, rel }
 *   POST /admin/api/files/move    { root, paths, toRoot, toPath } → { moved: [{ from, to }], skipped: [{ rel, code }] }
 *   POST /admin/api/files/trash   { root, paths }        → { trash, files }
 *   POST /admin/api/files/zip     { root, paths }        → { url }: GET that address (for ten minutes) for one zip of
 *        everything under `paths`, stored as is (games do not shrink), with its length known so the browser shows progress.
 *   POST /admin/api/files/upload/chunks { root, path, rel, size, lastModified } → { id, offset, size, kind }
 *        starts (or resumes) an upload into the folder `path`; `rel` is the file's name, under folders of its own
 *        for a dropped folder. Refused before a byte goes up when the name is taken. The pieces then go through
 *        PUT /admin/api/upload/chunks/:id?kind=<kind> (upload-api.js).
 *   POST /admin/api/files/upload  { root, path, items: [{ id, rel }] } → { placed: [rel], skipped: [{ rel, code }] }
 *
 * Errors are { error, code } with code one of FileError's (bad-path, not-found, exists, ...).
 * Every delete goes to the folder's trash; moves and renames are in the undo journal.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import yazl from "yazl";
import { createFileRoots, FileError } from "../../library/file-roots.js";
import { actorOf } from "../../library/trash-service.js";
import { TrashError } from "../../library/trash.js";
import { requestLang } from "../../meta/langs.js";
import debug from "../../debug.js";
import { apiWord } from "./api-words.js";
import * as chunks from "../../meta/upload-chunks.js";

const MAX_PATHS = 1000;
const ZIP_TTL_MS = 10 * 60 * 1000;

export function mountFilesApi(router, requireSession, files = createFileRoots(), { dropDir = chunks.dropChunksDir } = {}) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof FileError) return res.status(err.status).json({ error: apiWord(req, `files.${err.code}`), code: err.code });
      if (err instanceof chunks.ChunkError) return res.status(err.status).json({ error: apiWord(req, err.key, err.vars), code: err.key, ...err.extra });
      if (err instanceof TrashError) return res.status(err.status).json({ error: err.textIn(requestLang(req)), code: err.key ?? "failed" });
      debug.error("admin: files: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed"), code: "failed" });
    }
  };
  const str = (v) => (typeof v === "string" ? v : "");
  const paths = (v) => {
    if (!Array.isArray(v) || !v.length || v.length > MAX_PATHS || v.some((p) => typeof p !== "string")) throw new FileError("nothing");
    return v;
  };

  router.get("/api/files/roots", handle(async (req, res) => {
    res.json({ roots: files.roots().map((r) => ({ key: r.key })) });
  }));

  router.get("/api/files/list", handle(async (req, res) => {
    const { q, sort, order, page, perPage } = req.query;
    res.json(await files.list(str(req.query.root), str(req.query.path), { q: str(q).slice(0, 200), sort: str(sort) || "name", order: str(order), page, perPage }));
  }));

  router.get("/api/files/download", handle(async (req, res) => {
    const f = await files.open(str(req.query.root), str(req.query.path));
    // resolve() already refused dot folders inside the root; one above it (the root's own path) is fine.
    res.download(f.abs, f.name, { dotfiles: "allow" });
  }));

  router.post("/api/files/mkdir", handle(async (req, res) => {
    const b = req.body ?? {};
    res.json(await files.mkdir(str(b.root), str(b.path), str(b.name)));
  }));

  router.post("/api/files/rename", handle(async (req, res) => {
    const b = req.body ?? {};
    const out = await files.rename(str(b.root), str(b.path), str(b.name), { by: actorOf(req) });
    debug.log("admin: files: renamed %s:%s → %s", b.root, b.path, path.basename(out.rel));
    res.json(out);
  }));

  router.post("/api/files/move", handle(async (req, res) => {
    const b = req.body ?? {};
    const out = await files.move(str(b.root), paths(b.paths), str(b.toRoot) || str(b.root), str(b.toPath), { by: actorOf(req) });
    debug.log("admin: files: moved %d into %s:%s (%d skipped)", out.moved.length, b.toRoot || b.root, b.toPath ?? "", out.skipped.length);
    res.json(out);
  }));

  const dropOf = (root) => {
    const dir = dropDir(root);
    if (!dir) throw new FileError("no-root", 404);
    return dir;
  };

  router.post("/api/files/upload/chunks", handle(async (req, res) => {
    const b = req.body ?? {};
    const root = str(b.root);
    const t = await files.uploadTarget(root, str(b.path), str(b.rel));
    const begun = await chunks.begin(dropOf(root), { account: chunks.accountOf(req), kind: chunks.DROP_PREFIX + root, name: path.basename(t.abs), size: b.size, lastModified: b.lastModified });
    res.json({ ...begun, kind: chunks.DROP_PREFIX + root });
  }));

  router.post("/api/files/upload", handle(async (req, res) => {
    const b = req.body ?? {};
    const root = str(b.root);
    const dir = dropOf(root);
    const items = Array.isArray(b.items) && b.items.length && b.items.length <= MAX_PATHS ? b.items : null;
    if (!items) throw new FileError("nothing");
    const placed = [];
    const skipped = [];
    for (const item of items) {
      const rel = str(item?.rel);
      const part = await chunks.completed(dir, str(item?.id), chunks.accountOf(req));
      try {
        placed.push((await files.place(root, str(b.path), rel, part.path)).rel);
        await chunks.discard(dir, str(item.id), chunks.accountOf(req));
      } catch (err) {
        // A name taken while the bytes went up: the old file stays, the partial waits for the sweep.
        if (!(err instanceof FileError)) throw err;
        skipped.push({ rel, code: err.code });
      }
    }
    debug.log("admin: files: %d uploaded into %s:%s (%d skipped)", placed.length, root, str(b.path), skipped.length);
    res.json({ placed, skipped });
  }));

  // A zip is asked for with a POST (a selection can be long) and fetched by a plain link, so the browser's own
  // download takes it: no page memory, its progress bar, and a pause or resume of its own.
  const zips = new Map();
  router.post("/api/files/zip", handle(async (req, res) => {
    const b = req.body ?? {};
    const root = str(b.root);
    const rels = paths(b.paths);
    const entries = await files.collect(root, rels);
    if (!entries.length) throw new FileError("nothing");
    const now = Date.now();
    for (const [k, z] of zips) if (z.until < now) zips.delete(k);
    const folder = rels[0].split("/").slice(0, -1).pop() || root;
    const id = crypto.randomBytes(16).toString("hex");
    zips.set(id, { entries, name: `${rels.length === 1 ? entries[0].name : folder}.zip`, until: now + ZIP_TTL_MS });
    debug.log("admin: files: zip of %d entries from %s", entries.length, root);
    res.json({ url: `/admin/api/files/zip/${id}` });
  }));

  router.get("/api/files/zip/:id", handle(async (req, res) => {
    const z = zips.get(str(req.params.id));
    if (!z || z.until < Date.now()) throw new FileError("not-found", 404);
    const zip = new yazl.ZipFile();
    for (const e of z.entries) {
      if (e.dir) zip.addEmptyDirectory(e.name, { mtime: e.mtime });
      else zip.addReadStreamLazy(e.name, { size: e.size, mtime: e.mtime, compress: false }, (cb) => cb(null, fs.createReadStream(e.real)));
    }
    // Every size is known, so yazl answers the zip's length at once, before a byte is sent.
    zip.end((total) => {
      if (total >= 0) res.set("Content-Length", String(total));
    });
    // A file that changed or went away since the list cut the zip short; the browser then calls the download failed.
    zip.on("error", (err) => {
      debug.error("admin: files: zip: %s", err.message);
      res.destroy(err);
    });
    res.on("close", () => zip.outputStream.unpipe(res));
    res.attachment(z.name);
    res.type("application/zip");
    zip.outputStream.pipe(res);
  }));

  router.post("/api/files/trash", handle(async (req, res) => {
    const b = req.body ?? {};
    const out = await files.trash(str(b.root), paths(b.paths), { by: actorOf(req) });
    debug.log("admin: files: %d moved to the trash from %s", out.files.length, b.root);
    res.json({ trash: out.id, files: out.files });
  }));
}
