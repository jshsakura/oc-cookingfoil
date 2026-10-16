/**
 * SHA-256 of one byte range of a file, read in a low-priority child process
 * (nice/ionice, see nsz-runner.js lowPriorityPrefix) so a whole-file check
 * yields the disks to downloads. Run directly, this file is that child:
 *
 *   node hash-range.js <file> <start> <size>   → prints the hex digest
 */
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import { fileURLToPath } from "url";

const SELF = fileURLToPath(import.meta.url);

/** The digest of `size` bytes at `start`, streamed in this process. */
export function hashRangeHere(file, start, size) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    if (size <= 0) return resolve(hash.digest("hex"));
    let seen = 0;
    fs.createReadStream(file, { start, end: start + size - 1, highWaterMark: 1 << 20 })
      .on("data", (chunk) => { seen += chunk.length; hash.update(chunk); })
      .on("error", reject)
      .on("end", () => (seen === size ? resolve(hash.digest("hex")) : reject(new Error("range is truncated"))));
  });
}

/**
 * The same in a child. Rejects with an AbortError when `signal` aborts (the
 * child is killed) and with the child's message when it fails.
 */
export async function hashRange(file, start, size, { signal, lowPriority = true } = {}) {
  // Imported here so the child itself loads nothing but this file.
  const prefix = lowPriority ? (await import("./nsz-runner.js")).lowPriorityPrefix() : [];
  const argv = [...prefix, process.execPath, SELF, file, String(start), String(size)];
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const abort = () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err = (err + c).slice(-500); });
    child.once("error", (e) => { signal?.removeEventListener("abort", abort); reject(e); });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      const hex = out.trim();
      if (code === 0 && /^[0-9a-f]{64}$/.test(hex)) resolve(hex);
      else reject(new Error(err.trim() || `hash child exit ${code}`));
    });
  });
}

if (process.argv[1] === SELF) {
  const [file, start, size] = process.argv.slice(2);
  hashRangeHere(file, Number(start), Number(size)).then(
    (hex) => process.stdout.write(`${hex}\n`),
    (e) => { process.stderr.write(e.message); process.exit(1); },
  );
}
