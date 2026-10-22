/**
 * A README.md a person keeps in a folder the server reads: their notes, never content.
 * Scanners skip it in any case (README.md, readme.MD), though .md is a Mega Drive
 * ROM extension. The server itself writes no README anywhere; the folder guides
 * are served by the API (helpers/storage-guide.js).
 */

/** Whether a file name is README.md, in any case. Pure. */
export const isReadme = (name) => String(name ?? "").toLowerCase() === "readme.md";
