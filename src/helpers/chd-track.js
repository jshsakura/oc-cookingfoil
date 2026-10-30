/**
 * The first track of a .chd disc image as the { crc32, size } Redump lists for it, read by chdtrack
 * (docker/chdtrack, built on libchdr, BSD-3-Clause). A CHD's own header hashes cover 2448-byte frames
 * and match no list, so chdtrack decodes the image and hashes the track's sectors, writing nothing to disk.
 * A DVD image, which has no tracks, is hashed whole; a GD-ROM is not hashed. [] when there is no chdtrack, it fails, or it takes
 * too long: the caller then treats the file as one nobody could name.
 */
import { spawn, spawnSync } from "node:child_process";
import debug from "../debug.js";

const RUN_MS = 10 * 60 * 1000;

let found; // undefined until looked for once

/** The chdtrack program: COOK_CHDTRACK_BIN, else chdtrack if it runs; looked for once. Null when there is none. */
export function chdtrackBin(e = process.env, probe = () => spawnSync("chdtrack", [], { stdio: "ignore" })) {
  if (e.COOK_CHDTRACK_BIN) return e.COOK_CHDTRACK_BIN;
  found ??= probe().error ? null : "chdtrack";
  return found;
}

function run(bin, abs) {
  return new Promise((resolve) => {
    const child = spawn(bin, [abs], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_MS);
    child.stdout.on("data", (d) => { if (out.length < 256) out += d; });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? out : null); });
  });
}

let chain = Promise.resolve();

/** [{ crc32, size }] of the disc's first track, or []. One image at a time: decoding one is CPU-heavy. */
export function chdFirstTrack(abs, { bin = chdtrackBin(), exec = run } = {}) {
  if (!bin) return Promise.resolve([]);
  const job = chain.then(async () => {
    try {
      const m = /^([0-9a-f]{8}) (\d+)\s*$/.exec((await exec(bin, abs)) ?? "");
      return m ? [{ crc32: m[1], size: Number(m[2]) }] : [];
    } catch (err) {
      debug.error("chdtrack: %s", err.message);
      return [];
    }
  });
  chain = job.catch(() => {});
  return job;
}
