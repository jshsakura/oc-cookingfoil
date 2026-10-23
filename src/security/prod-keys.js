/**
 * The console keys (prod.keys) this server reads what each game file is with
 * (file-identity.js), and NSP/XCI names and icons, NSZ conversion and
 * home-screen shortcuts. Without them the server still serves everything: a game
 * file is then known by the [TITLEID][vN] in its name or its ticket's name, and the
 * overview warns that the files cannot be read.
 *
 * Two places, the upload first:
 *   ${COOK_DATA_DIR}/keys/prod.keys   what the admin handed in (dashboard or an admin console),
 *                                     with uploaded.json beside it ({ uploadedAt, keyCount })
 *   COOK_PROD_KEYS_PATH               a file the operator mounted, default ${COOK_KEYS_DIR}/prod.keys
 * An upload never touches the mounted file (often read-only), and remove() only
 * deletes the upload. Every reader asks keysFile() / keysDir() on each use, so a
 * change applies without a restart.
 *
 * Nothing here returns, logs or records a key value: status() and the history
 * carry counts only, and parse errors name a line number.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { dataDir, keysDir as mountedDir } from "../helpers/envs.js";
import { envString } from "../helpers/env-read.js";
import * as edits from "../meta/admin-edits.js";
import debug from "../debug.js";
import { discard } from "../library/trash-service.js";
import { maxGeneration } from "../meta/nca-crypto.js";
import { firmwareOf } from "../meta/rewrap/generations.js";

export const MAX_BYTES = 64 * 1024;
const UPLOAD_DIR = path.join(dataDir, "keys");
const UPLOAD_FILE = path.join(UPLOAD_DIR, "prod.keys");
const MARK_FILE = path.join(UPLOAD_DIR, "uploaded.json");
const MOUNTED_FILE = envString("COOK_PROD_KEYS_PATH", path.join(mountedDir, "prod.keys"));

const LINE_RE = /^([a-z0-9_]+)\s*=\s*([0-9a-fA-F]+)$/;
const CONTENT_KEY_RE = /^(key_area_key_application|master_key)_[0-9a-f]{2}$/;

/** Why a prod.keys was refused: reason is "format", "no-header-key" or "too-large". */
export class KeysError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

const uploaded = () => fs.existsSync(MARK_FILE) && fs.existsSync(UPLOAD_FILE);

/** The prod.keys file the readers use now. */
export const keysFile = () => (uploaded() ? UPLOAD_FILE : MOUNTED_FILE);

/** Its folder, for the tools that take a folder (nsz, the shortcut builder). */
export const keysDir = () => (uploaded() ? UPLOAD_DIR : mountedDir);

/** name → lower-case hex of a prod.keys text; throws KeysError. Pure. */
export function parseKeys(text) {
  if (typeof text !== "string") throw new KeysError("format", "prod.keys must be text");
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new KeysError("too-large", `prod.keys is over ${MAX_BYTES / 1024} KB`);
  const keys = new Map();
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const m = LINE_RE.exec(line);
    if (!m) throw new KeysError("format", `line ${i + 1} is not "name = hex"`);
    keys.set(m[1], m[2].toLowerCase());
  }
  if (keys.get("header_key")?.length !== 64) throw new KeysError("no-header-key", "header_key (64 hex digits) is missing");
  if (![...keys.keys()].some((name) => CONTENT_KEY_RE.test(name))) throw new KeysError("format", "no key_area_key_application_* or master_key_* entry");
  return keys;
}

/**
 * Counts only, and the highest master key generation the keys reach with the
 * firmware that brought it (what a game may need at most to be rewrapped). Pure.
 */
function summary(keys) {
  const gen = maxGeneration(keys);
  return {
    keyCount: keys.size,
    hasHeaderKey: keys.get("header_key")?.length === 64,
    titleKekCount: [...keys.keys()].filter((k) => /^titlekek_[0-9a-f]{2}$/.test(k)).length,
    maxGeneration: gen,
    maxFirmware: firmwareOf(gen),
  };
}

/** The entries of a file the operator placed, read leniently: lines that do not parse are skipped. */
function readLenient(file) {
  const keys = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = LINE_RE.exec(line.trim());
    if (m) keys.set(m[1], m[2].toLowerCase());
  }
  return keys;
}

/** True when `keys` can decrypt NCAs: a header key and a key area or master key. Pure. */
export const usable = (keys) => keys?.get("header_key")?.length === 64 && [...keys.keys()].some((name) => CONTENT_KEY_RE.test(name));

/** True when the server has keys it can read game files with. */
export const ready = () => usable(loadKeys());

let cached = null;

/**
 * The keys the readers decrypt with, as name → hex; null when there is no
 * prod.keys. Read again only when the file or its mtime changes.
 */
export function loadKeys() {
  const file = keysFile();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    cached = null;
    return null;
  }
  if (cached?.file === file && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.keys;
  if (stat.size > MAX_BYTES) return null;
  try {
    cached = { file, mtimeMs: stat.mtimeMs, size: stat.size, keys: readLenient(file) };
  } catch (err) {
    debug.error("prod.keys: cannot read %s: %s", file, err.code ?? err.message);
    return null;
  }
  return cached.keys;
}

const NONE = { present: false, source: null, uploadedAt: null, keyCount: 0, hasHeaderKey: false, titleKekCount: 0, maxGeneration: null, maxFirmware: null };

/** { present, source: "upload"|"file"|null, uploadedAt, keyCount, hasHeaderKey, titleKekCount, maxGeneration, maxFirmware }. No values. */
export function status() {
  const source = uploaded() ? "upload" : fs.existsSync(MOUNTED_FILE) ? "file" : null;
  if (!source) return { ...NONE };
  let keys = new Map();
  try {
    if (fs.statSync(keysFile()).size <= MAX_BYTES) keys = readLenient(keysFile());
  } catch (err) {
    debug.error("prod.keys: cannot read %s: %s", keysFile(), err.code ?? err.message);
  }
  let uploadedAt = null;
  if (source === "upload") {
    try {
      uploadedAt = JSON.parse(fs.readFileSync(MARK_FILE, "utf8")).uploadedAt ?? null;
    } catch {
      // the mark is only for the date
    }
  }
  return { present: true, source, uploadedAt, ...summary(keys) };
}

function writeAtomic(file, text) {
  const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Checks `text` and makes it the server's prod.keys. `via` is "device" or
 * "dashboard"; `actor` names who for the log. Returns status(); throws KeysError.
 */
export function install(text, { actor, via, device = null, deviceName = null }, now = Date.now()) {
  const keys = parseKeys(text);
  const before = status();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  writeAtomic(UPLOAD_FILE, [...keys].map(([name, hex]) => `${name} = ${hex}`).join("\n") + "\n");
  writeAtomic(MARK_FILE, JSON.stringify({ uploadedAt: new Date(now).toISOString(), keyCount: keys.size }));
  debug.log("prod.keys installed by %s via %s, %d keys", actor, via, keys.size);
  edits.record({ via, device, deviceName, kind: "server", id: "prod.keys", key: "keys", before: before.source, after: "upload" }, now);
  return status();
}

/** Moves the uploaded copy to the data folder's trash (never a mounted file); false when there was none. */
export async function remove({ actor, via, device = null, deviceName = null, by = null }) {
  if (!uploaded()) return false;
  await discard([UPLOAD_FILE, MARK_FILE].filter((f) => fs.existsSync(f)), { kind: "prod-keys", action: "delete", by, name: "prod.keys" });
  debug.log("prod.keys upload removed by %s via %s", actor, via);
  edits.record({ via, device, deviceName, kind: "server", id: "prod.keys", key: "keys", before: "upload", after: status().source });
  return true;
}
