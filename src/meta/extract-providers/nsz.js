/**
 * Decompress + delegate extractor for .nsz / .xcz files.
 *
 * NSZ / XCZ are zstd-chunked wrappers around NSP / XCI. The metadata we
 * want still lives in the inner container, but it's behind compression
 * we don't decode in JS. We shell out to `nsz` (nicoboss/nsz, Python +
 * the `zstandard` library, bundled into the runtime image at
 * /usr/local/bin/nsz) to materialize the inner container into a tempdir,
 * then hand the resulting .nsp / .xci off to the NSP provider so the
 * existing nstool pipeline does the rest.
 *
 * Disabled silently when:
 *   - `COOK_NSZ_BIN` (or `nsz` in PATH) is missing, OR
 *   - the NSP provider itself is disabled (no nstool / no prod.keys).
 *
 * Operational cost: decompression touches every block. A 5 GB XCZ →
 * XCI takes longer than the NSP step that follows, so the queue's
 * concurrency cap matters more for this provider than for pure NRO.
 */
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import debug from "../../debug.js";
import * as nsp from "./nsp.js";

const NSZ_RE = /\.(nsz|xcz)$/i;
const DEFAULT_TIMEOUT_MS = Number(process.env.COOK_EXTRACT_TIMEOUT_MS ?? 120_000);

let cachedBinary = undefined;

async function resolveBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  const explicit = process.env.COOK_NSZ_BIN;
  if (explicit) {
    try {
      await fs.access(explicit, fs.constants.X_OK);
      cachedBinary = explicit;
      return explicit;
    } catch {
      debug.error("nsz extractor: COOK_NSZ_BIN=%s not executable", explicit);
      cachedBinary = null;
      return null;
    }
  }
  const PATH = (process.env.PATH || "").split(path.delimiter);
  for (const dir of PATH) {
    const candidate = path.join(dir, "nsz");
    try {
      await fs.access(candidate, fs.constants.X_OK);
      cachedBinary = candidate;
      return candidate;
    } catch { /* keep looking */ }
  }
  cachedBinary = null;
  return null;
}

function runNsz(bin, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const child = spawn(bin, args, { signal: ctrl.signal, stdio: "ignore" });
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`nsz timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`nsz exit ${code}`));
    });
  });
}

function decompressedTargetName(srcName) {
  // Map .nsz → .nsp and .xcz → .xci. Anything else keeps its original
  // name (defensive — the caller already filtered by NSZ_RE).
  return srcName.replace(/\.nsz$/i, ".nsp").replace(/\.xcz$/i, ".xci");
}

export const name = "nsz";

export async function extract({ absPath, baseTitleId, fileName }, opts = {}) {
  if (!NSZ_RE.test(absPath)) return null;
  const bin = await resolveBinary();
  if (!bin) return null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cook-nsz-"));
  try {
    // Decompress into tmpRoot/. nsz writes a file named after the
    // input with the canonical inner extension, so the path is
    // predictable. -D = decompress, -o = output directory.
    await runNsz(bin, ["-D", "-o", tmpRoot, absPath], { timeoutMs });
    const candidate = path.join(tmpRoot, decompressedTargetName(path.basename(absPath)));
    try { await fs.access(candidate); }
    catch {
      // Fall back to scanning tmpRoot — nsz versions vary in naming.
      const entries = await fs.readdir(tmpRoot);
      const match = entries.find((n) => /\.(nsp|xci)$/i.test(n));
      if (!match) return null;
      return nsp.extract(
        { absPath: path.join(tmpRoot, match), baseTitleId, fileName },
        opts
      ).then((r) => r ? { ...r, source: "nacp-" + path.extname(match).slice(1).toLowerCase() + "z" } : null);
    }
    const inner = await nsp.extract({ absPath: candidate, baseTitleId, fileName }, opts);
    if (!inner) return null;
    return {
      ...inner,
      source: candidate.toLowerCase().endsWith(".xci") ? "nacp-xcz" : "nacp-nsz",
    };
  } catch (err) {
    debug.log("nsz extractor: %s — %s", path.basename(absPath), err.message);
    return null;
  } finally {
    fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export function resetForTests() { cachedBinary = undefined; }

export async function status() {
  return {
    bin: await resolveBinary(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}
