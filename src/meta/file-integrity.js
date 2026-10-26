/**
 * What the file check (verify-queue.js) said about one library file, for the
 * shop list and the title detail: "modified", "damaged", or null for a file
 * that passed or was not checked yet. A leaf module, so the list builder can
 * ask without importing the queue; the service registers the lookup.
 */
let lookup = () => null;

/** Sets where answers come from: (rel) → { verdict, reason?, detail? } | "modified" | "damaged" | null. */
export function provide(fn) {
  lookup = typeof fn === "function" ? fn : () => null;
}

/** The notice-worthy finding of the library file at `rel` (games-folder relative): { verdict, reason, detail }, or null. */
export function findingOf(rel) {
  try {
    const got = lookup(rel) ?? null;
    if (!got) return null;
    return typeof got === "string" ? { verdict: got, reason: null, detail: null } : { verdict: got.verdict, reason: got.reason ?? null, detail: got.detail ?? null };
  } catch {
    return null;
  }
}

/** The notice-worthy verdict of the library file at `rel`, or null. */
export const integrityOf = (rel) => findingOf(rel)?.verdict ?? null;
