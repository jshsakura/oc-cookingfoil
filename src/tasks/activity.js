/**
 * What the server is doing right now, for the admin page's activity menu:
 * "세이브 읽는 중 120/361", "NSZ 변환 · 43%".
 *
 *   const job = activity.begin("scan:saves", { title: "세이브 폴더를 읽습니다", total: 361 });
 *   job.step(120);          // or job.step(120, "0100…/slot1")
 *   job.done("361개");      // or job.fail(err), or job.discard() when there was nothing to do
 *
 * The registry lives in memory: what runs, plus the last RECENT_MAX that ended
 * (each kept RECENT_MS). Listeners get the whole snapshot, at most once every
 * FLUSH_MS, however often the jobs step. A job that cannot count its own steps
 * may pass `probe()` → { current?, total?, detail? }, which is read every PROBE_MS
 * while anyone listens (the NSZ conversion reads the size of its output file).
 *
 * A job the admin may stop passes `cancel()`: its entry carries `cancellable`,
 * and `cancel(id)` calls it once and marks the entry "중지하는 중". However the
 * job then ends (done, fail or discard), it lands in recent as "stopped".
 */
import debug from "../debug.js";

/** Thrown by a job that stops partway because the admin asked, so its half-done result is not kept. */
export class JobStopped extends Error {
  constructor() {
    super("중지했습니다");
    this.name = "JobStopped";
  }
}

export const KINDS = Object.freeze([
  "sync", "scan:games", "scan:homebrew", "scan:saves", "scan:patches", "scan:retro",
  "backup", "nsz", "titledb", "ratings", "eshop", "retro-meta", "retro-art", "retro-pack", "retro-achievements", "retro-hash",
  "homebrew-github", "homebrew-art", "prewarm", "optimize", "cleanup", "verify", "organize",
]);

const RECENT_MAX = 50;
const RECENT_MS = 10 * 60_000;
const FLUSH_MS = 200;
const PROBE_MS = 2000;
const TEXT_MAX = 200;

const text = (v) => (v == null ? null : String(v).slice(0, TEXT_MAX));
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

export function createActivity({ now = Date.now, flushMs = FLUSH_MS, probeMs = PROBE_MS, recentMax = RECENT_MAX, recentMs = RECENT_MS } = {}) {
  const running = new Map(); // id → entry
  const probes = new Map(); // id → probe()
  const cancels = new Map(); // id → cancel(), until it is called
  let recent = []; // newest first
  const listeners = new Set();
  let seq = 0;
  let flushTimer = null;
  let probeTimer = null;

  const copy = (e) => ({ ...e });

  function prune() {
    const cutoff = now() - recentMs;
    recent = recent.filter((e) => e.endedAt >= cutoff).slice(0, recentMax);
  }

  function snapshot() {
    prune();
    return { running: [...running.values()].map(copy), recent: recent.map(copy) };
  }

  function flush() {
    flushTimer = null;
    if (!listeners.size) return;
    const snap = snapshot();
    for (const fn of listeners) {
      try { fn(snap); } catch (err) { debug.error("activity: listener threw: %s", err.message); }
    }
  }

  function changed() {
    if (flushTimer || !listeners.size) return;
    flushTimer = setTimeout(flush, flushMs);
    flushTimer.unref?.();
  }

  function readProbes() {
    for (const [id, probe] of probes) {
      const e = running.get(id);
      if (!e) { probes.delete(id); continue; }
      try {
        const p = probe() || {};
        if (p.current !== undefined) e.current = count(p.current);
        if (p.total !== undefined) e.total = count(p.total);
        if (p.detail !== undefined) e.detail = text(p.detail);
      } catch (err) {
        debug.error("activity: probe of %s threw: %s", e.kind, err.message);
      }
    }
    changed();
  }

  function syncProbeTimer() {
    const want = probes.size > 0 && listeners.size > 0;
    if (want && !probeTimer) {
      probeTimer = setInterval(readProbes, probeMs);
      probeTimer.unref?.();
    } else if (!want && probeTimer) {
      clearInterval(probeTimer);
      probeTimer = null;
    }
  }

  function end(id, patch) {
    const e = running.get(id);
    if (!e) return;
    running.delete(id);
    probes.delete(id);
    cancels.delete(id);
    syncProbeTimer();
    // Stopped by the admin: that is what it shows, whatever way the job wound down.
    const { stopping, ...entry } = e;
    if (stopping) patch = { state: "stopped", result: patch?.result ?? null, detail: null };
    if (patch) {
      const endedAt = now();
      recent.unshift({ ...entry, ...patch, endedAt, ms: endedAt - e.startedAt });
      prune();
    }
    changed();
  }

  /** Starts one job. Its handle's methods do nothing once it has ended. */
  function begin(kind, { title, total = null, detail = null, probe = null, cancel = null } = {}) {
    const id = `a${++seq}`;
    // Every job can be stopped: one without its own cancel() sees `stopped` and winds down at its next step.
    const cancellable = true;
    running.set(id, {
      id, kind: String(kind), title: text(title) ?? String(kind), detail: text(detail),
      current: 0, total: count(total), startedAt: now(), state: "running", cancellable,
    });
    if (typeof probe === "function") { probes.set(id, probe); syncProbeTimer(); }
    cancels.set(id, typeof cancel === "function" ? cancel : () => {});
    changed();
    return {
      id,
      /** True once the admin asked this job to stop. */
      get stopped() { return Boolean(running.get(id)?.stopping); },
      step(n, stepDetail) {
        const e = running.get(id);
        if (!e) return;
        if (n !== undefined && n !== null) e.current = count(n) ?? e.current;
        if (stepDetail !== undefined && !e.stopping) e.detail = text(stepDetail);
        changed();
      },
      total(n) {
        const e = running.get(id);
        if (!e) return;
        e.total = count(n);
        changed();
      },
      done(result = null) { end(id, { state: "done", result: text(result) }); },
      fail(err) { end(id, { state: "failed", error: text(err?.message ?? err) || "알 수 없는 오류입니다." }); },
      /** Ends without a trace: the job found nothing to do. */
      discard() { end(id, null); },
    };
  }

  /** Runs `fn(job)` as one job: done with what `summary(result)` says, failed on a throw (rethrown). */
  async function track(kind, opts, fn, summary = () => null) {
    const job = begin(kind, opts);
    try {
      const result = await fn(job);
      job.done(summary(result));
      return result;
    } catch (err) {
      if (err instanceof JobStopped) job.discard();
      else job.fail(err);
      throw err;
    }
  }

  /** Asks a running job to stop. False when it is not running or cannot be stopped (or was asked already). */
  function cancel(id) {
    const e = running.get(id);
    const fn = cancels.get(id);
    if (!e || !fn) return false;
    cancels.delete(id);
    Object.assign(e, { cancellable: false, stopping: true, detail: "중지하는 중" });
    // The job may end inside its own cancel(): end() then records it as stopped.
    try { fn(); } catch (err) { debug.error("activity: cancel of %s threw: %s", e.kind, err.message); }
    changed();
    return true;
  }

  /** Calls `fn(snapshot)` after each change (at most every flushMs). Returns the unsubscribe. */
  function subscribe(fn) {
    listeners.add(fn);
    syncProbeTimer();
    return () => {
      listeners.delete(fn);
      syncProbeTimer();
    };
  }

  /** The snapshot now, probes read first (the page's fallback poll has no listener to keep them fresh). */
  function list() {
    if (probes.size) readProbes();
    return snapshot();
  }

  return { begin, track, list, subscribe, flush, cancel };
}

const shared = createActivity();
export const begin = shared.begin;
export const track = shared.track;
export const list = shared.list;
export const subscribe = shared.subscribe;
export const cancel = shared.cancel;
export default shared;
