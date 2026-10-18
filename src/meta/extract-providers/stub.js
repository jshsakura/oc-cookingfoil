/**
 * Default extractor: returns null for every input.
 *
 * The framework around it (nacp-extractor.js + extracted-meta-store.js)
 * is in place so that a follow-up commit can drop in a real provider —
 * subprocess wrappers around nstool/hactoolnet for NSP/XCI/NSZ/XCZ, or a
 * pure-JS NRO parser for homebrew. Until that lands the queue burns
 * cycles only at the rate of new "missing-metadata" files, and the
 * extracted-meta layer is just inert.
 *
 * A provider must export a single function:
 *
 *   async extract({ absPath, baseTitleId, fileName }) → record | null
 *
 *   record = {
 *     id: "0100000000010000",
 *     name?: "...",
 *     publisher?: "...",
 *     version?: "...",
 *     numberOfPlayers?: 4,
 *     iconBuffer?: Buffer,                  // PNG bytes; written by caller
 *     source: "nro" | "nacp" | "fan",
 *   }
 *
 *   Returning null means "nothing extractable" — the file stays in the
 *   shop response with its filename-derived metadata only. The caller
 *   never fails the whole pipeline over a single extraction miss.
 */
export async function extract(_args) {
  return null;
}

export const name = "stub";
