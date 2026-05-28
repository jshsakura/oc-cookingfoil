/**
 * Build the shop response payload (consumed by both /shop.json and /shop.tfl).
 *
 * Pipeline:
 *   fast-glob scan
 *     → filename parse  (name, titleId, version, contentType)
 *     → enrich each file entry with name + size + icon_url
 *     → merge user-supplied custom_entries.jsonc verbatim
 *     → emit a `titledb` skeleton from observed groupTitleIds
 *     → fold in the shop_template (welcome message, headers, ...)
 *
 * Invariants (FINDINGS §6, §7):
 *   - Every scanned file ends up in `files[]`. Parse failures only thin out
 *     metadata; they never drop the item.
 *   - The shop response is self-contained: one request, all the metadata.
 */
import fs from "fs";
import path from "path";
import FastGlob from "fast-glob";

import debug from "./debug.js";
import { parseFromFilename } from "./meta/filename-parser.js";
import { loadCustomEntries } from "./meta/custom-entries.js";
import {
  romsDirPath,
  welcomeMessage,
  customEntriesPath,
} from "./helpers/envs.js";
import {
  addUrlEncodedFileInfo as encodeUrlObject,
  getJsonTemplateFile,
} from "./helpers/helpers.js";

const SCAN_PATTERNS = ["**/*.nsp", "**/*.nsz", "**/*.xci", "**/*.xcz"];

function encodeRelPath(relPath) {
  // Match the original tinfoil-hat wire format: inner path is percent-encoded
  // (incl. `/`), then a literal "../" prefix is prepended. CyberFoil and
  // upstream Tinfoil both consume this shape.
  const encoded = encodeUrlObject({ url: relPath }).url;
  return "../" + encoded;
}

function safeStatSize(absPath) {
  try {
    return fs.statSync(absPath).size;
  } catch (err) {
    debug.error("stat failed for %s: %s", absPath, err.message);
    return 0;
  }
}

function normalizeTitleId(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.length === 16 ? hex : null;
}

export default async function generateIndex() {
  const template = getJsonTemplateFile();

  const relPaths = await FastGlob(SCAN_PATTERNS, {
    cwd: romsDirPath,
    dot: false,
    onlyFiles: true,
    braceExpansion: false,
    caseSensitiveMatch: false,
  });
  debug.log("scanned files: %d", relPaths.length);

  const files = [];
  const titledb = {};

  for (const rel of relPaths) {
    const size = safeStatSize(path.join(romsDirPath, rel));
    const parsed = parseFromFilename(rel);

    const item = {
      url: encodeRelPath(rel),
      name: parsed.name,
      size,
    };
    if (parsed.titleId) {
      item.icon_url = `/api/shop/icon/${parsed.titleId}`;
    }
    files.push(item);

    // Seed a titledb entry keyed by the group (base) title id so updates and
    // DLC roll up under the same game. Phase 2b's titledb merger will overlay
    // richer fields on top of this skeleton.
    if (parsed.groupTitleId && !titledb[parsed.groupTitleId]) {
      titledb[parsed.groupTitleId] = {
        id: parsed.groupTitleId,
        name: parsed.name,
        size,
      };
    }
  }

  // Append user-supplied entries verbatim (homebrew, fan content, synthetic IDs).
  const customs = await loadCustomEntries(customEntriesPath);
  for (const raw of customs) {
    const entry = { ...raw };
    const tid = normalizeTitleId(entry.titleId);
    if (tid && !entry.icon_url && !entry.iconUrl) {
      entry.icon_url = `/api/shop/icon/${tid}`;
    }
    files.push(entry);

    if (tid && !titledb[tid]) {
      titledb[tid] = {
        id: tid,
        name: entry.name,
        size: typeof entry.size === "number" ? entry.size : 0,
        publisher: entry.publisher,
        description: entry.description,
        releaseDate: entry.releaseDate,
        region: entry.region,
        rating: entry.rating,
        rank: entry.rank,
      };
    }
  }

  if (welcomeMessage && !template.success) {
    template.success = welcomeMessage;
  }

  return Object.assign(template, { files, titledb });
}
