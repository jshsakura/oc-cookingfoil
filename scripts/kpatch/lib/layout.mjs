/**
 * What a downloaded patch package is, and where its files go on the SD card.
 * Packages arrive in many shapes: SD-root zips, bare romfs/exefs, a folder
 * named after the title id, an extra "patch/" wrapper, emulator copies beside
 * the Atmosphère ones. Only the Atmosphère part is installed.
 */
const TID_RE = /^0100[0-9a-f]{12}$/i;
const FS_DIR = /^(romfs|exefs)$/i;

/** "layeredfs" | "xdelta" | "patcher" | "unknown" from the file list. Pure. */
export function packageKind(paths) {
  const lower = paths.map((p) => p.toLowerCase());
  const parts = lower.map((p) => p.split("/"));
  // Deltas need the game's own files, wherever they sit in the package.
  if (lower.some((p) => /\.(xdelta|vcdiff|bps)$/.test(p))) return "xdelta";
  if (lower.some((p) => p.includes("atmosphere/contents/") || p.includes("atmosphere/exefs_patches/"))) return "layeredfs";
  if (lower.some((p) => /\.(exe|bat|sh|py)$/.test(p))) return "patcher";
  const hasFs = parts.some((seg) => seg.some((s, i) => FS_DIR.test(s) && i < seg.length - 1) && !seg.includes("emulator_mod"));
  return hasFs ? "layeredfs" : "unknown";
}

/** Where one path lands, relative to the SD root, or null. Pure. */
function place(rel, tid) {
  const seg = rel.split("/");
  const low = seg.map((s) => s.toLowerCase());
  if (low.includes("emulator_mod")) return null;
  const atmo = low.indexOf("atmosphere");
  if (atmo >= 0) {
    const rest = seg.slice(atmo);
    if (low[atmo + 1] === "contents") {
      if (!TID_RE.test(rest[2] ?? "") || rest[2].toUpperCase() !== tid) return null;
      rest[2] = tid;
    }
    return rest.join("/");
  }
  const fs = low.findIndex((s, i) => FS_DIR.test(s) && i < seg.length - 1);
  if (fs < 0) return null;
  const owner = seg[fs - 1];
  if (owner && TID_RE.test(owner) && owner.toUpperCase() !== tid) return null;
  return [`atmosphere/contents/${tid}`, low[fs], ...seg.slice(fs + 1)].join("/");
}

/** The package's files as { from, to } under the SD root, plus what was left out. Pure. */
export function toSdRoot(paths, tid) {
  const files = [];
  const dropped = [];
  for (const rel of paths) {
    const to = place(rel, tid);
    if (to) files.push({ from: rel, to });
    else dropped.push(rel);
  }
  return { files, dropped };
}
