/**
 * data/plugin-cache/<id>: the files a plugin keeps between runs (downloaded pictures, pages it fetched).
 * The core bounds it so a plugin cannot fill the disk: each plugin gets CAP_BYTES, and the oldest files
 * (by modification time) go first when it is over.
 *
 *   createPluginCache({ dataDir, capBytes? }) -> { dirOf, usage, usageOf, sweep, sweepAll, clear, startSweeper }
 */
import fsp from "node:fs/promises";
import path from "node:path";

export const CAP_BYTES = 256 * 1024 * 1024;
export const SWEEP_EVERY_MS = 10 * 60_000;
// A sweep brings a plugin under this share of its cap, so the next write does not need another sweep.
const TARGET_SHARE = 0.9;

async function filesUnder(dir) {
  const out = [];
  let names;
  try { names = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of names) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await filesUnder(p));
    else if (e.isFile()) {
      const st = await fsp.stat(p).catch(() => null);
      if (st) out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

export function createPluginCache({ dataDir, capBytes = CAP_BYTES, log = () => {} }) {
  const root = path.join(dataDir, "plugin-cache");
  const dirOf = (id) => path.join(root, id);

  async function usageOf(id) {
    const files = await filesUnder(dirOf(id));
    return { bytes: files.reduce((n, f) => n + f.size, 0), files: files.length, capBytes };
  }

  async function usage() {
    let ids;
    try { ids = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return {}; }
    return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await usageOf(id)])));
  }

  /** Brings one plugin's cache under its cap, oldest files first. Returns { removed, freed }. */
  async function sweep(id) {
    const files = await filesUnder(dirOf(id));
    let total = files.reduce((n, f) => n + f.size, 0);
    if (total <= capBytes) return { removed: 0, freed: 0 };
    const goal = capBytes * TARGET_SHARE;
    let removed = 0;
    let freed = 0;
    for (const f of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= goal) break;
      await fsp.rm(f.path, { force: true });
      total -= f.size;
      freed += f.size;
      removed++;
    }
    log(`${id}: cache over ${capBytes} bytes, removed ${removed} files (${freed} bytes)`);
    return { removed, freed };
  }

  async function sweepAll() {
    const ids = Object.keys(await usage());
    for (const id of ids) await sweep(id).catch((err) => log(`${id}: cache sweep failed: ${err.message}`));
  }

  const clear = (id) => fsp.rm(dirOf(id), { recursive: true, force: true });

  function startSweeper(every = SWEEP_EVERY_MS) {
    const timer = setInterval(() => { sweepAll().catch(() => {}); }, every);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { dirOf, usage, usageOf, sweep, sweepAll, clear, startSweeper, capBytes };
}
