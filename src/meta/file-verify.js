/**
 * Checks one Switch game file (NSP, NSZ, XCI, XCZ) and says what it found.
 * The verdict only informs: nothing is hidden or refused because of it, the
 * library carries modified files on purpose.
 *
 *   ok        every NCA header signature passes and, where checked, the
 *             content hashes match the cnmt
 *   modified  an NCA header main signature fails: repacked or modded
 *             (Korean patches and the like)
 *   damaged   the container cannot be read, the file ends before the NCAs its
 *             file table lists do ("truncated"; a trimmed XCI only lacks the
 *             padding after its last NCA, so it is not), an NCA the cnmt lists
 *             is missing, or an NCA whose signature passes does not match its
 *             cnmt hash
 *
 * A damaged verdict carries `detail`: for "truncated", `present` (the share of
 * the file there, 0..1) and `ncas` the NCAs cut off; for "missing-content" and
 * "hash-mismatch", `ncas`. Each NCA is { id, type }, type the cnmt's content
 * type ("Program", "Control", ...) or null when no cnmt reads.
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
 * NCA's): every *.cnmt.nca is read in place with the keys (nca-reader.js),
 * and each NCA's bytes are streamed through
 * SHA-256 in a low-priority child (hash-range.js) and compared with its record.
 * A hash mismatch on an NCA whose own signature already failed is the
 * modification itself, so it stays "modified".
 *
 * Every cnmt is read on every check (a few KB each; a multi-title XCI has
 * several), so a missing NCA is found even without the whole-file hash pass.
 * The same read says what the file is: `identity` in the result
 * (file-identity.js), which needs the keys but not nstool.
 */
import { spawn } from "child_process";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { readPfs0Entries } from "./pfs0.js";
import { readXciSecureEntries } from "./hfs0.js";
import { listContents, readCnmtIdentity } from "./cnmt-parse.js";
import { readCnmtAt } from "./nca-reader.js";
import { loadKeys } from "../security/prod-keys.js";
import { pickIdentity } from "./file-identity.js";
import { hashRange } from "./hash-range.js";
import { resolveBinary, keysFile } from "./extract-providers/nsp.js";
import { lowPriorityPrefix } from "./nsz-runner.js";

export const VERIFY_RE = /\.(nsp|nsz|xci|xcz)$/i;
const NCA_HEADER_BYTES = 0xC00;
const NSTOOL_TIMEOUT_MS = 60_000;
const OUTPUT_CHARS = 16_000;
const CONTENT_TYPE_DELTA = 6;
const SIGNATURE_FAIL_RE = /NCA Header Main Signature:\s*FAIL/i;

const ncaIdOf = (name) => name.split(".")[0].toLowerCase();
const CONTENT_TYPES = ["Meta", "Program", "Data", "Control", "HtmlDocument", "LegalInformation", "DeltaFragment"];
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
export function decide({ readable = true, truncated = false, signature = "skip", failedIds = [], missing = [], hash = "skip", mismatched = [] }) {
  const checks = { signature, hash };
  if (!readable) return { verdict: "damaged", reason: "unreadable", checks };
  if (truncated) return { verdict: "damaged", reason: "truncated", checks };
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

/** The cnmt bytes of each meta NCA entry, read in place; an entry that does not read is left out. */
async function readCnmtsIn(absPath, metas) {
  const keys = loadKeys();
  if (!keys) return [];
  const handle = await fsp.open(absPath, "r");
  try {
    const out = [];
    for (const e of metas) {
      const cnmt = await readCnmtAt(handle, e.offset, keys);
      if (cnmt) out.push(cnmt);
    }
    return out;
  } finally {
    await handle.close();
  }
}

/**
 * A verifier. Everything outside the file comes in, so tests can stub them:
 * `tools()` → { bin, keys } with bin null when nstool is missing, or null
 * without keys; `nstool(bin, args, opts)` → { code, out };
 * `cnmts(absPath, metaEntries)` → [cnmt bytes]; `hash(file, start, size, opts)` → hex.
 */
export function createVerifier({
  tools = defaultTools,
  nstool = runNstoolText,
  cnmts = readCnmtsIn,
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

  /**
   * The content records of every cnmt in the container (a multi-title XCI has
   * one per title), merged by NCA id, and what the file is; records null when
   * no cnmt reads.
   */
  async function readMeta(absPath, entries) {
    const read = await cnmts(absPath, entries.filter((e) => /\.cnmt\.nca$/i.test(e.name)));
    const merged = new Map();
    for (const c of read) for (const r of listContents(c)) if (!merged.has(r.ncaId)) merged.set(r.ncaId, r);
    return { records: read.length ? [...merged.values()] : null, identity: pickIdentity(read.map(readCnmtIdentity)) };
  }

  /**
   * Checks the file at `absPath`. `hash`: also stream every NCA through
   * SHA-256 (plain containers only). `known` ({ ncaId: true | false }) holds
   * NCAs already hashed (matched or not), which are not read again; each new
   * result goes to `onHashed(ncaId, matched)` so a stopped run can resume.
   * When `known` covers every NCA, its results stand in for the hash pass
   * even without `hash`. Returns { verdict, reason, checks, identity }.
   */
  async function verify(absPath, { hash: wantHash = false, known = {}, onHashed = () => {}, signal } = {}) {
    const t = await tools();
    const container = await listContainer(absPath);
    const st = await fsp.stat(absPath);
    const ncas = container?.entries.filter((e) => isNca(e.name)) ?? [];
    if (!container || !ncas.length) return decide({ readable: false });
    const cut = container.entries.filter((e) => e.offset + e.size > st.size);
    if (cut.length) return truncatedVerdict(absPath, container, ncas, cut, st.size);
    if (ncas.some((e) => e.size < NCA_HEADER_BYTES)) return decide({ readable: false });
    if (!t) return decide({});

    const dir = await fsp.mkdtemp(path.join(tmpRoot, "cook-verify-"));
    const meta = await readMeta(absPath, ncas);
    const typeOf = new Map((meta.records ?? []).map((r) => [r.ncaId, CONTENT_TYPES[r.contentType] ?? null]));
    const typed = (ids) => ids.map((id) => ({ id, type: typeOf.get(id) ?? null }));
    const withId = (r) => ({ ...r, identity: meta.identity });
    const decideWith = (facts) => {
      const r = decide(facts);
      if (r.reason === "missing-content") return withId({ ...r, detail: { ncas: typed(facts.missing) } });
      if (r.reason === "hash-mismatch") return withId({ ...r, detail: { ncas: typed(facts.mismatched.filter((id) => !facts.failedIds?.includes(id))) } });
      return withId(r);
    };
    try {
      const failedIds = [];
      if (t.bin) for (const e of ncas) if (await signatureFailed(t, absPath, e, dir, signal)) failedIds.push(ncaIdOf(e.name));
      const facts = t.bin ? { signature: failedIds.length ? "fail" : "pass", failedIds } : {};

      const records = meta.records?.filter((r) => r.contentType !== CONTENT_TYPE_DELTA);
      if (!records) return decideWith(facts);
      const byId = new Map(ncas.map((e) => [ncaIdOf(e.name), e]));
      facts.missing = records.filter((r) => !byId.has(r.ncaId)).map((r) => r.ncaId);
      const complete = records.every((r) => typeof known[r.ncaId] === "boolean");
      if ((!wantHash && !complete) || container.compressed || facts.missing.length) return decideWith(facts);

      facts.mismatched = [];
      for (const r of records) {
        let matched = known[r.ncaId];
        if (typeof matched !== "boolean") {
          const e = byId.get(r.ncaId);
          matched = e.size === r.size && (await hash(absPath, e.offset, e.size, { signal })) === r.sha256;
          onHashed(r.ncaId, matched);
        }
        if (!matched) facts.mismatched.push(r.ncaId);
      }
      facts.hash = facts.mismatched.length ? "fail" : "pass";
      return decideWith(facts);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * A file that ends before its file table says: how much of it is there and
   * which NCAs are cut off, typed from a cnmt that still lies inside the file.
   */
  async function truncatedVerdict(absPath, container, ncas, cut, fileSize) {
    const end = Math.max(...container.entries.map((e) => e.offset + e.size));
    const meta = await readMeta(absPath, ncas.filter((e) => e.offset + e.size <= fileSize)).catch(() => ({ records: null, identity: null }));
    const typeOf = new Map((meta.records ?? []).map((r) => [r.ncaId, CONTENT_TYPES[r.contentType] ?? null]));
    const type = (e) => (/\.cnmt\.nc[az]$/i.test(e.name) ? "Meta" : typeOf.get(ncaIdOf(e.name)) ?? null);
    return {
      ...decide({ truncated: true }),
      detail: { present: Math.floor((fileSize / end) * 100) / 100, ncas: cut.filter((e) => isNca(e.name)).map((e) => ({ id: ncaIdOf(e.name), type: type(e) })) },
      identity: meta.identity ?? null,
    };
  }

  return { verify, tools };
}

/** nstool (null when missing) and the keys, or null without keys. */
async function defaultTools() {
  if (!loadKeys()) return null;
  return { bin: await resolveBinary(), keys: keysFile() };
}
