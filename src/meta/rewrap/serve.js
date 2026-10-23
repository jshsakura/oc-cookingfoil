/**
 * The download side of the rewrap: a game file asked for with ?rewrap=<the
 * console's firmware, "21.0.1"> (or a bare master key generation, as client
 * 0.4.26 sends) is served lowered to what that console runs.
 *
 * Both lanes (the shop's own address and the direct address) send game files
 * through helpers/file-send.js, which asks plan() for the patch map and lays
 * it over the stream; Range, If-Range, HEAD and 304 work as for the plain
 * file, and the length is the same. The ETag carries the target, so a cache
 * or a resume never mixes a lowered copy with the original or another target's.
 *
 * Patch maps are kept per (file, size, mtime, normalized target) for the keys they
 * were made with, the last MAX_PLANS used; parallel requests for one file
 * share the one being made. A refusal is not kept, so new keys apply at once.
 * The console's firmware lives only in that in-memory key and in the answer to
 * its own request: it is never written to a log, a record or the disk.
 */
import path from "path";
import debug from "../../debug.js";
import { loadKeys } from "../../security/prod-keys.js";
import { parseTarget } from "./generations.js";
import { buildPatchMap } from "./patch-map.js";
import { RewrapError, refusalBody } from "./refusals.js";

export const PARAM = "rewrap";
const MAX_PLANS = 64;

const plans = new Map(); // key → { keys, promise }, oldest first

/** Whether the request asks for a lowered file. */
export const asksRewrap = (req) => req.query?.[PARAM] !== undefined;

function remember(key, entry) {
  plans.delete(key);
  plans.set(key, entry);
  while (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value);
}

/**
 * { tag, patches } for the file at `abs` (stat `st`) lowered for `raw`, the
 * query value: the console's firmware version, or a bare generation
 * (generations.js parseTarget). Rejects with RewrapError for a refusal.
 */
export function plan(abs, st, raw, keys = loadKeys()) {
  const target = parseTarget(raw);
  if (target === null) return Promise.reject(new RewrapError("badTarget"));
  if (!keys) return Promise.reject(new RewrapError("noKeys"));
  const key = `${abs}\0${st.size}\0${st.mtimeMs}\0${target.label}`;
  const hit = plans.get(key);
  if (hit?.keys === keys) {
    remember(key, hit);
    return hit.promise;
  }
  const entry = { keys, promise: buildPatchMap(abs, target, keys).then((patches) => ({ tag: `rewrap-${target.label}`, patches })) };
  remember(key, entry);
  entry.promise.catch(() => {
    if (plans.get(key) === entry) plans.delete(key);
  });
  return entry.promise;
}

/** Answers a refusal with 409 { error, code }; false when `err` is no refusal (the caller passes it on). */
export function refuse(req, res, abs, err) {
  if (!(err instanceof RewrapError)) return false;
  // The console's firmware is used for this answer only: it is never logged or kept.
  debug.log("rewrap: refused %s: %s%s", path.basename(abs), err.code, err.detail ? ` (${err.detail})` : "");
  res.status(409).set("Cache-Control", "no-store").json(refusalBody(req, err));
  return true;
}

/** Forgets every patch map (tests). */
export function clearPlans() {
  plans.clear();
}
