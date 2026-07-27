/**
 * Pure policy for the background NACP extractor: should a given container be
 * auto-enqueued at all?
 *
 * Two orthogonal gates, split so each is trivially testable and the enqueue
 * site reads clearly:
 *   · mode  — COOK_EXTRACT_ICONS: "all" (every title), "missing" (only titles
 *             titledb can't cover, i.e. no `fromDb`), "off" (never).
 *   · size  — COOK_EXTRACT_MAX_GB cap. A genuinely-uncovered giant file (≥6 GB
 *             XCI / NSZ) would otherwise let the worker grind for minutes and
 *             hit the per-job timeout. Skipping it keeps the pass gentle; that
 *             file simply falls back to its filename (rare, acceptable).
 *
 * No I/O, no logging, no mutation — callers compose these and log their own
 * skip line so the human-facing message stays at the enqueue site.
 */

export const BYTES_PER_GB = 1024 ** 3;

/**
 * Does the extraction MODE want this title? (Ignores size.)
 * @param {{extractMode:string, fromDb:unknown}} x
 */
export function wantsExtractByMode({ extractMode, fromDb }) {
  if (extractMode === "all") return true;
  if (extractMode === "missing") return !fromDb;
  return false; // "off" or any unknown value
}

/**
 * Is this container over the size cap? `maxBytes <= 0` disables the cap
 * (unlimited). A non-finite / missing size is treated as under the cap so a
 * bad stat never silently drops a title.
 * @param {{sizeBytes:number, maxBytes:number}} x
 */
export function isOverSizeCap({ sizeBytes, maxBytes }) {
  if (!(maxBytes > 0)) return false; // 0 / negative / NaN ⇒ unlimited
  const size = Number(sizeBytes);
  if (!Number.isFinite(size)) return false;
  return size > maxBytes;
}

/**
 * Combined verdict: extract only when the mode wants it AND it's under the cap.
 * @param {{sizeBytes:number, extractMode:string, fromDb:unknown, maxBytes:number}} x
 */
export function shouldAutoExtract({ sizeBytes, extractMode, fromDb, maxBytes }) {
  if (!wantsExtractByMode({ extractMode, fromDb })) return false;
  if (isOverSizeCap({ sizeBytes, maxBytes })) return false;
  return true;
}
