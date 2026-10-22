/**
 * The storage guide (retro/scaffold.js) for the admin page, and later for tools:
 *
 *   GET /admin/api/storage-guide               the guide as Markdown, the same text the server keeps
 *                                              in README.md
 *   GET /admin/api/storage-guide?format=json   { text, enabled, skipped, made, failed, folders: [{ id, name, folder, made }],
 *                                                guide: { path, state }, folderGuides: [{ path, state }] } from the last scan,
 *                                              and guides: [{ path, state, text }], the README.md of each folder
 *                                              (helpers/folder-guides.js): the ones last written or found, or
 *                                              before the first write every one the server could write (state null)
 *
 * Both answer from memory: the last scan's text, or before the first scan the
 * built-in system table's. Neither reads the disk.
 */
import debug from "../../debug.js";
import * as envs from "../../helpers/envs.js";
import { DEFAULT_SYSTEMS } from "../../retro/systems.js";
import * as scaffold from "../../retro/scaffold.js";
import * as folderGuides from "../../helpers/folder-guides.js";

export function mountStorageGuideApi(router, requireSession, { layout = envs.layout, retroDir = envs.retroDir } = {}) {
  router.get("/api/storage-guide", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const text = scaffold.lastGuide() ?? scaffold.fallbackGuide({ systems: DEFAULT_SYSTEMS, layout, retroDir });
      if (req.query.format === "json") {
        const kept = folderGuides.list();
        const guides = kept.length ? kept : scaffold.fallbackFolderGuides({ systems: DEFAULT_SYSTEMS, layout, retroDir });
        return res.json({ text, ...(scaffold.status() ?? { enabled: null, folders: [], made: [], failed: [], guide: null }), guides });
      }
      res.type("text/markdown; charset=utf-8").send(text);
    } catch (err) {
      debug.error("admin: storage guide: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  });
}
