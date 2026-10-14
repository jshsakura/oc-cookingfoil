/**
 * Who a download token is made for (download-token.js): the console, with the
 * account behind it.
 *
 * One account may be signed in on two consoles at once, so a token belongs to
 * the device (the X-Device-Key or UID header CookingFoil and CyberFoil send),
 * together with the account (a shop account, a per-device login or a Google
 * account). A paired console with no account is its own identity. A request
 * with an account but no device id (a browser) is told apart by a hash of its
 * User-Agent. A request with neither was not signed in, and gets no token.
 *
 * On the token lane (direct-lane.js) the identity is checked again on every request:
 * the account must still be allowed to sign in and, when the console was
 * approved (paired) at the time, it must still be approved. A token also
 * carries stamps of the account's password (a shop account or a per-device
 * login) and of the paired console's access key: a new password or a new
 * pairing ends the tokens made before it.
 */
import crypto from "crypto";
import * as store from "./store.js";
import * as users from "./users.js";
import * as deviceLogins from "./device-logins.js";
import * as googleAccounts from "./google-accounts.js";
import { deviceKeyFromHeaders } from "./pairing.js";

const AGENT_CHARS = 12;

/** The account behind a signed-in request ({ kind, id }), or null. */
export function accountOf(req) {
  if (req.deviceLogin) return { kind: "login", id: req.deviceLogin };
  if (req.webUser?.kind === "google") return { kind: "google", id: req.webUser.sub };
  if (req.auth?.user) return { kind: "user", id: req.auth.user };
  return null;
}

/** A short key for whom a request counts against: "<kind>:<id>" of its account, else its paired console. */
export function ownerKey(req) {
  const acct = accountOf(req);
  if (acct) return `${acct.kind}:${acct.id}`;
  if (req.pairedDevice) return `paired:${String(req.pairedDevice).slice(0, 8).toLowerCase()}`;
  return "anonymous";
}

const fingerprint = (v) => crypto.createHash("sha256").update(String(v)).digest("base64url").slice(0, 16);

/** The current stamp of an account's password, or null where it has none (Google). */
function accountStamp({ kind, id }) {
  if (kind === "user") return users.sessionStamp(id);
  if (kind === "login") return deviceLogins.stamp(id);
  return null;
}

/** The current stamp of an approved console's access key, or null. */
function deviceStamp(dev) {
  const hash = store.getDeviceAccessKeyHash(dev);
  return hash ? fingerprint(hash) : null;
}

/**
 * { acct, dev, agent, paired, stamp, dstamp } for a request that signed in, or null.
 * `paired` is whether the console is approved now; the token then requires it.
 */
export function requester(req) {
  const acct = accountOf(req);
  if (!acct && !req.pairedDevice) return null;
  const dev = req.pairedDevice ?? deviceKeyFromHeaders(req);
  const agent = dev ? null : crypto.createHash("sha256").update(String(req.get("user-agent") ?? "")).digest("base64url").slice(0, AGENT_CHARS);
  const paired = Boolean(dev && store.isDeviceApproved(dev));
  return { acct, dev: dev ?? null, agent, paired, stamp: acct ? accountStamp(acct) : null, dstamp: paired ? deviceStamp(dev) : null };
}

function accountAllowed({ kind, id }) {
  if (kind === "login") return deviceLogins.isActive(id);
  if (kind === "google") return googleAccounts.isApproved(id);
  return users.isActive(id);
}

/** Whether tokens made for `who` may still be used. */
export function stillAllowed(who) {
  if (!who || (!who.acct && !who.paired)) return false;
  if (who.acct && (!accountAllowed(who.acct) || accountStamp(who.acct) !== (who.stamp ?? null))) return false;
  return !who.paired || (store.isDeviceApproved(who.dev) && deviceStamp(who.dev) === (who.dstamp ?? null));
}
