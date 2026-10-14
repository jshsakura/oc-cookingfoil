/**
 * Signed, expiring download links for the download-only address.
 *
 * When the admin sets a download address (server-settings downloadBaseUrl, e.g.
 * https://dl.example.org:38443), the lists hand out game file URLs on that
 * address instead of the shop's own:
 *
 *   "../Game%2Ffile.nsp"  →  "https://dl.example.org:38443/Game%2Ffile.nsp?exp=<unix>&sig=<mac>"
 *
 * The download address answers only those URLs (see download-host.js): no
 * sign-in, no pages, no API. The signature covers the decoded file path and
 * the expiry, so a link opens that one file until it expires and nothing else.
 *
 * Expiries are rounded up to a step (a quarter of the lifetime) so every list
 * served inside one step is byte-identical and the per-origin memo in
 * shop-cache.js keeps working; a link always lives at least the full lifetime.
 *
 * The key is 32 random bytes in ${COOK_DATA_DIR}/security/download-link.key
 * (0600), made on first use. Deleting it ends every link handed out so far.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";

const KEY_FILE = path.join(env.dataDir, "security", "download-link.key");
const KEY_BYTES = 32;
// 22 base64url characters = 132 bits of the HMAC.
const SIG_CHARS = 22;
const MIN_STEP_SEC = 60;

let key = null;

// Made only when the file is missing; a file that can't be read or is the wrong
// size is an error, so a key is never replaced behind the operator's back.
function signingKey() {
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

function mac(filePath, exp) {
  return crypto.createHmac("sha256", signingKey()).update(`${exp}\n${filePath}`).digest("base64url").slice(0, SIG_CHARS);
}

function decodePath(p) {
  try {
    return decodeURIComponent(p);
  } catch {
    return null;
  }
}

/** The expiry (unix seconds) for links made at `nowSec` with a lifetime of `ttlSec`. */
export function expiryFor(nowSec, ttlSec) {
  const step = Math.max(MIN_STEP_SEC, Math.floor(ttlSec / 4));
  return Math.ceil((nowSec + ttlSec) / step) * step;
}

/**
 * The link settings in force now: { base, exp } when a download address is set,
 * null when lists keep the shop's own address. Without a usable key the lists
 * keep the shop's own address too, rather than failing.
 */
export function current(nowMs = Date.now()) {
  if (!env.downloadBaseUrl) return null;
  try {
    signingKey();
  } catch (err) {
    debug.error("download links: no signing key, lists keep the shop address: %s", err.message);
    return null;
  }
  return { base: env.downloadBaseUrl, exp: expiryFor(Math.floor(nowMs / 1000), env.downloadLinkTtl) };
}

/** A signed link on `base` for one percent-encoded file path (no leading slash). */
export function signedUrl(base, encodedPath, exp) {
  const filePath = decodePath(`/${encodedPath}`);
  if (filePath === null) return `${base}/${encodedPath}`;
  return `${base}/${encodedPath}?exp=${exp}&sig=${mac(filePath, exp)}`;
}

/**
 * Turns every relative download URL in a serialized list ("../…") into a signed
 * link. Same anchor as helpers/origin.js rewriteDownloadOrigin, so artwork and
 * absolute custom URLs pass through untouched.
 */
export function rewriteSigned(json, link) {
  return json.replace(/"\.\.\/([^"]*)"/g, (_, enc) => `"${signedUrl(link.base, enc, link.exp)}"`);
}

/**
 * Checks a request on the download address: "ok", "expired" or "bad".
 * `rawPath` is the request path as sent (still percent-encoded).
 */
export function verify(rawPath, exp, sig, nowMs = Date.now()) {
  if (typeof exp !== "string" || !/^\d{1,12}$/.test(exp) || typeof sig !== "string" || sig.length !== SIG_CHARS) return "bad";
  const filePath = decodePath(rawPath);
  if (filePath === null) return "bad";
  const want = Buffer.from(mac(filePath, Number(exp)));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return "bad";
  return Number(exp) * 1000 < nowMs ? "expired" : "ok";
}

/** host[:port] of the download address, lower-cased; "" when none is set. */
export function downloadHost() {
  if (!env.downloadBaseUrl) return "";
  try {
    return new URL(env.downloadBaseUrl).host.toLowerCase();
  } catch {
    return "";
  }
}
