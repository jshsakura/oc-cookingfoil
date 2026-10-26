/**
 * Reads data/plugins/ and says what each folder is, without importing anything.
 *
 *   scanPluginDir(root) -> [{ id, dir, status, manifest?, problems?, needs? }]
 *     status "ok"            a manifest that passed, and an index.js inside the folder
 *     status "broken"        problems lists why (manifest codes, "symlink", "no-index", ...)
 *     status "incompatible"  well-formed but another apiVersion; needs is the version it asks for
 *
 * Only the operator puts folders here. Nothing in the loader follows a link out of the folder: a
 * symlinked plugin folder, manifest or index.js is refused, and so is anything whose real path
 * is not under the root.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { API_VERSION, MAX_MANIFEST_BYTES, parseManifest } from "./manifest.js";

export const MANIFEST_FILE = "plugin.json";
export const ENTRY_FILE = "index.js";

const isInside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

/** A regular file that is not a link and does not leave the folder; otherwise the reason it is not. */
async function plainFile(dirReal, file) {
  let st;
  try { st = await fs.lstat(file); } catch { return { problem: "missing" }; }
  if (st.isSymbolicLink()) return { problem: "symlink" };
  if (!st.isFile()) return { problem: "missing" };
  let real;
  try { real = await fs.realpath(file); } catch { return { problem: "missing" }; }
  if (!isInside(dirReal, real)) return { problem: "outside" };
  return { size: st.size };
}

async function inspect(rootReal, name) {
  const dir = path.join(rootReal, name);
  const entry = { id: name, dir };
  const broken = (...problems) => ({ ...entry, status: "broken", problems });

  let st;
  try { st = await fs.lstat(dir); } catch { return null; }
  if (st.isSymbolicLink()) return broken("symlink");
  if (!st.isDirectory()) return null;
  let dirReal;
  try { dirReal = await fs.realpath(dir); } catch { return broken("unreadable"); }
  if (!isInside(rootReal, dirReal)) return broken("outside");

  const mf = await plainFile(dirReal, path.join(dir, MANIFEST_FILE));
  if (mf.problem) return broken(mf.problem === "missing" ? "no-manifest" : `manifest-${mf.problem}`);
  if (mf.size > MAX_MANIFEST_BYTES) return broken("manifest-too-large");
  let text;
  try { text = await fs.readFile(path.join(dir, MANIFEST_FILE), "utf8"); } catch { return broken("unreadable"); }

  // Another apiVersion is "incompatible" even when its other fields no longer fit this shape.
  let raw;
  try { raw = JSON.parse(text); } catch { return broken("bad-json"); }
  if (Number.isInteger(raw?.apiVersion) && raw.apiVersion >= 1 && raw.apiVersion !== API_VERSION) {
    return { ...entry, status: "incompatible", needs: raw.apiVersion };
  }

  const parsed = parseManifest(raw, name);
  if (!parsed.ok) return broken(...parsed.problems);
  const ix = await plainFile(dirReal, path.join(dir, ENTRY_FILE));
  if (ix.problem) return broken(ix.problem === "missing" ? "no-index" : `index-${ix.problem}`);
  return { ...entry, status: "ok", manifest: parsed.manifest };
}

export async function scanPluginDir(root) {
  let rootReal;
  let names;
  try {
    rootReal = await fs.realpath(root);
    names = await fs.readdir(rootReal);
  } catch (err) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return [];
    throw err;
  }
  const found = [];
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue;
    const item = await inspect(rootReal, name);
    if (item) found.push(item);
  }
  return found;
}
