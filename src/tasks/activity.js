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
 */
import debug from "../debug.js";

export const KINDS = Object.freeze([
  "sync", "scan:games", "scan:homebrew", "scan:saves", "scan:patches", "scan:retro",
  "backup", "nsz", "titledb", "ratings", "eshop", "retro-meta", "retro-art",
  "homebrew-github", "homebrew-art", "prewarm", "optimize", "cleanup",
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
    syncProbeTimer();
    if (patch) {
      const endedAt = now();
      recent.unshift({ ...e, ...patch, endedAt, ms: endedAt - e.startedAt });
      prune();
    }
    changed();
  }

  /** Starts one job. Its handle's methods do nothing once it has ended. */
  function begin(kind, { title, total = null, detail = null, probe = null } = {}) {
    const id = `a${++seq}`;
    running.set(id, {
      id, kind: String(kind), title: text(title) ?? String(kind), detail: text(detail),
      current: 0, total: count(total), startedAt: now(), state: "running",
    });
    if (typeof probe === "function") { probes.set(id, probe); syncProbeTimer(); }
    changed();
    return {
      id,
      step(n, stepDetail) {
        const e = running.get(id);
        if (!e) return;
        if (n !== undefined && n !== null) e.current = count(n) ?? e.current;
        if (stepDetail !== undefined) e.detail = text(stepDetail);
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
      job.fail(err);
      throw err;
    }
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

  return { begin, track, list, subscribe, flush };
}

const shared = createActivity();
export const begin = shared.begin;
export const track = shared.track;
export const list = shared.list;
export const subscribe = shared.subscribe;
export default shared;
