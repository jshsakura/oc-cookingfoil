/**
 * Who changed which item setting, from where: one JSON line per change in
 * ${COOK_DATA_DIR}/admin-edits.jsonl, appended and never rewritten.
 *
 *   { at, via: "device" | "dashboard", device, deviceName, kind, id, key, before, after }
 *
 * `device` is the admin device's key (null from the dashboard). No secrets.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";

const FILE = path.join(dataDir, "admin-edits.jsonl");
export const MAX_LIMIT = 1000;

/** Appends one change. A failed write is logged, never thrown: the change itself already happened. */
export function record({ via, device = null, deviceName = null, kind, id, key, before, after }, now = Date.now()) {
  const line = { at: new Date(now).toISOString(), via, device, deviceName, kind, id, key, before, after };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, `${JSON.stringify(line)}\n`);
  } catch (err) {
    debug.error("admin edits: could not write the history: %s", err.message);
  }
}

/** The latest `limit` changes, newest first. Lines that do not parse are skipped. */
export function recent(limit = 100) {
  const n = Math.min(Math.max(Math.trunc(Number(limit)) || 100, 1), MAX_LIMIT);
  let text;
  try {
    text = fs.readFileSync(FILE, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    if (!lines[i]) continue;
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      // a line cut short by a crash
    }
  }
  return out;
}
