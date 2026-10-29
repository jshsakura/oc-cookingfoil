/**
 * The admin file browser over the library folders (library/file-roots.js):
 *
 *   GET  /admin/api/files/roots                          [{ key, name }]: the folders there are
 *   GET  /admin/api/files/list?root=&path=&q=&deep=&sort=&order=&page=&perPage=&only=dirs
 *        { root, path, parent, items: [{ name, rel, type, size, mtime, ext }], total, page, perPage, pages, counts, deep, cut }
 *        deep=1 finds q in every folder under path (cut: the walk stopped early).
 *   GET  /admin/api/files/download?root=&path=           the file itself
 *   POST /admin/api/files/mkdir   { root, path, name }   → { root, rel }
 *   POST /admin/api/files/rename  { root, path, name }   → { root, rel, undo }
 *   POST /admin/api/files/move    { root, paths, toRoot, toPath } → { moved: [{ from, to, undo }], skipped: [{ rel, code }] }
 *   POST /admin/api/files/copy    { root, paths, toRoot, toPath } → { copied: [{ from, to }], skipped: [{ rel, code }] }
 *        with background: true → { job, total } at once; GET /admin/api/files/copy/:job → { state: running|done|failed,
 *        total, done } in bytes, with what the copy answers once done, { code, error } once failed.
 *   POST /admin/api/files/trash   { root, paths }        → { trash, restore: [id], files }
 *   POST /admin/api/files/share   { root, path, hours }  → { url, id, expiresAt }: a download link to one file that anyone
 *        holding it can use for 1, 24 or 168 hours (library/file-shares.js, public end routes/file-share.js)
 *   GET  /admin/api/files/shares?root=&path=             → { shares: [{ id, expiresAt, by }] } live links to that file
 *   POST /admin/api/files/share/end { id }               → { ok } ends a link at once
 *   POST /admin/api/files/sizes   { root, paths }        → { sizes: { rel: { bytes, files, dirs } } } for the folders among
 *        `paths`, from a cache that only looks again at folders that changed (library/folder-sizes.js)
 *   POST /admin/api/files/info    { root, paths }        → { files, dirs, bytes, newest, cut }: what a pick holds, folders counted
 *        through, up to INFO_MAX entries (cut: it stopped there)
 *        `undo` is the journal line POST /admin/api/trash/undo takes back; `restore` the ids POST /admin/api/trash/restore takes.
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
import { createFileFacts, titleLabel } from "../../library/file-facts.js";
import { fileShares } from "../../library/file-shares.js";
import { publicBaseUrl } from "../../helpers/envs.js";
import { resolveOrigin } from "../../helpers/origin.js";
import debug from "../../debug.js";
import { apiWord } from "./api-words.js";
import * as chunks from "../../meta/upload-chunks.js";

const MAX_PATHS = 1000;
const ZIP_TTL_MS = 10 * 60 * 1000;
const INFO_MAX = 100000;
const COPY_TTL_MS = 10 * 60 * 1000;
const SIZES_MAX = 500;
// A while after start every storage is sized once, so the first folder opened already has its sizes.
const SIZES_WARM_MS = 60 * 1000;

/** Bytes under `p` (a file or a folder), 0 when it is gone. */
async function sizeOf(p) {
  const st = await fs.promises.lstat(p).catch(() => null);
  if (!st) return 0;
  if (!st.isDirectory()) return st.isFile() ? st.size : 0;
  const names = await fs.promises.readdir(p).catch(() => []);
  let n = 0;
  for (const name of names) n += await sizeOf(path.join(p, name));
  return n;
}

export function mountFilesApi(router, requireSession, files = createFileRoots(), { dropDir = chunks.dropChunksDir, facts = createFileFacts(), warmSizes = true, shares = fileShares() } = {}) {
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
    const deep = str(req.query.deep) === "1";
    const label = titleLabel(requestLang(req));
    const root = str(req.query.root);
    const dirsOnly = str(req.query.only) === "dirs";
    const out = await files.list(root, str(req.query.path), { q: str(q).slice(0, 200), deep, sort: str(sort) || "name", order: str(order), page, perPage, label, dirsOnly });
    res.json({ ...out, items: facts(root, out.items) });
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

  // A copy asked with background: true answers { job } at once and runs on; GET /api/files/copy/:id says how far
  // it got (the bytes in place plus the partial being written) and, once it ends, what it did. A game takes
  // minutes, longer than a proxy waits for one answer.
  const copies = new Map();
  const copyRun = async (b, job) => {
    const progress = { started: (part) => { job.part = part; }, placed: (abs) => { job.part = null; job.placing = sizeOf(abs).then((n) => { job.done += n; }); } };
    try {
      job.result = await files.copy(str(b.root), paths(b.paths), str(b.toRoot) || str(b.root), str(b.toPath), progress);
      await job.placing;
      job.state = "done";
      debug.log("admin: files: copied %d into %s:%s (%d skipped)", job.result.copied.length, b.toRoot || b.root, b.toPath ?? "", job.result.skipped.length);
    } catch (err) {
      job.state = "failed";
      job.code = err instanceof FileError ? err.code : "failed";
      if (!(err instanceof FileError)) debug.error("admin: files: copy: %s", err.message);
    }
    job.part = null;
    job.until = Date.now() + COPY_TTL_MS;
  };
  router.post("/api/files/copy", handle(async (req, res) => {
    const b = req.body ?? {};
    if (b.background === true) {
      const now = Date.now();
      for (const [k, j] of copies) if (j.until < now) copies.delete(k);
      const entries = await files.collect(str(b.root), paths(b.paths), { max: INFO_MAX });
      const id = crypto.randomBytes(12).toString("hex");
      const job = { state: "running", total: entries.reduce((n, e) => n + (e.dir ? 0 : e.size), 0), done: 0, part: null, until: Infinity };
      copies.set(id, job);
      copyRun(b, job);
      return res.json({ job: id, total: job.total });
    }
    const out = await files.copy(str(b.root), paths(b.paths), str(b.toRoot) || str(b.root), str(b.toPath));
    debug.log("admin: files: copied %d into %s:%s (%d skipped)", out.copied.length, b.toRoot || b.root, b.toPath ?? "", out.skipped.length);
    res.json(out);
  }));
  router.get("/api/files/copy/:id", handle(async (req, res) => {
    const job = copies.get(str(req.params.id));
    if (!job) throw new FileError("not-found", 404);
    const writing = job.part ? await sizeOf(job.part) : 0;
    const out = { state: job.state, total: job.total, done: Math.min(job.total, job.done + writing) };
    if (job.state === "done") Object.assign(out, job.result);
    if (job.state === "failed") Object.assign(out, { code: job.code, error: apiWord(req, `files.${job.code}`) });
    res.json(out);
  }));

  router.post("/api/files/share", handle(async (req, res) => {
    const b = req.body ?? {};
    const root = str(b.root);
    const f = await files.open(root, str(b.path));
    const rel = str(b.path);
    const made = shares.create({ root, rel, name: f.name, hours: Number(b.hours), by: actorOf(req) });
    debug.log("admin: files: shared %s:%s for %dh", root, rel, Number(b.hours));
    res.json({ url: `${resolveOrigin(req, publicBaseUrl)}/share/${made.token}`, id: made.id, expiresAt: made.expiresAt });
  }));
  router.get("/api/files/shares", handle(async (req, res) => {
    res.json({ shares: shares.of(str(req.query.root), str(req.query.path)) });
  }));
  router.post("/api/files/share/end", handle(async (req, res) => {
    if (!shares.revoke(str(req.body?.id))) throw new FileError("not-found", 404);
    res.json({ ok: true });
  }));

  router.post("/api/files/sizes", handle(async (req, res) => {
    const b = req.body ?? {};
    const rels = paths(b.paths);
    if (rels.length > SIZES_MAX) throw new FileError("nothing");
    res.json({ sizes: await files.sizes(str(b.root), rels) });
  }));
  if (warmSizes) {
    setTimeout(async () => {
      for (const r of files.roots()) await files.sizes(r.key, [""]).catch((err) => debug.error("admin: files: sizing %s: %s", r.key, err.message));
    }, SIZES_WARM_MS).unref();
  }

  router.post("/api/files/info", handle(async (req, res) => {
    const b = req.body ?? {};
    const entries = await files.collect(str(b.root), paths(b.paths), { mayBeRoot: true, max: INFO_MAX });
    const out = { files: 0, dirs: 0, bytes: 0, newest: 0, cut: entries.cut };
    for (const e of entries) {
      if (e.dir) out.dirs++;
      else {
        out.files++;
        out.bytes += e.size;
      }
      out.newest = Math.max(out.newest, e.mtime.getTime());
    }
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
  const purge = () => {
    const now = Date.now();
    for (const [k, z] of zips) if (z.until < now) zips.delete(k);
  };
  router.post("/api/files/zip", handle(async (req, res) => {
    const b = req.body ?? {};
    const root = str(b.root);
    const rels = paths(b.paths);
    const entries = await files.collect(root, rels);
    if (!entries.length) throw new FileError("nothing");
    purge();
    const now = Date.now();
    const folder = rels[0].split("/").slice(0, -1).pop() || root;
    const id = crypto.randomBytes(16).toString("hex");
    zips.set(id, { entries, name: `${rels.length === 1 ? entries[0].name : folder}.zip`, until: now + ZIP_TTL_MS });
    debug.log("admin: files: zip of %d entries from %s", entries.length, root);
    res.json({ url: `/admin/api/files/zip/${id}` });
  }));

  router.get("/api/files/zip/:id", handle(async (req, res) => {
    purge();
    const z = zips.get(str(req.params.id));
    if (!z) throw new FileError("not-found", 404);
    const zip = new yazl.ZipFile();
    // The one file being read, so a download stopped halfway closes it instead of leaving it open.
    let reading = null;
    for (const e of z.entries) {
      if (e.dir) zip.addEmptyDirectory(e.name, { mtime: e.mtime });
      else zip.addReadStreamLazy(e.name, { size: e.size, mtime: e.mtime, compress: false }, (cb) => cb(null, (reading = fs.createReadStream(e.real))));
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
    res.on("close", () => {
      if (res.writableFinished) return;
      zip.outputStream.unpipe(res);
      zip.outputStream.destroy();
      reading?.destroy();
    });
    res.attachment(z.name);
    res.type("application/zip");
    zip.outputStream.pipe(res);
  }));

  router.post("/api/files/trash", handle(async (req, res) => {
    const b = req.body ?? {};
    const out = await files.trash(str(b.root), paths(b.paths), { by: actorOf(req) });
    debug.log("admin: files: %d moved to the trash from %s", out.files.length, b.root);
    res.json({ trash: out.id, restore: out.entries.map((e) => e.id), files: out.files });
  }));
}
