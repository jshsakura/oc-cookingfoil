/**
 * Install facts read from inside each NSP/NSZ, for things titledb cannot say:
 *
 *   installSize         bytes the console stores (NSZ files are compressed, so
 *                       their file size understates the space an install needs)
 *   requiredFirmware    "16.0.0", for base games and updates
 *   requiredAppVersion  the base update a DLC needs, as a numeric version
 *   displayVersion      "1.4.1" for updates (titledb only knows 131072)
 *
 * Persisted as one JSON map under the extracted-meta directory, keyed by
 * "<TITLE_ID>@<numeric version>" so a replaced file gets read again. Reading
 * costs one small NCA copy per file, plus the control NCA for updates (see
 * pfs0.js), done one file at a time in the background; every batch of results
 * triggers a shop rebuild.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import debug from "../debug.js";
import { extractedMetaDir } from "../helpers/envs.js";
import { readPfs0Entries, copyPfs0Entry } from "./pfs0.js";
import { findControlNcaId, readCnmtFacts, firmwareString } from "./cnmt-parse.js";
import { NACP_TOTAL_BYTES } from "./nacp-decode.js";
import {
  resolveBinary, keysAvailable, runNstool, findFirstRecursive, KEYS_PATH, DEFAULT_TIMEOUT_MS,
} from "./extract-providers/nsp.js";

const STORE_PATH = path.join(extractedMetaDir, "content-meta.json");
// Earlier releases stored only update display versions, as "TID@ver" → "1.0.2".
const LEGACY_PATH = path.join(extractedMetaDir, "update-versions.json");
const PACE_MS = 200;
const NOTIFY_EVERY = 100;
const PFS0_RE = /\.(nsp|nsz)$/i;

const known = new Map(); // "TID@version" → record; { failed: true } when unreadable
const tried = new Set();
const queue = [];
const early = []; // enqueued before load() finished; replayed by load()
const listeners = [];
let running = false;
let loaded = false;
let sinceNotify = 0;

const keyOf = (titleId, version) => `${String(titleId).toUpperCase()}@${Number(version) || 0}`;

// A record migrated from the legacy store has only displayVersion.
const isComplete = (record) => Boolean(record && (record.failed || record.installSize));

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("content-meta: cannot read %s: %s", file, err.message);
    return null;
  }
}

export async function load() {
  const stored = await readJson(STORE_PATH);
  for (const [key, record] of Object.entries(stored ?? {})) {
    if (record && typeof record === "object") known.set(key, record);
  }
  const legacy = await readJson(LEGACY_PATH);
  if (legacy) {
    for (const [key, version] of Object.entries(legacy)) {
      if (typeof version === "string" && version && !known.get(key)?.displayVersion) {
        known.set(key, { ...known.get(key), displayVersion: version });
      }
    }
    await persist();
    await fs.rm(LEGACY_PATH, { force: true });
  }
  loaded = true;
  for (const job of early.splice(0)) enqueue(job);
}

/** The facts known so far for one file, or null. */
export function get(titleId, version) {
  return known.get(keyOf(titleId, version)) ?? null;
}

export function onExtracted(fn) {
  listeners.push(fn);
}

async function persist() {
  await fs.mkdir(extractedMetaDir, { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(known)));
  await fs.rename(tmp, STORE_PATH);
}

// NACP DisplayVersion: 0x10 bytes of NUL-padded UTF-8 at 0x3060.
export function displayVersionOf(nacp) {
  const raw = nacp.toString("utf8", 0x3060, 0x3070);
  const end = raw.indexOf("\0");
  return (end < 0 ? raw : raw.slice(0, end)).trim() || null;
}

/** Builds the stored record from parsed cnmt facts; the cnmt NCA itself is installed too. */
export function recordFromFacts(facts, metaNcaSize, displayVersion) {
  const record = { installSize: facts.contentSize + metaNcaSize };
  const firmware = firmwareString(facts.requiredSystemVersion);
  if (firmware) record.requiredFirmware = firmware;
  if (facts.requiredApplicationVersion) record.requiredAppVersion = facts.requiredApplicationVersion;
  if (displayVersion) record.displayVersion = displayVersion;
  return record;
}

async function extractOne(run, absPath, entry, tmp, label, pick) {
  const nca = path.join(tmp, `${label}.nca`);
  await copyPfs0Entry(absPath, entry, nca);
  await run(["-x", path.join(tmp, label), nca]);
  return findFirstRecursive(path.join(tmp, label), pick);
}

async function readDisplayVersion(run, absPath, entries, cnmt, tmp) {
  const controlId = findControlNcaId(cnmt);
  const controlEntry = controlId && entries.find((e) => e.name.toLowerCase() === `${controlId}.nca`);
  if (!controlEntry) return null;
  const nacpFile = await extractOne(run, absPath, controlEntry, tmp, "ctrl", (n) => n.toLowerCase() === "control.nacp");
  if (!nacpFile) return null;
  const nacp = await fs.readFile(nacpFile);
  return nacp.length < NACP_TOTAL_BYTES ? null : displayVersionOf(nacp);
}

/** Reads the install facts of one container; null when unreadable. */
export async function readContentMeta(absPath, { withDisplayVersion = false } = {}) {
  const bin = await resolveBinary();
  if (!bin || !(await keysAvailable())) return null;
  const entries = await readPfs0Entries(absPath);
  const cnmtEntry = entries?.find((e) => /\.cnmt\.nca$/i.test(e.name));
  if (!cnmtEntry) return null;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cook-meta-"));
  const run = (args) => runNstool(bin, ["-k", KEYS_PATH, ...args], { timeoutMs: DEFAULT_TIMEOUT_MS });
  try {
    const cnmtFile = await extractOne(run, absPath, cnmtEntry, tmp, "cnmt", (n) => /\.cnmt$/i.test(n));
    if (!cnmtFile) return null;
    const cnmt = await fs.readFile(cnmtFile);
    const facts = readCnmtFacts(cnmt);
    if (!facts) return null;
    const displayVersion = withDisplayVersion ? await readDisplayVersion(run, absPath, entries, cnmt, tmp) : null;
    return recordFromFacts(facts, cnmtEntry.size, displayVersion);
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Queues a file once per (title, version); XCI/XCZ are not PFS0 and are skipped. */
export function enqueue(job) {
  const { absPath, titleId, version, contentType } = job;
  if (!PFS0_RE.test(absPath)) return;
  // The first build can run before load(); hold its files until the store is read.
  if (!loaded) {
    early.push(job);
    return;
  }
  const key = keyOf(titleId, version);
  if (isComplete(known.get(key)) || tried.has(key)) return;
  tried.add(key);
  queue.push({ absPath, key, isUpdate: contentType === "update" });
  if (!running) work();
}

async function work() {
  running = true;
  while (queue.length) {
    const job = queue.shift();
    const previous = known.get(job.key);
    let record = null;
    try {
      const withDisplayVersion = job.isUpdate && !previous?.displayVersion;
      record = await readContentMeta(job.absPath, { withDisplayVersion });
    } catch (err) {
      debug.log("content-meta: %s: %s", path.basename(job.absPath), err.message);
    }
    // Remember misses too, so an unreadable file is not re-read every rebuild.
    known.set(job.key, record ? { ...previous, ...record } : { ...previous, failed: true });
    if (record) sinceNotify++;
    if (sinceNotify >= NOTIFY_EVERY || queue.length === 0) {
      await persist().catch((err) => debug.error("content-meta: save failed: %s", err.message));
      if (sinceNotify) for (const fn of listeners) fn();
      sinceNotify = 0;
    }
    if (queue.length) await new Promise((resolve) => setTimeout(resolve, PACE_MS));
  }
  running = false;
}

/** How far the background read has come, for /api/shop/info. */
export function progress() {
  return { read: known.size, pending: queue.length };
}
