/**
 * Default in-box provider: dispatches to the right extractor by file
 * extension.
 *
 *   .nro        → pure-JS NACP/icon parser (no keys required)
 *   .nsp / .xci → nstool subprocess wrapper (requires the binary +
 *                 prod.keys; returns null silently if either is missing,
 *                 letting filename-derived metadata carry the file)
 *   .nsz / .xcz → stub (compressed containers need a separate decompress
 *                 stage — nsz is the canonical tool; planned for a
 *                 follow-up release)
 */
import * as nro from "./nro.js";
import * as nsp from "./nsp.js";
import * as stub from "./stub.js";
import { langPriority } from "../../helpers/envs.js";

export const name = "auto";

export async function extract(args) {
  const lower = args.absPath.toLowerCase();
  if (lower.endsWith(".nro")) {
    return nro.extract(args, { langPriority });
  }
  if (lower.endsWith(".nsp") || lower.endsWith(".xci")) {
    return nsp.extract(args, { langPriority });
  }
  return stub.extract(args);
}
