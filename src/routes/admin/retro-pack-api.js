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
import { ACTIVITY_LANG, coreError, coreErrorText, coreText, coreWord } from "../../retro/core-messages.js";
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

/** The job as the request reads it: a failure said in its language by its code. Pure. */
const jobFor = (job, lang) => (job?.code ? { ...job, error: coreErrorText(lang, job) } : job);

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
      res.json({ ...plan, job: jobFor(last, requestLang(req)), busy: active, recovery: readRecovery(dataDir), credit: BEZEL_CREDIT });
    } catch (err) {
      debug.error("admin retro-pack: %s", err.message);
      res.status(502).json(coreError(req, err));
    }
  });

  // After someone has looked at the files the note lists, the note is deleted and filling is allowed again.
  router.post("/api/retro-pack/recovery/dismiss", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (req.body?.confirm !== true) return res.status(400).json({ error: coreWord(req, "confirmNeeded"), code: "confirmNeeded" });
    clearRecovery(dataDir);
    res.json({ ok: true });
  });

  router.post("/api/retro-pack/fill", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (req.body?.confirm !== true) return res.status(400).json({ error: coreWord(req, "confirmNeeded"), code: "confirmNeeded" });
    // Refused up front, so the page does not get a 202 for a run that stops at once.
    const pending = readRecovery(dataDir);
    if (pending) return res.status(409).json({ error: coreWord(req, "fillStuck"), code: "fillStuck", stuck: pending.stuck, recovery: pending });
    // Taken before the first await, so a second request in the same tick finds it held.
    if (active) return res.status(409).json({ error: coreWord(req, "fillRunning"), code: "fillRunning", job: jobFor(last, requestLang(req)) });
    // The official core upkeep (auto-cores.js) holds the pack: say so now, not after a 202.
    if (fillBusy()) return res.status(409).json({ error: coreWord(req, "busyFill"), code: "busyFill" });
    active = true;
    let act = null;
    let current = null;
    try {
      const catalog = await retroCatalog.current(retroDir);
      const packDir = packDirOf(retroDir);
      const store = ledger().forRoot(await ledgerRoot(packDir, { create: true }));
      current = last = { startedAt: Date.now(), step: "download" };
      act = activity.begin("retro-pack", { title: coreText(ACTIVITY_LANG, "fillTitle"), total: 4 });
      res.status(202).json({ job: current });
      const result = await applyFill({
        packDir, dataDir, ledger: store, games: catalog.games, systems: catalog.systems, url: retroPackUrl, fetchImpl,
        onStep: (step, d) => {
          current.step = step;
          if (step === "download") act.step(0, d?.total ? coreText(ACTIVITY_LANG, "stepDownloadPct", { pct: Math.floor(((d.done ?? 0) / d.total) * 100) }) : coreText(ACTIVITY_LANG, "stepDownload"));
          else act.step(step === "unpack" ? 1 : 2, coreText(ACTIVITY_LANG, step === "unpack" ? "stepUnpack" : step === "check" ? "stepCheck" : "stepPlace"));
        },
      });
      current.result = result;
      current.step = "art";
      act.step(3, coreText(ACTIVITY_LANG, "stepArt"));
      const started = await startArtSync(null);
      if (started.error) current.art = { skipped: started.error };
      else current.art = artCounts(await started.done.catch((err) => ({ x: { error: err.message } })));
      act.done(coreText(ACTIVITY_LANG, "fillDone", { installed: result.installed, replaced: result.replaced, kept: result.keptCount.operator + result.keptCount.modified }));
    } catch (err) {
      // Kept in English with its code; the page reads it in its own language (jobFor).
      const fault = err instanceof PackError ? err : PackError.of("failedWhy", { why: err.message });
      if (!current) return res.status(502).json(coreError(req, fault));
      current.error = fault.message;
      if (fault.code) Object.assign(current, { code: fault.code, vars: fault.vars });
      if (err.stuck) current.stuck = err.stuck;
      debug.error("admin retro-pack: %s", err.message);
      act?.fail(coreErrorText(ACTIVITY_LANG, fault));
    } finally {
      if (current) current.finishedAt = Date.now();
      active = false;
      await retroCatalog.scan(retroDir).catch((err) => debug.error("retro: rescan after a pack fill failed: %s", err.message));
    }
  });
}
