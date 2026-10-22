/**
 * The storage guide (retro/scaffold.js) for the admin page, and later for tools:
 *
 *   GET /admin/api/storage-guide               the guide as Markdown, the same text the server keeps
 *                                              in README.md
 *   GET /admin/api/storage-guide?format=json   { text, enabled, skipped, made, failed, folders: [{ id, name, folder, made }],
 *                                                guide: { path, state } } from the last scan
 *
 * Both answer from memory: the last scan's text, or before the first scan the
 * built-in system table's. Neither reads the disk.
 */
import debug from "../../debug.js";
import * as envs from "../../helpers/envs.js";
import { DEFAULT_SYSTEMS } from "../../retro/systems.js";
import * as scaffold from "../../retro/scaffold.js";

export function mountStorageGuideApi(router, requireSession, { layout = envs.layout, retroDir = envs.retroDir } = {}) {
  router.get("/api/storage-guide", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const text = scaffold.lastGuide() ?? scaffold.fallbackGuide({ systems: DEFAULT_SYSTEMS, layout, retroDir });
      if (req.query.format === "json") return res.json({ text, ...(scaffold.status() ?? { enabled: null, folders: [], made: [], failed: [], guide: null }) });
      res.type("text/markdown; charset=utf-8").send(text);
    } catch (err) {
      debug.error("admin: storage guide: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  });
}
