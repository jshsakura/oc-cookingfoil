/**
 * What the server does about the RetroArch pack without being asked, within
 * the same ownership rule as the admin's "fill" button (pack-fill.js): a file
 * is touched only when the ledger says the server placed it and it still has
 * that hash. Two jobs, both off when the retroPackAuto setting is off:
 *
 *   autoAddCores  ROMs appeared for a console whose core is not in the pack:
 *                 install that core from the cached official bundle. Only
 *                 cores the lock lists and marks verified, only absent files,
 *                 and never into the slot of a core the operator sent to the
 *                 trash (restoring it must stay possible). It looks at whether
 *                 a file exists and at nothing else: this runs after every scan.
 *   autoUpdate    the lock moved to a newer version (a server update): replace
 *                 the server's own untouched files; report the rest as
 *                 "update available". Installs nothing new, never moves a file
 *                 back to an older lock, and runs once per lock version (a
 *                 note in the ledger says the pass finished).
 *
 * The bundle is 300 MB, so neither downloads it unless the retroPackAutoDownload
 * setting says so. Without it they answer "fill-needed" / "update-needed" and
 * the cores tab shows the state; the admin's button still does the download.
 *
 * Both return { state, ... } and never throw: a failure leaves the pack as it
 * was (applyFill rolls back) and is reported as state "failed" with `error`.
 * "blocked" is a run that is not started because the last one left a recovery note.
 */
import fsp from "fs/promises";
import path from "path";
import { sha256File } from "./pack-bundle.js";
import { applyFill, compareVersions, fillBusy, isMeta, readRecovery, REAL_PACK, UPDATE_MARK, wantedCores } from "./pack-fill.js";

const cachedBundle = async (dataDir, lock) => (await fsp.stat(path.join(dataDir, "retro-pack-cache", lock.version, lock.bundle.file)).catch(() => null))?.size === lock.bundle.size;

const failure = (err, extra = {}) => ({ state: "failed", error: err.message, ...(err.stuck ? { stuck: err.stuck } : {}), ...extra });

/** `settings` is { auto, download }; `trashed` the names of cores sitting in the retro trash. */
export async function autoAddCores({ packDir, dataDir, ledger, games, systems = {}, settings, url, fetchImpl, io, bin, pack = REAL_PACK, trashed = new Set() }) {
  if (!settings.auto) return { state: "off", cores: [], held: [] };
  if (fillBusy()) return { state: "busy", cores: [], held: [] };
  if (readRecovery(dataDir)) return { state: "blocked", cores: [], held: [] };
  let missing;
  const held = [];
  try {
    missing = [];
    for (const { core } of wantedCores(games, pack).have) {
      if (await fsp.lstat(path.join(packDir, "cores", `${core}_libretro_libnx.nro`)).catch(() => null)) continue;
      (trashed.has(core) ? held : missing).push(core);
    }
    if (!missing.length) return { state: "nothing", cores: [], held };
    if (!(await cachedBundle(dataDir, pack.lock)) && !settings.download) return { state: "fill-needed", cores: missing, held };
  } catch (err) {
    return failure(err, { cores: [], held });
  }
  try {
    const result = await applyFill({ packDir, dataDir, ledger, games, systems, url, fetchImpl, io, bin, pack, mode: "add-cores", skip: trashed });
    const skipped = new Set((result.kept ?? []).map((k) => k.rel));
    const cores = missing.filter((c) => !skipped.has(`cores/${c}_libretro_libnx.nro`));
    return { state: result.installed > 0 ? "installed" : "nothing", cores: result.installed > 0 ? cores : [], held, result };
  } catch (err) {
    return failure(err, { cores: missing, held });
  }
}

export async function autoUpdate({ packDir, dataDir, ledger, games, systems = {}, settings, url, fetchImpl, io, bin, pack = REAL_PACK }) {
  if (!settings.auto) return { state: "off", available: [] };
  if (fillBusy()) return { state: "busy", available: [] };
  if (readRecovery(dataDir)) return { state: "blocked", available: [] };
  try {
    const rows = ledger.all();
    if (rows.get(UPDATE_MARK)?.lockVersion === pack.lock.version) return { state: "nothing", available: [] };
    const behind = [...rows].filter(([rel, e]) => !isMeta(rel) && compareVersions(e.lockVersion, pack.lock.version) < 0);
    if (!behind.length) return { state: "nothing", available: [] };
    if (!(await cachedBundle(dataDir, pack.lock)) && !settings.download) {
      // Only what could be replaced counts: a file the operator changed since stays as it is.
      let files = 0;
      for (const [rel, e] of behind) if ((await sha256File(path.join(packDir, rel)).catch(() => null)) === e.sha256) files++;
      return { state: "update-needed", available: [], files };
    }
    const result = await applyFill({ packDir, dataDir, ledger, games, systems, url, fetchImpl, io, bin, pack, mode: "update" });
    return { state: result.replaced > 0 ? "updated" : "nothing", available: result.kept ?? [], result };
  } catch (err) {
    return failure(err, { available: [] });
  }
}
