/**
 * The access log: one JSON line for each request worth a look, so that when a
 * console reports a timeout we can tell a request that reached the server from
 * one that never did. A request with no line here did not get this far.
 *
 * Logged: everything on the direct address, plus any request that failed (4xx,
 * 5xx), was cut off before the answer finished, or took SLOW_MS or longer.
 * Quick successful requests elsewhere are left out; a console install is
 * hundreds of them.
 *
 *   { t, route, dev, m, path, status, ms, aborted }
 *
 * `dev` is the first eight characters of the console's device key (nothing more
 * of it is kept), `path` has no query string, `status` is 0 when no answer had
 * started, `route` is direct, tunnel, lan or other (transfer-track.js).
 *
 * It lives in ${COOK_DATA_DIR}/access-log.jsonl, so it survives a new container.
 * The file is capped at MAX_BYTES: when it would pass that it becomes
 * access-log.jsonl.1 (replacing the older one) and a new file starts. Lines
 * older than the admin's 기록 보관 기간 (logKeepDays) are dropped when the log
 * starts writing and at every rollover. Writes are batched and never block a
 * request.
 */
import path from "node:path";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as env from "./envs.js";
import debug from "../debug.js";
import { pathOf, requesterOf, routeOf } from "./transfer-track.js";
import { socketIp } from "../security/net.js";

export const MAX_BYTES = 4 * 1024 * 1024;
export const SLOW_MS = 5_000;
const FLUSH_MS = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether an entry is worth a line. Pure. */
export function shouldLog(e, slowMs = SLOW_MS) {
  return e.route === "direct" || e.status >= 400 || e.aborted || e.ms >= slowMs;
}

/** The entry for a request whose response has closed after `ms`. */
export function entryOf(req, res, ms, now = Date.now()) {
  const route = routeOf({ lane: req.cookingfoilLane, headers: req.headers, peer: socketIp(req) });
  const who = requesterOf(req, "");
  return {
    t: new Date(now).toISOString(),
    route,
    dev: who.kind === "device" ? who.id : null,
    // Only the authenticated direct lane sets this address. It lets the operator
    // join an edge firewall decision to the proven requester, including shared IPs.
    ...(req.cookingfoilLane === "direct" && req.directClient ? { client: req.directClient, who: { kind: who.kind, id: who.id, label: who.label } } : {}),
    m: req.method,
    path: pathOf(req),
    status: res.headersSent ? res.statusCode : 0,
    ms,
    aborted: !res.writableFinished,
  };
}

export function createAccessLog({
  file = path.join(env.dataDir, "access-log.jsonl"),
  maxBytes = MAX_BYTES,
  keepMs = () => env.logKeepDays * DAY_MS,
} = {}) {
  const older = `${file}.1`;
  let pending = [];
  let timer = null;
  let size = null; // null until the file has been looked at and pruned
  let chain = Promise.resolve();

  /** Drops what is past the keep time from the file and removes an old older file. */
  async function prune() {
    const cutoff = Date.now() - keepMs();
    const mtime = await stat(older).then((s) => s.mtimeMs, () => null);
    if (mtime !== null && mtime < cutoff) await rm(older, { force: true });
    const text = await readFile(file, "utf8").catch(() => "");
    const kept = text.split("\n").filter((l) => {
      if (!l) return false;
      try { return Date.parse(JSON.parse(l).t) >= cutoff; } catch { return false; }
    });
    const out = kept.length ? kept.join("\n") + "\n" : "";
    if (out !== text) await writeFile(file, out);
    size = Buffer.byteLength(out);
  }

  async function write() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    try {
      await mkdir(path.dirname(file), { recursive: true });
      if (size === null) await prune();
      let chunk = "";
      for (const line of batch) {
        const bytes = Buffer.byteLength(line);
        if (size + Buffer.byteLength(chunk) + bytes > maxBytes) {
          if (chunk) await appendFile(file, chunk);
          chunk = "";
          await rename(file, older).catch(() => {});
          size = 0;
          await prune();
        }
        chunk += line;
      }
      if (chunk) {
        await appendFile(file, chunk);
        size += Buffer.byteLength(chunk);
      }
    } catch (err) {
      debug.error("access log: write failed: %s", err.message);
    }
  }

  return {
    record(entry) {
      pending.push(JSON.stringify(entry) + "\n");
      if (!timer) {
        timer = setTimeout(() => { timer = null; chain = chain.then(write); }, FLUSH_MS);
        timer.unref?.();
      }
    },
    /** Writes what is waiting; resolves when it is on disk. */
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      chain = chain.then(write);
      return chain;
    },
  };
}

const accessLogger = createAccessLog();

/** Middleware: mounted first, it sees every request, including the ones refused later. */
export function accessLog({ log = accessLogger, slowMs = SLOW_MS } = {}) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("close", () => {
      try {
        const e = entryOf(req, res, Number((process.hrtime.bigint() - start) / 1_000_000n));
        if (shouldLog(e, slowMs)) log.record(e);
      } catch (err) {
        debug.error("access log: %s", err.message);
      }
    });
    next();
  };
}
