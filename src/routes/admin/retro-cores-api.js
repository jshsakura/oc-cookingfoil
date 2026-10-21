/**
 * The cores in the RetroArch base pack, for the admin page's retro tab:
 *
 *   GET /admin/api/retro-cores   { official, retroarch: E | null,
 *                                  cores: [{ core, file, name, ...E, systems: [{ id, name, games }] }] }
 *
 * E = { size, sha256, modifiedAt, origin: "official" | "modified" | "extra" } (src/retro/core-list.js).
 * Read only.
 */
import debug from "../../debug.js";
import { retroDir } from "../../helpers/envs.js";
import { HashCache } from "../../helpers/hash-cache.js";
import { appDb } from "../../db/database.js";
import { hashStore } from "../../db/stores.js";
import * as retroCatalog from "../../retro/catalog.js";
import { listCores } from "../../retro/core-list.js";
import { packDirOf } from "../../retro/pack-status.js";

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
}
