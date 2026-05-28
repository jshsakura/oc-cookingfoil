/**
 * Default in-box provider: dispatches to the right extractor by file
 * extension. NRO files get a pure-JS pass (no keys required); NSP/XCI/
 * NSZ/XCZ get the stub (a follow-up release wires in nstool/hactoolnet
 * subprocess wrappers — that work needs prod.keys + bundled binaries
 * and is its own concern).
 */
import * as nro from "./nro.js";
import * as stub from "./stub.js";
import { langPriority } from "../../helpers/envs.js";

export const name = "auto";

export async function extract(args) {
  const lower = args.absPath.toLowerCase();
  if (lower.endsWith(".nro")) {
    return nro.extract(args, { langPriority });
  }
  // Encrypted container formats land here. Until the keyed-extractor
  // provider ships, return null and let the filename-derived metadata
  // carry the file.
  return stub.extract(args);
}
