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
 *   - a core the server took from a nightly build (ledger source "nightly", auto-cores.js): the fill
 *     never puts the stable build back over it
 *
 * Those are reported ("update available"), not changed. Running it again changes nothing.
 *
 * Applying: unpack into a staging folder, check every file, then copy each one beside its
 * destination and rename it into place. A file that is replaced is first kept in
 * <data>/retro-pack-prev/<its version>/. A step that fails puts everything back and the ledger
 * is not written, so the pack is as it was. Once a run is verified and written down the downloaded
 * bundle is deleted: the server keeps the unpacked files, not the 300 MB archive.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import realOfficial from "./data/official-cores-1.22.2.js";
import zlib from "zlib";
import { downloadBundle, extractPaths, lock as realLock, PackError, sha256File } from "./pack-bundle.js";

const realManifest = JSON.parse(fs.readFileSync(new URL("./data/retro-pack.files.json", import.meta.url), "utf8"));

/** The lock and the official core table the fill works from; tests pass a small pair of their own. */
export const REAL_PACK = Object.freeze({ lock: realLock, official: realOfficial, manifest: realManifest });

const NRO_MAGIC_AT = 0x10;

let running = false;
export const fillBusy = () => running;

/** Holds the pack for another writer (auto-cores.js): a release function, or null when a fill runs. */
export function claimFill() {
  if (running) return null;
  running = true;
  let held = true;
  return () => {
    if (held) running = false;
    held = false;
  };
}

/** SHA-256 and CRC-32 (8 hex, as the libretro nightly index writes it) of a file, in one read. */
export async function digestFile(abs) {
  const hash = crypto.createHash("sha256");
  let crc = 0;
  for await (const chunk of fs.createReadStream(abs)) {
    hash.update(chunk);
    crc = zlib.crc32(chunk, crc);
  }
  return { sha256: hash.digest("hex"), crc32: (crc >>> 0).toString(16).padStart(8, "0") };
}

/** Every official stable build's core hash the server knows. Pure. */
export const knownOfficial = ({ official }) => new Set(Object.values(official.files).map(([sha]) => sha));

/**
 * Whose a file is, by hash: the server's when its hash is the one the ledger wrote, or, with no row,
 * when it is the bytes of an official stable build. Anything else is the user's. Pure.
 */
export const serverOwns = (current, entry, known) => (entry ? current === entry.sha256 : known.has(current));

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
  const item = async (kind, rel, name, size, next, extra = {}) => ({ kind, rel, name, size, sha256: next, state: decide({ current: await hashOrNull(path.join(packDir, rel)), entry: entries.get(rel), next }), ...extra });
  const { have, lacking } = wantedCores(games, pack);
  const items = [await item("body", body.to, "RetroArch", body.size, body.sha256)];
  for (const c of have) {
    const [sha256, size] = officialCores.files[`${c.core}_libretro_libnx.nro`];
    items.push(await item("core", coreRel(c.core), c.core, size, sha256, { games: c.games, systems: c.systems.map((id) => ({ id, name: systems[id]?.names?.ko ?? id })) }));
  }
  const dirs = [];
  const missing = {};
  for (const d of lock.paths.dirs) {
    dirs.push({ rel: d.to, exists: Boolean(await fsp.lstat(path.join(packDir, d.to)).catch(() => null)) });
    // The files the bundle has in this folder and the pack does not: a folder that exists can still lack some.
    missing[d.to] = 0;
    for (const f of pack.manifest?.dirs?.[d.to] ?? []) if (!(await fsp.lstat(path.join(packDir, d.to, f)).catch(() => null))) missing[d.to]++;
  }
  const cached = (await fsp.stat(path.join(cacheDir, lock.bundle.file)).catch(() => null))?.size ?? 0;
  const changes = items.filter((i) => i.state === "install" || i.state === "replace");
  return {
    version: lock.version,
    bundle: { size: lock.bundle.size, cached: cached === lock.bundle.size, remaining: cached === lock.bundle.size ? 0 : lock.bundle.size - cached },
    items,
    dirs,
    missing,
    kept: items.filter((i) => i.state === "operator" || i.state === "modified").map((i) => ({ rel: i.rel, state: i.state })),
    notInBundle: lacking,
    needsBundle: changes.length > 0 || dirs.some((d) => !d.exists) || Object.values(missing).some((n) => n > 0),
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

/** Throws unless `abs` is a regular file and not a link. */
async function plainFile(abs) {
  const st = await fsp.lstat(abs);
  if (!st.isFile()) throw new PackError(`번들의 ${path.basename(abs)} 가 일반 파일이 아닙니다`, { status: 500 });
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
  await plainFile(bodyAbs);
  const bodyDigest = await digestFile(bodyAbs);
  if (bodyDigest.sha256 !== body.sha256 || !(await isNro(bodyAbs))) throw new PackError("번들의 RetroArch 본체가 lock 과 다릅니다. 설치하지 않습니다", { status: 502 });
  out.push({ rel: body.to, abs: bodyAbs, ...bodyDigest, source: "bundle", kind: "body" });
  for (const core of cores) {
    const abs = path.join(staging, lock.paths.cores.from, `${core}_libretro_libnx.nro`);
    await plainFile(abs);
    const [want, size] = officialCores.files[`${core}_libretro_libnx.nro`];
    const { sha256, crc32 } = await digestFile(abs);
    if (sha256 !== want || (await fsp.stat(abs)).size !== size || !(await isNro(abs))) throw new PackError(`번들의 ${core} 코어가 공식 목록과 다릅니다. 설치하지 않습니다`, { status: 502 });
    out.push({ rel: coreRel(core), abs, sha256, crc32, source: "bundle", kind: "core" });
  }
  for (const d of lock.paths.dirs) {
    for (const f of await walkFiles(path.join(staging, d.from))) {
      const abs = path.join(staging, d.from, f);
      out.push({ rel: `${d.to}/${f}`, abs, ...(await digestFile(abs)), source: "bundle", kind: "dir" });
    }
  }
  return out;
}

export const REAL_IO = Object.freeze({
  // Creates `dst` and fails when anything, a link included, is already there.
  copyExcl: (src, dst) => fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL),
  // Names `dst` for `src` and fails when `dst` exists: the one step that cannot overwrite.
  link: (src, dst) => fsp.link(src, dst),
  rename: (a, b) => fsp.rename(a, b),
  rm: (a) => fsp.rm(a, { force: true }),
  mkdir: (d) => fsp.mkdir(d, { recursive: true }),
  lstat: (p) => fsp.lstat(p).catch(() => null),
});

const NO_LINK = new Set(["EPERM", "ENOSYS", "EXDEV", "ENOTSUP", "EOPNOTSUPP", "EMLINK"]);
const tempName = (dest) => `${dest}.${crypto.randomBytes(6).toString("hex")}.cfpart`;

/** Throws when `abs` or any folder between `root` and it is a link, or when it is outside `root`. */
async function assertNoLinks(root, abs, io) {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new PackError(`${abs} 는 팩 폴더 밖입니다`, { status: 500 });
  let cur = root;
  for (const part of rel.split(path.sep)) {
    cur = path.join(cur, part);
    const st = await io.lstat(cur);
    if (!st) return;
    if (st.isSymbolicLink()) throw new PackError(`${path.relative(root, cur)} 가 링크라 쓰지 않습니다`, { status: 500 });
  }
}

/**
 * Puts the `ops` ({ rel, abs, sha256, action, expect?, keep? }) in place under `packDir` (its real path):
 *
 *   - the target and every folder above it must not be a link, and `keepRoot` (where replaced files are
 *     kept) is held to the same rule
 *   - an `install` never overwrites: the file is made under a unique temporary name (exclusively) and
 *     linked to its name, which fails if something appeared there since the decision; that op is then
 *     skipped and reported as the operator's
 *   - a `replace` is done only if the file still has the hash the ledger holds (`expect`), checked on the copy
 *     kept in `keep` and again right before the rename; otherwise it is skipped as changed
 *
 * On a failure what this run placed is undone (a file someone else has since changed is left alone) and
 * the error is thrown with `rolledBack`, or with `stuck` (the files that could not be put back) and no
 * `rolledBack`. Returns { done, skipped: [{ rel, state }], undo() } where `undo` is the same rollback for
 * a step that fails afterwards; it returns the rels it could not restore.
 */
export async function commit(ops, { packDir, keepRoot = null, io = REAL_IO }) {
  const done = [];
  const skipped = [];
  const temps = new Set();
  const hashOf = async (abs) => ((await io.lstat(abs))?.isFile() ? sha256File(abs) : null);
  const rollback = async () => {
    const stuck = [];
    for (const d of done.reverse()) {
      try {
        // Only what this run placed: if the file is not ours any more, leave it.
        if ((await hashOf(d.dest)) !== d.op.sha256 && (await io.lstat(d.dest))) continue;
        if (d.op.action === "replace") {
          const tmp = tempName(d.dest);
          temps.add(tmp);
          await io.copyExcl(d.op.keep, tmp);
          await io.rename(tmp, d.dest);
        } else await io.rm(d.dest);
      } catch {
        stuck.push(d.op.rel);
      }
    }
    for (const t of temps) await io.rm(t).catch(() => {});
    return stuck;
  };
  try {
    for (const op of ops) {
      const dest = path.join(packDir, op.rel);
      await assertNoLinks(packDir, dest, io);
      await io.mkdir(path.dirname(dest));
      await assertNoLinks(packDir, dest, io);
      const cur = await io.lstat(dest);
      if (op.action === "install" ? cur : !cur?.isFile() || (await hashOf(dest)) !== op.expect) {
        skipped.push({ rel: op.rel, state: op.action === "install" ? "operator" : "modified" });
        continue;
      }
      if (op.action === "replace") {
        await assertNoLinks(keepRoot, op.keep, io);
        await io.mkdir(path.dirname(op.keep));
        await assertNoLinks(keepRoot, op.keep, io);
        await io.rm(op.keep);
        await io.copyExcl(dest, op.keep);
        if ((await hashOf(op.keep)) !== op.expect) {
          await io.rm(op.keep);
          skipped.push({ rel: op.rel, state: "modified" });
          continue;
        }
      }
      const tmp = tempName(dest);
      temps.add(tmp);
      await io.copyExcl(op.abs, tmp);
      let placed = false;
      if (op.action === "install") {
        try {
          await io.link(tmp, dest);
          placed = true;
        } catch (err) {
          if (err.code === "EEXIST") skipped.push({ rel: op.rel, state: "operator" });
          else if (!NO_LINK.has(err.code)) throw err;
          else if (!(await io.lstat(dest))) {
            // No hard links on this filesystem: the check and the rename are two steps, the best that can be done.
            await io.rename(tmp, dest);
            placed = true;
          } else skipped.push({ rel: op.rel, state: "operator" });
        }
        await io.rm(tmp);
      } else if ((await hashOf(dest)) === op.expect) {
        await io.rename(tmp, dest);
        placed = true;
      } else {
        await io.rm(tmp);
        skipped.push({ rel: op.rel, state: "modified" });
      }
      temps.delete(tmp);
      if (placed) done.push({ op, dest });
    }
  } catch (err) {
    const stuck = await rollback();
    throw new PackError(`설치하다 멈췄습니다: ${err.message}`, { status: 500, ...(stuck.length ? { stuck } : { rolledBack: true }) });
  }
  return { done, skipped, undo: rollback };
}

/**
 * The ledger key of a pack folder: its real path. A folder that moved, or another one, has no rows
 * of its own, so its files are the operator's until the server has placed them there.
 */
export async function ledgerRoot(packDir, { create = false } = {}) {
  if (create) await fsp.mkdir(packDir, { recursive: true });
  return fsp.realpath(packDir).catch(() => path.resolve(packDir));
}

const recoveryFile = (dataDir) => path.join(dataDir, "retro-pack-recovery.json");

/** The note a run leaves when it could not put everything back, or null. */
export function readRecovery(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(recoveryFile(dataDir), "utf8"));
  } catch {
    return null;
  }
}

/** Forgets the recovery note, once the listed files have been looked at. */
export const clearRecovery = (dataDir) => fs.rmSync(recoveryFile(dataDir), { force: true });

/**
 * Downloads (when needed), unpacks and places the body, the wanted cores and the folders.
 * Returns { version, installed, replaced, current, kept: [{ rel, state }], keptCount, prevDir }.
 * `onStep(name, detail)` reports "download" (with { done, total }), "unpack", "check", "place".
 */
export async function applyFill({ packDir, dataDir, ledger, games, systems = {}, url, onStep = () => {}, fetchImpl, io, bin, pack = REAL_PACK }) {
  const { lock } = pack;
  if (running) throw new PackError("이미 채우고 있습니다", { status: 409 });
  const pending = readRecovery(dataDir);
  if (pending) throw new PackError("지난번 채우기에서 되돌리지 못한 파일이 있습니다. 확인한 뒤 복구 기록을 지워야 다시 채웁니다", { status: 409, stuck: pending.stuck });
  running = true;
  const cacheRoot = path.join(dataDir, "retro-pack-cache");
  const staging = path.join(dataDir, "retro-pack-staging", `${lock.version}-${process.pid}-${Date.now()}`);
  try {
    // The pack folder as it really is: every target is checked against this, not against a path with links in it.
    await fsp.mkdir(packDir, { recursive: true });
    const root = await fsp.realpath(packDir);
    // What a hard kill left behind in staging is of no use to anyone.
    await fsp.rm(path.join(dataDir, "retro-pack-staging"), { recursive: true, force: true });
    const keepRoot = path.join(await fsp.realpath(dataDir), "retro-pack-prev");
    if ((await fsp.lstat(keepRoot).catch(() => null))?.isSymbolicLink()) throw new PackError("retro-pack-prev 가 링크라 쓰지 않습니다", { status: 500 });
    await fsp.mkdir(keepRoot, { recursive: true });
    const { have } = wantedCores(games, pack);
    const cores = have.map((c) => c.core);
    // Nothing to place and no bundle on disk: do not fetch 300 MB to learn that.
    const plan = await describeFill({ packDir: root, ledger, games, systems, cacheDir: path.join(cacheRoot, lock.version), pack });
    if (!plan.needsBundle && !plan.bundle.cached) {
      // The body and cores are the lock's bytes already: a row left behind (a run cut off before the ledger
      // was written) moves to this version without the bundle, which is not kept after a fill.
      const entries = ledger.all();
      const behind = plan.items.filter((i) => i.state === "current" && entries.get(i.rel) && entries.get(i.rel).source !== "nightly" && (entries.get(i.rel).sha256 !== i.sha256 || entries.get(i.rel).lockVersion !== lock.version));
      const rows = [];
      for (const i of behind) rows.push({ rel: i.rel, sha256: i.sha256, source: entries.get(i.rel).source, lockVersion: lock.version, crc32: (await digestFile(path.join(root, i.rel))).crc32 });
      if (rows.length) ledger.put(rows);
      return { version: lock.version, installed: 0, replaced: 0, current: plan.items.length, kept: plan.kept, keptCount: { operator: plan.kept.filter((k) => k.state === "operator").length, modified: plan.kept.filter((k) => k.state === "modified").length }, skipped: true };
    }
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
      const cur = await hashOrNull(path.join(root, f.rel));
      // A nightly core stays as it is: the admin's update action keeps it current.
      const state = entry?.source === "nightly" && cur === entry.sha256 ? (cur === f.sha256 ? "current" : "operator") : decide({ current: cur, entry, next: f.sha256 });
      if (state === "install" || state === "replace") ops.push({ ...f, action: state, expect: entry?.sha256, prevVersion: entry?.lockVersion ?? "unknown" });
      else if (state === "current") {
        tally.current++;
        // Its bytes are the bundle's. A row for it that is behind (an older version, or a run that was cut off
        // before the ledger was written) moves to this version, or the file would look changed from then on.
        if (entry && entry.source !== "nightly" && (entry.sha256 !== f.sha256 || entry.lockVersion !== lock.version)) refresh.push(f);
      } else {
        keptCount[state]++;
        if (f.kind !== "dir") kept.push({ rel: f.rel, state });
      }
    }
    onStep("place", { files: ops.length });
    // A replaced file is kept in prev/<the version it came from>/.
    for (const o of ops) if (o.action === "replace") o.keep = path.join(keepRoot, o.prevVersion, o.rel);
    let placed;
    try {
      placed = await commit(ops, { packDir: root, keepRoot, io });
    } catch (err) {
      if (err.stuck?.length) throw leftBehind(dataDir, lock.version, err.stuck, err.message);
      throw err;
    }
    for (const k of placed.skipped) {
      keptCount[k.state]++;
      if (!kept.some((x) => x.rel === k.rel)) kept.push(k);
    }
    try {
      ledger.put([...placed.done.map((d) => d.op), ...refresh].map((f) => ({ rel: f.rel, sha256: f.sha256, source: f.source, lockVersion: lock.version, crc32: f.crc32 ?? null })));
    } catch (err) {
      const stuck = await placed.undo();
      if (stuck.length) throw leftBehind(dataDir, lock.version, stuck, `장부에 쓰지 못했고 되돌리지도 못했습니다: ${err.message}`, { ledgerBehind: true });
      throw new PackError(`장부에 쓰지 못해 되돌렸습니다: ${err.message}`, { status: 500, rolledBack: true });
    }
    // Verified and written down: the unpacked files are what the server keeps, not the bundle.
    await fsp.rm(cacheRoot, { recursive: true, force: true }).catch(() => {});
    return { version: lock.version, installed: placed.done.filter((d) => d.op.action === "install").length, replaced: placed.done.filter((d) => d.op.action === "replace").length, current: tally.current, kept, keptCount };
  } finally {
    running = false;
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/** Writes the recovery note and builds the error for a run that left files behind. */
function leftBehind(dataDir, version, stuck, message, extra = {}) {
  const note = { at: new Date().toISOString(), version, stuck, prev: path.join(dataDir, "retro-pack-prev"), ...extra };
  try {
    fs.writeFileSync(recoveryFile(dataDir), JSON.stringify(note, null, 2));
  } catch {
    // The error below carries the same list.
  }
  return new PackError(message, { status: 500, stuck, ...extra });
}
