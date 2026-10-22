/**
 * What goes in each folder the server uses, for the admin page and for tools (an API token may read it):
 *
 *   GET /admin/api/storage-guide                    the storage guide as Markdown
 *   GET /admin/api/storage-guide?format=json        { text, enabled, skipped, made, failed, folders: [{ id, name, folder, made }],
 *                                                     guides: [guide] }: the last scan's folder making and every folder's guide
 *   GET /admin/api/storage-guide/folder?path=<p>    { guide } for one folder, <p> as a guide's `path` ("retro/roms/gba");
 *                                                     with &format=md its Markdown. 400 for a path that is not a plain
 *                                                     relative one, 404 with { known: [path] } for one no guide has
 *
 * A guide is helpers/folder-guides.js's: { path, dir, consolePath, role, system?, title, purpose, accepts,
 * structure, naming, server, doNotPut, core, bios, arcade, text }. The server writes none of this to disk.
 * Everything comes from memory (helpers/storage-guide.js, which the capabilities in capabilities/library.js call too): the last scan's
 * guides, or before the first scan the built-in system table's. No request reads the disk.
 */
import debug from "../../debug.js";
import * as envs from "../../helpers/envs.js";
import * as storageGuide from "../../helpers/storage-guide.js";
import { apiWord } from "./api-words.js";

const NO_SCAN = { enabled: null, skipped: null, folders: [], made: [], failed: [] };

export function mountStorageGuideApi(router, requireSession, { layout = envs.layout, retroDir = envs.retroDir } = {}) {
  router.get("/api/storage-guide", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const { text, guides, status } = storageGuide.current({ layout, retroDir });
      if (req.query.format === "json") return res.json({ text, ...(status ?? NO_SCAN), guides });
      res.type("text/markdown; charset=utf-8").send(text);
    } catch (err) {
      debug.error("admin: storage guide: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed") });
    }
  });

  router.get("/api/storage-guide/folder", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const r = storageGuide.folder(req.query.path, { layout, retroDir });
      if (r.error === "bad-path") return res.status(400).json({ error: apiWord(req, "guide.badPath") });
      if (r.error === "unknown") return res.status(404).json({ error: apiWord(req, "guide.unknown"), known: r.known });
      if (req.query.format === "md") return res.type("text/markdown; charset=utf-8").send(r.guide.text);
      res.json({ guide: r.guide });
    } catch (err) {
      debug.error("admin: folder guide: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed") });
    }
  });
}
