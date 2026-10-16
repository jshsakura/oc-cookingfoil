/**
 * Game files in the library, from the library tab:
 *
 *   GET  /admin/api/library/files?q=        { files: [{ rel, name, size, kind, titleId }], total }  up to 100 matches
 *   POST /admin/api/library/files/remove    { rel }  delete one file from the games folder
 *   POST /admin/api/library/other/remove    { rel }  delete one stray file (not a game file) from the games folder
 *   GET  /admin/api/library/verify          the file check: { status, counts, pending, hashPending, flagged, … }
 *   POST /admin/api/library/verify/hash-all every file gets the whole-file hash it has not had   { queued }
 *   POST /admin/api/library/verify/recheck  { rel }  check one file again, hash included
 *
 * Only a file the library listed can be removed, and only from inside the games folder.
 * The file check only informs: nothing here hides or refuses a file because of it.
 */
import fsp from "fs/promises";
import path from "path";
import * as shopCache from "../../meta/shop-cache.js";
import { romsDirPath, patchesDir, savesDir, homebrewDir, retroDir, dataDir } from "../../helpers/envs.js";
import { GAME_FILE_RE } from "../../helpers/file-send.js";
import { nestedDirs } from "../../meta/library-browse.js";
import { inside } from "./homebrew-apps-api.js";
import debug from "../../debug.js";
import verifyQueue from "../../meta/verify-service.js";

const LIMIT = 100;

export function mountLibraryFilesApi(router, requireSession, verify = verifyQueue) {
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

  // A stray file is anything in the games folder that is not a game file, outside the folders the server manages itself.
  router.post("/api/library/other/remove", handle(async (req, res) => {
    const rel = String(req.body?.rel ?? "");
    const abs = inside(romsDirPath, rel);
    const hidden = rel.split("/").some((part) => part.startsWith("."));
    const managed = nestedDirs(romsDirPath, [patchesDir, savesDir, homebrewDir, retroDir, dataDir]).some((d) => rel === d || rel.startsWith(`${d}/`));
    const stat = abs && !hidden && !managed && !GAME_FILE_RE.test(rel) ? await fsp.lstat(abs).catch(() => null) : null;
    // A folder that is a link could lead out of the games folder: the real path must stay inside it.
    const real = stat?.isFile() ? await fsp.realpath(abs).catch(() => null) : null;
    const realBase = real ? await fsp.realpath(romsDirPath).catch(() => null) : null;
    if (!real || !realBase || !real.startsWith(realBase + path.sep)) return res.status(404).json({ error: "라이브러리에 없는 파일입니다" });
    await fsp.rm(abs, { force: true });
    for (let dir = path.dirname(abs); dir !== path.resolve(romsDirPath) && dir.startsWith(path.resolve(romsDirPath)); dir = path.dirname(dir)) {
      if (!(await fsp.rmdir(dir).then(() => true, () => false))) break;
    }
    shopCache.invalidate({ rescan: true });
    debug.log("admin: stray file removed: %s", rel);
    res.json({ ok: true });
  }));

  router.get("/api/library/verify", handle((req, res) => res.json(verify.view())));

  router.post("/api/library/verify/hash-all", handle((req, res) => res.json({ ok: true, queued: verify.hashAll() })));

  router.post("/api/library/verify/recheck", handle((req, res) => {
    const rel = String(req.body?.rel ?? "");
    if (!rel || !verify.recheck(rel)) return res.status(404).json({ error: "검사 기록이 없는 파일입니다" });
    res.json({ ok: true });
  }));
}
