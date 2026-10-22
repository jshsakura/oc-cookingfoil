/**
 * The storage guide and every folder's guide (helpers/folder-guides.js), from
 * memory: the admin API (routes/admin/storage-guide-api.js) and the MCP read
 * tools call these, so both say the same.
 *
 * Each retro scan recomputes them from the systems it read (retro/scaffold.js
 * run, kept as its last run). Before the first scan they come from the built-in
 * system table, computed once per layout. Neither reads the disk.
 */
import path from "path";
import { DEFAULT_SYSTEMS } from "../retro/systems.js";
import * as scaffold from "../retro/scaffold.js";

let fallback = null;

/** The guides from the built-in table, the same object while `layout` and `retroDir` stay. */
function builtIn(layout, retroDir) {
  if (fallback?.layout !== layout || fallback.retroDir !== retroDir) {
    const packDir = path.join(retroDir, "retroarch");
    fallback = { layout, retroDir, guide: scaffold.guideFor({ systems: DEFAULT_SYSTEMS, runnable: scaffold.runnableIds(DEFAULT_SYSTEMS), layout, retroDir, packDir }) };
  }
  return fallback.guide;
}

/** { text, guides, status }: the last scan's, or the built-in table's before it (status null). */
export function current({ layout, retroDir }) {
  return scaffold.lastGuide() ?? builtIn(layout, retroDir);
}

/**
 * `p` as a folder path a guide could have ("retro/roms/gba", a trailing "/" dropped), or null when it is
 * anything else: absolute, with "." or ".." or empty parts, a backslash or a control character.
 */
export function cleanPath(p) {
  if (typeof p !== "string") return null;
  const s = p.endsWith("/") ? p.slice(0, -1) : p;
  if (!s || s.startsWith("/") || /[\\\x00-\x1f]/.test(s)) return null;
  return s.split("/").every((part) => part && part !== "." && part !== "..") ? s : null;
}

/**
 * One folder's guide by its path: { guide }, { error: "bad-path" } or { error: "unknown", known: [path] }.
 */
export function folder(p, opts) {
  const at = cleanPath(p);
  if (!at) return { error: "bad-path" };
  const { guides } = current(opts);
  const guide = guides.find((g) => g.path === at);
  return guide ? { guide } : { error: "unknown", known: guides.map((g) => g.path) };
}
