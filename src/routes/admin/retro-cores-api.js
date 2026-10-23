/**
 * The cores in the RetroArch base pack, for the admin page's retro tab:
 *
 *   GET /admin/api/retro-cores   { official, retroarch: E | null,
 *                                  cores: [{ core, file, name, ...E, systems: [{ id, name, games }] }],
 *                                  systems: [{ id, name, games, core, ..., coreState }], auto }
 *
 *   POST /admin/api/retro-cores/system   { system, core | null }  the core a console's games start with;
 *                                         null goes back to the system table's. Rescans, so each game's
 *                                         forwarder key changes and consoles fetch a new one
 *
 *   POST /admin/api/retro-cores/enabled  { core, enabled }  switches a core on or off (src/retro/cores-off.js);
 *                                         an off core leaves the console pack and isn't fetched. GET marks it off: true
 *
 *   POST /admin/api/retro-cores/remove   { core, force? }  moves the core to the retro trash; 409 with
 *                                         { using } when games use it, unless force
 *
 *   POST /admin/api/retro-cores/auto          fetches the missing cores of the consoles with games now, from the
 *                                             libretro nightly buildbot (202 { started, cores } or 200 { started: false, reason })
 *   POST /admin/api/retro-cores/update        replaces each server core whose CRC-32 the nightly index changed (202)
 *   POST /admin/api/retro-cores/official      { core } the user's core goes to the retro trash, the nightly one takes its place (202)
 *   POST /admin/api/retro-cores/user-version  { core, hidden? } the user's core comes back from the trash, or with
 *                                             `hidden` the held file of that name (200 { core, restored, trashed? })
 *   409 while another core job or a pack fill runs.
 *
 * E = { size, sha256, modifiedAt, origin: "official" | "modified" | "extra" } (src/retro/core-list.js).
 * Each systems[] entry carries coreState { id, core, state, reason?, message?, retryAt?, origin?, source?, built?,
 * crc32?, userVersion? } (src/retro/auto-cores.js coreStates), and `auto` is the upkeep's
 * { enabled, source, job, failures, last, hidden: [{ file, core, name, size, modifiedAt }] } (hidden: a user's
 * core left beside a taken place by a crash or a lost race, held for the admin). The GET only reads: it moves
 * and deletes nothing; the leftovers are cleared when the upkeep starts and around each POST action.
 * Automation tokens may read all of it and start the install and the update (they write only the server's
 * own files), but not official or user-version, which move a user's core to or from the trash
 * (admin-page.js TOKEN_BLOCKED_RE).
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
import * as coresOff from "../../retro/cores-off.js";
import { apiWord } from "./api-words.js";
import { autoCores } from "../../retro/auto-cores.js";
import { PackError } from "../../retro/pack-bundle.js";

let hashCache = null;

/**
 * The pack's cores and the upkeep's state of each console's core (auto-cores.js coreStates), read
 * the same way for this tab and for the requirements view (retro-art-api.js). Reads only.
 */
export async function coreStatesNow(catalog) {
  hashCache ??= new HashCache(hashStore(appDb(), "retro"));
  const list = await listCores(packDirOf(retroDir), hashCache, catalog.games, catalog.systems);
  const auto = await autoCores();
  return { list, auto, states: await auto.states(catalog, new Map(list.cores.map((c) => [c.core, c.sha256]))) };
}

export function mountRetroCoresApi(router, requireSession) {
  router.get("/api/retro-cores", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const catalog = await retroCatalog.current(retroDir);
      const { list, auto, states: all } = await coreStatesNow(catalog);
      const states = new Map(all.map((st) => [st.id, st]));
      const off = coresOff.off();
      res.json({ ...list, cores: list.cores.map((c) => (off.has(c.core) ? { ...c, off: true } : c)), systems: list.systems.map((sys) => ({ ...sys, coreState: states.get(sys.id) ?? null })), auto: { ...auto.status(), hidden: await auto.hidden() } });
    } catch (err) {
      debug.error("admin retro-cores: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  router.post("/api/retro-cores/enabled", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const { core, enabled } = req.body ?? {};
    if (typeof enabled !== "boolean" || !coresOff.setEnabled(core, enabled)) return res.status(400).json({ error: apiWord(req, "coreSwitch.bad") });
    debug.log("admin retro-cores: %s switched %s", core, enabled ? "on" : "off");
    res.json({ core, enabled });
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

  // The core upkeep's actions (src/retro/auto-cores.js). auto and update write only the server's own files;
  // official and user-version move a user's core to the retro trash and back, so tokens may not call them.
  const job = (name, run) => router.post(`/api/retro-cores/${name}`, async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const out = await run(await autoCores(), req.body ?? {});
      if (out?.done) {
        const { done: _done, ...shown } = out;
        return res.status(202).json(shown);
      }
      res.json(out);
    } catch (err) {
      if (err instanceof PackError && err.status < 500) return res.status(err.status).json({ error: err.message });
      debug.error("admin retro-cores: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  });
  const jobView = (j) => ({ started: true, kind: j.kind, cores: [...j.cores], startedAt: j.startedAt, done: j.done });
  job("auto", async (a) => a.check(await retroCatalog.current(retroDir), { force: true }));
  job("update", async (a) => jobView(a.update()));
  job("official", async (a, body) => jobView(a.useOfficial(body.core)));
  job("user-version", async (a, body) => a.useUserVersion(body.core, { hidden: typeof body.hidden === "string" ? body.hidden : null }));

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
