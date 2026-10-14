/**
 * The download token: what a console shows on the direct address instead of
 * signing in.
 *
 *   <base64url(payload)>.<base64url(HMAC-SHA256(key, base64url(payload)))>
 *   payload = { v: 1, sub, iat, exp }   (unix seconds)
 *
 * sub is the console it was made for, with the account behind it
 * (link-identity.js requester: { acct, dev, agent, paired }). The token opens
 * any download on the direct address until exp, as long as that account and
 * console may still sign in (direct-lane.js checks that on every request).
 *
 * Tokens are issued in steps of a quarter of the lifetime: everything handed
 * out inside one step is the same token, and it lives at least the full
 * lifetime from the moment it was handed out.
 *
 * The key is 32 random bytes in ${COOK_DATA_DIR}/security/download-link.key
 * (0600), made on first use. Deleting it ends every token handed out so far.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as env from "../helpers/envs.js";

const KEY_FILE = path.join(env.dataDir, "security", "download-link.key");
const KEY_BYTES = 32;
const MIN_STEP_SEC = 60;
const MAX_TOKEN_CHARS = 4096;
const ACCOUNT_KINDS = new Set(["user", "login", "google"]);

let key = null;

// Made only when the file is missing; a file that can't be read or is the wrong
// size is an error, so a key is never replaced behind the operator's back.
export function signingKey() {
  if (key) return key;
  let raw = null;
  try {
    raw = fs.readFileSync(KEY_FILE);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (raw) {
    if (raw.length !== KEY_BYTES) throw new Error(`${KEY_FILE} is not a ${KEY_BYTES}-byte key`);
    return (key = raw);
  }
  const fresh = crypto.randomBytes(KEY_BYTES);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY_FILE, fresh, { mode: 0o600, flag: "wx" });
  return (key = fresh);
}

/** Tests point the module at a fresh key file. */
export function resetKeyForTests() {
  key = null;
}

const macOf = (body) => crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");

/** { iat, exp } of the token step `nowSec` falls in, for a lifetime of `ttlSec`. Pure. */
export function stepFor(nowSec, ttlSec) {
  const step = Math.max(MIN_STEP_SEC, Math.floor(ttlSec / 4));
  const iat = Math.floor(nowSec / step) * step;
  return { iat, exp: iat + step + ttlSec };
}

/** The identity as it goes into a token: only the fields link-identity.js compares. Pure. */
function subOf(who) {
  return { acct: who.acct ? { kind: who.acct.kind, id: who.acct.id } : null, dev: who.dev ?? null, agent: who.agent ?? null, paired: Boolean(who.paired) };
}

/** The token for `who` (link-identity.js requester) at `nowMs`. */
export function issue(who, nowMs = Date.now(), ttlSec = env.downloadLinkTtl) {
  const { iat, exp } = stepFor(Math.floor(nowMs / 1000), ttlSec);
  const body = Buffer.from(JSON.stringify({ v: 1, sub: subOf(who), iat, exp })).toString("base64url");
  return `${body}.${macOf(body)}`;
}

const isStrOrNull = (v) => v === null || (typeof v === "string" && v.length > 0 && v.length <= 512);

/** Whether a decoded sub has the shape issue() writes. Pure. */
function validSub(sub) {
  if (!sub || typeof sub !== "object") return false;
  const { acct, dev, agent, paired } = sub;
  if (acct !== null && !(acct && ACCOUNT_KINDS.has(acct.kind) && typeof acct.id === "string" && acct.id)) return false;
  return isStrOrNull(dev) && isStrOrNull(agent) && typeof paired === "boolean";
}

/**
 * Checks a token: { verdict: "ok", sub, exp } | { verdict: "expired" } |
 * { verdict: "invalid" }. Only a token with a valid MAC can be "expired".
 */
export function verify(token, nowMs = Date.now()) {
  const invalid = { verdict: "invalid" };
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS) return invalid;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return invalid;
  const want = Buffer.from(macOf(parts[0]));
  const got = Buffer.from(parts[1]);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return invalid;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return invalid;
  }
  if (payload?.v !== 1 || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat) || !validSub(payload.sub)) return invalid;
  if (payload.exp * 1000 <= nowMs) return { verdict: "expired" };
  return { verdict: "ok", sub: payload.sub, exp: payload.exp };
}
