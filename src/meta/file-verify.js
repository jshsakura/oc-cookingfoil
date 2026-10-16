/**
 * Checks one Switch game file (NSP, NSZ, XCI, XCZ) and says what it found.
 * The verdict only informs: nothing is hidden or refused because of it, the
 * library carries modified files on purpose.
 *
 *   ok        every NCA header signature passes and, where checked, the
 *             content hashes match the cnmt
 *   modified  an NCA header main signature fails: repacked or modded
 *             (Korean patches and the like)
 *   damaged   the container cannot be read, an NCA the cnmt lists is missing,
 *             or an NCA whose signature passes does not match its cnmt hash
 *   unchecked nstool or the keys are missing, so nothing could be said
 *
 * Signatures: the first 0xC00 bytes of each NCA (the header; an NCZ keeps its
 * first 0x4000 bytes plain, so the same slice works) go to a temp file and
 *
 *   nstool -y -t nca -k <prod.keys> <slice>
 *
 * prints "NCA Header Main Signature: FAIL" when the signature does not hold.
 * A slice also prints "NCA Partition 0 not readable", which means nothing.
 *
 * Hashes (NSP and XCI only; an NCZ is compressed, so its bytes are not the
 * NCA's): the *.cnmt.nca is cut out and unpacked with nstool as the content
 * reader does (content-meta.js), and each NCA's bytes are streamed through
 * SHA-256 in a low-priority child (hash-range.js) and compared with its record.
 * A hash mismatch on an NCA whose own signature already failed is the
 * modification itself, so it stays "modified".
 *
 * The cnmt is read on every check (a few KB), so a missing NCA is found even
 * without the whole-file hash pass.
 */
import { spawn } from "child_process";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { readPfs0Entries, copyPfs0Entry } from "./pfs0.js";
import { readXciSecureEntries } from "./hfs0.js";
import { listContents } from "./cnmt-parse.js";
import { hashRange } from "./hash-range.js";
import { resolveBinary, keysAvailable, findFirstRecursive, KEYS_PATH } from "./extract-providers/nsp.js";
import { lowPriorityPrefix } from "./nsz-runner.js";

export const VERIFY_RE = /\.(nsp|nsz|xci|xcz)$/i;
const NCA_HEADER_BYTES = 0xC00;
const NSTOOL_TIMEOUT_MS = 60_000;
const OUTPUT_CHARS = 16_000;
const CONTENT_TYPE_DELTA = 6;
const SIGNATURE_FAIL_RE = /NCA Header Main Signature:\s*FAIL/i;

const ncaIdOf = (name) => name.split(".")[0].toLowerCase();
const isNca = (name) => /\.(nca|ncz)$/i.test(name);

/** Runs nstool (low priority) and resolves to its combined output; rejects on a timeout or abort. */
export function runNstoolText(bin, args, { timeoutMs = NSTOOL_TIMEOUT_MS, signal, lowPriority = true } = {}) {
  const argv = [...(lowPriority ? lowPriorityPrefix() : []), bin, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (c) => { if (out.length < OUTPUT_CHARS) out += c.toString("utf8"); };
    const kill = () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } };
    const timer = setTimeout(() => { kill(); reject(new Error(`nstool timeout after ${timeoutMs} ms`)); }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.once("error", (err) => { clearTimeout(timer); reject(err); });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      else resolve({ code, out });
    });
  });
}

/** The NCA entries of a container and whether they are compressed; null when it cannot be read. */
export async function listContainer(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const entries = ext === ".xci" || ext === ".xcz"
    ? await readXciSecureEntries(absPath).catch(() => null)
    : await readPfs0Entries(absPath).catch(() => null);
  if (!entries) return null;
  return { compressed: ext === ".nsz" || ext === ".xcz", entries };
}

/**
 * The verdict from what the checks found. Pure.
 *   readable     the container's file table was read and every entry fits in the file
 *   signature    "pass" | "fail" | "skip";  failedIds  NCA ids whose signature failed
 *   missing      NCA ids the cnmt lists that the container lacks
 *   hash         "pass" | "fail" | "skip";  mismatched NCA ids whose hash differs
 */
export function decide({ readable = true, signature = "skip", failedIds = [], missing = [], hash = "skip", mismatched = [] }) {
  const checks = { signature, hash };
  if (!readable) return { verdict: "damaged", reason: "unreadable", checks };
  if (missing.length) return { verdict: "damaged", reason: "missing-content", checks };
  const failed = new Set(failedIds);
  if (mismatched.some((id) => !failed.has(id))) return { verdict: "damaged", reason: "hash-mismatch", checks };
  if (signature === "fail") return { verdict: "modified", reason: "signature-fail", checks };
  if (signature === "pass") return { verdict: "ok", reason: "ok", checks };
  return { verdict: "unchecked", reason: "no-tool", checks };
}

/** Reads `length` bytes at `position`; fewer when the file ends first. */
async function readSlice(absPath, position, length) {
  const handle = await fsp.open(absPath, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, position);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * A verifier. Everything outside the file comes in, so tests can stub nstool:
 * `tools()` → { bin, keys } or null, `nstool(bin, args, opts)` → { code, out },
 * `hash(file, start, size, opts)` → hex.
 */
export function createVerifier({
  tools = defaultTools,
  nstool = runNstoolText,
  hash = hashRange,
  tmpRoot = os.tmpdir(),
} = {}) {
  async function signatureFailed(t, absPath, entry, dir, signal) {
    const slice = await readSlice(absPath, entry.offset, NCA_HEADER_BYTES);
    const file = path.join(dir, `${ncaIdOf(entry.name)}.hdr`);
    await fsp.writeFile(file, slice);
    const { out } = await nstool(t.bin, ["-y", "-t", "nca", "-k", t.keys, file], { signal });
    await fsp.rm(file, { force: true });
    return SIGNATURE_FAIL_RE.test(out);
  }

  /** The cnmt's content records, or null when there is no cnmt NCA or it cannot be unpacked. */
  async function readCnmt(t, absPath, entries, dir, signal) {
    const entry = entries.find((e) => /\.cnmt\.nca$/i.test(e.name));
    if (!entry) return null;
    const nca = path.join(dir, "meta.nca");
    const out = path.join(dir, "cnmt");
    await copyPfs0Entry(absPath, entry, nca);
    await fsp.mkdir(out, { recursive: true });
    await nstool(t.bin, ["-k", t.keys, "-x", out, nca], { signal });
    const file = await findFirstRecursive(out, (n) => /\.cnmt$/i.test(n));
    return file ? listContents(await fsp.readFile(file)) : null;
  }

  /**
   * Checks the file at `absPath`. `hash`: also stream every NCA through
   * SHA-256 (plain containers only). Returns { verdict, reason, checks }.
   */
  async function verify(absPath, { hash: wantHash = false, signal } = {}) {
    const t = await tools();
    const container = await listContainer(absPath);
    const st = await fsp.stat(absPath);
    const ncas = container?.entries.filter((e) => isNca(e.name)) ?? [];
    const fits = container && container.entries.every((e) => e.offset + e.size <= st.size);
    if (!container || !fits || !ncas.length || ncas.some((e) => e.size < NCA_HEADER_BYTES)) return decide({ readable: false });
    if (!t) return decide({});

    const dir = await fsp.mkdtemp(path.join(tmpRoot, "cook-verify-"));
    try {
      const failedIds = [];
      for (const e of ncas) if (await signatureFailed(t, absPath, e, dir, signal)) failedIds.push(ncaIdOf(e.name));
      const facts = { signature: failedIds.length ? "fail" : "pass", failedIds };

      const records = (await readCnmt(t, absPath, ncas, dir, signal))?.filter((r) => r.contentType !== CONTENT_TYPE_DELTA);
      if (!records) return decide(facts);
      const byId = new Map(ncas.map((e) => [ncaIdOf(e.name), e]));
      facts.missing = records.filter((r) => !byId.has(r.ncaId)).map((r) => r.ncaId);
      if (!wantHash || container.compressed || facts.missing.length) return decide(facts);

      facts.mismatched = [];
      for (const r of records) {
        const e = byId.get(r.ncaId);
        if (e.size !== r.size || (await hash(absPath, e.offset, e.size, { signal })) !== r.sha256) facts.mismatched.push(r.ncaId);
      }
      facts.hash = facts.mismatched.length ? "fail" : "pass";
      return decide(facts);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { verify, tools };
}

/** nstool and the keys, or null when either is missing. */
async function defaultTools() {
  const bin = await resolveBinary();
  if (!bin || !(await keysAvailable())) return null;
  return { bin, keys: KEYS_PATH };
}
