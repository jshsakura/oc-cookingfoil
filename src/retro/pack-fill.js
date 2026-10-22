/**
 * Fills the RetroArch pack from the official bundle the lock pins: the
 * RetroArch body, the cores the server's games name, and the info, assets and
 * autoconfig folders.
 *
 * Whose file is it? The ledger (db/security-stores.js packLedger) lists what the
 * server placed, with the hash it had then. A file is replaced only when the
 * ledger has it AND it still has that hash. So these are never touched:
 *
 *   - a file the ledger does not know (the operator put it there, including a core that
 *     is the same bytes as the official one, and the cores a Korean patch changed)
 *   - a file whose hash differs from the ledger (the operator changed it)
 *   - retroarch.cfg, config/ and system/ (BIOS): nothing in the lock reaches them
 *   - anything the bundle does not have (stella, OpenBOR, ...)
 *
 * Those are reported ("update available"), not changed. Running it again changes nothing.
 *
 * Applying: unpack into a staging folder, check every file, then copy each one beside its
 * destination and rename it into place. A file that is replaced is first kept in
 * <data>/retro-pack-prev/<its version>/. A step that fails puts everything back and the ledger
 * is not written, so the pack is as it was.
 */
import fsp from "fs/promises";
import path from "path";
import realOfficial from "./data/official-cores-1.22.2.js";
import { downloadBundle, extractPaths, lock as realLock, PackError, sha256File } from "./pack-bundle.js";

/** The lock and the official core table the fill works from; tests pass a small pair of their own. */
export const REAL_PACK = Object.freeze({ lock: realLock, official: realOfficial });

const NRO_MAGIC_AT = 0x10;

let running = false;
export const fillBusy = () => running;

/** Whether `rel` (relative to the pack folder) is something the server must never write. Pure. */
export const isProtected = (rel) => rel === "retroarch.cfg" || rel.startsWith("system/") || rel.startsWith("config/") || rel.split("/").includes("..");

/**
 * What to do with one file. `current` is the hash of what is on disk (null when absent), `entry` the
 * ledger row or undefined, `next` the hash the bundle has. Pure.
 *
 *   install   absent: place it
 *   replace   the server's own, untouched, and the bundle has a newer one
 *   current   already the bundle's bytes
 *   operator  not placed by the server and different: kept, "update available"
 *   modified  placed by the server but changed since: kept
 */
export function decide({ current, entry, next }) {
  if (current === null) return "install";
  if (!entry) return current === next ? "current" : "operator";
  if (current !== entry.sha256) return current === next ? "current" : "modified";
  return current === next ? "current" : "replace";
}

const coreRel = (core) => `cores/${core}_libretro_libnx.nro`;

/** The cores `games` ask for that the official bundle has (verified), and those it does not have. Pure. */
export function wantedCores(games, { lock, official } = REAL_PACK) {
  const used = new Map();
  for (const g of games) if (g.core) used.set(g.core, [...(used.get(g.core) ?? []), g]);
  const have = [];
  const lacking = [];
  for (const [core, list] of [...used].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const known = lock.paths.cores.verified && official.files[`${core}_libretro_libnx.nro`];
    (known ? have : lacking).push({ core, games: list.length, systems: [...new Set(list.map((g) => g.system))] });
  }
  return { have, lacking };
}

const hashOrNull = async (abs) => ((await fsp.stat(abs).catch(() => null))?.isFile() ? sha256File(abs) : null);

/**
 * What the one-go button would do, without downloading anything: the body and each wanted core with its
 * state, the folders, what is kept as the operator's, and how many bytes are still to download.
 */
export async function describeFill({ packDir, ledger, games, systems, cacheDir, pack = REAL_PACK }) {
  const { lock, official: officialCores } = pack;
  const entries = ledger.all();
  const body = lock.paths.body;
  const item = async (kind, rel, name, size, next, extra = {}) => ({ kind, rel, name, size, state: decide({ current: await hashOrNull(path.join(packDir, rel)), entry: entries.get(rel), next }), ...extra });
  const { have, lacking } = wantedCores(games, pack);
  const items = [await item("body", body.to, "RetroArch", body.size, body.sha256)];
  for (const c of have) {
    const [sha256, size] = officialCores.files[`${c.core}_libretro_libnx.nro`];
    items.push(await item("core", coreRel(c.core), c.core, size, sha256, { games: c.games, systems: c.systems.map((id) => ({ id, name: systems[id]?.names?.ko ?? id })) }));
  }
  const dirs = [];
  for (const d of lock.paths.dirs) dirs.push({ rel: d.to, exists: Boolean(await fsp.stat(path.join(packDir, d.to)).catch(() => null)) });
  const cached = (await fsp.stat(path.join(cacheDir, lock.bundle.file)).catch(() => null))?.size ?? 0;
  const changes = items.filter((i) => i.state === "install" || i.state === "replace");
  return {
    version: lock.version,
    bundle: { size: lock.bundle.size, cached: cached === lock.bundle.size, remaining: cached === lock.bundle.size ? 0 : lock.bundle.size - cached },
    items,
    dirs,
    kept: items.filter((i) => i.state === "operator" || i.state === "modified").map((i) => ({ rel: i.rel, state: i.state })),
    notInBundle: lacking,
    needsBundle: changes.length > 0 || dirs.some((d) => !d.exists),
  };
}

async function walkFiles(root, rel = "", out = []) {
  for (const e of await fsp.readdir(path.join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new PackError(`번들에 심볼릭 링크가 있습니다: ${child}`, { status: 500 });
    if (e.isDirectory()) await walkFiles(root, child, out);
    else if (e.isFile()) out.push(child);
  }
  return out;
}

async function isNro(abs) {
  const fh = await fsp.open(abs, "r");
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, NRO_MAGIC_AT);
    return bytesRead === 4 && buf.toString("latin1") === "NRO0";
  } finally {
    await fh.close();
  }
}

/** Everything unpacked, as [{ rel (in the pack), abs, sha256, source }], after checking it against the lock. */
async function stagedFiles(staging, cores, { lock, official: officialCores }) {
  const out = [];
  const body = lock.paths.body;
  const bodyAbs = path.join(staging, body.from);
  const bodySha = await sha256File(bodyAbs);
  if (bodySha !== body.sha256 || !(await isNro(bodyAbs))) throw new PackError("번들의 RetroArch 본체가 lock 과 다릅니다. 설치하지 않습니다", { status: 502 });
  out.push({ rel: body.to, abs: bodyAbs, sha256: bodySha, source: "bundle", kind: "body" });
  for (const core of cores) {
    const abs = path.join(staging, lock.paths.cores.from, `${core}_libretro_libnx.nro`);
    const [want, size] = officialCores.files[`${core}_libretro_libnx.nro`];
    const sha256 = await sha256File(abs);
    if (sha256 !== want || (await fsp.stat(abs)).size !== size || !(await isNro(abs))) throw new PackError(`번들의 ${core} 코어가 공식 목록과 다릅니다. 설치하지 않습니다`, { status: 502 });
    out.push({ rel: coreRel(core), abs, sha256, source: "bundle", kind: "core" });
  }
  for (const d of lock.paths.dirs) {
    for (const f of await walkFiles(path.join(staging, d.from))) {
      const abs = path.join(staging, d.from, f);
      out.push({ rel: `${d.to}/${f}`, abs, sha256: await sha256File(abs), source: "bundle", kind: "dir" });
    }
  }
  return out;
}

const realIo = {
  copyFile: (a, b) => fsp.copyFile(a, b),
  rename: (a, b) => fsp.rename(a, b),
  rm: (a) => fsp.rm(a, { force: true }),
  mkdir: (d) => fsp.mkdir(d, { recursive: true }),
};

/**
 * Puts the `ops` ({ rel, abs, action, keep }) in place. Each is copied next to its destination and renamed;
 * a replaced file is first copied to `keep`. On any failure everything done so far is undone and the error
 * is thrown with `rolledBack` (or `stuck`, listing what could not be undone). Returns { count, undo() },
 * `undo` being the same rollback for a step that fails afterwards.
 */
export async function commit(ops, { packDir, io = realIo }) {
  const done = [];
  const part = (dest) => `${dest}.cfpart`;
  const rollback = async (failing = null) => {
    const stuck = [];
    for (const d of done.reverse()) {
      try {
        await io.rm(part(d.dest));
        if (d.op.action === "replace") {
          await io.copyFile(d.op.keep, part(d.dest));
          await io.rename(part(d.dest), d.dest);
        } else await io.rm(d.dest);
      } catch {
        stuck.push(d.op.rel);
      }
    }
    if (failing) await io.rm(part(failing)).catch(() => {});
    return stuck;
  };
  let current = null;
  try {
    for (const op of ops) {
      const dest = path.join(packDir, op.rel);
      current = dest;
      await io.mkdir(path.dirname(dest));
      if (op.action === "replace") {
        await io.mkdir(path.dirname(op.keep));
        await io.copyFile(dest, op.keep);
      }
      done.push({ op, dest });
      await io.copyFile(op.abs, part(dest));
      await io.rename(part(dest), dest);
    }
  } catch (err) {
    const stuck = await rollback(current);
    throw new PackError(`설치하다 멈춰 되돌렸습니다: ${err.message}`, { status: 500, ...(stuck.length ? { stuck } : { rolledBack: true }) });
  }
  return { count: done.length, undo: async () => (await rollback()).length };
}

/**
 * Downloads (when needed), unpacks and places the body, the wanted cores and the folders.
 * Returns { version, installed, replaced, current, kept: [{ rel, state }], keptCount, prevDir }.
 * `onStep(name, detail)` reports "download" (with { done, total }), "unpack", "check", "place".
 */
export async function applyFill({ packDir, dataDir, ledger, games, systems = {}, url, onStep = () => {}, fetchImpl, io, bin, pack = REAL_PACK }) {
  const { lock } = pack;
  if (running) throw new PackError("이미 채우고 있습니다", { status: 409 });
  running = true;
  const cacheRoot = path.join(dataDir, "retro-pack-cache");
  const staging = path.join(dataDir, "retro-pack-staging", `${lock.version}-${process.pid}-${Date.now()}`);
  try {
    const { have } = wantedCores(games, pack);
    const cores = have.map((c) => c.core);
    // Nothing to place and no bundle on disk: do not fetch 300 MB to learn that.
    const plan = await describeFill({ packDir, ledger, games, systems, cacheDir: path.join(cacheRoot, lock.version), pack });
    if (!plan.needsBundle && !plan.bundle.cached) return { version: lock.version, installed: 0, replaced: 0, current: plan.items.length, kept: plan.kept, keptCount: { operator: plan.kept.filter((k) => k.state === "operator").length, modified: plan.kept.filter((k) => k.state === "modified").length }, skipped: true };
    onStep("download", { done: 0, total: lock.bundle.size });
    const { file } = await downloadBundle({ url: url || lock.bundle.url, file: lock.bundle.file, size: lock.bundle.size, sha256: lock.bundle.sha256, cacheDir: path.join(cacheRoot, lock.version), fetchImpl, onProgress: (p) => onStep("download", p) });
    onStep("unpack");
    await extractPaths(file, staging, [lock.paths.body.from, ...cores.map((c) => `${lock.paths.cores.from}/${c}_libretro_libnx.nro`), ...lock.paths.dirs.map((d) => d.from)], { bin });
    onStep("check");
    const staged = await stagedFiles(staging, cores, pack);
    const entries = ledger.all();
    const ops = [];
    const tally = { current: 0 };
    const kept = [];
    const keptCount = { operator: 0, modified: 0 };
    const refresh = [];
    for (const f of staged) {
      if (isProtected(f.rel)) throw new PackError(`${f.rel} 는 서버가 쓰지 않는 파일입니다`, { status: 500 });
      const entry = entries.get(f.rel);
      const state = decide({ current: await hashOrNull(path.join(packDir, f.rel)), entry, next: f.sha256 });
      if (state === "install" || state === "replace") ops.push({ ...f, action: state, prevVersion: entry?.lockVersion ?? "unknown" });
      else if (state === "current") {
        tally.current++;
        // Its bytes are the bundle's, so a ledger row only moves to this version.
        if (entry && entry.sha256 === f.sha256 && entry.lockVersion !== lock.version) refresh.push(f);
      } else {
        keptCount[state]++;
        if (f.kind !== "dir") kept.push({ rel: f.rel, state });
      }
    }
    onStep("place", { files: ops.length });
    // A replaced file is kept in prev/<the version it came from>/.
    for (const o of ops) if (o.action === "replace") o.keep = path.join(dataDir, "retro-pack-prev", o.prevVersion, o.rel);
    const placed = await commit(ops, { packDir, io });
    try {
      ledger.put([...ops, ...refresh].map((f) => ({ rel: f.rel, sha256: f.sha256, source: f.source, lockVersion: lock.version })));
    } catch (err) {
      await placed.undo();
      throw new PackError(`장부에 쓰지 못해 되돌렸습니다: ${err.message}`, { status: 500, rolledBack: true });
    }
    await pruneOldCaches(cacheRoot, lock.version);
    return { version: lock.version, installed: ops.filter((o) => o.action === "install").length, replaced: ops.filter((o) => o.action === "replace").length, current: tally.current, kept, keptCount };
  } finally {
    running = false;
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/** Older bundle downloads are dropped once the current version is installed. */
async function pruneOldCaches(cacheRoot, keep) {
  for (const e of await fsp.readdir(cacheRoot, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && e.name !== keep) await fsp.rm(path.join(cacheRoot, e.name), { recursive: true, force: true }).catch(() => {});
  }
}
