/**
 * The cores in the RetroArch base pack, for the admin page's retro tab:
 *
 *   GET /admin/api/retro-cores   { official, retroarch: E | null,
 *                                  cores: [{ core, file, name, ...E, systems: [{ id, name, games }] }] }
 *
 *   POST /admin/api/retro-cores/system   { system, core | null }  the core a console's games start with;
 *                                         null goes back to the system table's. Rescans, so each game's
 *                                         forwarder key changes and consoles fetch a new one
 *
 *   POST /admin/api/retro-cores/remove   { core, force? }  moves the core to the retro trash; 409 with
 *                                         { using } when games use it, unless force
 *
 * E = { size, sha256, modifiedAt, origin: "official" | "modified" | "extra" } (src/retro/core-list.js).
 * Uploads go through /admin/api/upload/core.
 */
import fs from "fs";
import path from "path";
import debug from "../../debug.js";
import { retroDir } from "../../helpers/envs.js";
import { HashCache } from "../../helpers/hash-cache.js";
import { appDb } from "../../db/database.js";
import { hashStore } from "../../db/stores.js";
import * as retroCatalog from "../../retro/catalog.js";
import { listCores } from "../../retro/core-list.js";
import { CoreError, removeCore } from "../../retro/core-files.js";
import { coreFile, packDirOf } from "../../retro/pack-status.js";
import * as systemCores from "../../retro/system-cores.js";

export function mountRetroCoresApi(router, requireSession) {
  let hashCache = null;
  router.get("/api/retro-cores", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const catalog = await retroCatalog.current(retroDir);
      hashCache ??= new HashCache(hashStore(appDb(), "retro"));
      res.json(await listCores(packDirOf(retroDir), hashCache, catalog.games, catalog.systems));
    } catch (err) {
      debug.error("admin retro-cores: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  router.post("/api/retro-cores/system", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const { system } = req.body ?? {};
      const core = req.body?.core ?? null;
      const catalog = await retroCatalog.current(retroDir);
      if (typeof system !== "string" || !catalog.systems[system]) return res.status(404).json({ error: "그런 기종이 없습니다." });
      if (core !== null && (typeof core !== "string" || !systemCores.CORE_RE.test(core) || !fs.existsSync(path.join(packDirOf(retroDir), coreFile(core))))) {
        return res.status(400).json({ error: "retroarch/cores/ 에 없는 코어입니다." });
      }
      const tableCore = catalog.systems[system].tableCore ?? catalog.systems[system].core;
      systemCores.set(system, core === tableCore ? null : core);
      await retroCatalog.rescan(retroDir);
      debug.log("admin retro-cores: %s plays with %s", system, core ?? tableCore);
      res.json({ system, core: core ?? tableCore, tableCore });
    } catch (err) {
      debug.error("admin retro-cores: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  router.post("/api/retro-cores/remove", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const catalog = await retroCatalog.current(retroDir);
      const out = await removeCore(retroDir, req.body?.core, catalog.games, { force: req.body?.force === true });
      debug.log("admin retro-cores: %s → trash %s", out.core, out.entry);
      res.json(out);
    } catch (err) {
      if (err instanceof CoreError) return res.status(err.status).json({ error: err.message, ...err.extra });
      debug.error("admin retro-cores: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  });
}
