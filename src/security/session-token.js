/**
 * The session token: what a console sends instead of its access key once it has
 * signed in, so the paired console's access key crosses the network once every
 * SESSION_TTL_SEC instead of on every request, list and download chunk. Over
 * plain http at home that is the difference between a key anyone on the
 * network can read and a token that ends by itself.
 *
 *   Authorization: Bearer cfs_<base64url(payload)>.<base64url(HMAC-SHA256(key, "session\0" + base64url(payload)))>
 *   payload = { v: 1, sub, iat, exp }   (unix seconds)
 *
 * sub is the console with the account behind it (link-identity.js requester),
 * checked again on every request (stillAllowed): a disabled account, a new
 * password, a revoked console or a new pairing ends its tokens at once. A
 * token is good only from the console it was made for (the same X-Device-Key).
 *
 * The key is the download token's (download-token.js), with "session\0" in
 * front of what it signs, so a download token is never a session and a session
 * never opens the direct address. Deleting that key file ends both.
 */
import crypto from "crypto";
import { signingKey } from "./download-token.js";

export const PREFIX = "cfs_";
export const SESSION_TTL_SEC = 12 * 60 * 60;
const MAX_TOKEN_CHARS = 4096;
const KINDS = new Set(["user"]);

const macOf = (body) => crypto.createHmac("sha256", signingKey()).update(`session\0${body}`).digest("base64url");

/** The identity as it goes into a token: only what stillAllowed compares. Pure. */
function subOf(who) {
  return {
    acct: who.acct ? { kind: who.acct.kind, id: who.acct.id } : null,
    dev: who.dev,
    paired: Boolean(who.paired),
    stamp: who.stamp ?? null,
    dstamp: who.dstamp ?? null,
  };
}

/** Whether a session may be made for `who`: a console (a device key) with a shop account, or its pairing. Pure. */
export function eligible(who) {
  if (!who?.dev) return false;
  if (who.acct) return KINDS.has(who.acct.kind);
  return Boolean(who.paired);
}

/** { token, expiresAt } for `who` (link-identity.js requester) at `nowMs`. */
export function issue(who, nowMs = Date.now(), ttlSec = SESSION_TTL_SEC) {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSec;
  const body = Buffer.from(JSON.stringify({ v: 1, sub: subOf(who), iat, exp })).toString("base64url");
  return { token: `${PREFIX}${body}.${macOf(body)}`, expiresAt: exp * 1000 };
}

const isStrOrNull = (v) => v === null || (typeof v === "string" && v.length > 0 && v.length <= 512);

function validSub(sub) {
  if (!sub || typeof sub !== "object") return false;
  const { acct, dev, paired, stamp, dstamp } = sub;
  if (acct !== null && !(acct && KINDS.has(acct.kind) && typeof acct.id === "string" && acct.id)) return false;
  if (typeof dev !== "string" || !/^[0-9A-F]{64}$/.test(dev)) return false;
  return [stamp, dstamp].every(isStrOrNull) && typeof paired === "boolean" && (acct !== null || paired);
}

/** The token of an `Authorization: Bearer cfs_…` header, or null. Pure. */
export function presented(header) {
  const m = /^Bearer[ ]+(cfs_[^\s]+)[ ]*$/.exec(String(header ?? ""));
  return m ? m[1] : null;
}

/**
 * { verdict: "ok", sub, exp } | { verdict: "expired" } | { verdict: "invalid" }.
 * Only a token with a good MAC can be "expired". One signed with a key since
 * replaced is "invalid" like a forgery (and logged as one); the console signs
 * in again either way.
 */
export function verify(token, nowMs = Date.now()) {
  const invalid = { verdict: "invalid" };
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS || !token.startsWith(PREFIX)) return invalid;
  const parts = token.slice(PREFIX.length).split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return invalid;
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return invalid;
  }
  const want = Buffer.from(macOf(parts[0]));
  const got = Buffer.from(parts[1]);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return invalid;
  if (payload?.v !== 1 || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat) || !validSub(payload.sub)) return invalid;
  if (payload.exp * 1000 <= nowMs) return { verdict: "expired" };
  return { verdict: "ok", sub: payload.sub, exp: payload.exp };
}
