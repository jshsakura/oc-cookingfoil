/**
 * Default in-box provider: dispatches to the right extractor by file
 * extension.
 *
 *   .nro        → pure-JS NACP/icon parser (no keys required)
 *   .nsp / .xci → nstool subprocess wrapper (needs nstool + prod.keys)
 *   .nsz / .xcz → nsz decompresses inner container, then nsp handles it
 *
 * Each provider returns null when its tooling isn't available, so the
 * whole chain degrades gracefully: a server with no keys / no nstool /
 * no nsz still scans and serves every file, just without extracted
 * metadata for the container types it can't open.
 */
import * as nro from "./nro.js";
import * as nsp from "./nsp.js";
import * as nsz from "./nsz.js";
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
  if (lower.endsWith(".nsz") || lower.endsWith(".xcz")) {
    return nsz.extract(args, { langPriority });
  }
  return stub.extract(args);
}
