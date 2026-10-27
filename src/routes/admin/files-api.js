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
 *
 * Errors are { error, code } with code one of FileError's (bad-path, not-found, exists, ...).
 * Every delete goes to the folder's trash; moves and renames are in the undo journal.
 */
import path from "path";
import { createFileRoots, FileError } from "../../library/file-roots.js";
import { actorOf } from "../../library/trash-service.js";
import debug from "../../debug.js";
import { apiWord } from "./api-words.js";

const MAX_PATHS = 1000;

export function mountFilesApi(router, requireSession, files = createFileRoots()) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof FileError) return res.status(err.status).json({ error: apiWord(req, `files.${err.code}`), code: err.code });
      if (err?.status && err?.message) return res.status(err.status).json({ error: err.message, code: err.key ?? "failed" });
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
    res.download(f.abs, f.name, { dotfiles: "deny" });
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

  router.post("/api/files/trash", handle(async (req, res) => {
    const b = req.body ?? {};
    const out = await files.trash(str(b.root), paths(b.paths), { by: actorOf(req) });
    debug.log("admin: files: %d moved to the trash from %s", out.files.length, b.root);
    res.json({ trash: out.id, files: out.files });
  }));
}
