/**
 * The pairSecret rule for the one-time accessKey delivery (routes/pair.js).
 *
 * A console that asked with a pairSecret gets its key only by presenting that
 * secret again; anyone else polling with the same device key is told
 * "approved" with no key, and the delivery stays for the real console.
 *
 * Legacy: a console that asked without a secret keeps today's rule (the first
 * poll after approval takes the key). Once every client sends the secret, a
 * request without one is an old client and this branch can go.
 */
import * as store from "./store.js";
import { hashPairSecret, normalizePairSecret, pairSecretMatches, takeAccessKeyDelivery, verifyAccessKey } from "./pairing.js";

/**
 * Check, without keeping it, the pairSecret a console asks with: "invalid" when
 * malformed, "conflict" when another secret already claimed the device, else
 * "ok" with the hash to keep once the console is accepted (approved, or queued
 * within the pending limit), or "none" (no secret, or already approved). A
 * conflict carries the hash too, for a waiting console that asks again (/request).
 * @returns {{ verdict: "none" | "ok" | "conflict" | "invalid", hash?: string }}
 */
export function checkPairSecret(deviceKey, raw) {
  if (raw === undefined || raw === null || raw === "") return { verdict: "none" };
  const secret = normalizePairSecret(raw);
  if (!secret) return { verdict: "invalid" };
  if (store.isDeviceApproved(deviceKey)) return { verdict: "none" };
  const hash = hashPairSecret(secret);
  const prev = store.pairSecretHash(deviceKey);
  return { verdict: prev && prev !== hash ? "conflict" : "ok", hash };
}

/**
 * Keep the hash checkPairSecret gave, for a console just accepted.
 * @returns {"none" | "set" | "same" | "conflict"}
 */
export function keepPairSecret(deviceKey, hash) {
  return hash ? store.registerPairSecret(deviceKey, hash) : "none";
}

/**
 * Record the pairSecret a waiting console asked with. Only an unapproved
 * console registers one (an approved one has nothing left to claim), and the
 * first secret wins. `raw` absent is fine (legacy); a malformed one is not.
 * @returns {"none" | "set" | "same" | "conflict" | "invalid"}
 */
export function registerPairSecret(deviceKey, raw) {
  if (raw === undefined || raw === null || raw === "") return "none";
  const secret = normalizePairSecret(raw);
  if (!secret) return "invalid";
  if (store.isDeviceApproved(deviceKey)) return "none";
  return store.registerPairSecret(deviceKey, hashPairSecret(secret));
}

/**
 * The staged accessKey for a console that proved it asked (or a legacy one), consumed; else null.
 * A staged key the console's record no longer holds (it got another since) is dropped, not given:
 * the console would put it in place of the key that works.
 */
export function deliverAccessKey(deviceKey, presented) {
  const want = store.pairSecretHash(deviceKey);
  if (want && !pairSecretMatches(presented, want)) return null;
  const accessKey = takeAccessKeyDelivery(deviceKey);
  if (!accessKey || !verifyAccessKey(accessKey, store.getDeviceAccessKeyHash(deviceKey))) return null;
  store.clearPairSecret(deviceKey);
  return accessKey;
}
