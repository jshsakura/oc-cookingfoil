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
  extractIcons,
} from "./helpers/envs.js";
import {
  addUrlEncodedFileInfo as encodeUrlObject,
  getJsonTemplateFile,
} from "./helpers/helpers.js";
import pkg from "./package.js";

// Stamp every proxy artwork URL with the server's MAJOR.MINOR version.
// Embedded clients like Tinfoil cache responses keyed on the literal URL
// string. The stamp gives us a single knob to bust those caches across
// a release line — but doing it on every patch turned out to be way too
// aggressive: each v0.7.x → v0.7.(x+1) bump forced Tinfoil to re-fetch
// the entire icon library (1.9k titles × ~300 ms cold = multi-minute
// stall on a normal LAN deploy).
//
// Major/minor only means a patch release (bug fixes, doc edits, this
// kind of internal tweak) ships without re-fetching anything. The next
// minor bump (v0.8.0) is the planned moment for a one-shot bust —
// long-running deployments that have accreted stale placeholders pick
// up clean state then, and nobody pays the bandwidth tax in between.
const ARTWORK_VERSION = pkg.version.split(".").slice(0, 2).join(".");
function withVersion(path) { return `${path}?v=${ARTWORK_VERSION}`; }

const SCAN_PATTERNS = ["**/*.nsp", "**/*.nsz", "**/*.xci", "**/*.xcz", "**/*.nro"];
const GAME_FILE_RE = /\.(nsp|nsz|xci|xcz|nro)$/i;

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
  if (entry.iconUrl) out.iconUrl = withVersion(`/api/shop/icon/${titleId}`);
  if (entry.bannerUrl) out.bannerUrl = withVersion(`/api/shop/banner/${titleId}`);
  if (Array.isArray(entry.screenshots) && entry.screenshots.length > 0) {
    out.screenshots = entry.screenshots.map(
      (_, i) => withVersion(`/api/shop/screenshot/${titleId}/${i}`)
    );
    out.screenshotCount = entry.screenshots.length;
  }
  return out;
}

// Tinfoil's on-Switch search only matches the literal `name` field of
// each entry, AND the Switch's on-screen keyboard is English-only. So
// when titledb picks a Korean (or other CJK) display name, the title is
// effectively unsearchable from the device unless we glue the English
// rendering onto the name ourselves:
//
//   "젤다의 전설 (The Legend of Zelda)"
//
// We do this for exactly the "CJK pick + English alias exists" case:
//   - skip when the picked name is already ASCII ("Mario" stays "Mario")
//   - skip when no English alias was collected for the title
// The first ASCII alias different from the picked name is the one we
// surface — there's typically only one canonical English title, and
// extra clutter would just push the row off-screen on Tinfoil.
const CJK_RE = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿가-힯]/;
const ASCII_RE = /^[\x00-\x7f]+$/;

function decorateNameWithAlias(name, fromDb) {
  if (!fromDb) return name;
  if (!CJK_RE.test(name)) return name;
  const aliases = Array.isArray(fromDb.aliases) ? fromDb.aliases : [];
  const eng = aliases.find(
    (a) => typeof a === "string" && ASCII_RE.test(a.trim()) && a.trim() !== name
  );
  if (!eng) return name;
  return `${name} (${eng.trim()})`;
}

function buildFileItem(relPath, size) {
  const parsed = parseFromFilename(relPath);
  const baseId = parsed.groupTitleId;
  const fromDb = baseId ? titledbStore.get(baseId) : null;
  const rawName = fromDb?.name || parsed.name;
  const displayName = decorateNameWithAlias(rawName, fromDb);

  const item = {
    url: encodeRelPath(relPath),
    name: displayName,
    size,
  };
  if (parsed.titleId) {
    item.titleId = parsed.titleId;
    item.baseTitleId = baseId;
    item.kind = parsed.contentType; // "base" | "update" | "dlc"
    // Per FINDINGS §2: CyberFoil reads either `icon_url` (snake_case)
    // OR `iconUrl` (camelCase) per file. Emitting both maximizes
    // compatibility across Tinfoil forks / future clients without
    // making the response materially larger.
    const iconUrl = withVersion(`/api/shop/icon/${parsed.titleId}`);
    item.icon_url = iconUrl;
    item.iconUrl = iconUrl;
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

  for (const [relPath, item] of filesMap.entries()) {
    files.push(item);
    const baseId = item.baseTitleId;
    if (baseId && !titledb[baseId]) {
      const fromDb = titledbStore.get(baseId);
      const proxied = proxyifyTitledb(fromDb, baseId);
      // Tinfoil reads the displayed name from per-file entries, but
      // some forks fall back to the titledb section's name for search.
      // Decorate this one too so the English alias is reachable from
      // both code paths.
      const decoratedTitledbName = proxied?.name
        ? decorateNameWithAlias(proxied.name, fromDb)
        : null;
      // Fallback layer (NACP/NRO extraction). Lower priority than titledb
      // but higher than nothing — fills in name/publisher/version for
      // homebrew and fan titles that blawar will never carry.
      const extracted = !fromDb ? extractedMeta.get(baseId) : null;
      // Queue extraction per the COOK_EXTRACT_ICONS policy:
      //   all     → every title, so the icon comes out of the container and
      //             covers render fully offline (CDN is only a fallback).
      //   missing → only titles titledb can't cover.
      //   off     → never.
      // The worker de-dupes by titleId AND skips containers whose icon is
      // already on disk, so re-enqueueing on every rebuild stays cheap.
      // `wantMeta` is false for titledb-covered titles — they only need the
      // icon, so the worker can skip the expensive nstool dump when one is
      // already cached. Use the raw relPath (filesMap key) — item.url is
      // percent-encoded for wire transport and would point the extractor at
      // a non-existent path otherwise.
      const wantExtract =
        extractIcons === "all" ? true : extractIcons === "missing" ? !fromDb : false;
      if (wantExtract && !extracted) {
        nacpExtractor.enqueue({
          absPath: path.join(romsDirPath, relPath),
          baseTitleId: baseId,
          fileName: item.name,
          wantMeta: !fromDb,
        });
      }
      titledb[baseId] = {
        ...(proxied ?? {}),
        id: baseId,
        // Preference order: titledb (decorated) > extracted NACP > filename.
        // The decorated form glues the English alias onto a CJK name
        // ('젤다의 전설 (The Legend of Zelda)') so the Switch English-
        // keyboard search matches no matter which name surface a given
        // Tinfoil fork reads.
        name: decoratedTitledbName ?? extracted?.name ?? item.name,
        publisher: proxied?.publisher ?? extracted?.publisher,
        version: proxied?.version ?? extracted?.version,
        numberOfPlayers: proxied?.numberOfPlayers ?? extracted?.numberOfPlayers,
        // No-omission invariant: every base titleId surfaces with an icon
        // URL even when titledb has nothing for it. The icon route 404s
        // when the asset isn't on disk yet — clients render their own
        // 'no icon' graphic and re-fetch on the next shop refresh.
        iconUrl: proxied?.iconUrl ?? withVersion(`/api/shop/icon/${baseId}`),
        size: item.size > 0 ? item.size : proxied?.size ?? 0,
      };
    }
  }

  for (const raw of customs) {
    const entry = { ...raw };
    const tid = normalizeTitleId(entry.titleId);
    if (tid && !entry.icon_url && !entry.iconUrl) {
      entry.icon_url = withVersion(`/api/shop/icon/${tid}`);
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
