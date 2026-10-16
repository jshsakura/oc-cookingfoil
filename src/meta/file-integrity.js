/**
 * What the file check (verify-queue.js) said about one library file, for the
 * shop list and the title detail: "modified", "damaged", or null for a file
 * that passed or was not checked yet. A leaf module, so the list builder can
 * ask without importing the queue; the service registers the lookup.
 */
let lookup = () => null;

/** Sets where answers come from: (rel) → "modified" | "damaged" | null. */
export function provide(fn) {
  lookup = typeof fn === "function" ? fn : () => null;
}

/** The notice-worthy verdict of the library file at `rel` (games-folder relative), or null. */
export function integrityOf(rel) {
  try {
    return lookup(rel) ?? null;
  } catch {
    return null;
  }
}
