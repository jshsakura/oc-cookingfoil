/**
 * A README.md the server keeps in a folder: the storage guide (retro/scaffold.js)
 * and the guide of each folder (helpers/folder-guides.js).
 *
 * Its first line carries a hash of the rest. The server writes the file when it
 * is missing and rewrites it only while that hash still matches, so a guide
 * someone edited, or a README of their own, is left as it is. It never makes a
 * folder to hold one: a guide whose folder is missing is not written. A guide
 * already as the server would write it is only read, never written again.
 *
 * Scanners skip a file of this name (isGuideName): it is never a game, a ROM,
 * a BIOS file or something to sort.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";

export const GUIDE_NAME = "README.md";
const MARK_RE = /^<!-- cookingfoil-guide sha256=([0-9a-f]{16}) [^\n]*-->\n/;

const hash = (body) => crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);

/** Whether a file name is a folder guide's, in any case. Pure. */
export const isGuideName = (name) => String(name ?? "").toLowerCase() === GUIDE_NAME.toLowerCase();

/** The guide with its first line: a marker and the hash of the rest. Pure. */
export function stamp(body) {
  return `<!-- cookingfoil-guide sha256=${hash(body)} Written by the CookingFoil server. Edit this file and the server stops updating it. -->\n${body}`;
}

/**
 * What is at the guide's place, against the guide `body` the server would write. Pure.
 *   missing   nothing there: write
 *   current   the server's, as it would write it
 *   stale     the server's, untouched since, for an older text: write
 *   edited    the server's, changed by hand: leave
 *   foreign   no marker, a file of someone else's: leave
 */
export function guideState(existing, body) {
  if (existing === null) return "missing";
  const m = existing.match(MARK_RE);
  if (!m) return "foreign";
  const rest = existing.slice(m[0].length);
  if (hash(rest) !== m[1]) return "edited";
  return rest === body ? "current" : "stale";
}

const isDir = async (p) => (await fsp.stat(p).catch(() => null))?.isDirectory() === true;

/**
 * Writes `body` (stamped) to `file` when it is missing or stale. Returns { path, state, error? }:
 * a guideState, "written", "no-folder" (its folder is not there, so nothing was made),
 * "unreadable" or "failed".
 */
export async function writeGuide(file, body) {
  if (!(await isDir(path.dirname(file)))) return { path: file, state: "no-folder" };
  let existing = null;
  try {
    existing = await fsp.readFile(file, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") return { path: file, state: "unreadable", error: err.code ?? err.message };
  }
  const state = guideState(existing, body);
  if (state !== "missing" && state !== "stale") return { path: file, state };
  // A dot file while it is written: every scanner skips those.
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await fsp.writeFile(tmp, stamp(body));
    await fsp.rename(tmp, file);
    return { path: file, state: "written" };
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    return { path: file, state: "failed", error: err.code ?? err.message };
  }
}
