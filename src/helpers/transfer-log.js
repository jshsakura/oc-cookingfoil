/**
 * Download records: which way each download came in and how fast it went.
 *
 * A console fetches one file over several connections, each a run of Range
 * requests, so single requests say little. Requests for the same file from the
 * same requester on the same route are grouped into one transfer. A transfer
 * stays open while its requests keep coming and closes QUIET_MS after the last
 * one ended; it is then logged in one line and kept with the last MAX_RECENT
 * others, which are saved to ${COOK_DATA_DIR}/transfers.json (debounced, tmp +
 * rename) and read back on start.
 *
 * Speed is bytes over active time: the wall time during which at least one of
 * its requests was in flight, so a pause between two tries does not count.
 *
 * The request side (what a request is, who sent it, which route) is in
 * transfer-track.js; this file only adds up what it is told. Nothing here runs
 * per chunk and nothing touches the disk synchronously.
 */
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dataDir } from "./envs.js";
import debug from "../debug.js";
import { DOWNLOAD_BYTES as LIVE_BYTES } from "../security/drain.js";

export const QUIET_MS = 20_000;
// A downloader still counts this long after its last piece (see downloaders()).
export const BUSY_WITHIN_MS = 5_000;
export const MAX_RECENT = 500;
// Open transfers kept at once; past this the quietest is closed early.
export const MAX_OPEN = 256;
// Byte ranges kept per transfer to tell whether the whole file went out.
const MAX_SPANS = 512;
const PERSIST_DELAY_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const ROUTES = ["tunnel", "direct", "lan", "other"];

const MB = 1e6;

/** MB/s with one decimal for `bytes` over `ms`, or null when no time passed. Pure. */
export function mbpsOf(bytes, ms) {
  if (!(ms > 0)) return null;
  return Math.round((bytes / MB / (ms / 1000)) * 10) / 10;
}

/** "2.10 GB" / "512.0 MB" / "800 KB", decimal units like the speed. Pure. */
export function sizeText(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.round(n / 1000)} KB`;
}

/** Adds [start, end) to sorted, merged `spans` (mutated, kept bounded). Returns false once they overflow. */
export function addSpan(spans, start, end) {
  if (!(end > start)) return true;
  let i = 0;
  while (i < spans.length && spans[i][1] < start) i++;
  let s = start, e = end, j = i;
  while (j < spans.length && spans[j][0] <= e) {
    s = Math.min(s, spans[j][0]);
    e = Math.max(e, spans[j][1]);
    j++;
  }
  spans.splice(i, j - i, [s, e]);
  return spans.length <= MAX_SPANS;
}

const covers = (spans, size) => size > 0 && spans.length === 1 && spans[0][0] === 0 && spans[0][1] >= size;

function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.round(((v[mid - 1] + v[mid]) / 2) * 10) / 10;
}

/** Count, median and best MB/s per route for the records that ended after `since`. Pure. */
export function summarize(records, since) {
  const out = {};
  for (const route of ROUTES) {
    const mine = records.filter((r) => r.route === route && r.endedAt >= since);
    const speeds = mine.filter((r) => r.mbps != null).map((r) => r.mbps);
    out[route] = { count: mine.length, medianMbps: median(speeds), bestMbps: speeds.length ? Math.max(...speeds) : null };
  }
  return out;
}

const ROUTE_WORD = { tunnel: "tunnel", direct: "direct", lan: "lan", other: "other" };

/** The one log line of a finished transfer. Pure. */
export function logLine(r) {
  const secs = Math.round((r.activeMs ?? 0) / 1000);
  const speed = r.mbps == null ? "?" : r.mbps.toFixed(1);
  const whole = r.complete ? "whole file" : "partial";
  return `transfer: ${r.file.name} ${sizeText(r.bytes)} in ${secs} s = ${speed} MB/s, route ${ROUTE_WORD[r.route] ?? r.route}, ` +
    `${r.peakConnections} connections (peak), ${r.requests} requests, ${whole}, ${r.who.label}, client ${r.client || "unknown"}`;
}

const isRecord = (r) => r && typeof r === "object" && typeof r.id === "string" && Number.isFinite(r.startedAt) &&
  Number.isFinite(r.endedAt) && ROUTES.includes(r.route) && r.file && typeof r.file.name === "string" &&
  Number.isFinite(r.bytes) && r.who && typeof r.who.label === "string";

/**
 * One recorder. `file` is where records are saved (null: memory only), `now`
 * the clock, `log` where the finished-transfer line goes.
 */
export function createTransferLog({
  file = path.join(dataDir, "transfers.json"),
  now = Date.now,
  quietMs = QUIET_MS,
  maxRecent = MAX_RECENT,
  maxOpen = MAX_OPEN,
  persistDelayMs = PERSIST_DELAY_MS,
  log = (line) => debug.log("%s", line),
} = {}) {
  const open = new Map(); // key → transfer
  let recent = []; // newest first
  let seq = 0;
  let sweepTimer = null;
  let persistTimer = null;
  let writing = null;

  const newId = () => `${now().toString(36)}-${(seq++).toString(36)}`;

  function ensureSweep() {
    if (sweepTimer || !open.size) return;
    sweepTimer = setInterval(() => sweep(), Math.max(250, Math.floor(quietMs / 4)));
    sweepTimer.unref?.();
  }

  function stopSweepIfIdle() {
    if (sweepTimer && !open.size) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  /** Makes room for one more open transfer: the one quiet longest goes first, else the oldest. */
  function makeRoom() {
    if (open.size < maxOpen) return;
    let victim = null;
    for (const t of open.values()) {
      const better = !victim || (t.inflight === 0 && victim.inflight > 0) ||
        ((t.inflight === 0) === (victim.inflight === 0) && t.lastAt < victim.lastAt);
      if (better) victim = t;
    }
    if (victim) finish(victim);
  }

  /**
   * A request for a download started. `meta` = { key, route, file: { path, name },
   * client, who: { kind, id, label }, remote: { scope, country }, ranged }.
   * `probe()` returns the body bytes this request has sent so far (only read
   * for the live view). Returns the handle to pass to end().
   */
  function begin(meta, probe = () => 0) {
    const t0 = now();
    let t = open.get(meta.key);
    if (!t) {
      makeRoom();
      t = {
        id: newId(), key: meta.key, startedAt: t0, lastAt: t0, route: meta.route,
        file: { ...meta.file }, fileSize: null, bytes: 0, requests: 0, inflight: 0,
        peakConnections: 0, activeMs: 0, activeSince: null, spans: [], spansLost: false,
        client: meta.client ?? "", who: { ...meta.who }, remote: { ...meta.remote },
        live: new Set(), counted: false,
      };
      open.set(meta.key, t);
      ensureSweep();
    }
    if (t.inflight === 0) t.activeSince = t0;
    t.inflight++;
    const handle = { t, probe, ended: false, ranged: Boolean(meta.ranged), together: t.inflight };
    // How many ran at once, seen by each request still running: the peak counts only downloads.
    for (const h of t.live) h.together = Math.max(h.together, t.inflight);
    t.live.add(handle);
    t.lastAt = t0;
    return handle;
  }

  /**
   * The request ended (finished or cut). `info` = { download, sent, size,
   * start, name }: whether it counts as a download, the body bytes that went
   * out, the whole file's size if known, the offset it started at, and a better
   * display name when the response gave one.
   */
  function end(handle, { download = false, sent = 0, size = null, start = 0, name = null } = {}) {
    if (handle.ended) return;
    handle.ended = true;
    const t = handle.t;
    t.live.delete(handle);
    const t1 = now();
    t.inflight = Math.max(0, t.inflight - 1);
    if (t.inflight === 0 && t.activeSince != null) {
      t.activeMs += t1 - t.activeSince;
      t.activeSince = null;
    }
    t.lastAt = t1;
    if (!download || open.get(t.key) !== t) return;
    t.counted = true;
    t.requests++;
    t.peakConnections = Math.max(t.peakConnections, handle.together);
    t.bytes += Math.max(0, sent);
    if (Number.isFinite(size) && size > 0) t.fileSize = size;
    if (name) t.file.name = name;
    if (!t.spansLost && !addSpan(t.spans, start, start + Math.max(0, sent))) t.spansLost = true;
  }

  function liveBytes(t) {
    let n = t.bytes;
    for (const h of t.live) n += Math.max(0, Number(h.probe()) || 0);
    return n;
  }

  function activeMsOf(t, at) {
    return t.activeMs + (t.activeSince != null ? at - t.activeSince : 0);
  }

  function recordOf(t, endedAt) {
    const activeMs = activeMsOf(t, endedAt);
    return {
      id: t.id, startedAt: t.startedAt, endedAt, file: { path: t.file.path, name: t.file.name },
      fileSize: t.fileSize, bytes: t.bytes, requests: t.requests, peakConnections: t.peakConnections,
      route: t.route, client: t.client, who: { kind: t.who.kind, id: t.who.id, label: t.who.label },
      remote: { scope: t.remote.scope, country: t.remote.country ?? null },
      activeMs, mbps: mbpsOf(t.bytes, activeMs),
      complete: !t.spansLost && covers(t.spans, t.fileSize),
    };
  }

  function finish(t) {
    open.delete(t.key);
    for (const h of t.live) h.ended = true;
    t.live.clear();
    stopSweepIfIdle();
    if (!t.counted) return null;
    const rec = recordOf(t, t.inflight > 0 ? now() : t.lastAt);
    recent.unshift(rec);
    if (recent.length > maxRecent) recent.length = maxRecent;
    try { log(logLine(rec)); } catch { /* a log sink never stops the record */ }
    schedulePersist();
    return rec;
  }

  /** Closes the transfers that have been quiet for quietMs. Returns how many closed. */
  function sweep(at = now()) {
    let closed = 0;
    for (const t of [...open.values()]) {
      if (t.inflight === 0 && at - t.lastAt >= quietMs) {
        finish(t);
        closed++;
      }
    }
    return closed;
  }

  async function flush() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    if (!file) return;
    while (writing) await writing;
    writing = (async () => {
      try {
        await mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp.${process.pid}`;
        await writeFile(tmp, JSON.stringify({ version: 1, transfers: recent }));
        await rename(tmp, file);
      } catch (err) {
        debug.error("transfers: save failed: %s", err.message);
      } finally {
        writing = null;
      }
    })();
    await writing;
  }

  function schedulePersist() {
    if (!file || persistTimer) return;
    persistTimer = setTimeout(() => { persistTimer = null; flush().catch(() => {}); }, persistDelayMs);
    persistTimer.unref?.();
  }

  /** Reads the saved records; ones already recorded since start stay first. */
  async function load() {
    if (!file) return 0;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch {
      return 0;
    }
    const seen = new Set(recent.map((r) => r.id));
    const saved = (Array.isArray(parsed?.transfers) ? parsed.transfers : []).filter((r) => isRecord(r) && !seen.has(r.id));
    recent = [...recent, ...saved].sort((a, b) => b.endedAt - a.endedAt).slice(0, maxRecent);
    return saved.length;
  }

  /** Closes everything still open (a restart) and saves. */
  async function shutdown() {
    for (const t of [...open.values()]) finish(t);
    await flush();
  }

  // A running request shows as a download once it is a Range request or has sent DOWNLOAD_BYTES.
  const looksLive = (t) => t.counted || [...t.live].some((h) => h.ranged || Number(h.probe()) >= LIVE_BYTES);

  /** The open transfers that are downloads, with live bytes and speed, newest first. */
  function active(at = now()) {
    return [...open.values()].filter(looksLive)
      .map((t) => {
        const rec = recordOf(t, at);
        rec.bytes = liveBytes(t);
        rec.mbps = mbpsOf(rec.bytes, rec.activeMs);
        rec.peakConnections = Math.max(rec.peakConnections, ...[...t.live].map((h) => h.together));
        rec.inflight = t.inflight;
        rec.endedAt = null;
        return rec;
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /** What the admin page shows: open transfers, recent ones (optionally of one route) and the last day per route. */
  function snapshot({ route = null, limit = 200, at = now() } = {}) {
    const list = route ? recent.filter((r) => r.route === route) : recent;
    const live = active(at);
    return {
      active: route ? live.filter((r) => r.route === route) : live,
      recent: list.slice(0, Math.max(0, limit)),
      total: list.length,
      summary: summarize(recent, at - DAY_MS),
      quietSeconds: Math.round(quietMs / 1000),
    };
  }

  /**
   * How many consoles (or accounts, or addresses) are downloading right now: a request in
   * flight, or one that ended within `withinMs` (a console pauses between Range pieces).
   */
  function downloaders(at = now(), withinMs = BUSY_WITHIN_MS) {
    const who = new Set();
    for (const t of open.values()) if (t.inflight > 0 || at - t.lastAt < withinMs) who.add(`${t.who.kind}:${t.who.id}`);
    return who.size;
  }

  return {
    begin, end, sweep, flush, load, shutdown, snapshot, active, downloaders,
    openCount: () => open.size,
    recentCount: () => recent.length,
  };
}

/** The server's own recorder. */
const transferLog = createTransferLog();
export default transferLog;
