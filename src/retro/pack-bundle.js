/**
 * The official RetroArch bundle the pack lock pins (data/retro-pack.lock.json):
 * download it into <data>/retro-pack-cache/<version>/ so that an interrupted
 * download carries on, check its SHA-256 against the lock, and unpack only the
 * paths the server wants with 7-Zip.
 *
 * A file whose hash is not the lock's is deleted and refused: nothing from it
 * is ever unpacked.
 */
import crypto from "crypto";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

export const lock = JSON.parse(fs.readFileSync(new URL("./data/retro-pack.lock.json", import.meta.url), "utf8"));

export class PackError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "PackError";
    Object.assign(this, extra);
  }
}

/** SHA-256 of a file, read in a stream. */
export async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

const CANDIDATES = ["7z", "7zz", "7za", "7zr"];

/** The 7-Zip program: COOK_7Z_BIN, else the first of 7z, 7zz, 7za, 7zr that runs. Null when none does. */
export function sevenZipBin(env = process.env) {
  if (env.COOK_7Z_BIN) return env.COOK_7Z_BIN;
  return CANDIDATES.find((bin) => !spawnSync(bin, ["i"], { stdio: "ignore" }).error) ?? null;
}

const rangeFrom = (res) => /^bytes (\d+)-/.exec(res.headers.get("content-range") ?? "")?.[1];

/**
 * The bundle at `cacheDir/<file>`, complete and verified. A finished download that is already there is
 * checked and reused; a part carries on with a Range request; a hash that does not match deletes the
 * file and throws. `onProgress({ done, total })` is called as bytes arrive.
 */
export async function downloadBundle({ url, file = lock.bundle.file, size = lock.bundle.size, sha256 = lock.bundle.sha256, cacheDir, fetchImpl = fetch, onProgress = () => {} }) {
  await fsp.mkdir(cacheDir, { recursive: true });
  const dest = path.join(cacheDir, file);
  const have = async () => (await fsp.stat(dest).catch(() => null))?.size ?? 0;
  let at = await have();
  if (at === size) {
    if ((await sha256File(dest)) === sha256) return { file: dest, downloaded: false };
    await fsp.rm(dest, { force: true });
    at = 0;
  } else if (at > size) {
    await fsp.rm(dest, { force: true });
    at = 0;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { headers: at ? { Range: `bytes=${at}-` } : {}, redirect: "follow" });
    if (res.status === 416) {
      await fsp.rm(dest, { force: true });
      at = 0;
      continue;
    }
    if (!res.ok || !res.body) throw new PackError(`번들을 받지 못했습니다 (HTTP ${res.status})`, { status: 502 });
    // A server that ignores Range sends the whole file with 200: start over.
    const resume = at > 0 && res.status === 206 && Number(rangeFrom(res)) === at;
    if (!resume) at = 0;
    let done = at;
    const count = new Transform({ transform(chunk, _enc, cb) { done += chunk.length; onProgress({ done, total: size }); cb(null, chunk); } });
    await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(dest, { flags: resume ? "a" : "w" }));
    break;
  }
  if ((await have()) !== size || (await sha256File(dest)) !== sha256) {
    await fsp.rm(dest, { force: true });
    throw new PackError("받은 번들의 SHA-256 이 맞지 않아 지웠습니다. 설치하지 않습니다", { status: 502, hashMismatch: true });
  }
  return { file: dest, downloaded: true };
}

/**
 * Unpacks only `paths` (files or folders inside the archive) into `outDir`. 7-Zip's warning exit (1) is
 * accepted when every wanted path is there afterwards; anything else throws.
 */
export async function extractPaths(archive, outDir, paths, { bin = sevenZipBin() } = {}) {
  if (!bin) throw new PackError("7-Zip 이 없어 번들을 풀 수 없습니다 (COOK_7Z_BIN)", { status: 500 });
  await fsp.mkdir(outDir, { recursive: true });
  const code = await new Promise((resolve, reject) => {
    const child = spawn(bin, ["x", "-y", "-bd", "-aoa", `-o${outDir}`, "--", archive, ...paths], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err = (err + d).slice(-500); });
    child.on("error", reject);
    child.on("close", (c) => resolve(c === 0 || c === 1 ? 0 : Object.assign(new Error(err.trim() || `7z exit ${c}`), { code: c })));
  });
  if (code !== 0) throw new PackError(`번들을 풀지 못했습니다: ${code.message}`, { status: 500 });
  for (const p of paths) {
    if (!(await fsp.lstat(path.join(outDir, p)).catch(() => null))) throw new PackError(`번들에 ${p} 가 없습니다`, { status: 500 });
  }
}
