/**
 * Game files in the library, from the library tab:
 *
 *   GET  /admin/api/library/files?q=        { files: [{ rel, name, size, kind, titleId }], total }  up to 100 matches
 *   POST /admin/api/library/files/remove    { rel }  move one file of the games folder to its trash
 *   POST /admin/api/library/other/remove    { rel }  move one stray file (not a game file) of the games folder to its trash
 *   GET  /admin/api/library/verify          the file check: { status, counts, pending, hashPending, flagged, … }
 *   POST /admin/api/library/verify/hash-all every file gets the whole-file hash it has not had   { queued }
 *   POST /admin/api/library/verify/recheck  { rel }  check one file again, hash included
 *
 * Only a file the library listed can be removed, and only from inside the games folder.
 * Removing moves it to <games>/.cookingfoil-trash (library/trash.js); it stays
 * there until someone empties the trash on the admin page.
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
import * as trashService from "../../library/trash-service.js";
import { trashGameFiles } from "../../library/game-files.js";
import { apiWord } from "./api-words.js";

const LIMIT = 100;

const toTrash = (req, abs, kind, action) => trashGameFiles([abs], { kind, action, by: trashService.actorOf(req), name: path.basename(abs) });

export function mountLibraryFilesApi(router, requireSession, verify = verifyQueue) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof trashService.TrashError) return res.status(err.status).json({ error: err.message });
      debug.error("admin: library files: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed") });
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
    if (!abs) return res.status(404).json({ error: apiWord(req, "libraryFiles.notInLibrary") });
    const out = await toTrash(req, abs, "game", "library-file-remove");
    debug.log("admin: library file moved to the trash: %s", rel);
    res.json({ ok: true, trash: out.id });
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
    if (!real || !realBase || !real.startsWith(realBase + path.sep)) return res.status(404).json({ error: apiWord(req, "libraryFiles.notInLibrary") });
    const out = await toTrash(req, abs, "file", "library-other-remove");
    debug.log("admin: stray file moved to the trash: %s", rel);
    res.json({ ok: true, trash: out.id });
  }));

  router.get("/api/library/verify", handle((req, res) => res.json(verify.view())));

  router.post("/api/library/verify/hash-all", handle((req, res) => res.json({ ok: true, queued: verify.hashAll() })));

  router.post("/api/library/verify/recheck", handle((req, res) => {
    const rel = String(req.body?.rel ?? "");
    if (!rel || !verify.recheck(rel)) return res.status(404).json({ error: apiWord(req, "libraryFiles.noCheck") });
    res.json({ ok: true });
  }));
}
