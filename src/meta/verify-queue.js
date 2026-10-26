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
 *   - a file whose size changed is a new file: checked again, hash included.
 *     One whose mtime alone changed gets its signatures again and keeps its
 *     hash results;
 *   - a file that turns up under a new path with the size and mtime of one
 *     that went away (a rename or move) takes that one's record over instead
 *     of being hashed again. Records that went away are kept for that in a
 *     second catalog ("file-verdicts-gone", up to GONE_MAX);
 *   - when a library look finds fewer than half the files known (and at least
 *     PRUNE_GUARD_MIN are known), nothing is forgotten: that is a folder that
 *     could not be read, not files deleted.
 *
 * A file is started only while no console is downloading and none has for
 * IDLE_MS (the games sit on spinning disks); a hash under way stops when a
 * download starts and the file waits again. A file in use or written in the
 * last minute waits. A hash keeps its progress per NCA ({ ncaId: matched }),
 * so a run stopped for a download resumes after the NCAs already read. After
 * MAX_FAILS unexpected errors in a row the queue stops, and starts again by
 * itself after RESUME_MS or when the admin asks for something.
 *
 * The admin may stop a check from the activity menu (`stop()`): the file in
 * progress is aborted and keeps waiting, and nothing more starts until the next
 * library update, a restart or another request from the admin page.
 *
 * Each check also keeps what the file is (its cnmt, file-identity.js), so the
 * library is read for that once, and flags a file whose name carries another
 * title id than its content ("misnamed"; it only informs, like the verdicts).
 *
 * Records live in the index database (catalog "file-verdicts"), keyed by the
 * games-folder relative path:
 *   { path, size, mtimeMs, verdict?, reason?, checks?, detail?, at?, wantHash, hashDone,
 *     ncaHashes?, stale?, identity?, misnamed?, alerted?, signed? }   stale: the mtime changed, the signatures run again
 *   signed: { nca, ticket } (file-verify.js), what a console without signature patches needs
 *
 * A file newly found damaged is told to the admin once (`onDamaged`, one call
 * per run with every such file): `alerted` marks it, and it is told again only
 * after a check that found it not damaged.
 */
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { VERIFY_RE } from "./file-verify.js";
import { nameDisagrees } from "./file-identity.js";
import { activityText } from "./meta-messages.js";

const IDLE_MS = 30_000;
const RECENT_WRITE_MS = 60_000;
const BUSY_RETRY_MS = 10 * 60_000;
const YIELD_POLL_MS = 2000;
const AUTO_DELAY_MS = 2000;
const MAX_FAILS = 5;
const RESUME_MS = 30 * 60_000;
const GONE_MAX = 10_000;
const PRUNE_GUARD_MIN = 10;
const FLAGGED_MAX = 200;

export const NOTICE = new Set(["modified", "damaged"]);
const notice = (row) => (row && NOTICE.has(row.verdict) ? row.verdict : null);
// A record from before checks kept the identity or the signatures, or a damaged one from before they said why in detail, is read again once, signatures only.
const needsWork = (row) => !row.verdict || row.stale || (row.wantHash && !row.hashDone) || !("identity" in row) || !("signed" in row)
  || (row.verdict === "damaged" && !("detail" in row));
const sizeChanged = (st, row) => row.mtimeMs != null && st.size !== row.size;
const mtimeChanged = (st, row) => row.mtimeMs != null && Math.round(st.mtimeMs) !== Math.round(row.mtimeMs);
const fresh = (rel, st, wantHash) => ({ path: rel, size: st.size, mtimeMs: st.mtimeMs, wantHash, hashDone: false });
// The same bytes under another path: size and mtime (rename and move keep both).
const keyOf = (row) => (row.mtimeMs == null ? null : `${row.size}:${Math.round(row.mtimeMs)}`);

/** What a file's record becomes after a stat: replaced, touched (mtime only) or as it was. */
function restat(row, st) {
  if (sizeChanged(st, row)) return fresh(row.path, st, true);
  if (mtimeChanged(st, row)) return { ...row, mtimeMs: st.mtimeMs, stale: true };
  return row;
}

/**
 * One queue. Everything outside the folder comes in, so tests can drive it:
 * `store` (catalogStore shape), `verifier` ({ verify, tools }), `catalog()` the
 * library's files, `downloads()` and `fileInUse(rel)` the download activity,
 * `onVerdict()` after a notice-worthy verdict changes, and `track(opts)` an
 * activity job ({ step, total, done, fail, discard }).
 */
/**
 * How long until `hours` allows a check: 0 inside the window, Infinity when off.
 * `hours` is "always", "off" or "<from>-<to>" in whole local hours (it may run past midnight). Pure.
 */
export function msUntilHours(hours, date = new Date()) {
  if (!hours || hours === "always") return 0;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(hours);
  if (!m) return Infinity;
  const [from, to] = [Number(m[1]), Number(m[2])];
  const h = date.getHours();
  const inside = from < to ? h >= from && h < to : h >= from || h < to;
  if (inside) return 0;
  const start = new Date(date);
  start.setHours(from, 0, 0, 0);
  if (start <= date) start.setDate(start.getDate() + 1);
  return start - date;
}

export function createVerifyQueue({
  gamesDir,
  store,
  goneStore = null,
  verifier,
  catalog = () => [],
  downloads = () => ({ active: 0, lastEndedAt: 0 }),
  fileInUse = () => false,
  onVerdict = () => {},
  onDamaged = () => {},
  track = () => null,
  // How long until a check may read the library (the admin's hours); a file the admin asked for goes at once.
  msUntilAllowed = () => 0,
  stat = (abs) => fsp.stat(abs),
  now = Date.now,
  idleMs = IDLE_MS,
  recentWriteMs = RECENT_WRITE_MS,
  busyRetryMs = BUSY_RETRY_MS,
  autoDelayMs = AUTO_DELAY_MS,
  yieldPollMs = YIELD_POLL_MS,
  resumeMs = RESUME_MS,
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
  let found = []; // files found damaged this run, not told yet: [{ path, reason, detail }]
  let resumeTimer = null;
  let resumeAt = null;
  let stopped = false; // the admin stopped the check: nothing starts until the next library update or request
  const gone = new Map(); // size:mtime → a record that went away, oldest first

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
    for (const row of goneStore?.load()?.items ?? []) {
      const key = row?.path && keyOf(row);
      if (key) gone.set(key, row);
    }
  }

  /** Keeps records that went away, for a rename that brings them back. */
  function bury(list) {
    if (!goneStore) return;
    for (const row of list) {
      const key = keyOf(row);
      if (!key) continue;
      gone.delete(key);
      gone.set(key, row);
      goneStore.put(row);
    }
    const extra = [...gone.entries()].slice(0, Math.max(0, gone.size - GONE_MAX));
    for (const [key] of extra) gone.delete(key);
    if (extra.length) goneStore.remove(...extra.map(([, r]) => r.path));
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
    // Records whose path is not in the library now: a new path with the same bytes takes one over.
    const leaving = new Map();
    for (const [rel, row] of rows) if (!next.has(rel) && keyOf(row)) leaving.set(keyOf(row), row);
    const moved = new Set();
    for (const f of files) {
      // Only what is new since the last look (all of it after a start) is stat'ed.
      if (seen.get(f.rel) === f.size && rows.has(f.rel)) continue;
      const st = await stat(abs(f.rel)).catch(() => null);
      if (closed) return;
      if (!st?.isFile()) continue;
      const row = rows.get(f.rel);
      if (!row) {
        const r = fresh(f.rel, st, !seeding);
        const key = keyOf(r);
        const was = seeding ? null : leaving.get(key) ?? gone.get(key);
        if (was) {
          // A rename or move: the record (verdict, hash progress) follows the file.
          if (leaving.get(key) === was) { leaving.delete(key); moved.add(was.path); }
          else { gone.delete(key); goneStore?.remove(was.path); }
          put({ ...was, path: f.rel });
          debug.log("verify: %s kept the record of %s", f.rel, was.path);
        } else if (seeding) { rows.set(f.rel, r); pending.add(f.rel); seeded.push(r); } else put(r);
      } else {
        const r = row.mtimeMs == null ? { ...row, size: st.size, mtimeMs: st.mtimeMs } : restat(row, st);
        if (r !== row) put(r);
      }
    }
    if (seeding) {
      // Everything already there counts as seen, without the hash pass.
      store.replace([...rows.values()], now());
      firstRun = false;
      debug.log("verify: recorded %d library file(s) on the first start", seeded.length);
    }
    if (files.length) prune(next, files.length, moved);
    seen = next;
    pump();
  }

  /** Forgets the records of files gone from the library, unless the look itself looks broken. */
  function prune(next, count, moved) {
    const known = [...rows.keys()].filter((rel) => !moved.has(rel)).length;
    const leftRels = [...rows.keys()].filter((rel) => !next.has(rel));
    if (!leftRels.length) return;
    const forget = (list) => {
      const flagged = list.some((rel) => notice(rows.get(rel)));
      const buried = list.filter((rel) => !moved.has(rel)).map((rel) => rows.get(rel));
      for (const rel of list) { rows.delete(rel); pending.delete(rel); later.delete(rel); urgent.delete(rel); }
      store.remove(...list);
      bury(buried);
      if (flagged) onVerdict();
    };
    if (known >= PRUNE_GUARD_MIN && count < known * 0.5) {
      // Fewer than half the files: a folder that could not be read. Only the moved records go.
      debug.log("verify: the library lists %d of %d known file(s); keeping the records of the missing ones", count, known);
      forget(leftRels.filter((rel) => moved.has(rel)));
      return;
    }
    forget(leftRels);
  }

  /** After a library rebuild: look at the files again (coalesced). */
  function onLibraryUpdate() {
    if (closed || autoTimer) return;
    autoTimer = setTimeout(() => { autoTimer = null; stopped = false; sync(); }, autoDelayMs);
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
        if (stopped) { waitingFor = "stopped"; endBatch(); break; }
        const { row, soonest } = pickNext();
        if (!row) {
          waitingFor = null;
          if (Number.isFinite(soonest)) wake(soonest);
          endBatch();
          break;
        }
        const until = urgent.has(row.path) ? 0 : msUntilAllowed();
        if (until > 0) {
          waitingFor = "schedule";
          endBatch();
          if (Number.isFinite(until)) wake(until);
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
    batch = { job: track({ title: activityText("act.verify"), total: pending.size, cancel: stop }), done: 0 };
  }

  /** Tells the admin about the files found damaged since the last time, in one call. */
  function tellDamaged() {
    if (!found.length) return;
    const list = found;
    found = [];
    try { onDamaged(list); } catch (err) { debug.error("verify: damaged notice failed: %s", err.message); }
  }

  function endBatch() {
    tellDamaged();
    if (!batch) return;
    const { job, done } = batch;
    batch = null;
    if (done) job?.done(activityText("act.count", { n: done }));
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
    const base = row.mtimeMs == null ? { ...row, size: st.size, mtimeMs: st.mtimeMs } : restat(row, st);
    const hash = Boolean(base.wantHash && !base.hashDone);
    // NCAs already hashed (by a run a download stopped, or a full pass before an mtime change).
    let ncaHashes = { ...(base.ncaHashes ?? {}) };
    const onHashed = (id, matched) => {
      ncaHashes = { ...ncaHashes, [id]: matched };
      const cur = rows.get(rel);
      if (!cur) return;
      const saved = { ...cur, ncaHashes };
      rows.set(rel, saved);
      store.put(saved);
    };

    beginBatch();
    batch.job?.total(batch.done + pending.size);
    batch.job?.step(batch.done, path.basename(rel));
    const abort = new AbortController();
    running = { rel, abort, hash };
    // A hash reads the whole file: when a console starts downloading it stops and waits again.
    const poll = hash ? setInterval(() => { if (downloads().active) abort.abort("yield"); }, yieldPollMs) : null;
    poll?.unref?.();
    try {
      const r = await verifier.verify(abs(rel), { hash, known: ncaHashes, onHashed, signal: abort.signal });
      fails = 0;
      const { stale: _s, ...done } = base;
      const identity = r.identity ?? null;
      const damaged = r.verdict === "damaged";
      put({ ...done, ncaHashes, verdict: r.verdict, reason: r.reason, checks: r.checks, detail: r.detail ?? null, at: now(), hashDone: base.hashDone || hash, identity, misnamed: nameDisagrees(rel, identity), alerted: damaged, signed: r.signed ?? null });
      if (damaged && !base.alerted) found.push({ path: rel, reason: r.reason, detail: r.detail ?? null });
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
        debug.log("verify: stopped after %d failures in a row; trying again in %d min", MAX_FAILS, Math.round(resumeMs / 60_000));
        batch?.job?.fail(activityText("act.verifyStopped", { n: MAX_FAILS, why: err.message }));
        batch = null;
        tellDamaged();
        resumeAt = now() + resumeMs;
        resumeTimer = setTimeout(() => {
          debug.log("verify: trying again after the stop for failures");
          resume();
          pump();
        }, resumeMs);
        resumeTimer.unref?.();
      }
    } finally {
      clearInterval(poll);
      running = null;
    }
  }

  /** The admin asked for something: a stop after failures ends and every file may be tried again. */
  function resume() {
    clearTimeout(resumeTimer);
    resumeTimer = null;
    resumeAt = null;
    pausedReason = null;
    stopped = false;
    fails = 0;
    failedNow.clear();
  }

  /** The admin stopped the check: the file in progress is aborted and waits, and the batch ends. */
  function stop() {
    stopped = true;
    running?.abort.abort("stop");
    if (!running && !pumping) endBatch();
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
    const { verdict: _v, reason: _r, checks: _c, detail: _d, at: _a, ncaHashes: _n, stale: _s, ...rest } = row;
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
    clearTimeout(resumeTimer);
    running?.abort.abort("shutdown");
  }

  // ── what the page reads ──────────────────────────────────────────────
  function integrityOf(rel) {
    return notice(rows.get(rel));
  }

  /** The notice-worthy finding with its reason and detail: { verdict, reason, detail }, or null. */
  function findingOf(rel) {
    const row = rows.get(rel);
    return notice(row) ? { verdict: row.verdict, reason: row.reason ?? null, detail: row.detail ?? null } : null;
  }

  /** { nca?, ticket? } with only what is known (true or false), while the record is current; null when nothing is. */
  function signedOf(rel) {
    const row = rows.get(rel);
    if (!row?.signed || row.stale) return null;
    const out = {};
    for (const k of ["nca", "ticket"]) if (typeof row.signed[k] === "boolean") out[k] = row.signed[k];
    return Object.keys(out).length ? out : null;
  }

  /** What the check found the file to be, while its size and mtime still hold; else null. */
  function identityOf(rel, { size, mtimeMs }) {
    const row = rows.get(rel);
    return row?.identity && !row.stale && row.size === size && row.mtimeMs === mtimeMs ? row.identity : null;
  }

  function view() {
    load();
    const counts = { ok: 0, modified: 0, damaged: 0, unchecked: 0, misnamed: 0 };
    let hashPending = 0;
    const flagged = [];
    for (const row of rows.values()) {
      const v = row.verdict && row.verdict !== "unchecked" ? row.verdict : "unchecked";
      counts[v] = (counts[v] ?? 0) + 1;
      if (row.wantHash && !row.hashDone) hashPending++;
      if (notice(row)) flagged.push({ path: row.path, verdict: row.verdict, reason: row.reason ?? null, checks: row.checks ?? null, detail: row.detail ?? null, at: row.at ?? null, size: row.size ?? null });
      if (row.misnamed) {
        counts.misnamed++;
        flagged.push({ path: row.path, verdict: "misnamed", reason: "name-mismatch", contentId: row.identity?.titleId ?? null, at: row.at ?? null, size: row.size ?? null });
      }
    }
    const rank = { damaged: 0, modified: 1, misnamed: 2 };
    flagged.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.path.localeCompare(b.path));
    return {
      status: pausedReason ? "paused" : running ? "running" : waitingFor ?? (pending.size ? "waiting" : "idle"),
      pausedReason,
      resumeAt,
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
    init, sync, onLibraryUpdate, hashAll, recheck, stop, shutdown, integrityOf, findingOf, signedOf, identityOf, view, pump,
    get: (rel) => rows.get(rel) ?? null,
    /** Test-only: resolves once nothing runs or is being started. */
    async idle() {
      while (pumping || running || syncing) await new Promise((r) => setTimeout(r, 5));
    },
  };
}
