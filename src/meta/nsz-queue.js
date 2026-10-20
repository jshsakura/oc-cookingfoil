/**
 * The NSZ conversion queue: compresses .nsp files in the games folder to .nsz
 * (and .xci to .xcz when that setting is on), one file at a time by default,
 * run by the admin from the 변환 tab.
 *
 * For each file, in queue order:
 *   - it must still be there, at least the minimum size, with no <name>.nsz
 *     beside it, not downloaded right now or within the last two minutes, and
 *     not written in the last minute (an upload or copy still landing);
 *   - nsz compresses and verifies it into <games>/.cookingfoil-nsz-work/<id>/,
 *     on the same filesystem so the swap is one rename. The library scan
 *     (fast-glob, dot: false) and the watcher (dot names ignored) never look
 *     inside a dot folder;
 *   - the result must exist and be smaller than the original;
 *   - the original is stat'ed again: changed or in use, the result is dropped
 *     and the file waits ("busy") to be tried later;
 *   - the .nsz is renamed next to the original and the library told about both
 *     paths (coalesced into one incremental rebuild). The original is deleted
 *     at once by default; with nszKeepHours above 0 it is first moved (one
 *     rename) into <games>/.cookingfoil-nsz-keep/<id>/, another dot folder,
 *     and deleted once that time is up.
 *
 * A file that fails keeps its original untouched, is marked failed and the
 * queue goes on with the next one. MAX_FAILS nsz failures in a row pause the
 * run as a safety net (a broken nsz or keys would otherwise fail every file).
 *
 * A kept original is deleted, oldest first, once it is older than
 * nszKeepHours ("age"), while the kept total is over nszKeepGb when that is
 * above 0 ("cap"), before a run would pause for free space ("space"), by
 * 지금 비우기 ("manual") and with its row by 빼기 ("removed") or 끝난 것 삭제
 * ("cleared"). The age timer is set from the state file again on start,
 * past-due ones first. Its row leaves the list then; every conversion,
 * deletion and failure also goes to the conversion log (nsz-log.js).
 *
 * 선택한 것만 변환 runs only the rows it names, in queue order, and ends the
 * run once none of them is left to start; the other rows keep waiting.
 *
 * A new file is started only while no console is downloading and none has for
 * IDLE_MS: the games sit on spinning disks, and conversion would compete with
 * downloads. A file already running finishes. Below the free space floor the
 * run pauses.
 *
 * A run ends by itself once nothing is left to start or running: the queue
 * then sits idle with no timer and no folder scan. It starts again only when
 * the admin presses 시작 or, with auto-queue on, when the library gains a new
 * file (unless the admin paused it). Failed files keep their reason and wait
 * for 재시도; nothing retries them by itself.
 *
 * The queue is kept in ${COOK_DATA_DIR}/nsz-queue.json (written atomically,
 * coalesced). A file that was running when the server stopped waits again, and
 * the work folder is emptied on start. Pause, a setting turned off and a
 * restart stop the child and drop its partial output.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import FastGlob from "fast-glob";
import debug from "../debug.js";
import { resolveNsz, nszArgs, runNsz, failureReason, findOutput, trimReason } from "./nsz-runner.js";
import { createNszLog } from "./nsz-log.js";

export const WORK_DIR_NAME = ".cookingfoil-nsz-work";
export const KEEP_DIR_NAME = ".cookingfoil-nsz-keep";
const HOUR = 3600_000;
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
// Room left over beyond the file itself: nsz's own scratch and the filesystem's reserve.
const SPACE_SLACK = GIB;
const IDLE_MS = 30_000;
const BUSY_RETRY_MS = 10 * 60_000;
const RECENT_WRITE_MS = 60_000;
const MAX_FAILS = 5;
const FAILURE_LOG = 50;
const SAVE_DELAY_MS = 300;
const AUTO_DELAY_MS = 2000;
const PAGE_MAX = 100;

const EXT = { nsp: ".nsz", xci: ".xcz" };
const kindOf = (rel) => (/\.nsp$/i.test(rel) ? "nsp" : /\.xci$/i.test(rel) ? "xci" : null);
const targetOf = (rel) => rel.replace(/\.(nsp|xci)$/i, (m) => EXT[m.slice(1).toLowerCase()]);
const gb = (n) => `${(n / GIB).toFixed(1)} GB`;

// Which states a filter chip shows.
const FILTERS = {
  all: null,
  waiting: new Set(["waiting", "busy"]),
  running: new Set(["running"]),
  done: new Set(["done"]),
  failed: new Set(["failed", "skipped"]),
};

const emptyState = () => ({ version: 1, running: false, held: false, pausedReason: null, only: null, items: [], dismissed: [], failures: [], stats: { converted: 0, savedBytes: 0, inBytes: 0, outBytes: 0 } });

/**
 * One queue. Everything outside the folder and the state file comes in, so
 * tests can drive it: `settings()` the live settings, `downloads()` and
 * `fileInUse(rel)` the download activity, `freeBytes(dir)`, `catalog()` the
 * library's names and title ids, `onSwapped(changes)` and `alert(text, subject)`,
 * `now()` the clock the kept originals age by.
 */
export function createNszQueue({
  gamesDir,
  stateFile,
  logFile = path.join(path.dirname(stateFile), "nsz-log.jsonl"),
  settings,
  bin = resolveNsz,
  downloads = () => ({ active: 0, lastEndedAt: 0 }),
  fileInUse = () => false,
  freeBytes = defaultFreeBytes,
  catalog = () => [],
  onSwapped = () => {},
  alert = () => {},
  idleMs = IDLE_MS,
  busyRetryMs = BUSY_RETRY_MS,
  recentWriteMs = RECENT_WRITE_MS,
  killGraceMs = 3000,
  autoDelayMs = AUTO_DELAY_MS,
  lowPriority = true,
  now = Date.now,
  // One running file as a job on the admin page's activity list: (item, probe) → { done, fail, discard } | null.
  track = () => null,
}) {
  const workDir = path.join(gamesDir, WORK_DIR_NAME);
  const keepDir = path.join(gamesDir, KEEP_DIR_NAME);
  const log = createNszLog(logFile);
  let state = emptyState();
  const runs = new Map(); // id -> { stop, done, outDir, stopping }
  const removing = new Set();
  let saveTimer = null;
  let wakeTimer = null;
  let wakeAt = 0;
  let autoTimer = null;
  let pumping = false;
  let pumpAgain = false;
  let closed = false;
  let waitingFor = null; // "downloads" while a download keeps the next file back
  let fails = 0;
  let cycle = { done: 0, saved: 0, failed: 0 };
  let byRel = new Map();
  let keepTimer = null;
  let keepChain = Promise.resolve();

  const reindex = () => { byRel = new Map(state.items.map((i) => [i.rel, i])); };
  const find = (id) => state.items.find((i) => i.id === id) ?? null;

  // ── persistence ──────────────────────────────────────────────────────
  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      state = { ...emptyState(), ...parsed, stats: { ...emptyState().stats, ...parsed.stats } };
      if (!Array.isArray(state.items)) state.items = [];
    } catch {
      state = emptyState();
    }
    let resumed = 0;
    for (const i of state.items) if (i.state === "running") { Object.assign(i, { state: "waiting", startedAt: null }); resumed++; }
    reindex();
    return resumed;
  }

  function writeNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = `${stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, stateFile);
    } catch (err) {
      debug.error("nsz: queue not saved: %s", err.message);
    }
  }

  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(writeNow, SAVE_DELAY_MS);
    saveTimer.unref?.();
  }

  // ── adding ───────────────────────────────────────────────────────────
  function eligibleKind(rel, s = settings()) {
    const k = kindOf(rel);
    return k === "nsp" || (k === "xci" && s.xci) ? k : null;
  }

  /** Adds files ({ rel, size }) not queued yet, largest first. Returns { added, bytes }. */
  function addFiles(files, { undismiss = false } = {}) {
    const s = settings();
    const min = s.minSizeMb * MIB;
    const names = new Map(catalog().map((f) => [f.rel, f]));
    const dismissed = new Set(state.dismissed);
    const fresh = [];
    for (const f of files) {
      const kind = eligibleKind(f.rel, s);
      if (!kind || !(f.size >= min)) continue;
      const had = byRel.get(f.rel);
      if (had && had.state !== "done") continue;
      if (dismissed.has(f.rel)) {
        if (!undismiss) continue;
        dismissed.delete(f.rel);
      }
      if (had) state.items = state.items.filter((i) => i !== had);
      const meta = names.get(f.rel) ?? {};
      fresh.push({
        id: crypto.randomBytes(6).toString("hex"), rel: f.rel, kind, size: f.size, name: meta.name ?? null,
        titleId: meta.baseTitleId ?? meta.titleId ?? null, state: "waiting", addedAt: Date.now(),
      });
    }
    fresh.sort((a, b) => b.size - a.size);
    state.items.push(...fresh);
    state.dismissed = [...dismissed];
    reindex();
    if (fresh.length) save();
    return { added: fresh.length, bytes: fresh.reduce((n, i) => n + i.size, 0) };
  }

  /** Every .nsp (and .xci when on) in the games folder with its size. */
  async function scanFolder() {
    const s = settings();
    const entries = await FastGlob(s.xci ? ["**/*.nsp", "**/*.xci"] : ["**/*.nsp"], {
      cwd: gamesDir, dot: false, onlyFiles: true, caseSensitiveMatch: false, stats: true, followSymbolicLinks: false,
    });
    return entries.map((e) => ({ rel: e.path, size: e.stats?.size ?? 0 }));
  }

  /** What a scan would queue now, plus what already waits: { files, bytes }. */
  async function preview() {
    const s = settings();
    const min = s.minSizeMb * MIB;
    let files = 0;
    let bytes = 0;
    for (const f of await scanFolder()) {
      if (f.size < min || !eligibleKind(f.rel, s)) continue;
      // New files and those already waiting; failed ones wait for 재시도, and a running one is under way.
      const st = byRel.get(f.rel)?.state ?? "done";
      if (st !== "done" && st !== "waiting" && st !== "busy") continue;
      files++;
      bytes += f.size;
    }
    return { files, bytes };
  }

  /** Scans the games folder and queues every eligible file, removed ones too. */
  async function scan() {
    const r = addFiles(await scanFolder(), { undismiss: true });
    pump();
    return r;
  }

  /** After a library rebuild: queue new files by themselves (coalesced). */
  function onLibraryUpdate() {
    const s = settings();
    if (closed || !s.enabled || !s.autoQueue || autoTimer) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      const s2 = settings();
      if (closed || !s2.enabled || !s2.autoQueue) return;
      const r = addFiles(catalog().map((f) => ({ rel: f.rel, size: f.size })));
      if (!r.added) return;
      debug.log("nsz: queued %d new file(s) from the library", r.added);
      // A new file starts an idle queue; a pause by the admin or for disk or failures stays.
      if (!state.running && !state.held && !state.pausedReason) {
        state.running = true;
        fails = 0;
        save();
      }
      pump();
    }, autoDelayMs);
    autoTimer.unref?.();
  }

  // ── running ──────────────────────────────────────────────────────────
  function wake(ms) {
    const at = Date.now() + Math.max(0, ms);
    if (wakeTimer && wakeAt <= at) return;
    clearTimeout(wakeTimer);
    wakeAt = at;
    wakeTimer = setTimeout(() => { wakeTimer = null; pump(); }, Math.max(0, ms));
    wakeTimer.unref?.();
  }

  function pickNext(s) {
    const now = Date.now();
    let soonest = Infinity;
    const only = state.only ? new Set(state.only) : null;
    for (const i of state.items) {
      if (runs.has(i.id) || removing.has(i.id) || !eligibleKind(i.rel, s) || (only && !only.has(i.id))) continue;
      if (i.state === "waiting") return { item: i };
      if (i.state === "busy") {
        if ((i.retryAt ?? 0) <= now) return { item: i };
        soonest = Math.min(soonest, i.retryAt - now);
      }
    }
    return { item: null, soonest };
  }

  function record(item, patch) {
    Object.assign(item, patch);
    if (patch.state === "failed" || patch.state === "skipped") {
      state.failures.push({ at: Date.now(), rel: item.rel, reason: item.reason });
      if (state.failures.length > FAILURE_LOG) state.failures.splice(0, state.failures.length - FAILURE_LOG);
    }
    save();
  }

  function pauseFor(reason, text) {
    if (!state.running) return;
    state.running = false;
    state.pausedReason = reason;
    save();
    debug.log("nsz: paused (%s)", reason);
    alert(text, reason);
  }

  /** Starts files while there is room, the queue runs and nothing keeps them back. */
  async function pump() {
    if (pumping) { pumpAgain = true; return; }
    pumping = true;
    try {
      do {
        pumpAgain = false;
        await fill();
      } while (pumpAgain);
    } catch (err) {
      debug.error("nsz: %s", err.message);
    } finally {
      pumping = false;
    }
  }

  async function fill() {
    const s = settings();
    if (closed || !s.enabled || !state.running) { waitingFor = null; return; }
    while (runs.size < s.workers) {
      const { item, soonest } = pickNext(s);
      if (!item) {
        waitingFor = null;
        if (Number.isFinite(soonest)) wake(soonest);
        else if (runs.size === 0) drained();
        return;
      }
      const d = downloads();
      const quiet = d.active ? 0 : Date.now() - (d.lastEndedAt || 0);
      if (d.active || quiet < idleMs) {
        waitingFor = "downloads";
        wake(d.active ? Math.min(idleMs, 5000) : idleMs - quiet);
        return;
      }
      waitingFor = null;
      // The output never outgrows the original, so a file needs its own size free (plus what
      // the files already running may still write, and a little slack), and the optional floor on top.
      const busy = [...runs.keys()].reduce((n, id) => n + (find(id)?.size || 0), 0);
      const need = (item.size || 0) + busy + SPACE_SLACK + s.diskFloorGb * GIB;
      let free = await freeBytes(gamesDir);
      // Kept originals make room first, oldest first; the run pauses only when that is not enough.
      while (free < need && keptItems().length) {
        if ((await serial(() => dropKept(keptItems()[0], "space"))) == null) break;
        free = await freeBytes(gamesDir);
      }
      if (free < need) {
        pauseFor("disk", `남은 공간이 ${gb(free)}라 ${item.name || path.basename(item.rel)}(${gb(item.size || 0)})를 변환할 작업 공간이 모자라 멈췄습니다. 공간을 비운 뒤 변환 탭에서 다시 시작합니다.`);
        return;
      }
      startItem(item, s);
    }
  }

  /** Nothing left to start or running: the run ends, leaving no timer behind. */
  function drained() {
    if (state.running || state.only) {
      state.running = false;
      state.only = null;
      save();
    }
    if (!cycle.done && !cycle.failed) return;
    const text = `변환 대기열을 모두 처리했습니다. ${cycle.done}개를 변환해 ${gb(cycle.saved)}를 확보했습니다.${cycle.failed ? ` 실패 ${cycle.failed}개는 변환 탭에서 확인합니다.` : ""}`;
    cycle = { done: 0, saved: 0, failed: 0 };
    debug.log("nsz: queue drained");
    // Each drain is its own alert; the 30 minute repeat guard is for the pauses.
    alert(text, `drained-${Date.now()}`);
  }

  function startItem(item, s) {
    const outDir = path.join(workDir, item.id);
    const run = { stop: null, done: null, outDir, stopping: false };
    runs.set(item.id, run);
    record(item, { state: "running", startedAt: Date.now(), finishedAt: null, reason: null, attempts: (item.attempts ?? 0) + 1 });
    const job = track(item, () => {
      const p = progressOf(item);
      return { current: p.outBytes, total: p.expectedBytes };
    });
    run.done = convert(item, s, run)
      .catch((err) => finish(item, { state: "failed", reason: trimReason(err.message) || "알 수 없는 오류입니다." }))
      .finally(async () => {
        await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
        runs.delete(item.id);
        if (item.state === "done") job?.done(item.savedBytes ? `${gb(item.savedBytes)} 줄임` : null);
        else if (item.state === "failed") job?.fail(item.reason);
        else job?.discard();
        pump();
      });
  }

  /** Ends a file. `counts`: nsz itself failed, which counts toward pausing after MAX_FAILS in a row. */
  function finish(item, patch, { counts = false } = {}) {
    record(item, { ...patch, finishedAt: Date.now(), retryAt: patch.state === "busy" ? Date.now() + busyRetryMs : null });
    if (patch.state === "failed") {
      logEvent(item, "failed", item.reason);
      cycle.failed++;
      if (counts) fails++;
      if (fails >= MAX_FAILS) {
        fails = 0;
        pauseFor("failures", `변환이 ${MAX_FAILS}번 잇달아 실패해 멈췄습니다. 마지막 이유: ${item.reason}`);
      }
    } else if (patch.state === "done") {
      fails = 0;
    }
  }

  const changed = (st, item) => st.size !== item.size || Math.round(st.mtimeMs) !== Math.round(item.mtimeMs);
  const BUSY = (why) => ({ state: "busy", reason: why });

  async function convert(item, s, run) {
    const abs = path.join(gamesDir, item.rel);
    const target = path.join(gamesDir, targetOf(item.rel));
    const st = await fsp.stat(abs).catch(() => null);
    if (!st?.isFile()) return finish(item, { state: "skipped", reason: "파일이 없습니다." });
    if (st.size < s.minSizeMb * MIB) return finish(item, { state: "skipped", reason: "최소 크기보다 작습니다." });
    Object.assign(item, { size: st.size, mtimeMs: st.mtimeMs });
    if (fs.existsSync(target)) return finish(item, { state: "failed", reason: "같은 이름의 .nsz 가 이미 있습니다." });
    if (fileInUse(item.rel)) return finish(item, BUSY("다운로드하는 중이라 나중에 다시 합니다."));
    if (Date.now() - st.mtimeMs < recentWriteMs) return finish(item, BUSY("파일이 방금 바뀌어 나중에 다시 합니다."));
    const nsz = bin();
    if (!nsz) return finish(item, { state: "failed", reason: "nsz 를 찾지 못했습니다. COOK_NSZ_BIN 을 확인합니다." });

    await fsp.rm(run.outDir, { recursive: true, force: true });
    await fsp.mkdir(run.outDir, { recursive: true });
    const child = runNsz({ bin: nsz, args: nszArgs(s, run.outDir, abs), graceMs: killGraceMs, lowPriority });
    run.stop = child.stop;
    if (run.stopping) child.stop();
    const r = await child.done;
    if (r.stopped || run.stopping) return record(item, { state: "waiting", startedAt: null, reason: null });
    if (r.code !== 0) return finish(item, { state: "failed", reason: failureReason(r.code, r.signal, r.tail).reason }, { counts: true });

    const out = findOutput(run.outDir);
    if (!out) return finish(item, { state: "failed", reason: "결과 파일이 없습니다." }, { counts: true });
    const outSize = (await fsp.stat(out)).size;
    if (outSize >= item.size) return finish(item, { state: "failed", reason: "압축해도 줄어들지 않습니다." });

    const again = await fsp.stat(abs).catch(() => null);
    if (!again) return finish(item, { state: "skipped", reason: "변환하는 동안 파일이 사라졌습니다." });
    if (changed(again, item)) return finish(item, BUSY("변환하는 동안 파일이 바뀌어 나중에 다시 합니다."));
    if (fileInUse(item.rel)) return finish(item, BUSY("다운로드하는 중이라 나중에 다시 합니다."));
    if (fs.existsSync(target)) return finish(item, { state: "failed", reason: "같은 이름의 .nsz 가 이미 있습니다." });

    await fsp.rename(out, target);
    const keep = settings().keepHours > 0;
    try {
      if (keep) {
        await fsp.mkdir(path.dirname(keptPath(item)), { recursive: true });
        await fsp.rename(abs, keptPath(item));
      } else {
        await fsp.unlink(abs);
      }
    } catch (err) {
      onSwapped([{ rel: targetOf(item.rel), op: "upsert" }]);
      return finish(item, { state: "failed", reason: `원본을 지우지 못했습니다: ${trimReason(err.message)}` });
    }
    onSwapped([{ rel: item.rel, op: "remove" }, { rel: targetOf(item.rel), op: "upsert" }]);
    const saved = item.size - outSize;
    const stats = state.stats;
    Object.assign(stats, { converted: stats.converted + 1, savedBytes: stats.savedBytes + saved, inBytes: stats.inBytes + item.size, outBytes: stats.outBytes + outSize });
    cycle.done++;
    cycle.saved += saved;
    debug.log("nsz: %s converted, %d bytes saved", item.rel, saved);
    finish(item, { state: "done", outSize, savedBytes: saved, reason: null, ...(keep ? { keptAt: now(), keptBytes: item.size } : {}) });
    logEvent(item, "converted");
    if (keep) await purgeDue();
  }

  // ── kept originals ───────────────────────────────────────────────────
  const keptPath = (item) => path.join(keepDir, item.id, path.basename(item.rel));
  const keptItems = () => state.items.filter((i) => i.keptAt).sort((a, b) => a.keptAt - b.keptAt);
  const keptBytes = () => keptItems().reduce((n, i) => n + (i.keptBytes || 0), 0);
  const dueAt = (item, s = settings()) => item.keptAt + s.keepHours * HOUR;
  // Kept originals are deleted one at a time.
  const serial = (fn) => (keepChain = keepChain.catch(() => {}).then(fn));

  function logEvent(item, event, reason) {
    log.append({
      at: now(), id: item.id, rel: item.rel, name: item.name ?? null, from: item.rel, to: targetOf(item.rel),
      sizeBefore: item.size ?? null, sizeAfter: item.outSize ?? null, event, ...(reason ? { reason } : {}),
    });
  }

  /** Deletes one kept original and its row. Returns the bytes freed, or null when it could not be deleted. */
  async function dropKept(item, reason) {
    if (!item?.keptAt || !state.items.includes(item)) return 0;
    const had = fs.existsSync(keptPath(item));
    try {
      await fsp.rm(path.join(keepDir, item.id), { recursive: true, force: true });
    } catch (err) {
      debug.error("nsz: kept original of %s not deleted: %s", item.rel, err.message);
      return null;
    }
    if (!had) debug.log("nsz: kept original of %s was already gone", item.rel);
    logEvent(item, "original-deleted", had ? reason : "missing");
    state.items = state.items.filter((i) => i !== item);
    reindex();
    save();
    return had ? item.keptBytes || 0 : 0;
  }

  /** Deletes the kept originals past their time, then the oldest while over the cap, and sets the next timer. */
  function purgeDue() {
    return serial(async () => {
      const s = settings();
      let n = 0;
      for (const i of keptItems()) if (dueAt(i, s) <= now() && (await dropKept(i, "age")) != null) n++;
      const cap = (s.keepGb || 0) * GIB;
      if (cap > 0) {
        for (const i of keptItems()) {
          if (keptBytes() <= cap) break;
          if ((await dropKept(i, "cap")) != null) n++;
        }
      }
      scheduleKeep();
      return n;
    });
  }

  function scheduleKeep() {
    clearTimeout(keepTimer);
    keepTimer = null;
    const oldest = keptItems()[0];
    if (closed || !oldest) return;
    keepTimer = setTimeout(() => { keepTimer = null; purgeDue(); }, Math.max(0, dueAt(oldest) - now()));
    keepTimer.unref?.();
  }

  /** 지금 비우기: deletes every kept original. */
  function purgeKept() {
    return serial(async () => {
      let removed = 0;
      let bytes = 0;
      for (const i of keptItems()) {
        const b = await dropKept(i, "manual");
        if (b == null) continue;
        removed++;
        bytes += b;
      }
      scheduleKeep();
      return { removed, bytes };
    });
  }

  /**
   * On start: drop the records whose kept file is gone and the folders no record names. Without the
   * keep folder (the games disk not mounted yet) nothing is touched; a folder with no record (a lost
   * or unreadable state file, a kill before the record was saved) is only deleted once it is older
   * than the keep time, like any kept original.
   */
  async function reconcileKept() {
    if (!fs.existsSync(keepDir)) {
      if (keptItems().length) debug.log("nsz: keep folder missing, %d kept originals left as they are", keptItems().length);
      return;
    }
    for (const i of keptItems()) if (!fs.existsSync(keptPath(i))) await dropKept(i, "missing");
    const known = new Set(keptItems().map((i) => i.id));
    const maxAge = settings().keepHours * HOUR;
    for (const d of await fsp.readdir(keepDir).catch(() => [])) {
      if (known.has(d)) continue;
      const dir = path.join(keepDir, d);
      const st = await fsp.stat(dir).catch(() => null);
      if (!st || now() - st.mtimeMs < maxAge) continue;
      debug.log("nsz: kept folder %s has no record and is past the keep time, deleted", d);
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Stops every running file; each goes back to waiting and its output is dropped. */
  async function stopAll() {
    const all = [...runs.values()];
    for (const r of all) {
      r.stopping = true;
      r.stop?.();
    }
    await Promise.all(all.map((r) => r.done));
  }

  // ── what the admin page does ─────────────────────────────────────────
  async function init() {
    // A file that was running when the server stopped waits again.
    if (load()) writeNow();
    // Whatever a previous process left in the work folder is partial output.
    await fsp.rm(workDir, { recursive: true, force: true }).catch((err) => debug.error("nsz: work folder not cleaned: %s", err.message));
    await serial(reconcileKept);
    await purgeDue();
    pump();
  }

  function start() {
    state.only = null;
    state.running = true;
    state.held = false;
    state.pausedReason = null;
    fails = 0;
    save();
    pump();
  }

  /** 선택한 것만 변환: runs these rows (waiting or busy) and nothing else. Returns how many. */
  function runSelected(ids) {
    const want = new Set(ids);
    const picked = state.items.filter((i) => want.has(i.id) && (i.state === "waiting" || i.state === "busy"));
    if (!picked.length) return 0;
    Object.assign(state, { only: picked.map((i) => i.id), running: true, held: false, pausedReason: null });
    fails = 0;
    save();
    pump();
    return picked.length;
  }

  /** 대기 중인 것만 변환: the rows waiting now, and none that are added while they run. Returns how many. */
  const runWaiting = () => runSelected(state.items.filter((i) => i.state === "waiting" || i.state === "busy").map((i) => i.id));

  async function pause() {
    state.running = false;
    state.held = true;
    state.pausedReason = null;
    save();
    await stopAll();
    writeNow();
  }

  /** A setting changed: turned off, the running files stop; otherwise the queue looks again. */
  async function settingsChanged() {
    if (!settings().enabled) await stopAll();
    await purgeDue();
    pump();
  }

  function moveTop(id) {
    const item = find(id);
    if (!item) return false;
    state.items = [item, ...state.items.filter((i) => i !== item)];
    save();
    return true;
  }

  function retry(id) {
    const list = id === "all" ? state.items.filter((i) => i.state === "failed" || i.state === "skipped" || i.state === "busy") : [find(id)].filter(Boolean);
    for (const i of list) {
      if (i.state === "running" || i.state === "done") continue;
      Object.assign(i, { state: "waiting", reason: null, retryAt: null, finishedAt: null });
    }
    if (id !== "all" && !list.length) return 0;
    // 재시도 is the admin's go: an idle queue starts, a paused one stays paused.
    if (list.length && !state.running && !state.held && !state.pausedReason) state.running = true;
    save();
    pump();
    return list.length;
  }

  async function remove(id) {
    const item = find(id);
    if (!item) return false;
    const run = runs.get(id);
    removing.add(id);
    if (run) {
      run.stopping = true;
      run.stop?.();
      await run.done;
    }
    removing.delete(id);
    // Taking out a row whose original is kept deletes that original.
    if (item.keptAt) return (await serial(() => dropKept(item, "removed"))) != null;
    state.items = state.items.filter((i) => i !== item);
    if (item.state !== "done" && !state.dismissed.includes(item.rel)) state.dismissed.push(item.rel);
    reindex();
    save();
    return true;
  }

  /** 끝난 것 삭제: clears done and skipped rows; a cleared row's kept original is deleted with it. */
  async function clearFinished() {
    const finished = (i) => i.state === "done" || i.state === "skipped";
    let n = 0;
    for (const i of state.items.filter((r) => finished(r) && r.keptAt)) if ((await serial(() => dropKept(i, "cleared"))) != null) n++;
    const before = state.items.length;
    state.items = state.items.filter((i) => !finished(i) || i.keptAt);
    reindex();
    save();
    scheduleKeep();
    return n + before - state.items.length;
  }

  /** On shutdown: stop the children, keep the run state so it resumes after the restart. */
  async function shutdown() {
    closed = true;
    clearTimeout(wakeTimer);
    clearTimeout(autoTimer);
    clearTimeout(keepTimer);
    await stopAll();
    writeNow();
  }

  /** The same without waiting, for a forced exit: the children get SIGKILL. */
  function killNow() {
    closed = true;
    for (const r of runs.values()) { r.stopping = true; r.stop?.(); }
    writeNow();
  }

  // ── what the admin page reads ────────────────────────────────────────
  function progressOf(item) {
    const run = runs.get(item.id);
    const out = run ? findOutput(run.outDir) : null;
    let outBytes = 0;
    if (out) { try { outBytes = fs.statSync(out).size; } catch { /* just written over */ } }
    const { inBytes, outBytes: doneOut } = state.stats;
    // An estimate from the files done so far; with none yet the page shows a moving bar.
    const ratio = inBytes > 0 ? doneOut / inBytes : null;
    return { outBytes, expectedBytes: ratio ? Math.round(item.size * ratio) : null };
  }

  function totals() {
    const t = { waiting: 0, running: 0, done: 0, failed: 0, busy: 0, skipped: 0, waitingBytes: 0 };
    for (const i of state.items) {
      t[i.state] = (t[i.state] ?? 0) + 1;
      if (i.state === "waiting" || i.state === "busy") t.waitingBytes += i.size;
    }
    return { ...t, converted: state.stats.converted, savedBytes: state.stats.savedBytes };
  }

  /** The page's view: state, totals, the running files, and one page of the list. */
  function view({ filter = "all", offset = 0, limit = 50 } = {}) {
    const s = settings();
    const want = FILTERS[filter] ?? null;
    const rows = want ? state.items.filter((i) => want.has(i.state)) : state.items;
    const off = Math.max(0, Math.floor(Number(offset) || 0));
    const lim = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(limit) || 50)));
    const page = rows.slice(off, off + lim).map((i) => (i.state === "running" ? { ...i, ...progressOf(i) } : i.keptAt ? { ...i, keepUntil: dueAt(i, s) } : { ...i }));
    const kept = keptItems();
    const only = state.only ? state.items.filter((i) => state.only.includes(i.id) && ["waiting", "busy", "running"].includes(i.state)).length : 0;
    return {
      enabled: s.enabled,
      running: state.running,
      status: !s.enabled ? "off" : state.running ? "running" : state.held || state.pausedReason ? "paused" : "idle",
      autoQueue: Boolean(s.autoQueue),
      pausedReason: state.pausedReason,
      waitingFor,
      only,
      kept: { count: kept.length, bytes: keptBytes(), capBytes: (s.keepGb || 0) * GIB, keepHours: s.keepHours, nextAt: kept.length ? dueAt(kept[0], s) : null, now: now() },
      tool: Boolean(bin()),
      totals: totals(),
      active: state.items.filter((i) => runs.has(i.id)).map((i) => ({ ...i, ...progressOf(i) })),
      items: page,
      total: rows.length,
      offset: off,
      limit: lim,
      failures: state.failures.slice(-10).reverse(),
    };
  }

  return {
    init, start, runSelected, runWaiting, pause, scan, preview, addFiles, onLibraryUpdate, settingsChanged,
    moveTop, retry, remove, clearFinished, purgeKept, purgeDue, shutdown, killNow, view, totals,
    logPage: (q) => log.page(q), workDir, keepDir, find, pump,
    /** Test-only: resolves once nothing runs or starts. */
    async idle() {
      for (;;) {
        while (pumping) await new Promise((r) => setTimeout(r, 5));
        if (!runs.size) return;
        await Promise.all([...runs.values()].map((r) => r.done));
      }
    },
  };
}

async function defaultFreeBytes(dir) {
  const st = await fsp.statfs(dir);
  return Number(st.bavail) * Number(st.bsize);
}
