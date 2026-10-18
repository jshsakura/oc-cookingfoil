/**
 * Load user-supplied custom shop entries from a JSON5/JSONC file.
 *
 * Each entry must have `url` and `name`. Everything else is optional.
 * Malformed entries are skipped individually — never block the whole shop.
 * See FINDINGS §6 (custom entries) and §7 (no-omission invariant).
 */
import { readFile } from "fs/promises";
import JSON5 from "json5";
import debug from "../debug.js";

export async function loadCustomEntries(filePath) {
  if (!filePath) return [];
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON5.parse(raw);
    if (!Array.isArray(parsed)) {
      debug.error("custom_entries: top-level value is not an array — ignoring file");
      return [];
    }
    const valid = [];
    for (const [idx, entry] of parsed.entries()) {
      if (!entry || typeof entry !== "object") {
        debug.error("custom_entries[%d]: not an object — skipping", idx);
        continue;
      }
      if (typeof entry.url !== "string" || !entry.url.length) {
        debug.error("custom_entries[%d]: missing url — skipping", idx);
        continue;
      }
      if (typeof entry.name !== "string" || !entry.name.length) {
        debug.error("custom_entries[%d]: missing name — skipping", idx);
        continue;
      }
      valid.push(entry);
    }
    debug.log("custom_entries: loaded %d entries", valid.length);
    return valid;
  } catch (err) {
    if (err.code === "ENOENT") return [];
    debug.error("custom_entries load error:", err.message);
    return [];
  }
}
