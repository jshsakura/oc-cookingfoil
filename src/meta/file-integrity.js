/**
 * What the file check (verify-queue.js) said about one library file, for the
 * library list and the title detail: "modified", "damaged", or null for a file
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

let signedLookup = () => null;

/** Sets where signature answers come from: (rel) → { nca?, ticket? } | null. */
export function provideSigned(fn) {
  signedLookup = typeof fn === "function" ? fn : () => null;
}

/** Whether the file at `rel` is signed: { nca?, ticket? } with only the known ones, or null when nothing is known. */
export function signedOf(rel) {
  try {
    return signedLookup(rel) ?? null;
  } catch {
    return null;
  }
}
