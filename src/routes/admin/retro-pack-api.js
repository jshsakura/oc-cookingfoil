/**
 * Fill the RetroArch pack in one go, for the admin page's retro tab (cores sub-tab):
 *
 *   GET  /admin/api/retro-pack         what the button would do, nothing downloaded:
 *                                      { version, bundle: { size, cached, remaining }, items: [{ kind, rel, name, size, state, ... }],
 *                                        dirs, kept, notInBundle, needsBundle, job, credit }
 *   POST /admin/api/retro-pack/fill    { confirm: true } starts it (202 { job }); 409 when one runs; 400 without confirm
 *
 * The order: the RetroArch body, the cores for consoles that have ROMs, info/assets/autoconfig, then the
 * covers and bezels of every console with ROMs (the same job as the art tab's "download what is missing").
 * Progress shows in the activity menu. Which files the server may replace is src/retro/pack-fill.js's rule.
 * The bundle address is the retroPackUrl setting (empty: the lock's official one).
 */
import path from "path";
import debug from "../../debug.js";
import { coreText } from "../../retro/core-messages.js";
import { requestLang } from "../../meta/langs.js";
import { dataDir, retroDir, retroPackUrl } from "../../helpers/envs.js";
import { packLedger } from "../../db/security-stores.js";
import * as retroCatalog from "../../retro/catalog.js";
import { applyFill, clearRecovery, describeFill, fillBusy, ledgerRoot, readRecovery } from "../../retro/pack-fill.js";
import { lock, PackError } from "../../retro/pack-bundle.js";
import { packDirOf } from "../../retro/pack-status.js";
import { BEZEL_CREDIT } from "../../retro/credits.js";
import * as activity from "../../tasks/activity.js";
import { startArtSync } from "./retro-art-api.js";

let last = null;
// Held from the moment a start request is accepted to the end of the covers step; set before any await.
let active = false; // { startedAt, step, finishedAt?, result?, art?, error? }

/** What the covers and bezels step reports, boiled down to counts. */
const artCounts = (summary = {}) => Object.values(summary).reduce((n, s) => ({ boxart: n.boxart + (s.boxart ?? 0), bezel: n.bezel + (s.bezel ?? 0), errors: n.errors + (s.errors ?? 0) + (s.error ? 1 : 0) }), { boxart: 0, bezel: 0, errors: 0 });

export function mountRetroPackApi(router, requireSession, { ledger = () => packLedger(), cacheRoot = () => path.join(dataDir, "retro-pack-cache"), fetchImpl } = {}) {
  router.get("/api/retro-pack", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const catalog = await retroCatalog.current(retroDir);
      const packDir = packDirOf(retroDir);
      const plan = await describeFill({ packDir, ledger: ledger().forRoot(await ledgerRoot(packDir)), games: catalog.games, systems: catalog.systems, cacheDir: path.join(cacheRoot(), lock.version) });
      res.json({ ...plan, job: last, busy: active, recovery: readRecovery(dataDir), credit: BEZEL_CREDIT });
    } catch (err) {
      debug.error("admin retro-pack: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // After someone has looked at the files the note lists, the note is deleted and filling is allowed again.
  router.post("/api/retro-pack/recovery/dismiss", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (req.body?.confirm !== true) return res.status(400).json({ error: "확인이 필요합니다" });
    clearRecovery(dataDir);
    res.json({ ok: true });
  });

  router.post("/api/retro-pack/fill", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (req.body?.confirm !== true) return res.status(400).json({ error: "확인이 필요합니다" });
    // Refused up front, so the page does not get a 202 for a run that stops at once.
    const pending = readRecovery(dataDir);
    if (pending) return res.status(409).json({ error: "지난번 채우기에서 되돌리지 못한 파일이 있습니다. 확인한 뒤 복구 기록을 지워야 다시 채웁니다", stuck: pending.stuck, recovery: pending });
    // Taken before the first await, so a second request in the same tick finds it held.
    if (active) return res.status(409).json({ error: "이미 채우고 있습니다", job: last });
    // The official core upkeep (auto-cores.js) holds the pack: say so now, not after a 202.
    if (fillBusy()) return res.status(409).json({ error: coreText(requestLang(req), "busyFill") });
    active = true;
    let act = null;
    let current = null;
    try {
      const catalog = await retroCatalog.current(retroDir);
      const packDir = packDirOf(retroDir);
      const store = ledger().forRoot(await ledgerRoot(packDir, { create: true }));
      current = last = { startedAt: Date.now(), step: "download" };
      act = activity.begin("retro-pack", { title: "RetroArch 팩을 채웁니다", total: 4 });
      res.status(202).json({ job: current });
      const result = await applyFill({
        packDir, dataDir, ledger: store, games: catalog.games, systems: catalog.systems, url: retroPackUrl, fetchImpl,
        onStep: (step, d) => {
          current.step = step;
          if (step === "download") act.step(0, d?.total ? `번들을 받는 중 ${Math.floor(((d.done ?? 0) / d.total) * 100)}%` : "번들을 받는 중");
          else act.step(step === "unpack" ? 1 : 2, step === "unpack" ? "필요한 파일을 푸는 중" : step === "check" ? "받은 파일을 확인하는 중" : "파일을 놓는 중");
        },
      });
      current.result = result;
      current.step = "art";
      act.step(3, "표지와 베젤을 받는 중");
      const started = await startArtSync(null);
      if (started.error) current.art = { skipped: started.error };
      else current.art = artCounts(await started.done.catch((err) => ({ x: { error: err.message } })));
      act.done(`설치 ${result.installed} · 교체 ${result.replaced} · 그대로 ${result.keptCount.operator + result.keptCount.modified}`);
    } catch (err) {
      const message = err instanceof PackError ? err.message : `처리하지 못했습니다: ${err.message}`;
      if (!current) return res.status(502).json({ error: message });
      current.error = message;
      if (err.stuck) current.stuck = err.stuck;
      debug.error("admin retro-pack: %s", err.message);
      act?.fail(err);
    } finally {
      if (current) current.finishedAt = Date.now();
      active = false;
      await retroCatalog.scan(retroDir).catch((err) => debug.error("retro: rescan after a pack fill failed: %s", err.message));
    }
  });
}
