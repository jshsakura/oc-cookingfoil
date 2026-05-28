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
 * Invariants (FINDINGS §6, §7):
 *   - Every scanned file ends up in `files[]`. Parse failures only thin out
 *     metadata; they never drop the item.
 *   - The shop response is self-contained: one request, all the metadata.
 *   - Image URLs in the response point to OUR proxy endpoints — never raw
 *     Nintendo CDN URLs — so the Switch client gets locally-cached
 *     bytes (offline-friendly) and we control retention.
 */
import FastGlob from "fast-glob";

import debug from "./debug.js";
import { parseFromFilename } from "./meta/filename-parser.js";
import { loadCustomEntries } from "./meta/custom-entries.js";
import * as titledbStore from "./meta/titledb-store.js";
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

export default async function generateIndex() {
  const template = getJsonTemplateFile();

  // `stats: true` makes fast-glob fold the per-file size into the directory
  // walk itself (one async syscall stream) — replaces an N-deep `fs.statSync`
  // loop that would block the event loop for libraries with thousands of
  // games. Entries become objects with `.path` and `.stats`.
  const entries = await FastGlob(SCAN_PATTERNS, {
    cwd: romsDirPath,
    dot: false,
    onlyFiles: true,
    braceExpansion: false,
    caseSensitiveMatch: false,
    stats: true,
  });
  debug.log("scanned files: %d", entries.length);

  const files = [];
  const titledb = {};

  for (const entry of entries) {
    const rel = entry.path;
    const size = entry.stats?.size ?? 0;
    const parsed = parseFromFilename(rel);

    const baseId = parsed.groupTitleId;
    const fromDb = baseId ? titledbStore.get(baseId) : null;
    const displayName = fromDb?.name || parsed.name;

    const item = {
      url: encodeRelPath(rel),
      name: displayName,
      size,
    };
    if (parsed.titleId) {
      item.titleId = parsed.titleId;
      item.baseTitleId = baseId;
      item.kind = parsed.contentType; // "base" | "update" | "dlc"
      item.icon_url = `/api/shop/icon/${parsed.titleId}`;
    }
    files.push(item);

    if (baseId && !titledb[baseId]) {
      const proxied = proxyifyTitledb(fromDb, baseId);
      titledb[baseId] = {
        ...(proxied ?? {}),
        id: baseId,
        name: displayName,
        // No-omission invariant: every base titleId surfaces with an icon
        // URL even when titledb has nothing for it. The icon route falls
        // back to a 1×1 transparent PNG when there's also no upstream, so
        // the frontend's r.tdb is never undefined and image tags never 404.
        iconUrl: proxied?.iconUrl ?? `/api/shop/icon/${baseId}`,
        size: size > 0 ? size : proxied?.size ?? 0,
      };
    }
  }

  // Append user-supplied entries (homebrew, fan content, synthetic IDs).
  const customs = await loadCustomEntries(customEntriesPath);
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
