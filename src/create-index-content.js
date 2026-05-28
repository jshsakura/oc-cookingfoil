/**
 * Build the shop response payload (consumed by both /shop.json and /shop.tfl
 * via the chokidar-warmed cache in src/meta/shop-cache.js).
 *
 * Pipeline:
 *   fast-glob scan
 *     → filename parse  (name, titleId, version, contentType)
 *     → per-item enrich with name + size + icon_url + titleId + kind
 *     → titledb store overlay (per-field language fallback already applied)
 *     → custom_entries.jsonc verbatim merge (with synthetic-titleId support)
 *     → rewrite every titledb image URL to the local proxy (/api/shop/...)
 *     → fold in the shop_template (welcome message, custom headers, ...)
 *
 * Two surfaces:
 *   - generateIndex() — convenience wrapper that does a full scan + compose.
 *     Useful for one-shot callers (tests, ad-hoc invocation).
 *   - scanLibrary() / readOneFile() / composeResponse() — primitives used
 *     by the cache layer to maintain an incremental in-memory state. A
 *     chokidar event for a single file produces a single readOneFile()
 *     and a re-compose, instead of re-walking thousands of unchanged
 *     entries.
 *
 * Invariants (FINDINGS §6, §7):
 *   - Every scanned file ends up in `files[]`. Parse failures only thin out
 *     metadata; they never drop the item.
 *   - The shop response is self-contained: one request, all the metadata.
 *   - Image URLs in the response point to OUR proxy endpoints — never raw
 *     Nintendo CDN URLs — so the Switch client gets locally-cached
 *     bytes (offline-friendly) and we control retention.
 */
import fs from "fs/promises";
import path from "path";
import FastGlob from "fast-glob";

import debug from "./debug.js";
import { parseFromFilename } from "./meta/filename-parser.js";
import { loadCustomEntries } from "./meta/custom-entries.js";
import * as titledbStore from "./meta/titledb-store.js";
import * as extractedMeta from "./meta/extracted-meta-store.js";
import * as nacpExtractor from "./meta/nacp-extractor.js";
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
const GAME_FILE_RE = /\.(nsp|nsz|xci|xcz)$/i;

export function isGameFile(relOrAbsPath) {
  return GAME_FILE_RE.test(relOrAbsPath);
}

function encodeRelPath(relPath) {
  // Match the original tinfoil-hat wire format: inner path is percent-encoded
  // (incl. `/`), then a literal "../" prefix is prepended.
  const encoded = encodeUrlObject({ url: relPath }).url;
  return "../" + encoded;
}

function normalizeTitleId(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.length === 16 ? hex : null;
}

/**
 * Take a titledb entry (with Nintendo CDN URLs) and produce the version we
 * surface to clients — image URLs replaced with our proxy endpoints, keyed
 * by the base titleId. The raw upstream URLs stay in titledb-store for the
 * proxy itself to look up.
 */
function proxyifyTitledb(entry, titleId) {
  if (!entry) return entry;
  const out = { ...entry, id: titleId };
  if (entry.iconUrl) out.iconUrl = `/api/shop/icon/${titleId}`;
  if (entry.bannerUrl) out.bannerUrl = `/api/shop/banner/${titleId}`;
  if (Array.isArray(entry.screenshots) && entry.screenshots.length > 0) {
    out.screenshots = entry.screenshots.map(
      (_, i) => `/api/shop/screenshot/${titleId}/${i}`
    );
    out.screenshotCount = entry.screenshots.length;
  }
  return out;
}

function buildFileItem(relPath, size) {
  const parsed = parseFromFilename(relPath);
  const baseId = parsed.groupTitleId;
  const fromDb = baseId ? titledbStore.get(baseId) : null;
  const displayName = fromDb?.name || parsed.name;

  const item = {
    url: encodeRelPath(relPath),
    name: displayName,
    size,
  };
  if (parsed.titleId) {
    item.titleId = parsed.titleId;
    item.baseTitleId = baseId;
    item.kind = parsed.contentType; // "base" | "update" | "dlc"
    item.icon_url = `/api/shop/icon/${parsed.titleId}`;
  }
  return item;
}

/**
 * Re-read one file from disk and build its file item. Returns null if the
 * file disappeared between the chokidar event and this stat — the caller
 * should treat that as a removal.
 */
export async function readOneFile(relPath) {
  try {
    const st = await fs.stat(path.join(romsDirPath, relPath));
    return buildFileItem(relPath, st.size);
  } catch (err) {
    if (err.code !== "ENOENT") {
      debug.error("readOneFile %s: %s", relPath, err.message);
    }
    return null;
  }
}

/**
 * Full library scan + custom-entries load. Returns the primitive state
 * (`filesMap` keyed by relative path, plus `customs` array) that the
 * shop-cache layer then mutates via delta apply and re-composes on each
 * change.
 */
export async function scanLibrary() {
  const entries = await FastGlob(SCAN_PATTERNS, {
    cwd: romsDirPath,
    dot: false,
    onlyFiles: true,
    braceExpansion: false,
    caseSensitiveMatch: false,
    stats: true,
  });
  debug.log("scanned files: %d", entries.length);

  const filesMap = new Map();
  for (const entry of entries) {
    const rel = entry.path;
    const size = entry.stats?.size ?? 0;
    filesMap.set(rel, buildFileItem(rel, size));
  }

  const customs = await loadCustomEntries(customEntriesPath);
  return { filesMap, customs };
}

export async function loadCustoms() {
  return loadCustomEntries(customEntriesPath);
}

/**
 * Produce the shop response payload from current primitive state. Cheap
 * (O(filesMap.size + customs.length) iteration, no I/O), so safe to call
 * after every chokidar delta. Output ordering follows Map insertion order
 * + customs append, which is deterministic given the same state.
 */
export function composeResponse(filesMap, customs) {
  const template = getJsonTemplateFile();
  const files = [];
  const titledb = {};

  for (const item of filesMap.values()) {
    files.push(item);
    const baseId = item.baseTitleId;
    if (baseId && !titledb[baseId]) {
      const fromDb = titledbStore.get(baseId);
      const proxied = proxyifyTitledb(fromDb, baseId);
      // Fallback layer (NACP/NRO extraction). Lower priority than titledb
      // but higher than nothing — fills in name/publisher/version for
      // homebrew and fan titles that blawar will never carry.
      const extracted = !fromDb ? extractedMeta.get(baseId) : null;
      // Queue extraction for anything missing from both layers. The worker
      // de-dupes by titleId, so re-enqueueing on every rebuild is cheap.
      if (!fromDb && !extracted) {
        nacpExtractor.enqueue({
          absPath: path.join(romsDirPath, item.url.replace(/^\.\.\//, "")),
          baseTitleId: baseId,
          fileName: item.name,
        });
      }
      titledb[baseId] = {
        ...(proxied ?? {}),
        id: baseId,
        name: item.name,
        // Pick up extracted fields when titledb is silent. These only
        // overwrite the synthesized defaults — proxied (titledb) always wins.
        publisher: proxied?.publisher ?? extracted?.publisher,
        version: proxied?.version ?? extracted?.version,
        numberOfPlayers: proxied?.numberOfPlayers ?? extracted?.numberOfPlayers,
        // No-omission invariant: every base titleId surfaces with an icon
        // URL even when titledb has nothing for it. The icon route falls
        // back to a 1×1 transparent PNG when there's also no upstream, so
        // the frontend's r.tdb is never undefined and image tags never 404.
        iconUrl: proxied?.iconUrl ?? `/api/shop/icon/${baseId}`,
        size: item.size > 0 ? item.size : proxied?.size ?? 0,
      };
    }
  }

  for (const raw of customs) {
    const entry = { ...raw };
    const tid = normalizeTitleId(entry.titleId);
    if (tid && !entry.icon_url && !entry.iconUrl) {
      entry.icon_url = `/api/shop/icon/${tid}`;
    }
    files.push(entry);

    if (tid && !titledb[tid]) {
      const proxied = proxyifyTitledb(titledbStore.get(tid), tid) ?? {};
      titledb[tid] = {
        ...proxied,
        id: tid,
        name: entry.name ?? proxied.name,
        size: typeof entry.size === "number" ? entry.size : proxied.size ?? 0,
        publisher: entry.publisher ?? proxied.publisher,
        description: entry.description ?? proxied.description,
        releaseDate: entry.releaseDate ?? proxied.releaseDate,
        region: entry.region ?? proxied.region,
        rating: entry.rating ?? proxied.rating,
        rank: entry.rank ?? proxied.rank,
      };
    }
  }

  if (welcomeMessage && !template.success) {
    template.success = welcomeMessage;
  }

  return Object.assign(template, { files, titledb });
}

/**
 * Convenience wrapper: full scan + immediate compose. Used by tests and
 * any caller that doesn't need to maintain incremental state.
 */
export default async function generateIndex() {
  const { filesMap, customs } = await scanLibrary();
  return composeResponse(filesMap, customs);
}
