/**
 * RetroArch cores the server gets by itself, one at a time from the libretro nightly buildbot
 * (nightly-cores.js), for the consoles that have games (retroAutoCores, on by default). Not a
 * mirror of every core: with one small download a core there is no reason to hold cores nobody
 * plays. The RetroArch frontend, info, assets and autoconfig still come from the pinned stable
 * bundle (pack-fill.js); a nightly core with a stable 1.22.2 frontend is not verified on a console.
 *
 * Whose a core is goes by hash (pack-fill.js serverOwns): the hash the ledger wrote, or with no
 * row the bytes of an official stable build. Every other core is the user's and is pinned: never
 * replaced, no "update available". A core in the retro trash is not fetched again either (someone
 * took it out). BIOS (system/), retroarch.cfg and config/ are never written.
 *
 *   check(cat)            after every catalog scan: the missing cores of the consoles with games, in
 *                         one job (the activity menu shows it). A scan while a job runs is looked at
 *                         once when it ends. A core that fails waits for its backoff (30 min, doubling
 *                         up to a day) unless the admin asks
 *   update()              the admin's "update installed cores": each core the server owns whose CRC-32
 *                         is not the index's is replaced in place (no copy of the old one is kept).
 *                         Forwarders keep their key: shortcuts are never made again by themselves
 *   useOfficial(core)     a pinned core goes to the retro trash and the nightly build takes its place
 *   useUserVersion(core)  the core from the trash comes back under its own name and the server's file
 *                         is deleted; refused, with the trash item left, when the name is taken
 *
 * A file is replaced or deleted only after it was moved aside (a rename in its folder) and the moved
 * bytes were hashed as the server's; anything else goes back. A user's file is never deleted.
 *
 * Every download asks first that the data disk (the zip and its unpacked .nro) and the disk the
 * cores are written to each keep the NSZ floor (nszDiskFloorGb) plus 1 GiB free; the ledger gets
 * sha256, crc32, the nightly date (built) and source "nightly". Downloads have time limits
 * (nightly-cores.js TIMEOUTS).
 *
 * Per console state (coreStates), for the admin's core screen and the requirements view:
 *
 *   present         the server's core (source nightly or official, built, crc32)
 *   pinned          the user's own core: kept as it is
 *   installing      a job is fetching it now
 *   will-install    missing; the next check fetches it
 *   missing         missing and retroAutoCores is off
 *   held            missing and in the retro trash
 *   not-in-nightly  the nightly buildbot has no such core (looked again after a day)
 *   failed          missing and the last try failed (reason, message, retryAt)
 *
 * A present core with a user version in the trash carries userVersion: true, so the admin can switch back.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { PackError, sha256File } from "./pack-bundle.js";
import { claimFill, digestFile, knownOfficial, ledgerRoot, readRecovery, REAL_PACK, serverOwns } from "./pack-fill.js";
import { fetchCore, fetchIndex, INDEX_TIMEOUTS, NIGHTLY_BASE, nroName, TIMEOUTS } from "./nightly-cores.js";
import { toTrash } from "./core-files.js";
import { listTrash, restoreEntry } from "./trash.js";

const GIB = 1024 ** 3;
export const SPACE_SLACK = GIB;
export const BACKOFF_MS = Object.freeze([30 * 60_000, 60 * 60_000, 2 * 3600_000, 4 * 3600_000, 8 * 3600_000, 16 * 3600_000, 24 * 3600_000]);
const NOT_IN_NIGHTLY_MS = 24 * 3600_000;
export const STATE_FILE = "retro-auto-cores.json";
const NRO_MAGIC_AT = 0x10;

const coreRel = (core) => `cores/${nroName(core)}`;
const CORE_RE = /^[a-z0-9_]{1,64}$/;

/** Each console with games and the core it starts with, as [id, core]. Pure. */
export function systemsInUse(games, systems) {
  const ids = new Set(games.map((g) => g.system));
  return Object.entries(systems).filter(([id, s]) => ids.has(id) && s.core).map(([id, s]) => [id, s.core]);
}

/** How long to wait after the `attempts`-th failure in a row. Pure. */
export const backoffAfter = (attempts) => BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];

/**
 * The state of each console's core. Pure.
 *
 *   present   Map core → sha256 (null when not hashed) of the core files on disk
 *   entries   the ledger rows; held, Map core → trash entry of the cores in the retro trash
 *   job       { cores: Set } while one runs; failures, core → { reason, message, retryAt }
 */
export function coreStates({ games, systems, present, entries, held = new Map(), enabled, job = null, failures = {}, now = Date.now(), pack = REAL_PACK }) {
  const known = knownOfficial(pack);
  return systemsInUse(games, systems).map(([id, core]) => {
    const base = { id, core };
    const failure = failures[core];
    if (present.has(core)) {
      const sha = present.get(core);
      const entry = entries.get(coreRel(core));
      if (sha === null ? Boolean(entry) : serverOwns(sha, entry, known)) {
        return { ...base, state: "present", source: entry?.source ?? "official", built: entry?.built ?? null, crc32: entry?.crc32 ?? null, ...(held.has(core) ? { userVersion: true } : {}) };
      }
      return { ...base, state: "pinned", origin: pack.official.files[nroName(core)] ? "modified" : "extra" };
    }
    if (held.has(core)) return { ...base, state: "held", reason: "in-trash" };
    if (job?.cores.has(core)) return { ...base, state: "installing" };
    if (failure?.reason === "not-in-nightly" && now < failure.retryAt) return { ...base, state: "not-in-nightly", retryAt: failure.retryAt };
    if (failure && now < failure.retryAt) return { ...base, state: "failed", reason: failure.reason, message: failure.message, retryAt: failure.retryAt };
    if (!enabled) return { ...base, state: "missing", reason: "auto-off" };
    return { ...base, state: "will-install" };
  });
}

const failureReason = (err) => err.reason ?? (err.stuck ? "rollback" : /HTTP|fetch|ECONN|ENOTFOUND|ETIMEDOUT/i.test(err.message) ? "download" : "install");

async function statfsFree(dir) {
  const st = await fsp.statfs(dir);
  return Number(st.bavail) * Number(st.bsize);
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

/** The retro trash's cores, newest first, as Map core → entry. */
async function trashedCores(retroDir) {
  const out = new Map();
  for (const e of await listTrash(retroDir)) {
    const core = e.system === "core" ? String(e.name).match(/^([a-z0-9_]+)_libretro_libnx\.nro$/)?.[1] : null;
    if (core && !out.has(core)) out.set(core, e.entry);
  }
  return out;
}

/** A name beside `abs` in its folder, hidden from the pack listing (base-pack.js skips dot names). */
const besideName = (abs, kind) => path.join(path.dirname(abs), `.${path.basename(abs)}.${crypto.randomBytes(6).toString("hex")}.${kind}`);

/**
 * Puts a file moved aside back at `dest`, never over a file that got there since. When one did, the
 * aside file is deleted only if it is the server's (`owned`); a user's stays where it is.
 */
async function putBack(aside, dest, owned) {
  try {
    await fsp.link(aside, dest);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    if (!owned) {
      debug.error("retro: %s could not go back, a file got to %s first; it stays at %s", path.basename(dest), dest, aside);
      return;
    }
  }
  await fsp.rm(aside, { force: true });
}

const busy = () => new PackError("코어 작업이나 RetroArch 팩 채우기가 돌고 있습니다. 끝난 뒤 다시 합니다", { status: 409 });

/**
 * The upkeep for one pack folder. Every dependency is a function or value so tests run it on a temp folder:
 * packDir(), retroDir, dataDir, ledger() (packLedger), enabled(), base() (the nightly address),
 * floorBytes(), freeBytes(dir), hashCache (helpers/hash-cache.js), hashFile(abs) (a fresh read, for the
 * check before a swap), restore(dir, entry) (trash.js restoreEntry), timeouts { core, index } (nightly-cores.js),
 * activity (tasks/activity.js or null), onCoreChanged(cores) after replaced cores.
 */
export function createAutoCores({
  packDir, retroDir, dataDir, ledger, enabled = () => true, base = () => NIGHTLY_BASE, floorBytes = () => 0,
  freeBytes = statfsFree, hashCache = null, hashFile = sha256File, restore = restoreEntry, timeouts = { core: TIMEOUTS, index: INDEX_TIMEOUTS },
  activity = null, onCoreChanged = () => {}, fetchImpl, bin, pack = REAL_PACK, now = Date.now,
}) {
  const file = path.join(dataDir, STATE_FILE);
  let saved = readState(file);
  let job = null; // { kind, cores: Set, startedAt, done }
  let again = null; // the catalog a check saw while a job ran

  const persist = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(saved, null, 1)}\n`);
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      debug.error("retro: could not save %s: %s", file, err.message);
    }
  };
  const store = async () => ledger().forRoot(await ledgerRoot(packDir()));
  const hashOf = async (abs) => {
    const st = await fsp.lstat(abs).catch(() => null);
    if (!st?.isFile()) return null;
    return hashCache ? hashCache.hash({ abs, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino }) : hashFile(abs);
  };
  const failures = () => saved.failures ?? {};
  const setFailure = (core, err) => {
    const attempts = (failures()[core]?.attempts ?? 0) + 1;
    const reason = failureReason(err);
    const wait = reason === "not-in-nightly" ? NOT_IN_NIGHTLY_MS : backoffAfter(attempts);
    saved = { ...saved, failures: { ...failures(), [core]: { reason, message: err.message, at: now(), attempts, retryAt: now() + wait } } };
    debug.error("retro: core %s not installed (%s): %s", core, reason, err.message);
  };
  const clearFailure = (core) => {
    const { [core]: _gone, ...rest } = failures();
    saved = { ...saved, failures: rest };
  };

  /** Throws (reason disk-floor) when `bytes` more on `dir`'s disk would leave less than the floor free. */
  async function roomOn(dir, label, bytes) {
    const need = bytes + SPACE_SLACK + floorBytes();
    const free = await freeBytes(dir);
    if (free < need) throw new PackError(`${label}의 빈 공간이 모자라 코어를 받지 않았습니다 (필요 ${Math.ceil(need / 1048576)}MB, 남은 공간 ${Math.floor(free / 1048576)}MB)`, { status: 507, reason: "disk-floor", need, free });
  }

  /**
   * Before a download of `bytes`: the data disk holds the zip and the .nro unpacked from it (counted as
   * twice the zip), the cores' disk the copy beside its place while the old file is still there.
   * When both are one disk the data disk is asked for all three.
   */
  async function room(bytes) {
    await fsp.mkdir(dataDir, { recursive: true });
    const cores = await coresDir();
    const oneDisk = (await fsp.stat(dataDir)).dev === (await fsp.stat(cores)).dev;
    await roomOn(dataDir, "데이터 디스크", bytes * (oneDisk ? 3 : 2));
    await roomOn(cores, "레트로 디스크", bytes);
  }

  /** The pack folder's real cores/ folder, made when missing; neither it nor the pack folder may be a link. */
  async function coresDir() {
    const root = packDir();
    await fsp.mkdir(path.join(root, "cores"), { recursive: true });
    for (const p of [root, path.join(root, "cores")]) if ((await fsp.lstat(p)).isSymbolicLink()) throw new PackError(`${p} 가 링크라 쓰지 않습니다`, { status: 500 });
    return path.join(await fsp.realpath(root), "cores");
  }

  /**
   * Fetches `core` (index entry `info`), checks it, and puts it in place: `expect` null installs (never over
   * a file that is there), a hash replaces only a file that still has it. Writes the ledger row.
   * Returns "installed" | "replaced" | "kept" (someone's file got there, or changed, first).
   */
  async function place(core, info, expect = null) {
    const staging = path.join(dataDir, "retro-core-staging", `${core}-${crypto.randomBytes(6).toString("hex")}`);
    try {
      const nro = await fetchCore(core, { base: base(), fetchImpl, dir: staging, room, bin, timeouts: timeouts.core });
      const digest = await digestFile(nro);
      if (digest.crc32 !== info.crc32) throw new PackError(`${core} 코어의 CRC32 가 목록과 다릅니다. 설치하지 않습니다`, { status: 502, reason: "crc-mismatch" });
      if (!(await isNro(nro))) throw new PackError(`${core} 코어가 Switch NRO 가 아닙니다`, { status: 502, reason: "bad-zip" });
      const dest = path.join(await coresDir(), nroName(core));
      const tmp = besideName(dest, "cfpart");
      await fsp.copyFile(nro, tmp, fs.constants.COPYFILE_EXCL);
      let done;
      try {
        done = expect === null ? await putNew(tmp, dest) : await swap(tmp, dest, expect);
      } finally {
        await fsp.rm(tmp, { force: true });
      }
      if (done !== "kept") (await store()).put([{ rel: coreRel(core), sha256: digest.sha256, source: "nightly", lockVersion: "nightly", crc32: digest.crc32, built: info.date }]);
      return done;
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** `tmp` becomes `dest` only when nothing is there: "installed", or "kept" when a file got there first. */
  async function putNew(tmp, dest) {
    try {
      await fsp.link(tmp, dest);
      return "installed";
    } catch (err) {
      if (err.code === "EEXIST") return "kept";
      throw err;
    }
  }

  /**
   * `tmp` takes the place of `dest` when `dest` is still the server's file (`expect`): it is moved aside
   * first, and the moved bytes are what is checked, so a write that lands meanwhile is never lost.
   * "replaced", or "kept" when it was not the server's (put back) or a new file got to `dest` meanwhile.
   */
  async function swap(tmp, dest, expect) {
    const aside = besideName(dest, "aside");
    try {
      await fsp.rename(dest, aside);
    } catch (err) {
      if (err.code === "ENOENT") return "kept";
      throw err;
    }
    let sha;
    try {
      sha = await hashFile(aside);
    } catch (err) {
      await putBack(aside, dest, false);
      throw err;
    }
    if (sha !== expect) {
      await putBack(aside, dest, false);
      return "kept";
    }
    const done = await putNew(tmp, dest).catch(async (err) => {
      await putBack(aside, dest, true);
      throw err;
    });
    await fsp.rm(aside, { force: true });
    return done === "installed" ? "replaced" : "kept";
  }

  /**
   * Restores the trash `entry` holding `core` under its own name and nowhere else. Refused (409), with the
   * item left in the trash, when the name is taken. A trash that restores beside under another name
   * (feat/shared-trash) is undone: what came back goes to the trash again.
   */
  async function restoreExact(core, entry) {
    const dest = path.join(packDir(), coreRel(core));
    const rel = path.relative(retroDir, dest).split(path.sep).join("/");
    if (await fsp.lstat(dest).catch(() => null)) throw new PackError(`${nroName(core)} 자리에 다른 파일이 있어 되살리지 않았습니다`, { status: 409 });
    const out = await restore(retroDir, entry);
    const elsewhere = (out?.files ?? []).filter((f) => f !== rel);
    if (out?.renamed?.length || elsewhere.length) {
      for (const f of elsewhere) await toTrash(retroDir, path.join(retroDir, f), nroName(core)).catch((err) => debug.error("retro: could not put %s back in the trash: %s", f, err.message));
      throw new PackError(`${nroName(core)} 자리에 다른 파일이 있어 되살리지 않았습니다`, { status: 409 });
    }
    return out;
  }

  /** Runs `fn` as the one job of this upkeep, holding the pack against a fill. Throws 409 when either runs. */
  function start(kind, cores, fn) {
    if (job) throw busy();
    const release = claimFill();
    if (!release) throw busy();
    const act = activity?.begin("retro-pack", { title: kind === "update" ? "코어를 새 빌드로 바꿉니다" : "코어를 받아 설치합니다", total: Math.max(cores.length, 1) });
    job = { kind, cores: new Set(cores), startedAt: now() };
    job.done = (async () => {
      try {
        const out = await fn(act);
        saved = { ...saved, last: { at: now(), kind, ...out } };
        persist();
        if (act) (out.installed?.length || out.replaced?.length ? act.done(`설치 ${out.installed?.length ?? 0} · 교체 ${out.replaced?.length ?? 0}`) : act.discard());
        return out;
      } catch (err) {
        saved = { ...saved, last: { at: now(), kind, error: err.message } };
        persist();
        act?.fail(err);
        debug.error("retro: core %s job failed: %s", kind, err.message);
        return { error: err.message, reason: err.reason ?? null };
      } finally {
        release();
        job = null;
        const next = again;
        again = null;
        if (next) check(next).catch((err) => debug.error("retro: core check after a job: %s", err.message));
      }
    })();
    return job;
  }

  /** The cores of the consoles with games that are missing and due now (`force`: whatever the backoff). */
  async function due(cat, force) {
    const root = packDir();
    const trash = await trashedCores(retroDir);
    const fail = failures();
    return [...new Set(systemsInUse(cat.games, cat.systems).map(([, core]) => core))]
      .filter((core) => CORE_RE.test(core) && !trash.has(core) && !fs.existsSync(path.join(root, coreRel(core))))
      .filter((core) => force || !fail[core] || now() >= fail[core].retryAt)
      .sort();
  }

  async function installAll(cores, act) {
    const installed = [];
    let index;
    try {
      index = await fetchIndex({ base: base(), fetchImpl, now: now(), timeouts: timeouts.index });
    } catch (err) {
      for (const core of cores) setFailure(core, err);
      throw err;
    }
    for (const [i, core] of cores.entries()) {
      act?.step(i, core);
      const info = index.get(core);
      try {
        if (!info) throw new PackError(`nightly 에 ${core} 코어가 없습니다`, { status: 404, reason: "not-in-nightly" });
        if ((await place(core, info)) === "installed") installed.push(core);
        clearFailure(core);
      } catch (err) {
        setFailure(core, err);
      }
    }
    return { installed, failed: cores.filter((c) => failures()[c]) };
  }

  /**
   * Looks at `cat` (the catalog after a scan) and starts one job for every missing core that is due.
   * `force` (the admin's button) runs with the setting off and before a backoff ends.
   * Returns { started, reason?, cores, done? }.
   */
  async function check(cat, { force = false } = {}) {
    if (!force && !enabled()) return { started: false, reason: "off", cores: [] };
    if (job) {
      again = cat;
      return { started: false, reason: "busy", cores: [] };
    }
    if (readRecovery(dataDir)) return { started: false, reason: "recovery", cores: [] };
    const cores = await due(cat, force);
    if (!cores.length) return { started: false, reason: "nothing", cores };
    if (job) {
      again = cat;
      return { started: false, reason: "busy", cores: [] };
    }
    try {
      const started = start("install", cores, (act) => installAll(cores, act));
      return { started: true, cores, done: started.done };
    } catch (err) {
      if (err.status === 409) return { started: false, reason: "busy", cores };
      throw err;
    }
  }

  /** The admin's "update installed cores": a job replacing each server core whose CRC-32 the index changed. */
  function update() {
    return start("update", [], async (act) => {
      const index = await fetchIndex({ base: base(), fetchImpl, fresh: true, now: now(), timeouts: timeouts.index });
      const known = knownOfficial(pack);
      const entries = (await store()).all();
      const names = (await fsp.readdir(path.join(packDir(), "cores")).catch(() => [])).sort();
      const replaced = [];
      const pinned = [];
      const current = [];
      for (const name of names) {
        const core = name.match(/^([a-z0-9_]+)_libretro_libnx\.nro$/)?.[1];
        const info = core && index.get(core);
        if (!info) continue;
        const abs = path.join(packDir(), "cores", name);
        const sha = await hashOf(abs);
        if (sha === null) continue;
        const entry = entries.get(coreRel(core));
        if (!serverOwns(sha, entry, known)) {
          pinned.push(core);
          continue;
        }
        const crc = entry?.sha256 === sha && entry.crc32 ? entry.crc32 : (await digestFile(abs)).crc32;
        if (crc === info.crc32) {
          current.push(core);
          continue;
        }
        act?.step(replaced.length, core);
        try {
          if ((await place(core, info, sha)) === "replaced") replaced.push(core);
          clearFailure(core);
        } catch (err) {
          setFailure(core, err);
        }
      }
      if (replaced.length) onCoreChanged(replaced);
      return { replaced, current, pinned };
    });
  }

  /** A pinned core goes to the retro trash and the nightly build takes its place; a failed fetch puts it back. */
  function useOfficial(core) {
    if (!CORE_RE.test(String(core))) throw new PackError("코어 이름이 맞지 않습니다", { status: 400 });
    return start("official", [core], async () => {
      const info = (await fetchIndex({ base: base(), fetchImpl, now: now(), timeouts: timeouts.index })).get(core);
      if (!info) throw new PackError(`nightly 에 ${core} 코어가 없습니다`, { status: 404, reason: "not-in-nightly" });
      const dest = path.join(packDir(), coreRel(core));
      const sha = await hashOf(dest);
      if (sha !== null && serverOwns(sha, (await store()).all().get(coreRel(core)), knownOfficial(pack))) return { installed: [], already: true };
      const trashed = sha === null ? null : (await toTrash(retroDir, dest, nroName(core))).entry;
      try {
        if ((await place(core, info)) !== "installed") throw new PackError(`${core} 자리에 다른 파일이 생겨 설치하지 않았습니다`, { status: 409 });
      } catch (err) {
        if (trashed) await restoreExact(core, trashed).catch((e) => debug.error("retro: %s stays in the trash: %s", core, e.message));
        throw err;
      }
      return { installed: [core], trashed };
    });
  }

  /** The user's core comes back from the retro trash under its own name; the server's file (fetched again any time) is deleted. */
  async function useUserVersion(core) {
    if (!CORE_RE.test(String(core))) throw new PackError("코어 이름이 맞지 않습니다", { status: 400 });
    const entry = (await trashedCores(retroDir)).get(core);
    if (!entry) throw new PackError("휴지통에 이 코어의 사용자 버전이 없습니다", { status: 404 });
    if (job) throw busy();
    const release = claimFill();
    if (!release) throw busy();
    try {
      const dest = path.join(packDir(), coreRel(core));
      const ledgerNow = await store();
      const owns = (sha) => serverOwns(sha, ledgerNow.all().get(coreRel(core)), knownOfficial(pack));
      const notMine = () => new PackError("지금 자리에 있는 코어도 사용자 파일이라 바꾸지 않습니다", { status: 409 });
      const sha = await hashOf(dest);
      if (sha !== null && !owns(sha)) throw notMine();
      let aside = null;
      if (sha !== null) {
        aside = besideName(dest, "aside");
        await fsp.rename(dest, aside);
        // The bytes moved aside are what gets deleted, so they are what is checked, read again.
        if (!owns(await hashFile(aside).catch(() => null))) {
          await putBack(aside, dest, false);
          throw notMine();
        }
      }
      try {
        await restoreExact(core, entry);
      } catch (err) {
        if (aside) await putBack(aside, dest, true);
        throw err instanceof PackError ? err : new PackError(err.message, { status: 409 });
      }
      if (aside) await fsp.rm(aside, { force: true });
      ledgerNow.drop(coreRel(core));
      return { core, restored: entry };
    } finally {
      release();
    }
  }

  return {
    check,
    update,
    useOfficial,
    useUserVersion,
    /** The job now, the failures and the last result. */
    status: () => ({ enabled: enabled(), source: base(), job: job ? { kind: job.kind, cores: [...job.cores], startedAt: job.startedAt } : null, failures: failures(), last: saved.last ?? null }),
    /** Each console's state, with `present` (Map core → sha256 | null) read by the caller. */
    async states(cat, present) {
      return coreStates({ games: cat.games, systems: cat.systems, present, entries: fs.existsSync(packDir()) ? (await store()).all() : new Map(), held: await trashedCores(retroDir), enabled: enabled(), job, failures: failures(), now: now(), pack });
    },
  };
}

function readState(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

let shared = null;

/** The server's own upkeep for <retro dir>/retroarch, made on first use. */
export async function autoCores() {
  if (shared) return shared;
  const envs = await import("../helpers/envs.js");
  const { packLedger } = await import("../db/security-stores.js");
  const activity = await import("../tasks/activity.js");
  const { packDirOf } = await import("./pack-status.js");
  const { HashCache } = await import("../helpers/hash-cache.js");
  const { appDb } = await import("../db/database.js");
  const { hashStore } = await import("../db/stores.js");
  shared ??= createAutoCores({
    packDir: () => packDirOf(envs.retroDir),
    retroDir: envs.retroDir,
    dataDir: envs.dataDir,
    ledger: () => packLedger(),
    enabled: () => envs.retroAutoCores,
    floorBytes: () => envs.nszDiskFloorGb * GIB,
    hashCache: new HashCache(hashStore(appDb(), "retro")),
    activity,
  });
  return shared;
}
