/**
 * Re-pair requests: an approved console that no longer holds its access key
 * (a format, a lost config, a console another account approved) asks
 * /api/pair/status with a pairSecret and is shown a QR again (routes/pair.js).
 *
 * The request lives here, apart from the approved record, so asking changes
 * nothing about the console: it stays approved and its current key keeps
 * working until someone approves the QR (pairing-approve.js approvePairLink).
 * Only that approval swaps the key, and it is delivered to the secret that
 * asked. One request per console, as long as its QR link lives; while it does,
 * another secret is refused, so nobody can slip their own secret under a QR
 * the console's owner is about to approve.
 *
 * In memory only, like the QR links it follows: a restart ends both, and the
 * console simply asks again.
 */
const LIMIT = 512;
const requests = new Map(); // deviceKey → { secretHash, expiresAt }

function prune(now) {
  for (const [deviceKey, r] of requests) if (now >= r.expiresAt) requests.delete(deviceKey);
}

/** The live request for `deviceKey`, { secretHash, expiresAt }, or null. */
export function repairRequest(deviceKey, now = Date.now()) {
  const r = requests.get(deviceKey);
  if (!r) return null;
  if (now < r.expiresAt) return r;
  requests.delete(deviceKey);
  return null;
}

/**
 * Whether `secretHash` may ask for `deviceKey` now: "same" when it already
 * holds the live request, "new" when there is none, "conflict" when another
 * secret holds it.
 */
export function repairVerdict(deviceKey, secretHash, now = Date.now()) {
  const r = repairRequest(deviceKey, now);
  if (!r) return "new";
  return r.secretHash === secretHash ? "same" : "conflict";
}

/** Record (or extend to `expiresAt`, its QR link's end) the request of `secretHash` for `deviceKey`. */
export function keepRepair(deviceKey, secretHash, expiresAt, now = Date.now()) {
  if (!requests.has(deviceKey)) {
    prune(now);
    while (requests.size >= LIMIT) requests.delete(requests.keys().next().value);
  }
  requests.set(deviceKey, { secretHash, expiresAt });
}

/** Forget the request for `deviceKey` (approved, or the console is gone). */
export function dropRepair(deviceKey) {
  requests.delete(deviceKey);
}
