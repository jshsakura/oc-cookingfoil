/**
 * Error logs a console sends in (the CookingFoil client's log.txt tail), so
 * the operator can read what went wrong on the hardware.
 *
 *   POST /api/client/log    text/plain body (64 KB at most, else 413),
 *                           X-Log-Reason: a short, URL-encoded reason; Version: the app version
 *                           → 204, or 429 past 5 a minute per console
 *
 * Kept at <data dir>/client/logs/<first 8 of the device key>/<YYYYMMDD-HHMMSS>.txt
 * (UTC) plus latest.txt, the newest 50 per console. Files take the owner of
 * the client folder, so the host user can read them. Same sign-in as the rest.
 *
 * The limits follow the account that signed in, not the device key it sends
 * (any signed-in client can make up keys): 5 logs a minute per account, and an
 * account may start at most MAX_CONSOLES_PER_ACCOUNT console folders (each
 * folder's .owner names who started it). Across all accounts there are at most
 * MAX_FOLDERS folders and MAX_TOTAL_BYTES of logs; past that the oldest logs go.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import express from "express";
import { dataDir } from "../helpers/envs.js";
import { deviceKeyFromHeaders } from "../security/pairing.js";
import debug from "../debug.js";
import { tooManyRequests } from "../security/retry-after.js";
import { ownerKey } from "../security/link-identity.js";

export const LOGS_DIR = path.join(dataDir, "client", "logs");
const MAX_BYTES = 64 * 1024;
const KEEP = 50;
const PER_MINUTE = 5;
const REASON_MAX = 200;
const STAMP_RE = /^\d{8}-\d{6}(-\d+)?\.txt$/;
const PREFIX_RE = /^[0-9a-f]{8}$/;
const OWNER_FILE = ".owner";
export const MAX_CONSOLES_PER_ACCOUNT = 8;
export const MAX_FOLDERS = 256;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const recent = new Map(); // account → send times in the last minute

/** Who a log counts against: the signed-in account, else the paired console itself. */
export const ownerOf = ownerKey;

/** The console folders there are, with who started each. */
async function folders() {
  const names = (await fsp.readdir(LOGS_DIR).catch(() => [])).filter((p) => PREFIX_RE.test(p));
  return Promise.all(names.map(async (prefix) => ({
    prefix,
    owner: (await fsp.readFile(path.join(LOGS_DIR, prefix, OWNER_FILE), "utf8").catch(() => "")).trim(),
  })));
}

/** Why `owner` may not start a folder for `prefix` now, or null when it may. */
export async function folderRefusal(prefix, owner) {
  if (fs.existsSync(path.join(LOGS_DIR, prefix))) return null;
  const all = await folders();
  if (all.length >= MAX_FOLDERS) return "log storage is full";
  if (all.filter((f) => f.owner === owner).length >= MAX_CONSOLES_PER_ACCOUNT) return "too many consoles send logs for this account";
  return null;
}

/** Removes the oldest logs, across every console, until all of them fit in `maxBytes`. */
export async function trimTotal(maxBytes = MAX_TOTAL_BYTES) {
  const files = [];
  for (const { prefix } of await folders()) {
    const dir = path.join(LOGS_DIR, prefix);
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      const st = await fsp.stat(path.join(dir, name)).catch(() => null);
      if (st?.isFile()) files.push({ file: path.join(dir, name), name, size: st.size, stamp: STAMP_RE.test(name) });
    }
  }
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const f of files.filter((x) => x.stamp).sort((a, b) => a.name.localeCompare(b.name))) {
    if (total <= maxBytes) break;
    await fsp.rm(f.file, { force: true });
    total -= f.size;
  }
}

/** The reason header, decoded, one line, at most REASON_MAX characters. Pure. */
export function cleanReason(raw) {
  let s = String(raw ?? "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // not encoded after all; keep it as sent
  }
  return s.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, REASON_MAX);
}

/** "20261012-083015" for a time, in UTC. Pure. */
export function stampOf(date) {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function tooOften(prefix, now = Date.now()) {
  const times = (recent.get(prefix) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= PER_MINUTE) {
    recent.set(prefix, times);
    return Math.ceil((60_000 - (now - times[0])) / 1000);
  }
  recent.set(prefix, [...times, now]);
  return 0;
}

/** Hand a new file or folder to whoever owns the client folder (the host user). */
async function ownLikeParent(target) {
  try {
    const st = await fsp.stat(path.dirname(LOGS_DIR));
    await fsp.chown(target, st.uid, st.gid);
  } catch {
    // not root, or a filesystem without owners: leave it
  }
}

export async function keepNewest(dir) {
  const files = (await fsp.readdir(dir)).filter((f) => STAMP_RE.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) await fsp.rm(path.join(dir, f), { force: true });
}

export function mountClientLog(router) {
  router.post("/log", express.text({ type: "text/plain", limit: MAX_BYTES }), async (req, res, next) => {
    try {
      const deviceKey = deviceKeyFromHeaders(req);
      if (!deviceKey) return res.status(400).json({ error: "send the console's device key (X-Device-Key)" });
      if (typeof req.body !== "string") return res.status(415).json({ error: "send the log as text/plain" });
      const prefix = deviceKey.slice(0, 8).toLowerCase();
      if (!PREFIX_RE.test(prefix)) return res.status(400).json({ error: "send the console's device key (X-Device-Key)" });
      const owner = ownerOf(req);
      const wait = tooOften(owner);
      if (wait) {
        return tooManyRequests(res, wait).json({ error: "too many logs; wait a minute" });
      }
      const refusal = await folderRefusal(prefix, owner);
      if (refusal) return tooManyRequests(res, 3600).json({ error: refusal });
      const now = new Date();
      const version = String(req.get("Version") ?? "").replace(/[^\w.+-]/g, "").slice(0, 40) || "unknown";
      const head = `# received ${now.toISOString()} · version ${version} · reason ${cleanReason(req.get("X-Log-Reason")) || "-"}\n`;
      const dir = path.join(LOGS_DIR, prefix);
      const fresh = !fs.existsSync(dir);
      await fsp.mkdir(dir, { recursive: true });
      if (fresh) {
        await fsp.writeFile(path.join(dir, OWNER_FILE), `${owner}\n`);
        await ownLikeParent(LOGS_DIR);
        await ownLikeParent(dir);
      }
      let name = `${stampOf(now)}.txt`;
      for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${stampOf(now)}-${n}.txt`;
      const text = head + req.body;
      for (const f of [name, "latest.txt"]) {
        const file = path.join(dir, f);
        await fsp.writeFile(`${file}.tmp`, text);
        await fsp.rename(`${file}.tmp`, file);
        await ownLikeParent(file);
      }
      await keepNewest(dir);
      await trimTotal();
      debug.log("client log: %s… sent %d bytes (%s)", prefix, Buffer.byteLength(req.body), version);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
  // An oversized body: say so plainly rather than with the generic error page.
  router.use("/log", (err, req, res, next) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: `logs are ${MAX_BYTES} bytes at most` });
    next(err);
  });
}
