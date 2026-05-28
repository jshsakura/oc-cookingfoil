/**
 * Background queue + worker that asks a pluggable provider to extract
 * NACP-style metadata (and an icon, if the provider can pull one) for
 * titleIds that aren't covered by blawar/titledb.
 *
 * Why a queue: extraction in real providers spawns subprocesses against
 * potentially multi-GB NSP files. Doing that on the request path would
 * stall the event loop and starve other handlers. The queue uses bounded
 * concurrency and de-duplicates work — the shop-cache builder enqueues
 * the same baseTitleId every time it sees the file; the worker only
 * extracts once.
 *
 * Where the data lands: extracted-meta-store.js (one JSON per titleId)
 * + (optionally) an icon PNG persisted into the image-cache directory,
 * which the icon route already consults when there's no upstream URL.
 */
import path from "path";
import fs from "fs/promises";
import * as extractedMeta from "./extracted-meta-store.js";
import { cachePathFor } from "./image-cache.js";
import { extract as stubExtract } from "./extract-providers/stub.js";
import { iconCacheDir } from "../helpers/envs.js";
import debug from "../debug.js";

const CONCURRENCY = Number(process.env.COOK_EXTRACT_CONCURRENCY ?? 2);

// Active provider. Swapped in by future commits that ship a binary
// integration; tests can swap it via setProvider() too.
let provider = { name: "stub", extract: stubExtract };

export function setProvider(p) {
  if (!p || typeof p.extract !== "function") {
    throw new Error("provider must expose extract()");
  }
  provider = p;
  debug.log("nacp-extractor: provider set to %s", p.name || "anonymous");
}

const queue = [];
const inFlight = new Set();   // baseTitleId currently extracting
const tried = new Set();      // baseTitleId we've already attempted (any outcome)
let active = 0;
let drained = Promise.resolve();
let drainedResolver = null;

export function enqueue({ absPath, baseTitleId, fileName }) {
  if (!baseTitleId) return false;
  if (tried.has(baseTitleId)) return false;
  if (inFlight.has(baseTitleId)) return false;
  if (extractedMeta.get(baseTitleId)) {
    tried.add(baseTitleId);
    return false;
  }
  queue.push({ absPath, baseTitleId, fileName });
  inFlight.add(baseTitleId);
  if (drainedResolver === null) {
    drained = new Promise((resolve) => { drainedResolver = resolve; });
  }
  pump();
  return true;
}

async function workOne(job) {
  let record = null;
  try {
    record = await provider.extract(job);
  } catch (err) {
    debug.error(
      "nacp-extractor: provider threw for %s (%s): %s",
      job.baseTitleId, job.fileName, err.message
    );
  }
  if (record && typeof record === "object") {
    // Persist icon (if any) into the same on-disk layout the image-cache
    // already serves from, so the icon route picks it up naturally.
    if (record.iconBuffer && Buffer.isBuffer(record.iconBuffer)) {
      try {
        await fs.mkdir(iconCacheDir, { recursive: true });
        const iconPath = cachePathFor(job.baseTitleId, "icon");
        const tmp = `${iconPath}.tmp.${process.pid}`;
        await fs.writeFile(tmp, record.iconBuffer);
        await fs.rename(tmp, iconPath);
        record.iconPath = iconPath;
      } catch (err) {
        debug.error("nacp-extractor: icon persist failed for %s: %s", job.baseTitleId, err.message);
      }
      delete record.iconBuffer;
    }
    try {
      await extractedMeta.put({ id: job.baseTitleId, ...record });
      debug.log(
        "nacp-extractor: stored %s (%s) — %s",
        job.baseTitleId, record.source || provider.name, record.name || "(no name)"
      );
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
      .finally(() => {
        active -= 1;
        inFlight.delete(job.baseTitleId);
        tried.add(job.baseTitleId);
        if (queue.length === 0 && active === 0 && drainedResolver) {
          const r = drainedResolver;
          drainedResolver = null;
          r();
        } else {
          pump();
        }
      });
  }
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
  provider = { name: "stub", extract: stubExtract };
}
