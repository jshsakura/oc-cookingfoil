/**
 * Background queue + worker that asks a pluggable provider to extract
 * NACP-style metadata (and an icon, if the provider can pull one) for
 * titleIds that aren't covered by blawar/titledb.
 *
 * Why a queue: extraction in real providers spawns subprocesses against
 * potentially multi-GB NSP files. Doing that on the request path would
 * stall the event loop and starve other handlers. The queue uses bounded
 * concurrency and de-duplicates work — the library-cache builder enqueues
 * the same baseTitleId every time it sees the file; the worker only
 * extracts once.
 *
 * Where the data lands: extracted-meta-store.js (one JSON per titleId)
 * + (optionally) an icon PNG persisted into the image-cache directory,
 * which the icon route already consults when there's no upstream URL.
 */
import path from "path";
import fs from "fs/promises";
import { NACP_ICON, shrink } from "./art-ingest.js";
import * as extractedMeta from "./extracted-meta-store.js";
import { cachePathFor, dropVariants, hasCached } from "./image-cache.js";
import * as autoProvider from "./extract-providers/auto.js";
import { iconCacheDir, extractPaceMs } from "../helpers/envs.js";
import debug from "../debug.js";
import { envNumber } from "../helpers/env-read.js";
import { NACP_DECODER_VERSION } from "./nacp-decode.js";

const CONCURRENCY = envNumber("COOK_EXTRACT_CONCURRENCY", 2, { min: 1, integer: true });

// Inter-job pacing: a small gap between jobs so the one-time background pass
// runs GENTLY (never saturates disk/CPU while serving). Concurrency is
// unchanged — this only spaces jobs out. See COOK_EXTRACT_PACE_MS.
const PACE_MS = extractPaceMs;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Active provider. `auto` dispatches by file extension — NRO files get
// the pure-JS NACP/icon parser, encrypted containers fall through to the
// stub until a keyed extractor is wired in. Tests / future binary
// integrations can swap via setProvider().
let provider = autoProvider;

export function setProvider(p) {
  if (!p || typeof p.extract !== "function") {
    throw new Error("provider must expose extract()");
  }
  provider = p;
  debug.log("nacp-extractor: provider set to %s", p.name || "anonymous");
}

// Subscribers fired AFTER a record is persisted to extracted-meta. The
// library-cache layer hooks this so the next /games.json reflects the new
// metadata without the user having to wait for the next chokidar event.
const subscribers = new Set();
export function onExtracted(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
function notifyExtracted(payload) {
  for (const fn of subscribers) {
    try { fn(payload); } catch (err) {
      debug.error("nacp-extractor: subscriber threw: %s", err.message);
    }
  }
}

const queue = [];
const inFlight = new Set();   // baseTitleId currently extracting
const tried = new Set();      // baseTitleId we've already attempted (any outcome)
let active = 0;
let drained = Promise.resolve();
let drainedResolver = null;

// Which game-file icon goes to which client language (extract-providers/nsp.js
// LANG_ICON_NAMES). Raised when that changes: 2 is twelve languages, Chinese by
// script (1, unmarked, gave zh the traditional icon).
export const ICON_MAP = 2;

/** Whether a record's language icons were saved by an older mapping, or never: they are read once more. Pure. */
export const needsLangIcons = (record) => !Array.isArray(record?.iconLangs) || record.iconMap !== ICON_MAP;

/**
 * Whether a stored record is read from its file once more: in full when its
 * name came out garbled (extracted-meta-store.js) or an older decoder could
 * not read its NACP, whatever the extraction mode; else for its language icons
 * (needsLangIcons). Pure.
 */
export const needsReread = (record) => fullReread(record) || needsLangIcons(record);

function fullReread(record) {
  if (record?.garbled) return true;
  return record?.nacpUnreadable != null && record.nacpUnreadable !== NACP_DECODER_VERSION;
}

/**
 * Queues a game for reading. `fallbacks` are its other files in the order to
 * try when `absPath` yields no icon (create-index-content.js orders them).
 */
export function enqueue({ absPath, baseTitleId, fileName, wantMeta = true, fallbacks = [] }) {
  if (!baseTitleId) return false;
  if (tried.has(baseTitleId)) return false;
  if (inFlight.has(baseTitleId)) return false;
  // A record whose language icons are missing or from an older mapping is
  // extracted once more (its icons only); the record then carries iconLangs
  // and the current iconMap, and is left alone.
  const existing = extractedMeta.get(baseTitleId);
  // Icons live in data/icons since the eShop's stopped coming: a record read before has its icon read once more.
  const noIcon = !hasCached(cachePathFor(baseTitleId, "icon"));
  if (existing && (!needsReread(existing) || wantMeta === false) && !noIcon) {
    tried.add(baseTitleId);
    return false;
  }
  queue.push({ absPath, baseTitleId, fileName, wantMeta, fallbacks, langIconsOnly: Boolean(existing) && !fullReread(existing) });
  inFlight.add(baseTitleId);
  if (drainedResolver === null) {
    drained = new Promise((resolve) => { drainedResolver = resolve; });
  }
  pump();
  return true;
}

async function iconCached(baseTitleId) {
  try {
    await fs.access(cachePathFor(baseTitleId, "icon"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves the game file's icon for each client language whose art differs from
 * the default icon, as `<id>.icon.<lang>.jpg`; returns the languages saved.
 */
async function persistLangIcons(baseTitleId, byLang, defaultIcon) {
  if (!byLang || typeof byLang !== "object") return [];
  const fallback = Buffer.isBuffer(defaultIcon) ? defaultIcon : null;
  const saved = [];
  for (const [lang, buf] of Object.entries(byLang)) {
    if (!Buffer.isBuffer(buf) || (fallback && buf.equals(fallback))) continue;
    try {
      const file = cachePathFor(baseTitleId, "icon-lang", lang);
      await fs.writeFile(`${file}.tmp.${process.pid}`, await compactIcon(buf));
      await fs.rename(`${file}.tmp.${process.pid}`, file);
      dropVariants(file);
      saved.push(lang);
    } catch (err) {
      debug.error("nacp-extractor: %s icon for %s not saved: %s", lang, baseTitleId, err.message);
    }
  }
  return saved;
}

/**
 * The game file's icon as kept on disk: at most 256px (the size NACP icons are
 * made at) and recompressed, about a fifth of the bytes the file stores. The
 * file's own bytes are never kept, so one sharp cannot read is not saved.
 */
function compactIcon(buf) {
  return shrink(buf, NACP_ICON);
}

/** Saves the game file's default icon as data/icons/<id>.jpg; returns its path, or null. */
async function persistIcon(baseTitleId, buf) {
  if (!Buffer.isBuffer(buf)) return null;
  try {
    await fs.mkdir(iconCacheDir, { recursive: true });
    const iconPath = cachePathFor(baseTitleId, "icon");
    const tmp = `${iconPath}.tmp.${process.pid}`;
    await fs.writeFile(tmp, await compactIcon(buf));
    await fs.rename(tmp, iconPath);
    // Its WebP copies were drawn from the icon this one replaces.
    dropVariants(iconPath);
    return iconPath;
  } catch (err) {
    debug.error("nacp-extractor: icon persist failed for %s: %s", baseTitleId, err.message);
    return null;
  }
}

/**
 * Second pass over a title already extracted: keep its record (names may have
 * been fixed by hand in extracted-meta/<id>.json), and only save its icons.
 */
async function addLangIcons(job, record) {
  const existing = extractedMeta.get(job.baseTitleId);
  // A file that could not be read this time keeps what it had, and is tried again on a later start.
  if (!existing || !record || typeof record !== "object") return;
  const iconPath = await persistIcon(job.baseTitleId, record.iconBuffer);
  const iconLangs = await persistLangIcons(job.baseTitleId, record.iconsByLang, record.iconBuffer);
  // An icon the older mapping saved under a language this one gives none (zh's traditional icon) goes.
  for (const lang of (Array.isArray(existing.iconLangs) ? existing.iconLangs : []).filter((l) => !iconLangs.includes(l))) {
    const file = cachePathFor(job.baseTitleId, "icon-lang", lang);
    await fs.rm(file, { force: true }).catch(() => {});
    dropVariants(file);
  }
  await extractedMeta.put({ ...existing, ...(iconPath ? { iconPath } : {}), iconLangs, iconMap: ICON_MAP });
  if (iconPath || iconLangs.length) {
    debug.log("nacp-extractor: %s icons for %s", iconLangs.join("/"), job.baseTitleId);
    notifyExtracted({ baseTitleId: job.baseTitleId, source: "lang-icons" });
  }
}

/**
 * Reads the game's files in turn until one gives an icon: a broken base file
 * or one whose container cannot be opened leaves the update to try. Without an
 * icon anywhere, the first record read still gives the name.
 */
async function readFirstWithIcon(job) {
  let first = null;
  for (const file of [{ absPath: job.absPath, fileName: job.fileName }, ...(job.fallbacks || [])]) {
    let record = null;
    try {
      record = await provider.extract({ ...job, ...file });
    } catch (err) {
      debug.error("nacp-extractor: provider threw for %s (%s): %s", job.baseTitleId, file.fileName, err.message);
    }
    if (record && typeof record === "object") {
      if (Buffer.isBuffer(record.iconBuffer)) return record;
      first ??= record;
    }
  }
  return first;
}

async function workOne(job) {
  // titledb-covered titles (wantMeta === false) only need an icon. If one is
  // already on disk from a prior extract, skip the container read entirely. This keeps COOK_EXTRACT_ICONS=all a
  // one-time pass instead of re-dumping multi-GB files on every restart.
  if (job.wantMeta === false && (await iconCached(job.baseTitleId))) {
    return;
  }
  let record = null;
  try {
    record = await readFirstWithIcon(job);
    if (job.langIconsOnly) return await addLangIcons(job, record);
  } catch (err) {
    debug.error(
      "nacp-extractor: provider threw for %s (%s): %s",
      job.baseTitleId, job.fileName, err.message
    );
  }
  if (record && typeof record === "object") {
    // Persist icon (if any) into the same on-disk layout the image-cache
    // already serves from, so the icon route picks it up naturally.
    const iconPath = await persistIcon(job.baseTitleId, record.iconBuffer);
    if (iconPath) record.iconPath = iconPath;
    record.iconLangs = await persistLangIcons(job.baseTitleId, record.iconsByLang, record.iconBuffer);
    delete record.iconBuffer;
    record.iconMap = ICON_MAP;
    delete record.iconsByLang;
    // titledb already owns the name/publisher/version for wantMeta === false
    // titles, and composeResponse only reads extracted meta when titledb has
    // no entry. Writing a record for them would just be dead JSON on disk, so
    // we keep the icon we just persisted and skip the metadata store.
    if (job.wantMeta === false) {
      if (record.iconPath) {
        debug.log("nacp-extractor: icon-only %s — %s", job.baseTitleId, path.basename(record.iconPath));
        // The list's icon URLs carry the file's version, so the list is built again.
        notifyExtracted({ baseTitleId: job.baseTitleId, source: "icon" });
      }
      return;
    }
    try {
      await extractedMeta.put({ id: job.baseTitleId, ...record });
      debug.log(
        "nacp-extractor: stored %s (%s) — %s",
        job.baseTitleId, record.source || provider.name, record.name || "(no name)"
      );
      notifyExtracted({ baseTitleId: job.baseTitleId, source: record.source || provider.name });
    } catch (err) {
      debug.error("nacp-extractor: persist failed for %s: %s", job.baseTitleId, err.message);
    }
  }
}

function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    active += 1;
    workOne(job)
      .catch((err) => debug.error("nacp-extractor: workOne failed: %s", err.message))
      .finally(async () => {
        active -= 1;
        inFlight.delete(job.baseTitleId);
        tried.add(job.baseTitleId);
        if (queue.length === 0 && active === 0 && drainedResolver) {
          const r = drainedResolver;
          drainedResolver = null;
          r();
        } else {
          // Pace the NEXT job so the pass stays gentle. Only when there's more
          // work — an empty queue drains immediately (no artificial latency).
          if (PACE_MS > 0) await delay(PACE_MS);
          pump();
        }
      });
  }
}

/** Lets every title be tried again on the next rebuild (new prod.keys); titles already read stay skipped by enqueue(). */
export function forgetTried() {
  tried.clear();
}

export function pending() {
  return { queued: queue.length, active, tried: tried.size };
}

/** Resolves the next time the queue empties (or immediately if empty). */
export function whenDrained() {
  return drained;
}

/** Drop everything — used by tests, not production code. */
export function resetForTests() {
  queue.length = 0;
  inFlight.clear();
  tried.clear();
  active = 0;
  drained = Promise.resolve();
  drainedResolver = null;
  provider = autoProvider;
}
