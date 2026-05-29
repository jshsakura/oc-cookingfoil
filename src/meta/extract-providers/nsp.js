/**
 * Keyed extractor for NSP/XCI containers, via an external `nstool` binary.
 *
 * Switch game containers are encrypted with the console master key set
 * (prod.keys). Reproducing the full decryption pipeline in JS is a
 * 2–3 kLOC ordeal — Cryptography (AES-XTS, AES-CTR, AES-ECB), key
 * derivation chains, NCA section parsing, the works. Instead we shell
 * out to nstool (jakcron/nstool — actively maintained, MIT-ish) and
 * reuse its known-correct extraction.
 *
 * Provider runs ONLY when both of the following are true at startup:
 *   1. `COOK_NSTOOL_BIN` (or `nstool` in PATH) resolves to an executable.
 *   2. `COOK_PROD_KEYS_PATH` (default: `/keys/prod.keys`) exists.
 *
 * If either is missing, extract() returns null and `auto.js` falls back
 * to the stub — extracted-meta stays empty for these container types.
 *
 * Pipeline (multi-step subprocess):
 *   tmp/pfs0/      ← nstool -x tmp/pfs0  input.nsp
 *   find *.cnmt.nca
 *   tmp/cnmt/      ← nstool -x tmp/cnmt  tmp/pfs0/<cnmt>.nca
 *   read .cnmt → parse → ControlNca id
 *   tmp/ctrl/      ← nstool -x tmp/ctrl  tmp/pfs0/<ctrl>.nca
 *   read tmp/ctrl/0/control.nacp        ← shared NACP decoder
 *   read tmp/ctrl/0/icon_<Language>.dat ← langPriority pick
 *   rm -rf tmp/
 *
 * The whole thing runs under a single AbortController so timeouts kill
 * any pending step plus the tmpdir. nstool itself is single-threaded
 * I/O; on a typical Switch dump (~1–8 GB), the wall clock here is
 * dominated by the PFS0 extract — multi-second, hence the worker
 * concurrency cap on the queue layer.
 */
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import debug from "../../debug.js";
import {
  decodeNacp,
  NACP_TOTAL_BYTES,
  NACP_SLOT_TO_ICON_NAME,
  slotPriorityOrder,
} from "../nacp-decode.js";
import { findControlNcaId } from "../cnmt-parse.js";

const NSP_RE = /\.(nsp|xci)$/i;
const DEFAULT_TIMEOUT_MS = Number(process.env.COOK_EXTRACT_TIMEOUT_MS ?? 120_000);
const KEYS_PATH = process.env.COOK_PROD_KEYS_PATH ?? "/keys/prod.keys";

// Detected once at module load. resolveBinary() returns null when both
// `COOK_NSTOOL_BIN` is unset and no `nstool` lives in PATH.
let cachedBinary = undefined;

async function resolveBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  const explicit = process.env.COOK_NSTOOL_BIN;
  if (explicit) {
    try {
      await fs.access(explicit, fs.constants.X_OK);
      cachedBinary = explicit;
      return explicit;
    } catch {
      debug.error("nsp extractor: COOK_NSTOOL_BIN=%s not executable", explicit);
      cachedBinary = null;
      return null;
    }
  }
  // PATH lookup. We don't want to invoke `which` per-extract — module load
  // does it once.
  const PATH = (process.env.PATH || "").split(path.delimiter);
  for (const dir of PATH) {
    const candidate = path.join(dir, "nstool");
    try {
      await fs.access(candidate, fs.constants.X_OK);
      cachedBinary = candidate;
      return candidate;
    } catch { /* keep looking */ }
  }
  cachedBinary = null;
  return null;
}

async function keysAvailable() {
  try {
    await fs.access(KEYS_PATH, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function runNstool(bin, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const child = spawn(bin, args, { signal: ctrl.signal, stdio: "ignore" });
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`nstool timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`nstool exit ${code}`));
    });
  });
}

async function findFirst(dir, predicate) {
  let entries;
  try { entries = await fs.readdir(dir); } catch { return null; }
  for (const name of entries) {
    if (predicate(name)) return path.join(dir, name);
  }
  return null;
}

async function findFirstRecursive(dir, predicate, maxDepth = 4) {
  if (maxDepth < 0) return null;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && predicate(ent.name)) return full;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const hit = await findFirstRecursive(path.join(dir, ent.name), predicate, maxDepth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

async function pickIconForLangs(controlDir, langPriority) {
  const order = slotPriorityOrder(langPriority);
  for (const slot of order) {
    const langName = NACP_SLOT_TO_ICON_NAME[slot];
    if (!langName) continue;
    const candidate = await findFirstRecursive(
      controlDir,
      (n) => n.toLowerCase() === `icon_${langName.toLowerCase()}.dat`
    );
    if (candidate) {
      try { return await fs.readFile(candidate); } catch { /* try next */ }
    }
  }
  // Last resort: any icon_*.dat
  const any = await findFirstRecursive(controlDir, (n) => /^icon_.*\.dat$/i.test(n));
  if (any) {
    try { return await fs.readFile(any); } catch { return null; }
  }
  return null;
}

export const name = "nsp";

export async function extract({ absPath, baseTitleId }, opts = {}) {
  if (!NSP_RE.test(absPath)) return null;
  const bin = await resolveBinary();
  if (!bin) return null;
  if (!(await keysAvailable())) return null;
  const langPriority = opts.langPriority ?? ["en", "ja", "ko"];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cook-nsp-"));
  try {
    const pfs0Dir = path.join(tmpRoot, "pfs0");
    const cnmtDir = path.join(tmpRoot, "cnmt");
    const ctrlDir = path.join(tmpRoot, "ctrl");
    await fs.mkdir(pfs0Dir, { recursive: true });

    // 1. Dump the container into individual NCAs.
    await runNstool(bin, ["-k", KEYS_PATH, "-x", pfs0Dir, absPath], { timeoutMs });

    // 2. Find the cnmt NCA (small, suffixed .cnmt.nca).
    const cnmtNca = await findFirst(pfs0Dir, (n) => /\.cnmt\.nca$/i.test(n));
    if (!cnmtNca) return null;

    // 3. Extract the cnmt NCA → contains a binary .cnmt manifest.
    await fs.mkdir(cnmtDir, { recursive: true });
    await runNstool(bin, ["-k", KEYS_PATH, "-x", cnmtDir, cnmtNca], { timeoutMs });
    const cnmtFile = await findFirstRecursive(cnmtDir, (n) => /\.cnmt$/i.test(n));
    if (!cnmtFile) return null;
    const cnmtBuf = await fs.readFile(cnmtFile);

    // 4. Parse the cnmt to find the Control NCA's id.
    const controlId = findControlNcaId(cnmtBuf);
    if (!controlId) return null;

    // 5. Extract the Control NCA.
    const controlNcaPath = path.join(pfs0Dir, `${controlId}.nca`);
    try { await fs.access(controlNcaPath); }
    catch { return null; }
    await fs.mkdir(ctrlDir, { recursive: true });
    await runNstool(bin, ["-k", KEYS_PATH, "-x", ctrlDir, controlNcaPath], { timeoutMs });

    // 6. control.nacp + icon picked by language priority.
    const nacpFile = await findFirstRecursive(ctrlDir, (n) => n.toLowerCase() === "control.nacp");
    if (!nacpFile) return null;
    const nacpBuf = await fs.readFile(nacpFile);
    if (nacpBuf.length < NACP_TOTAL_BYTES) return null;

    const meta = decodeNacp(nacpBuf, langPriority);
    if (!meta) return null;

    const iconBuffer = await pickIconForLangs(ctrlDir, langPriority);

    return {
      id: baseTitleId,
      name: meta.name,
      publisher: meta.publisher,
      version: meta.version,
      source: NSP_RE.test(absPath) && absPath.toLowerCase().endsWith(".xci") ? "nacp-xci" : "nacp-nsp",
      iconBuffer,
    };
  } catch (err) {
    debug.log("nsp extractor: %s — %s", path.basename(absPath), err.message);
    return null;
  } finally {
    fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/** Test seam: reset the cached binary lookup. */
export function resetForTests() { cachedBinary = undefined; }

/** Diagnostics surface for the future /api/admin/status endpoint. */
export async function status() {
  return {
    bin: await resolveBinary(),
    keysPresent: await keysAvailable(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}
