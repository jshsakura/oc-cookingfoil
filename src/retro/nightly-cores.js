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

/** GET `url`, following redirects only within the base's origin (and only over https when the base is https). */
async function get(url, { base, fetchImpl = fetch }) {
  const origin = new URL(base).origin;
  let at = new URL(url, base);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (at.origin !== origin) throw new PackError(`${at.host} 는 코어를 받는 주소가 아닙니다`, { status: 502, reason: "download" });
    const res = await fetchImpl(at.href, { redirect: "manual" });
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
export async function fetchIndex({ base = NIGHTLY_BASE, fetchImpl, fresh = false, now = Date.now() } = {}) {
  if (!fresh && cached.base === base && now - cached.at < INDEX_TTL_MS) return cached.index;
  const res = await get(".index-extended", { base, fetchImpl });
  const text = await res.text();
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
export async function fetchCore(core, { base = NIGHTLY_BASE, fetchImpl, dir, room = async () => {}, bin, max = CORE_ZIP_MAX }) {
  await fsp.mkdir(dir, { recursive: true });
  const res = await get(zipName(core), { base, fetchImpl });
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
  const zip = path.join(dir, zipName(core));
  let done = 0;
  const cap = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      cb(done > max ? new PackError(`${core} 코어 파일이 너무 큽니다`, { status: 502, reason: "too-large" }) : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), cap, fs.createWriteStream(zip));
  const out = path.join(dir, "out");
  await extractPaths(zip, out, [nroName(core)], { bin });
  const nro = path.join(out, nroName(core));
  const st = await fsp.lstat(nro);
  if (!st.isFile() || st.size > max) throw new PackError(`${core} 코어 압축 안의 파일이 맞지 않습니다`, { status: 502, reason: "bad-zip" });
  return nro;
}
