/**
 * Display versions ("1.4.1") of update files, read from the NACP inside each
 * update NSP/NSZ. titledb only knows the numeric version (131072), which is
 * what clients showed until now.
 *
 * Persisted as one JSON map under the extracted-meta directory, keyed by
 * "<UPDATE_TITLE_ID>@<numeric version>" so a replaced update file gets read
 * again. Reading costs two small NCA copies per file (see pfs0.js), done one
 * file at a time in the background; every few results trigger a shop rebuild.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import debug from "../debug.js";
import { extractedMetaDir } from "../helpers/envs.js";
import { readPfs0Entries, copyPfs0Entry } from "./pfs0.js";
import { findControlNcaId } from "./cnmt-parse.js";
import { NACP_TOTAL_BYTES } from "./nacp-decode.js";
import {
  resolveBinary, keysAvailable, runNstool, findFirstRecursive, KEYS_PATH, DEFAULT_TIMEOUT_MS,
} from "./extract-providers/nsp.js";

const STORE_PATH = path.join(extractedMetaDir, "update-versions.json");
const PACE_MS = 200;
const NOTIFY_EVERY = 25;
const UPDATE_RE = /\.(nsp|nsz)$/i;

const known = new Map(); // "TID@version" → display version, or "" when the file had none
const tried = new Set();
const queue = [];
const listeners = [];
let running = false;
let loaded = false;
let sinceNotify = 0;

const keyOf = (titleId, version) => `${String(titleId).toUpperCase()}@${Number(version) || 0}`;

export async function load() {
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_PATH, "utf8"));
    for (const [key, value] of Object.entries(parsed ?? {})) if (typeof value === "string") known.set(key, value);
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("update-versions: cannot read %s: %s", STORE_PATH, err.message);
  }
  loaded = true;
}

export function get(titleId, version) {
  return known.get(keyOf(titleId, version)) || null;
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

/** Reads the display version of one update container; null when unreadable. */
export async function readDisplayVersion(absPath) {
  const bin = await resolveBinary();
  if (!bin || !(await keysAvailable())) return null;
  const entries = await readPfs0Entries(absPath);
  if (!entries) return null;
  const cnmtEntry = entries.find((e) => /\.cnmt\.nca$/i.test(e.name));
  if (!cnmtEntry) return null;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cook-upd-"));
  const run = (args) => runNstool(bin, ["-k", KEYS_PATH, ...args], { timeoutMs: DEFAULT_TIMEOUT_MS });
  try {
    const cnmtNca = path.join(tmp, "meta.nca");
    await copyPfs0Entry(absPath, cnmtEntry, cnmtNca);
    await run(["-x", path.join(tmp, "cnmt"), cnmtNca]);
    const cnmtFile = await findFirstRecursive(path.join(tmp, "cnmt"), (n) => /\.cnmt$/i.test(n));
    if (!cnmtFile) return null;
    const controlId = findControlNcaId(await fs.readFile(cnmtFile));
    const controlEntry = controlId && entries.find((e) => e.name.toLowerCase() === `${controlId}.nca`);
    if (!controlEntry) return null;
    const controlNca = path.join(tmp, "control.nca");
    await copyPfs0Entry(absPath, controlEntry, controlNca);
    await run(["-x", path.join(tmp, "ctrl"), controlNca]);
    const nacpFile = await findFirstRecursive(path.join(tmp, "ctrl"), (n) => n.toLowerCase() === "control.nacp");
    if (!nacpFile) return null;
    const nacp = await fs.readFile(nacpFile);
    if (nacp.length < NACP_TOTAL_BYTES) return null;
    return displayVersionOf(nacp);
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Queues an update file once per (title, version); no-op until load() ran. */
export function enqueue({ absPath, titleId, version }) {
  if (!loaded || !UPDATE_RE.test(absPath)) return;
  const key = keyOf(titleId, version);
  if (known.has(key) || tried.has(key)) return;
  tried.add(key);
  queue.push({ absPath, key });
  if (!running) work();
}

async function work() {
  running = true;
  while (queue.length) {
    const job = queue.shift();
    let value = null;
    try {
      value = await readDisplayVersion(job.absPath);
    } catch (err) {
      debug.log("update-versions: %s — %s", path.basename(job.absPath), err.message);
    }
    // Remember misses too, so a file without a readable NACP is not re-read every rebuild.
    known.set(job.key, value ?? "");
    if (value) sinceNotify++;
    if (sinceNotify >= NOTIFY_EVERY || queue.length === 0) {
      await persist().catch((err) => debug.error("update-versions: save failed: %s", err.message));
      if (sinceNotify) for (const fn of listeners) fn();
      sinceNotify = 0;
    }
    if (queue.length) await new Promise((resolve) => setTimeout(resolve, PACE_MS));
  }
  running = false;
}
