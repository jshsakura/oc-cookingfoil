/**
 * The file check queue: looks at each Switch game file in the library once
 * (file-verify.js) and keeps what it found, one file at a time, in the
 * background. The verdict only informs the web and the console; nothing is
 * hidden, refused or moved because of it.
 *
 * What runs when:
 *   - signatures read a few KB per NCA, so every library file gets them,
 *     newest first;
 *   - the whole-file hash reads every byte, so it runs by itself only for
 *     files that first appeared after this queue started keeping records. On
 *     the very first start every file already there is recorded as seen
 *     without a hash, so a deploy does not read a multi-TB library; the admin
 *     can ask for a full hash pass;
 *   - a file whose size or mtime changed is a new file: checked again, hash
 *     included.
 *
 * A file is started only while no console is downloading and none has for
 * IDLE_MS (the games sit on spinning disks); a hash under way stops when a
 * download starts and the file waits again. A file in use or written in the
 * last minute waits. After MAX_FAILS unexpected errors in a row the queue
 * stops until the admin asks for something again.
 *
 * Records live in the index database (catalog "file-verdicts"), keyed by the
 * games-folder relative path:
 *   { path, size, mtimeMs, verdict?, reason?, checks?, at?, wantHash, hashDone }
 */
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { VERIFY_RE } from "./file-verify.js";

const IDLE_MS = 30_000;
const RECENT_WRITE_MS = 60_000;
const BUSY_RETRY_MS = 10 * 60_000;
const YIELD_POLL_MS = 2000;
const AUTO_DELAY_MS = 2000;
const MAX_FAILS = 5;
const FLAGGED_MAX = 200;

export const NOTICE = new Set(["modified", "damaged"]);
const notice = (row) => (row && NOTICE.has(row.verdict) ? row.verdict : null);
const needsWork = (row) => !row.verdict || (row.wantHash && !row.hashDone);
const changed = (st, row) => row.mtimeMs != null && (st.size !== row.size || Math.round(st.mtimeMs) !== Math.round(row.mtimeMs));
const fresh = (rel, st, wantHash) => ({ path: rel, size: st.size, mtimeMs: st.mtimeMs, wantHash, hashDone: false });

/**
 * One queue. Everything outside the folder comes in, so tests can drive it:
 * `store` (catalogStore shape), `verifier` ({ verify, tools }), `catalog()` the
 * library's files, `downloads()` and `fileInUse(rel)` the download activity,
 * `onVerdict()` after a notice-worthy verdict changes, and `track(opts)` an
 * activity job ({ step, total, done, fail, discard }).
 */
export function createVerifyQueue({
  gamesDir,
  store,
  verifier,
  catalog = () => [],
  downloads = () => ({ active: 0, lastEndedAt: 0 }),
  fileInUse = () => false,
  onVerdict = () => {},
  track = () => null,
  stat = (abs) => fsp.stat(abs),
  now = Date.now,
  idleMs = IDLE_MS,
  recentWriteMs = RECENT_WRITE_MS,
  busyRetryMs = BUSY_RETRY_MS,
  autoDelayMs = AUTO_DELAY_MS,
  yieldPollMs = YIELD_POLL_MS,
}) {
  const rows = new Map(); // rel → record
  const pending = new Set(); // rels that need a check
  const later = new Map(); // rel → when it may be tried again (in use, just written)
  const failedNow = new Set(); // rels that threw this run; not picked again until asked
  const urgent = new Set(); // rels the admin asked to check again: they go first
  let seen = new Map(); // rel → size at the last library look
  let loaded = false;
  let firstRun = false;
  let running = null; // { rel, abort }
  let pumping = false;
  let closed = false;
  let pausedReason = null;
  let waitingFor = null;
  let fails = 0;
  let wakeTimer = null;
  let wakeAt = 0;
  let autoTimer = null;
  let syncing = null;
  let batch = null; // { job, done }

  const abs = (rel) => path.join(gamesDir, rel);

  function load() {
    if (loaded) return;
    loaded = true;
    const got = store.load();
    firstRun = !got;
    for (const row of got?.items ?? []) {
      if (!row?.path) continue;
      rows.set(row.path, row);
      if (needsWork(row)) pending.add(row.path);
    }
  }

  function put(row) {
    const before = notice(rows.get(row.path));
    rows.set(row.path, row);
    store.put(row);
    if (needsWork(row)) pending.add(row.path);
    else pending.delete(row.path);
    if (before !== notice(row)) onVerdict();
  }

  // ── following the library ────────────────────────────────────────────
  /** Records new and replaced files, forgets removed ones. Resolves once done. */
  function sync() {
    if (syncing) return syncing;
    syncing = doSync().catch((err) => debug.error("verify: library look failed: %s", err.message)).finally(() => { syncing = null; });
    return syncing;
  }

  async function doSync() {
    load();
    const files = catalog().filter((f) => VERIFY_RE.test(f.rel));
    if (!files.length && !rows.size) return;
    const next = new Map(files.map((f) => [f.rel, f.size]));
    const seeding = firstRun;
    const seeded = [];
    for (const f of files) {
      // Only what is new since the last look (all of it after a start) is stat'ed.
      if (seen.get(f.rel) === f.size && rows.has(f.rel)) continue;
      const st = await stat(abs(f.rel)).catch(() => null);
      if (closed) return;
      if (!st?.isFile()) continue;
      const row = rows.get(f.rel);
      if (!row) {
        const r = fresh(f.rel, st, !seeding);
        if (seeding) { rows.set(f.rel, r); pending.add(f.rel); seeded.push(r); } else put(r);
      } else if (changed(st, row)) {
        put(fresh(f.rel, st, true));
      } else if (row.mtimeMs == null) {
        put({ ...row, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
    if (seeding) {
      // Everything already there counts as seen, without the hash pass.
      store.replace([...rows.values()], now());
      firstRun = false;
      debug.log("verify: recorded %d library file(s) on the first start", seeded.length);
    }
    if (files.length) {
      const gone = [...rows.keys()].filter((rel) => !next.has(rel));
      if (gone.length) {
        const flagged = gone.some((rel) => notice(rows.get(rel)));
        for (const rel of gone) { rows.delete(rel); pending.delete(rel); later.delete(rel); urgent.delete(rel); }
        store.remove(...gone);
        if (flagged) onVerdict();
      }
    }
    seen = next;
    pump();
  }

  /** After a library rebuild: look at the files again (coalesced). */
  function onLibraryUpdate() {
    if (closed || autoTimer) return;
    autoTimer = setTimeout(() => { autoTimer = null; sync(); }, autoDelayMs);
    autoTimer.unref?.();
  }

  // ── running ──────────────────────────────────────────────────────────
  function wake(ms) {
    const at = now() + Math.max(0, ms);
    if (wakeTimer && wakeAt <= at) return;
    clearTimeout(wakeTimer);
    wakeAt = at;
    wakeTimer = setTimeout(() => { wakeTimer = null; pump(); }, Math.max(0, ms));
    wakeTimer.unref?.();
  }

  /** The newest file that needs a check and may be tried now, or how long until one may. */
  function pickNext() {
    const t = now();
    let best = null;
    let soonest = Infinity;
    for (const rel of urgent) {
      if (!pending.has(rel)) urgent.delete(rel);
      else if ((later.get(rel) ?? 0) <= t) return { row: rows.get(rel), soonest };
    }
    for (const rel of pending) {
      if (failedNow.has(rel)) continue;
      const at = later.get(rel) ?? 0;
      if (at > t) { soonest = Math.min(soonest, at - t); continue; }
      const row = rows.get(rel);
      if (!best || (row.mtimeMs ?? 0) > (best.mtimeMs ?? 0)) best = row;
    }
    return { row: best, soonest };
  }

  function quietFor() {
    const d = downloads();
    return d.active ? -1 : now() - (d.lastEndedAt || 0);
  }

  async function pump() {
    if (pumping || running || closed) return;
    pumping = true;
    try {
      for (;;) {
        if (closed || pausedReason) break;
        const { row, soonest } = pickNext();
        if (!row) {
          waitingFor = null;
          if (Number.isFinite(soonest)) wake(soonest);
          endBatch();
          break;
        }
        const quiet = quietFor();
        if (quiet < idleMs) {
          waitingFor = "downloads";
          wake(quiet < 0 ? Math.min(idleMs, 5000) : idleMs - quiet);
          break;
        }
        waitingFor = null;
        if (!(await verifier.tools())) {
          waitingFor = "tool";
          endBatch();
          break;
        }
        await runOne(row);
      }
    } catch (err) {
      debug.error("verify: %s", err.message);
    } finally {
      pumping = false;
    }
  }

  function beginBatch() {
    if (batch) return;
    batch = { job: track({ title: "게임 파일을 검사합니다", total: pending.size }), done: 0 };
  }

  function endBatch() {
    if (!batch) return;
    const { job, done } = batch;
    batch = null;
    if (done) job?.done(`${done}개`);
    else job?.discard();
  }

  async function runOne(row) {
    const rel = row.path;
    const st = await stat(abs(rel)).catch(() => null);
    if (!st?.isFile()) { pending.delete(rel); return; }
    if (fileInUse(rel)) { later.set(rel, now() + busyRetryMs); return; }
    const age = now() - st.mtimeMs;
    if (age < recentWriteMs) { later.set(rel, now() + (recentWriteMs - age)); return; }
    later.delete(rel);
    const base = changed(st, row) ? fresh(rel, st, true) : { ...row, size: st.size, mtimeMs: st.mtimeMs };
    const hash = Boolean(base.wantHash && !base.hashDone);

    beginBatch();
    batch.job?.total(batch.done + pending.size);
    batch.job?.step(batch.done, path.basename(rel));
    const abort = new AbortController();
    running = { rel, abort, hash };
    // A hash reads the whole file: when a console starts downloading it stops and waits again.
    const poll = hash ? setInterval(() => { if (downloads().active) abort.abort("yield"); }, yieldPollMs) : null;
    poll?.unref?.();
    try {
      const r = await verifier.verify(abs(rel), { hash, signal: abort.signal });
      fails = 0;
      put({ ...base, verdict: r.verdict, reason: r.reason, checks: r.checks, at: now(), hashDone: base.hashDone || hash });
      batch.done++;
      if (NOTICE.has(r.verdict)) debug.log("verify: %s is %s (%s)", rel, r.verdict, r.reason);
    } catch (err) {
      if (abort.signal.aborted) return; // stopped for a download or a shutdown: it waits again
      fails++;
      failedNow.add(rel);
      urgent.delete(rel);
      debug.error("verify: %s not checked: %s", rel, err.message);
      if (fails >= MAX_FAILS) {
        pausedReason = "failures";
        debug.log("verify: stopped after %d failures in a row", MAX_FAILS);
        batch?.job?.fail(`${MAX_FAILS}번 잇달아 검사하지 못해 멈췄습니다: ${err.message}`);
        batch = null;
      }
    } finally {
      clearInterval(poll);
      running = null;
    }
  }

  /** The admin asked for something: a stop after failures ends and every file may be tried again. */
  function resume() {
    pausedReason = null;
    fails = 0;
    failedNow.clear();
  }

  // ── what the admin page does ─────────────────────────────────────────
  async function init() {
    load();
    pump();
  }

  /** Every file gets the whole-file hash it has not had yet. Returns how many. */
  function hashAll() {
    load();
    let n = 0;
    for (const row of rows.values()) {
      if (row.hashDone || row.wantHash) continue;
      const next = { ...row, wantHash: true };
      rows.set(row.path, next);
      pending.add(row.path);
      n++;
    }
    if (n) store.replace([...rows.values()], now());
    resume();
    pump();
    return n;
  }

  /** Checks one file again from the start, hash included. False when it is not in the library. */
  function recheck(rel) {
    load();
    const row = rows.get(rel);
    if (!row) return false;
    const { verdict: _v, reason: _r, checks: _c, at: _a, ...rest } = row;
    put({ ...rest, wantHash: true, hashDone: false });
    later.delete(rel);
    urgent.add(rel);
    resume();
    pump();
    return true;
  }

  async function shutdown() {
    closed = true;
    clearTimeout(wakeTimer);
    clearTimeout(autoTimer);
    running?.abort.abort("shutdown");
  }

  // ── what the page reads ──────────────────────────────────────────────
  function integrityOf(rel) {
    return notice(rows.get(rel));
  }

  function view() {
    load();
    const counts = { ok: 0, modified: 0, damaged: 0, unchecked: 0 };
    let hashPending = 0;
    const flagged = [];
    for (const row of rows.values()) {
      const v = row.verdict && row.verdict !== "unchecked" ? row.verdict : "unchecked";
      counts[v] = (counts[v] ?? 0) + 1;
      if (row.wantHash && !row.hashDone) hashPending++;
      if (notice(row)) flagged.push({ path: row.path, verdict: row.verdict, reason: row.reason ?? null, checks: row.checks ?? null, at: row.at ?? null, size: row.size ?? null });
    }
    flagged.sort((a, b) => (a.verdict === b.verdict ? a.path.localeCompare(b.path) : a.verdict === "damaged" ? -1 : 1));
    return {
      status: pausedReason ? "paused" : running ? "running" : waitingFor ?? (pending.size ? "waiting" : "idle"),
      pausedReason,
      current: running ? { path: running.rel, hash: running.hash } : null,
      total: rows.size,
      counts,
      pending: pending.size,
      hashPending,
      flagged: flagged.slice(0, FLAGGED_MAX),
      flaggedTotal: flagged.length,
    };
  }

  return {
    init, sync, onLibraryUpdate, hashAll, recheck, shutdown, integrityOf, view, pump,
    get: (rel) => rows.get(rel) ?? null,
    /** Test-only: resolves once nothing runs or is being started. */
    async idle() {
      while (pumping || running || syncing) await new Promise((r) => setTimeout(r, 5));
    },
  };
}
