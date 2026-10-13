/**
 * Game files in the library, from the library tab:
 *
 *   GET  /admin/api/library/files?q=        { files: [{ rel, name, size, kind, titleId }], total }  up to 100 matches
 *   POST /admin/api/library/files/remove    { rel }  delete one file from the games folder
 *
 * Only a file the library listed can be removed, and only from inside the games folder.
 */
import fsp from "fs/promises";
import path from "path";
import * as shopCache from "../../meta/shop-cache.js";
import { romsDirPath } from "../../helpers/envs.js";
import { inside } from "./homebrew-apps-api.js";
import debug from "../../debug.js";

const LIMIT = 100;

export function mountLibraryFilesApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      debug.error("admin: library files: %s", err.message);
      res.status(500).json({ error: "처리하지 못했습니다. 서버 기록을 봅니다" });
    }
  };

  router.get("/api/library/files", handle(async (req, res) => {
    await shopCache.get();
    const q = String(req.query.q ?? "").trim().toLowerCase().slice(0, 100);
    const all = shopCache.files();
    const hits = q ? all.filter((f) => [f.rel, f.name, f.titleId].some((s) => (s ?? "").toLowerCase().includes(q))) : [];
    hits.sort((a, b) => a.rel.localeCompare(b.rel, "ko"));
    res.json({ files: hits.slice(0, LIMIT), matched: hits.length, total: all.length });
  }));

  router.post("/api/library/files/remove", handle(async (req, res) => {
    await shopCache.get();
    const rel = String(req.body?.rel ?? "");
    const abs = shopCache.files().some((f) => f.rel === rel) ? inside(romsDirPath, rel) : null;
    if (!abs) return res.status(404).json({ error: "라이브러리에 없는 파일입니다" });
    await fsp.rm(abs, { force: true });
    // Folders the file leaves empty go too, up to the games folder itself.
    for (let dir = path.dirname(abs); dir !== path.resolve(romsDirPath) && dir.startsWith(path.resolve(romsDirPath)); dir = path.dirname(dir)) {
      if (!(await fsp.rmdir(dir).then(() => true, () => false))) break;
    }
    shopCache.invalidate({ rescan: true });
    debug.log("admin: library file removed: %s", rel);
    res.json({ ok: true });
  }));
}
