/**
 * Single RetroArch cores from the libretro nightly buildbot, the way RetroArch's own core
 * updater gets them on the Switch:
 *
 *   <base>/.index-extended                          one line a file: "<date> <crc32> <name>"
 *   <base>/<core>_libretro_libnx.nro.zip            one core, the .nro alone inside
 *
 * The CRC-32 the index lists is that of the .nro inside the zip. It catches a broken
 * download, not a forged one: the files come over https from the one host the base names,
 * and a redirect is followed only to that same host. Nothing larger than CORE_ZIP_MAX is
 * taken. buildbot publishes no SHA-256, so the server records the one it computes.
 *
 * Every request has three limits (TIMEOUTS, INDEX_TIMEOUTS): `connect` until the headers come,
 * `idle` with no byte of the body, and `total` for the whole download. One slow connection
 * cannot hold the pack (pack-fill.js claimFill) longer than that; it fails as a download and
 * waits for its backoff.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { extractPaths, PackError } from "./pack-bundle.js";

export const NIGHTLY_BASE = "https://buildbot.libretro.com/nightly/nintendo/switch/libnx/latest/";
export const CORE_ZIP_MAX = 256 * 1024 * 1024;
const INDEX_MAX = 1024 * 1024;
const INDEX_TTL_MS = 10 * 60_000;
const MAX_HOPS = 3;
export const TIMEOUTS = Object.freeze({ connect: 30_000, idle: 60_000, total: 10 * 60_000 });
export const INDEX_TIMEOUTS = Object.freeze({ connect: 30_000, idle: 30_000, total: 30_000 });

const zipName = (core) => `${core}_libretro_libnx.nro.zip`;
export const nroName = (core) => `${core}_libretro_libnx.nro`;

/** The index as Map core → { date, crc32, file }. Lines that do not fit are skipped. Pure. */
export function parseIndex(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+([0-9a-fA-F]{8})\s+([a-z0-9_]+)_libretro_libnx\.nro\.zip$/);
    if (m) out.set(m[3], { date: m[1], crc32: m[2].toLowerCase(), file: zipName(m[3]) });
  }
  return out;
}

const timedOut = (what) => new PackError(`${what} 시간 안에 받지 못했습니다`, { status: 504, reason: "download" });

/**
 * One download's limits: `signal` aborts the request at `total`, or when `idle()` was not called for
 * `idle` ms once armed; run(promise) turns that abort into a download failure. done() stops the timers.
 */
function deadline(what, { idle, total }) {
  const stall = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(total), stall.signal]);
  let timer = null;
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => stall.abort(), ms);
  };
  return {
    signal,
    arm,
    idle: () => arm(idle),
    done: () => clearTimeout(timer),
    run: (promise) => promise.catch((err) => {
      throw signal.aborted ? timedOut(what) : err;
    }),
  };
}

/** GET `url`, following redirects only within the base's origin (and only over https when the base is https). */
async function get(url, { base, fetchImpl = fetch, limit, connect }) {
  const origin = new URL(base).origin;
  let at = new URL(url, base);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (at.origin !== origin) throw new PackError(`${at.host} 는 코어를 받는 주소가 아닙니다`, { status: 502, reason: "download" });
    limit.arm(connect);
    const res = await limit.run(fetchImpl(at.href, { redirect: "manual", signal: limit.signal }));
    limit.done();
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      res.body?.cancel?.().catch(() => {});
      at = new URL(res.headers.get("location"), at);
      continue;
    }
    if (!res.ok || !res.body) throw new PackError(`코어를 받지 못했습니다 (HTTP ${res.status})`, { status: 502, reason: "download" });
    return res;
  }
  throw new PackError("넘겨주기가 너무 많습니다", { status: 502, reason: "download" });
}

let cached = { base: null, at: 0, index: null };

/** The nightly index, read again at most every ten minutes unless `fresh`. */
export async function fetchIndex({ base = NIGHTLY_BASE, fetchImpl, fresh = false, now = Date.now(), timeouts = INDEX_TIMEOUTS } = {}) {
  if (!fresh && cached.base === base && now - cached.at < INDEX_TTL_MS) return cached.index;
  const limit = deadline("코어 목록을", timeouts);
  let text;
  try {
    const res = await get(".index-extended", { base, fetchImpl, limit, connect: timeouts.connect });
    limit.idle();
    text = await limit.run(res.text());
  } finally {
    limit.done();
  }
  if (text.length > INDEX_MAX) throw new PackError("코어 목록이 너무 큽니다", { status: 502, reason: "download" });
  const index = parseIndex(text);
  if (!index.size) throw new PackError("코어 목록을 읽지 못했습니다", { status: 502, reason: "download" });
  cached = { base, at: now, index };
  return index;
}

/** Forgets the cached index (tests, and the admin's update action). */
export const forgetIndex = () => {
  cached = { base: null, at: 0, index: null };
};

/**
 * Downloads `core`'s zip into `dir` and unpacks its .nro there. `room(bytes)` is asked first with the
 * size the server announces (or the cap) and throws to refuse. Returns the .nro's path.
 */
export async function fetchCore(core, { base = NIGHTLY_BASE, fetchImpl, dir, room = async () => {}, bin, max = CORE_ZIP_MAX, timeouts = TIMEOUTS }) {
  await fsp.mkdir(dir, { recursive: true });
  const limit = deadline(`${core} 코어를`, timeouts);
  const zip = path.join(dir, zipName(core));
  try {
    const res = await get(zipName(core), { base, fetchImpl, limit, connect: timeouts.connect });
    const announced = Number(res.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > max) {
      res.body.cancel().catch(() => {});
      throw new PackError(`${core} 코어 파일이 너무 큽니다`, { status: 502, reason: "too-large" });
    }
    try {
      await room(Number.isFinite(announced) && announced > 0 ? announced : max);
    } catch (err) {
      res.body.cancel().catch(() => {});
      throw err;
    }
    let done = 0;
    const cap = new Transform({
      transform(chunk, _enc, cb) {
        limit.idle();
        done += chunk.length;
        cb(done > max ? new PackError(`${core} 코어 파일이 너무 큽니다`, { status: 502, reason: "too-large" }) : null, chunk);
      },
    });
    limit.idle();
    await limit.run(pipeline(Readable.fromWeb(res.body), cap, fs.createWriteStream(zip)));
  } finally {
    limit.done();
  }
  const out = path.join(dir, "out");
  await extractPaths(zip, out, [nroName(core)], { bin });
  const nro = path.join(out, nroName(core));
  const st = await fsp.lstat(nro);
  if (!st.isFile() || st.size > max) throw new PackError(`${core} 코어 압축 안의 파일이 맞지 않습니다`, { status: 502, reason: "bad-zip" });
  return nro;
}
