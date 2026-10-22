/**
 * What the server does about the RetroArch pack without being asked, within
 * the same ownership rule as the admin's "fill" button (pack-fill.js): a file
 * is touched only when the ledger says the server placed it and it still has
 * that hash. Two jobs, both off when the retroPackAuto setting is off:
 *
 *   autoAddCores  ROMs appeared for a console whose core is not in the pack:
 *                 install that core from the cached official bundle. Only
 *                 cores the lock lists and marks verified, only absent files.
 *   autoUpdate    the lock moved to a newer version (a server update): replace
 *                 the server's own untouched files; report the rest as
 *                 "update available". Installs nothing new.
 *
 * The bundle is 300 MB, so neither downloads it unless the retroPackAutoDownload
 * setting says so. Without it they answer "fill-needed" / "update-needed" and
 * the cores tab shows the state; the admin's button still does the download.
 *
 * Both return { state, ... } and never throw: a failure leaves the pack as it
 * was (applyFill rolls back) and is reported as state "failed" with `error`.
 */
import fsp from "fs/promises";
import path from "path";
import { fillBusy, applyFill, describeFill, REAL_PACK } from "./pack-fill.js";

const cachedBundle = async (dataDir, lock) => (await fsp.stat(path.join(dataDir, "retro-pack-cache", lock.version, lock.bundle.file)).catch(() => null))?.size === lock.bundle.size;

const failure = (err, extra = {}) => ({ state: "failed", error: err.message, ...(err.stuck ? { stuck: err.stuck } : {}), ...extra });

/** `settings` is { auto, download }. */
export async function autoAddCores({ packDir, dataDir, ledger, games, systems = {}, settings, url, fetchImpl, io, bin, pack = REAL_PACK }) {
  if (!settings.auto) return { state: "off", cores: [] };
  if (fillBusy()) return { state: "busy", cores: [] };
  let missing;
  try {
    const plan = await describeFill({ packDir, ledger, games, systems, cacheDir: path.join(dataDir, "retro-pack-cache", pack.lock.version), pack });
    missing = plan.items.filter((i) => i.kind === "core" && i.state === "install").map((i) => i.name);
    if (!missing.length) return { state: "nothing", cores: [] };
    if (!plan.bundle.cached && !settings.download) return { state: "fill-needed", cores: missing };
  } catch (err) {
    return failure(err, { cores: [] });
  }
  try {
    const result = await applyFill({ packDir, dataDir, ledger, games, systems, url, fetchImpl, io, bin, pack, mode: "add-cores" });
    const skipped = new Set((result.kept ?? []).map((k) => k.rel));
    const cores = missing.filter((c) => !skipped.has(`cores/${c}_libretro_libnx.nro`));
    return { state: result.installed > 0 ? "installed" : "nothing", cores: result.installed > 0 ? cores : [], result };
  } catch (err) {
    return failure(err, { cores: missing });
  }
}

export async function autoUpdate({ packDir, dataDir, ledger, games, systems = {}, settings, url, fetchImpl, io, bin, pack = REAL_PACK }) {
  if (!settings.auto) return { state: "off", available: [] };
  if (fillBusy()) return { state: "busy", available: [] };
  try {
    const behind = [...ledger.all()].filter(([, e]) => e.lockVersion !== pack.lock.version);
    if (!behind.length) return { state: "nothing", available: [] };
    if (!(await cachedBundle(dataDir, pack.lock)) && !settings.download) return { state: "update-needed", available: [], files: behind.length };
    const result = await applyFill({ packDir, dataDir, ledger, games, systems, url, fetchImpl, io, bin, pack, mode: "update" });
    return { state: result.replaced > 0 ? "updated" : "nothing", available: result.kept ?? [], result };
  } catch (err) {
    return failure(err, { available: [] });
  }
}
