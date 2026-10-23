/**
 * xdelta (VCDIFF) through the xdelta3 program: `xdelta3 -d -s <source> <patch> <out>`. xdelta3
 * checks the checksums the patch carries and exits non-zero when the source or the result is
 * wrong, so a zero exit is the verification. Without the program, a clear error says so.
 */
import { execFile } from "child_process";
import { RomPatchError } from "./error.js";

export const XDELTA_BIN = "xdelta3";
// A big disc image takes a while; past this the run is stopped and counted as failed.
const TIMEOUT_MS = 30 * 60 * 1000;

/** Writes the result of `patchPath` over `sourcePath` to `outPath`. */
export function applyXdelta(sourcePath, patchPath, outPath, { bin = XDELTA_BIN } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, ["-d", "-f", "-s", sourcePath, patchPath, outPath], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
      if (!err) return resolve();
      if (err.code === "ENOENT") return reject(new RomPatchError("xdelta-missing", `${bin} is not installed on the server`, 501));
      reject(new RomPatchError("xdelta-failed", `xdelta3 refused the patch: ${String(stderr || err.message).trim().split("\n").pop()}`));
    });
  });
}
