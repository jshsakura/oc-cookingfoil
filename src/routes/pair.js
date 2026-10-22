/**
 * Public device-pairing endpoints, outside the sign-in wall.
 * Live only when COOK_DEVICE_PAIRING=true; otherwise the router 404s.
 *
 * The only place a console's ID and password count: with COOK_DEVICE_AUTO_APPROVE
 * on, a /request or /status that carries a real account (Basic) approves the
 * console at once (auth-guard.js pairSignIn, lockout included), and from then
 * on it connects with its device key and access key. Every /request and
 * /status answer carries `passwordOnly: true` (the `pair-password-only`
 * feature) so the client knows it may forget the password once approved.
 *
 *   POST /api/pair/request  { deviceKey, pairSecret?, label?, message? }  message: a one-line note for the admin (100 chars)
 *        label: the console's own nickname, shown in the queue and naming it once approved
 *        enrollToken (or X-Enroll-Token): the token a downloaded client carries; a working one approves the console under that account at once
 *        pairSecret: 64 hex the client generated (32 random bytes), or the X-Pair-Secret header
 *        → records the device as "pending" for the admin to approve.
 *        → { status: "pending", passwordOnly: true, … }  (or { status: "approved", passwordOnly: true } if already done)
 *        → 400 { error: "invalid pairSecret" } when one is sent but is not 64 hex
 *        → 409 { error: "pairSecret mismatch" } when another secret already asked for this device
 *        → 429 + Retry-After when this address put too many new devices in the queue lately
 *          (security/pending-limit.js); /status answers the same for a new device
 *
 *   GET  /api/pair/status?deviceKey=<64hex>   (or the X-Device-Key header)
 *        + the same pairSecret as the X-Pair-Secret header (or ?pairSecret=)
 *        → { status: "pending", passwordOnly: true, … }       while unapproved
 *        → { status: "approved", passwordOnly: true, accessKey, shopUrl }
 *                                                             ONCE after approval, to the caller with the secret (shopUrl: this server's address)
 *        → { status: "approved", passwordOnly: true }         on later polls, or without the secret
 *        → 409 { error: "pairSecret mismatch" }               while pending, with a secret other than the first
 *
 *   POST /api/pair/enroll  { token }  + X-Device-Key
 *        A console spends the enrollment token its downloaded client carries
 *        (security/enroll-tokens.js) for its own access key, approved under the
 *        account that downloaded it. Once, within an hour of the download, in every
 *        approval mode; a later console with the same download is refused (used)
 *        and asks /api/pair/status like a console with only the server address.
 *        → { status: "approved", accessKey, shopUrl }
 *        label: the console's own nickname, which names it once approved
 *        → 401 { error } + X-CookingFoil-Enroll: used | expired | revoked | invalid
 *          (invalid: a token this server never made). A known one puts the console
 *          in the approval queue under the download's account, so the admin sees
 *          whose it is (two consoles from one download: the second waits there)
 *        → 409 { error }   the console is another account's, or the account may no longer sign in
 *
 *   POST /api/pair/rebind  { from: <old 64hex>, accessKey? }  + X-Device-Key: <new 64hex>
 *        The same console under a new device key (a client that now makes its
 *        key from the console instead of keeping a random one): its approval,
 *        name and access key move to the new key. Proof that it is that
 *        console, either of:
 *          - the old key's accessKey (body or X-Access-Key)
 *          - Basic with the account that approved it, while automatic approval
 *            is on (lockout counted as at the sign-in wall)
 *        The new key must be free: not waiting for approval, and not approved
 *        except by the same account, so call this before using the new key.
 *        → { status: "moved" | "kept", deviceKey }   kept: nothing was there to move
 *        → 400 invalid key, 401 no proof, 403 the old key belongs to someone else,
 *          409 the new key is already in use
 *
 * The accessKey is handed down exactly once (first poll after approval that
 * presents the pairSecret the console asked with); the device persists it and
 * presents it on every future request. The server keeps only the secret's
 * SHA-256, the first secret for a device wins, and a poll without it (or with
 * another) never consumes the delivery. A console that asked without a secret
 * (an older client) gets the key on its first poll, as before
 * (security/pairing-delivery.js). Mounted OUTSIDE the sign-in wall but
 * INSIDE rate-limiting + the probe access-guard.
 */
import express from "express";

import * as store from "../security/store.js";
import {
  normalizeDeviceKey,
  deviceKeyFromHeaders,
  pairMessage,
  verifyAccessKey,
} from "../security/pairing.js";
import * as enrollTokens from "../security/enroll-tokens.js";
import * as users from "../security/users.js";
import { SYSTEM_APPROVERS } from "../security/users.js";
import * as googleAccounts from "../security/google-accounts.js";
import { generateAccessKey, hashAccessKey, stageAccessKeyDelivery } from "../security/pairing.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl, devicePairing } from "../helpers/envs.js";
import { noteRefusal } from "../security/auth-log.js";
import { vouch } from "../security/server-id.js";
import debug from "../debug.js";
import { issuePairLink } from "../security/pairing-link.js";
import { autoApproveFromPairRequest, pairSignIn } from "../security/auth-guard.js";
import { deliverAccessKey, registerPairSecret } from "../security/pairing-delivery.js";
import { recordPending } from "../security/pending-limit.js";
import { tooManyRequests } from "../security/retry-after.js";
import { recordDeny, DENY } from "../security/deny.js";
import { passwordOwnerOk } from "../security/password-policy.js";


/** Whether the account behind an approval may still sign in: "admin", a shop account, or "google:<email>". */
function ownerAllowed(owner) {
  if (owner === "admin") return true;
  if (typeof owner !== "string") return false;
  if (owner.startsWith("google:")) {
    const email = owner.slice("google:".length);
    return googleAccounts.list().some((a) => a.email === email && googleAccounts.isApproved(a.sub));
  }
  // An enrollment an ID-and-password account made is not spent while that sign-in is off.
  return passwordOwnerOk() && users.isActive(owner);
}

/**
 * Whether a download's enrollment token made by `owner` may take this console:
 * it must be free, or already this account's (the same console enrolling again
 * after a format). The markers the server writes for other approvals ("admin",
 * "auto", "telegram") are no account's, whatever an account is called.
 */
/** The name the console goes by (its system nickname), sent as `label`; null when none. */
function consoleName(req) {
  return pairMessage(req.body?.label)?.slice(0, 64) ?? null;
}

const FROM_DOWNLOAD = "웹에서 받은 클라이언트";

/**
 * A console that asks with the download token its client carries is approved under the
 * account that downloaded it, the way /enroll would, with its key staged for the next
 * status poll. Without one it waits like any other; with one that no longer works
 * (another console spent it, its hour passed, a newer download withdrew it) it waits too, and the download it names,
 * { owner, id, state }, is returned so the queue shows whose console it is.
 */
function enrollFromRequest(req, deviceKey) {
  const token = req.body?.enrollToken ?? req.get("x-enroll-token");
  if (!token || store.isDeviceApproved(deviceKey)) return null;
  const spent = enrollTokens.spend(token, deviceKey, { canEnroll: (owner) => mayEnroll(deviceKey, owner) });
  if (!spent || spent.refused) {
    const known = enrollTokens.lookup(token);
    debug.log("pair: %s… asked with a download token that is %s", deviceKey.slice(0, 12), spent?.refused ? "another account's" : known?.state ?? "unknown");
    return known;
  }
  const accessKey = generateAccessKey();
  store.approveDevice(deviceKey, { label: consoleName(req) ?? FROM_DOWNLOAD, addedBy: spent.owner, accessKeyHash: hashAccessKey(accessKey) });
  stageAccessKeyDelivery(deviceKey, accessKey);
  debug.log("pair: %s… enrolled by %s's download %s (from its request)", deviceKey.slice(0, 12), spent.owner, spent.id);
  return null;
}

const ENROLL_REFUSED = {
  used: "another console already used this download; this one waits for approval",
  expired: "this download's day has passed; this console waits for approval",
  revoked: "this download was withdrawn; this console waits for approval",
  invalid: "the enrollment token has expired or is unknown",
};

export function mayEnroll(deviceKey, owner) {
  if (!ownerAllowed(owner)) return false;
  if (!store.isDeviceApproved(deviceKey)) return true;
  return store.deviceAddedBy(deviceKey) === owner && !SYSTEM_APPROVERS.has(owner);
}

function pendingResponse(req, deviceKey) {
  const link = issuePairLink(deviceKey);
  const origin = resolveOrigin(req, publicBaseUrl);
  return {
    status: "pending",
    passwordOnly: true,
    pairUrl: origin ? `${origin}/pair/${link.token}` : null,
    pairCode: link.code,
    expiresAt: link.expiresAt,
  };
}

// Another secret already claimed this device key: the console cannot get a key
// until the admin refuses or forgets the request, so it should say so rather
// than show a QR the admin might approve for someone else.
function secretConflict(req, res) {
  noteRefusal(req, res, 409, "pair-secret-mismatch");
  res.status(409).json({ error: "pairSecret mismatch" });
}

// This address put too many new consoles in the queue lately (security/pending-limit.js).
function tooManyConsoles(req, res, deviceKey, retryAfterSec) {
  recordDeny(req, { reason: DENY.RATE_LIMITED, status: 429, deviceKey, detail: "pair-request" });
  tooManyRequests(res, retryAfterSec).json({ error: "too many new devices from this address; try again later" });
}

export default function pairRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "8kb" }));

  // Hard 404 when the pairing lane is off — no surface to probe.
  router.use((req, res, next) => {
    if (!devicePairing) {
      res.status(404).type("text/plain").send("not found");
      return;
    }
    next();
  });

  // The device key may arrive in the body/query OR as the header the client
  // already stamps on every other request — accept either so a caller can't
  // half-work depending on which endpoint it hits.
  const resolveKey = (req, explicit) =>
    normalizeDeviceKey(explicit) ?? deviceKeyFromHeaders(req);
  // The pairSecret, likewise: a body or query field, or the X-Pair-Secret header.
  const pairSecretOf = (req, explicit) => explicit ?? req.get("X-Pair-Secret");

  router.post("/request", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = resolveKey(req, req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    // Before auto-approval, so a console approved right here is held to its secret too.
    const registered = registerPairSecret(deviceKey, pairSecretOf(req, req.body?.pairSecret));
    if (registered === "invalid") {
      res.status(400).json({ error: "invalid pairSecret" });
      return;
    }
    if (registered === "conflict") return secretConflict(req, res);
    const download = enrollFromRequest(req, deviceKey);
    await autoApproveFromPairRequest(req, deviceKey).catch(() => false);
    if (store.isDeviceApproved(deviceKey)) {
      res.json({ status: "approved", passwordOnly: true });
      return;
    }
    // The console's own note, so the admin can tell which one asks; a request without one keeps the last.
    const message = req.body && "message" in req.body ? pairMessage(req.body.message) : undefined;
    const queued = recordPending(req, deviceKey, { message, name: consoleName(req), download });
    if (!queued.ok) return tooManyConsoles(req, res, deviceKey, queued.retryAfterSec);
    debug.log("pair: request from %s…", deviceKey.slice(0, 12));
    res.json(pendingResponse(req, deviceKey));
  });

  router.get("/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = resolveKey(req, req.query?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const secret = pairSecretOf(req, req.query?.pairSecret);
    // A GET-only client asks here, so its secret registers here too (a malformed one is ignored).
    if (registerPairSecret(deviceKey, secret) === "conflict") return secretConflict(req, res);
    const download = enrollFromRequest(req, deviceKey);
    // A console that knocks with its account is approved right here (COOK_DEVICE_AUTO_APPROVE).
    await autoApproveFromPairRequest(req, deviceKey).catch(() => false);
    if (!store.isDeviceApproved(deviceKey)) {
      // Polling doubles as the knock: record the device as pending so a
      // GET-only client (oc-cookfoil-sdl has no POST helper) surfaces in the
      // admin dashboard without a separate /request call.
      const queued = recordPending(req, deviceKey, { download });
      if (!queued.ok) return tooManyConsoles(req, res, deviceKey, queued.retryAfterSec);
      res.json(pendingResponse(req, deviceKey));
      return;
    }
    const out = { status: "approved", passwordOnly: true };
    // Only to the caller holding the pairSecret the console asked with (or any caller, for a legacy console).
    const accessKey = deliverAccessKey(deviceKey, typeof secret === "string" ? secret : null);
    if (accessKey) {
      out.accessKey = accessKey;
      const origin = resolveOrigin(req, publicBaseUrl);
      out.shopUrl = origin || null;
      debug.log("pair: delivered accessKey to %s…", deviceKey.slice(0, 12));
    }
    res.json(out);
  });

  router.post("/enroll", (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = deviceKeyFromHeaders(req);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const canEnroll = (owner) => mayEnroll(deviceKey, owner);
    const spent = enrollTokens.spend(req.body?.token, deviceKey, { canEnroll });
    if (!spent) {
      // A download this server made still says whose it is: the console waits
      // in the queue under that account's name, for the admin to approve.
      const known = enrollTokens.lookup(req.body?.token);
      debug.log("pair: %s… enroll refused: the download token is %s", deviceKey.slice(0, 12), known?.state ?? "unknown");
      if (known && !store.isDeviceApproved(deviceKey)) recordPending(req, deviceKey, { name: consoleName(req), download: known });
      // A download this server made, spent or not, names the server; a made-up one does not.
      noteRefusal(req, res, 401, `enroll-${known?.state ?? "invalid"}`, { proven: Boolean(known) });
      res.set("X-CookingFoil-Enroll", known?.state ?? "invalid");
      res.status(401).json({ error: ENROLL_REFUSED[known?.state] ?? ENROLL_REFUSED.invalid });
      return;
    }
    if (spent.refused) {
      debug.log("pair: %s… enroll refused: the console is another account's", deviceKey.slice(0, 12));
      noteRefusal(req, res, 409, "enroll-other-account", { proven: true });
      res.status(409).json({ error: "this console belongs to another account" });
      return;
    }
    const accessKey = generateAccessKey();
    const fresh = !store.isDeviceApproved(deviceKey);
    store.approveDevice(deviceKey, { label: fresh ? consoleName(req) ?? FROM_DOWNLOAD : undefined, addedBy: spent.owner, accessKeyHash: hashAccessKey(accessKey) });
    store.clearPairSecret(deviceKey);
    debug.log("pair: %s… enrolled by %s's download %s", deviceKey.slice(0, 12), spent.owner, spent.id);
    const origin = resolveOrigin(req, publicBaseUrl);
    vouch(res);
    res.json({ status: "approved", accessKey, shopUrl: origin || null });
  });

  router.post("/rebind", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const to = deviceKeyFromHeaders(req);
    const from = normalizeDeviceKey(req.body?.from);
    if (!to || !from || from === to) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const hash = store.getDeviceAccessKeyHash(from);
    const keyProof = Boolean(hash && verifyAccessKey(req.body?.accessKey ?? req.get("X-Access-Key"), hash));
    const who = await pairSignIn(req);
    if (!keyProof && !who) {
      noteRefusal(req, res, 401, "rebind-no-proof");
      res.status(401).json({ error: "sign in, or show the old access key" });
      return;
    }
    // An account proves only the consoles it approved itself; the markers the
    // server writes for other approvals ("admin", "auto", "telegram") are no
    // account's, whatever an account is called.
    const approvedBy = store.deviceAddedBy(from);
    const accountOwns = Boolean(who && approvedBy === who.name && !SYSTEM_APPROVERS.has(approvedBy));
    if (store.isDeviceApproved(from) && !keyProof && !accountOwns) {
      // Signed in with a real account: the refusal may name the server.
      noteRefusal(req, res, 403, "rebind-not-this-account", { proven: true });
      res.status(403).json({ error: "that console is not this account's" });
      return;
    }
    // The new key must be free: not waiting in the queue, and approved, if at
    // all, only by the same account (a console that signed in with it already).
    const toBy = store.deviceAddedBy(to);
    const toFree = !store.isDevicePending(to) && (!store.isDeviceApproved(to) || (who && toBy === who.name && !SYSTEM_APPROVERS.has(toBy)));
    if (!toFree) {
      res.status(409).json({ error: "the new device key is already in use" });
      return;
    }
    const moved = store.rebindDevice(from, to);
    debug.log("pair: rebind %s… → %s… (%s)", from.slice(0, 12), to.slice(0, 12), moved ? "moved" : "nothing to move");
    res.json({ status: moved ? "moved" : "kept", deviceKey: to });
  });

  return router;
}
