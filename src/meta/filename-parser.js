/**
 * Parse Switch title metadata from filenames.
 *
 * Convention (community-standard):
 *   "Game Name [TITLEID][vVERSION] (size).ext"
 *
 * TITLEID: 16 hex chars. Suffix encodes content type:
 *   ...000 → base game
 *   ...800 → update / patch
 *   anything else → DLC (add-on content)
 *
 * Every field is best-effort. Per the no-omission invariant in FINDINGS §7,
 * parse failures never drop the item — caller must include it anyway.
 */
import path from "path";

const TITLEID_RE = /\[([0-9A-Fa-f]{16})\]/g;
const VERSION_RE = /\[v(\d+)\]/i;
const TAG_RE = /\[[^\]]*\]/g;
const PAREN_RE = /\([^)]*\)/g;

const KNOWN_EXTS = new Set(["nsp", "nsz", "xci", "xcz", "nro"]);

// Add-on content ids start one 0x1000 block above their application id
// (base 0100B6400CA56000 → DLC 0100B6400CA57001…), so the base is the DLC id
// with the low 12 bits cleared, minus 0x1000.
export function dlcBaseTitleId(titleId) {
  const base = (BigInt(`0x${titleId}`) & ~0xfffn) - 0x1000n;
  return base.toString(16).toUpperCase().padStart(16, "0");
}

export function parseFromFilename(filename) {
  const base = path.basename(filename);
  const ext = path.extname(base).toLowerCase().replace(".", "");
  const stem = base.slice(0, base.length - (ext ? ext.length + 1 : 0));

  const titleIds = [...stem.matchAll(TITLEID_RE)].map((m) => m[1].toUpperCase());
  const titleId = titleIds[0] ?? null;

  const versionMatch = stem.match(VERSION_RE);
  const version = versionMatch ? Number(versionMatch[1]) : null;

  // Cleaned-up display name: strip [..] and (..) tokens, collapse whitespace.
  const name =
    stem
      .replace(TAG_RE, "")
      .replace(PAREN_RE, "")
      .replace(/\s+/g, " ")
      .trim() || stem; // never empty — fall back to raw stem

  let contentType = "base";
  let groupTitleId = titleId;
  if (titleId) {
    const suffix = titleId.slice(-3).toLowerCase();
    if (suffix === "800") {
      contentType = "update";
      groupTitleId = titleId.slice(0, -3) + "000";
    } else if (suffix !== "000") {
      contentType = "dlc";
      groupTitleId = dlcBaseTitleId(titleId);
    }
  }

  return {
    name,
    titleId,
    groupTitleId,
    version,
    contentType,
    ext,
    isKnownContainer: KNOWN_EXTS.has(ext),
  };
}
