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
 *          limit: "device" when the account it signed in with (or its download's) holds all the
 *          consoles it may (security/device-limit.js; deviceLimit then names that number), "enroll" when its download is over the
 *          account's hourly count; the console waits for approval by QR
 *        → 400 { error: "invalid pairSecret" } when one is sent but is not 64 hex
 *        → 409 { error: "pairSecret mismatch" } (X-CookingFoil-Auth: pair-secret-mismatch) only in a
 *          race where the console was approved meanwhile under another secret. A console still
 *          waiting that asks with a new secret (it restarted, say) takes its request over: the
 *          new secret replaces the old and it is answered "pending" with a fresh pairUrl (the old QR
 *          stops working; pairCode comes from the device key, so it stays)
 *        → 429 + Retry-After when this address put too many new devices in the queue lately
 *          (security/pending-limit.js); /status answers the same for a new device
 *
 *   GET  /api/pair/status?deviceKey=<64hex>   (or the X-Device-Key header)
 *        + the same pairSecret as the X-Pair-Secret header (or ?pairSecret=)
 *        → { status: "pending", passwordOnly: true, … }       while unapproved
 *        → { status: "approved", passwordOnly: true, accessKey, shopUrl }
 *                                                             ONCE after approval, to the caller with the secret (shopUrl: this server's address)
 *        → { status: "approved", passwordOnly: true }         when no key is delivered and no valid secret came
 *        → { status: "pending", passwordOnly: true, repair: true, pairUrl, pairCode, expiresAt }
 *                                                             when no key is delivered but a valid secret (64 hex) came:
 *                                                             the console is approved yet has no key it can use (it
 *                                                             lost it, or /enroll answered 409 because another account
 *                                                             holds it), so it shows this QR again (one link per
 *                                                             console while it lives, the pending rate limit for a new
 *                                                             one). Nothing changes until someone approves it: the
 *                                                             console stays approved and its key keeps working. The
 *                                                             approval (security/pairing-repair.js, pairing-approve.js)
 *                                                             makes the approving account its owner (within that
 *                                                             account's device limit), swaps in a new key (the old one
 *                                                             stops) and hands it, once, only to the secret that asked
 *        → 409 { error: "pairSecret mismatch" }               while pending, with a secret other than the first; or
 *                                                             while another secret's re-pair QR for this console lives
 *
 *   POST /api/pair/enroll  { token }  + X-Device-Key
 *        A console spends the enrollment token its downloaded client carries
 *        (security/enroll-tokens.js) for its own access key, approved under the
 *        account that downloaded it, within an hour of the download. With
 *        automatic approval a download enrolls every console that brings it,
 *        up to enrollPerHour (server setting, 5 by default) per account in any rolling hour across
 *        all its downloads; with manual approval it enrolls one. A console
 *        refused asks /api/pair/status like a console with only the server address.
 *        → { status: "approved", accessKey, shopUrl }
 *        label: the console's own nickname, which names it once approved
 *        → 401 { error } + X-CookingFoil-Enroll: limit | used | expired | revoked | invalid
 *          and X-CookingFoil-Auth: enroll-<that>
 *          (limit: the account's enrollPerHour this hour; used: spent, manual approval;
 *          invalid: a token this server never made). A known one puts the console
 *          in the approval queue under the download's account, so the admin sees
 *          whose it is
 *        → 403 { error } + X-CookingFoil-Enroll: limit, X-CookingFoil-Auth: device-limit
 *          the account holds all the consoles it may (security/device-limit.js)
 *        → 409 { error }   the console is another account's, or the account may no longer sign in
 *          (X-CookingFoil-Auth: enroll-other-account); the console then asks /api/pair/status with
 *          its pairSecret for a re-pair QR
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
 * SHA-256; while a device waits, the last /request's secret wins (a /status
 * poll with another is refused), and a poll without it (or with another) never
 * consumes the delivery. A console that asked without a secret
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
import { generateAccessKey, hashAccessKey, hashPairSecret, normalizePairSecret, stageAccessKeyDelivery } from "../security/pairing.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl, devicePairing, deviceAutoApprove, deviceLimit } from "../helpers/envs.js";
import { accountFull } from "../security/device-limit.js";
import { noteRefusal } from "../security/auth-log.js";
import { vouch } from "../security/server-id.js";
import debug from "../debug.js";
import { dropPairLink, issuePairLink } from "../security/pairing-link.js";
import { autoApproveFromPairRequest, pairSignIn } from "../security/auth-guard.js";
import { checkPairSecret, deliverAccessKey, keepPairSecret } from "../security/pairing-delivery.js";
import { admitRepair, recordPending } from "../security/pending-limit.js";
import { dropRepair, keepRepair, repairVerdict } from "../security/pairing-repair.js";
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

/** What spend and respend ask of an account for this console: still allowed, and room left. */
const enrollChecks = (deviceKey) => ({
  canEnroll: (owner) => mayEnroll(deviceKey, owner),
  full: (owner) => Boolean(accountFull(owner, deviceKey)),
  multi: deviceAutoApprove,
});

/**
 * A console that asks with the download token its client carries is approved under the
 * account that downloaded it, the way /enroll would, with its key staged for the next
 * status poll. Without one it waits like any other; with one that no longer works
 * (spent, its hour passed, a newer download ended it, the account is at a limit) it waits
 * too, and { download, limit } says whose download it names ({ owner, id, state }, so
 * the queue shows whose console it is) and which limit held it ("device", "enroll").
 */
function enrollFromRequest(req, deviceKey) {
  const token = req.body?.enrollToken ?? req.get("x-enroll-token");
  if (!token || store.isDeviceApproved(deviceKey)) return {};
  const spent = enrollTokens.spend(token, deviceKey, enrollChecks(deviceKey));
  if (!spent || spent.refused || spent.full || spent.limit) {
    const known = enrollTokens.lookup(token);
    const limit = spent?.full ? "device" : spent?.limit ? "enroll" : undefined;
    debug.log("pair: %s… asked with a download token that is %s", deviceKey.slice(0, 12), spent?.refused ? "another account's" : limit ? `at the ${limit} limit` : known?.state ?? "unknown");
    return { download: known, limit };
  }
  const accessKey = generateAccessKey();
  store.approveDevice(deviceKey, { label: consoleName(req) ?? FROM_DOWNLOAD, addedBy: spent.owner, accessKeyHash: hashAccessKey(accessKey) });
  stageAccessKeyDelivery(deviceKey, accessKey);
  debug.log("pair: %s… enrolled by %s's download %s (from its request)", deviceKey.slice(0, 12), spent.owner, spent.id);
  return {};
}

const ENROLL_REFUSED = {
  limit: "this account connected its most consoles through downloads this hour; this console waits for approval by QR",
  used: "another console already used this download; this one waits for approval",
  expired: "this download's hour has passed; this console waits for approval",
  revoked: "this download was ended; this console waits for approval",
  invalid: "the enrollment token has expired or is unknown",
};

export function mayEnroll(deviceKey, owner) {
  if (!ownerAllowed(owner)) return false;
  if (!store.isDeviceApproved(deviceKey)) return true;
  return store.deviceAddedBy(deviceKey) === owner && !SYSTEM_APPROVERS.has(owner);
}

function pendingResponse(req, deviceKey, limit) {
  const link = issuePairLink(deviceKey);
  const origin = resolveOrigin(req, publicBaseUrl);
  return {
    status: "pending",
    passwordOnly: true,
    pairUrl: origin ? `${origin}/pair/${link.token}` : null,
    pairCode: link.code,
    expiresAt: link.expiresAt,
    ...(limit ? { limit } : {}),
    ...(limit === "device" ? { deviceLimit } : {}),
  };
}

// Another secret already claimed this device key: the console cannot get a key
// until the admin refuses or forgets the request, so it should say so rather
// than show a QR the admin might approve for someone else.
function secretConflict(req, res) {
  noteRefusal(req, res, 409, "pair-secret-mismatch");
  res.status(409).json({ error: "pairSecret mismatch" });
}

/**
 * An approved console that asked with a pairSecret but got no key: it lost the
 * one it had (or another account holds it), so it is shown a QR again. Nothing
 * changes until someone approves that QR (security/pairing-repair.js), so a
 * stranger who knows the device key cannot knock the console out.
 */
function repairResponse(req, res, deviceKey, secretHash) {
  const verdict = repairVerdict(deviceKey, secretHash);
  if (verdict === "conflict") return secretConflict(req, res);
  if (verdict === "new") {
    const admitted = admitRepair(req, deviceKey);
    if (!admitted.ok) return tooManyConsoles(req, res, deviceKey, admitted.retryAfterSec);
    debug.log("pair: %s… is approved but asked for a new key; showing a re-pair QR", deviceKey.slice(0, 12));
  }
  const out = pendingResponse(req, deviceKey);
  keepRepair(deviceKey, secretHash, out.expiresAt);
  res.json({ ...out, repair: true });
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
    // Checked first, kept only once the console is accepted (approved here, or queued within the
    // pending limit), so a console approved right here is held to it and a refused one leaves nothing.
    const secret = checkPairSecret(deviceKey, pairSecretOf(req, req.body?.pairSecret));
    if (secret.verdict === "invalid") {
      res.status(400).json({ error: "invalid pairSecret" });
      return;
    }
    // A waiting console that asks again with a new secret (it restarted, say) takes its request over,
    // once it is accepted again (approved here, or let through the pending limit).
    if (secret.verdict === "conflict" && !store.isDevicePending(deviceKey)) return secretConflict(req, res);
    const swap = secret.verdict === "conflict";
    const { download, limit } = enrollFromRequest(req, deviceKey);
    const auto = await autoApproveFromPairRequest(req, deviceKey).catch(() => false);
    if (store.isDeviceApproved(deviceKey)) {
      if (swap) store.replacePairSecret(deviceKey, secret.hash);
      if (keepPairSecret(deviceKey, secret.hash) === "conflict") return secretConflict(req, res);
      res.json({ status: "approved", passwordOnly: true });
      return;
    }
    // The console's own note, so the admin can tell which one asks; a request without one keeps the last.
    const message = req.body && "message" in req.body ? pairMessage(req.body.message) : undefined;
    const queued = recordPending(req, deviceKey, { message, name: consoleName(req), download });
    if (!queued.ok) return tooManyConsoles(req, res, deviceKey, queued.retryAfterSec);
    if (swap) {
      // A QR shown under the old secret must not hand a key to the new one: it gets a fresh link.
      store.replacePairSecret(deviceKey, secret.hash);
      dropPairLink(deviceKey);
      debug.log("pair: %s… asked again with a new pairSecret", deviceKey.slice(0, 12));
    }
    if (keepPairSecret(deviceKey, secret.hash) === "conflict") return secretConflict(req, res);
    debug.log("pair: request from %s…", deviceKey.slice(0, 12));
    res.json(pendingResponse(req, deviceKey, auto === "limit" ? "device" : limit));
  });

  router.get("/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = resolveKey(req, req.query?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const secret = pairSecretOf(req, req.query?.pairSecret);
    // A GET-only client asks here, so its secret registers here too (a malformed one is ignored),
    // once the console is accepted, as on /request.
    const checked = checkPairSecret(deviceKey, secret);
    if (checked.verdict === "conflict") return secretConflict(req, res);
    const { download, limit } = enrollFromRequest(req, deviceKey);
    // A console that knocks with its account is approved right here (COOK_DEVICE_AUTO_APPROVE).
    const auto = await autoApproveFromPairRequest(req, deviceKey).catch(() => false);
    if (store.isDeviceApproved(deviceKey) && keepPairSecret(deviceKey, checked.hash) === "conflict") return secretConflict(req, res);
    if (!store.isDeviceApproved(deviceKey)) {
      // Polling doubles as the knock: record the device as pending so a
      // GET-only client (oc-cookfoil-sdl has no POST helper) surfaces in the
      // admin dashboard without a separate /request call.
      const queued = recordPending(req, deviceKey, { download });
      if (!queued.ok) return tooManyConsoles(req, res, deviceKey, queued.retryAfterSec);
      if (keepPairSecret(deviceKey, checked.hash) === "conflict") return secretConflict(req, res);
      res.json(pendingResponse(req, deviceKey, auto === "limit" ? "device" : limit));
      return;
    }
    const out = { status: "approved", passwordOnly: true };
    // Only to the caller holding the pairSecret the console asked with (or any caller, for a legacy console).
    const accessKey = deliverAccessKey(deviceKey, typeof secret === "string" ? secret : null);
    const repairSecret = accessKey ? null : normalizePairSecret(secret);
    if (repairSecret) return repairResponse(req, res, deviceKey, hashPairSecret(repairSecret));
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
    const checks = enrollChecks(deviceKey);
    const first = enrollTokens.spend(req.body?.token, deviceKey, checks);
    // A console sometimes repeats its enroll seconds later; one the download took is answered again.
    const again = first ? null : enrollTokens.respend(req.body?.token, deviceKey, checks);
    const spent = first ?? again;
    if (!spent || spent.limit || spent.full) {
      // A download this server made still says whose it is: the console waits
      // in the queue under that account's name, for the admin to approve.
      const known = enrollTokens.lookup(req.body?.token, Date.now(), { multi: checks.multi });
      const reason = spent?.limit ? "limit" : spent?.full ? "device-limit" : known ? known.reason ?? "used" : "invalid";
      debug.log("pair: %s… enroll refused: %s", deviceKey.slice(0, 12), reason);
      if (known && !store.isDeviceApproved(deviceKey)) recordPending(req, deviceKey, { name: consoleName(req), download: known });
      res.set("X-CookingFoil-Enroll", reason === "device-limit" ? "limit" : reason);
      if (reason === "device-limit") {
        noteRefusal(req, res, 403, "device-limit", { proven: true });
        res.status(403).json({ error: "this account holds all the consoles it may; remove one it no longer uses, then approve this one" });
        return;
      }
      // A download this server made, spent or not, names the server; a made-up one does not.
      noteRefusal(req, res, 401, `enroll-${reason}`, { proven: Boolean(known) });
      res.status(401).json({ error: ENROLL_REFUSED[reason] ?? ENROLL_REFUSED.invalid });
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
    dropRepair(deviceKey);
    if (again) debug.log("pair: %s… re-enrolled with its own download %s", deviceKey.slice(0, 12), spent.id);
    else debug.log("pair: %s… enrolled by %s's download %s", deviceKey.slice(0, 12), spent.owner, spent.id);
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
