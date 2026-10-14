/**
 * Signed, expiring direct download links.
 *
 * Every download keeps its `url` on the shop's own address (the tunnel, with
 * the usual sign-in). When the admin sets a direct address (server-settings
 * publicDirectBaseUrl, e.g. https://dl.example.org:38443, a proxy on this host
 * that forwards only signed GET/HEAD requests here), every signed-in list also
 * gives each download a direct twin:
 *
 *   "url": "https://shop.example/Game%2Ffile.nsp",
 *   "direct_url": "https://dl.example.org:38443/Game%2Ffile.nsp?u=<tag>&g=<n>&exp=<unix>&sig=<mac>"
 *
 * (directName() gives the twin's name: url → direct_url, romUrl → romDirectUrl,
 * bundle_url → bundle_direct_url.) Without a direct address, or for a caller
 * who did not sign in, the field is left out and the lists are exactly what
 * they were.
 *
 * The signature covers the decoded path and the rest of the query in a fixed
 * order, never the host, so "/api/homebrew/x/file?path=…" opens that one file
 * and nothing else. u is the console it was made for (link-identity.js) and g
 * that console's generation (download-state.js), both signed. g is only there
 * to make a fresh link once one of the console's links has been used up; it is
 * not compared with the console's current generation, so an older link that
 * was never used keeps working until it expires. direct-lane.js serves such a
 * link without the sign-in and closes it once its file has been delivered in full.
 *
 * Expiries are rounded up to a step (a quarter of the lifetime) so every list
 * served inside one step is byte-identical and the memo in shop-cache.js keeps
 * working; a link always lives at least the full lifetime.
 *
 * The key is 32 random bytes in ${COOK_DATA_DIR}/security/download-link.key
 * (0600), made on first use. Deleting it ends every link handed out so far.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";
import * as identity from "./link-identity.js";
import * as state from "./download-state.js";

const KEY_FILE = path.join(env.dataDir, "security", "download-link.key");
const KEY_BYTES = 32;
// 22 base64url characters = 132 bits of the HMAC.
const SIG_CHARS = 22;
const MIN_STEP_SEC = 60;
// 12 base64url characters = 72 bits: enough to tell a household's consoles apart.
const TAG_CHARS = 12;

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

function mac(filePath, exp, pairs) {
  const message = `v2\n${exp}\n${JSON.stringify([filePath, pairs])}`;
  return crypto.createHmac("sha256", signingKey()).update(message).digest("base64url").slice(0, SIG_CHARS);
}

/** The query's pairs without exp and sig, by name (a name's values keep their order). Pure. */
export function canonicalPairs(params) {
  return [...params].filter(([k]) => k !== "exp" && k !== "sig").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
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
 * The link settings in force now: { base, exp } when a direct address is set,
 * else null. Without a usable key there are no direct links either, rather
 * than a failing list.
 */
export function current(nowMs = Date.now()) {
  const base = env.publicDirectBaseUrl;
  if (!base) return null;
  try {
    signingKey();
  } catch (err) {
    debug.error("direct links: no signing key, lists carry no direct links: %s", err.message);
    return null;
  }
  return { base, exp: expiryFor(Math.floor(nowMs / 1000), env.downloadLinkTtl) };
}

/** The identity tag of `who` (link-identity.js requester): stable, and reveals nothing about it. */
export function tagFor(who) {
  const parts = JSON.stringify([who.acct?.kind ?? null, who.acct?.id ?? null, who.dev, who.agent]);
  return `i${crypto.createHmac("sha256", signingKey()).update(`id\n${parts}`).digest("base64url").slice(0, TAG_CHARS)}`;
}

/**
 * The link settings for one list request: { base, exp, u, g } when a direct
 * address is set and the request signed in; null otherwise, and the list then
 * carries no direct links.
 */
export function forRequest(req, nowMs = Date.now()) {
  const link = current(nowMs);
  if (!link) return null;
  const who = identity.requester(req);
  if (!who) return null;
  const u = tagFor(who);
  return { ...link, u, g: state.remember(u, who, nowMs) };
}

/** The signed direct link for `pathAndQuery` ("/api/…?…", percent-encoded), or null. */
export function directUrl(pathAndQuery, link) {
  if (!link) return null;
  const q = pathAndQuery.indexOf("?");
  const encPath = q < 0 ? pathAndQuery : pathAndQuery.slice(0, q);
  const filePath = decodePath(encPath);
  if (filePath === null) return null;
  const params = new URLSearchParams(q < 0 ? "" : pathAndQuery.slice(q + 1));
  for (const k of ["exp", "sig", "u", "g"]) params.delete(k);
  params.append("u", link.u);
  params.append("g", String(link.g));
  return `${link.base}${encPath}?${params}&exp=${link.exp}&sig=${mac(filePath, link.exp, canonicalPairs(params))}`;
}

/** The name of a URL field's direct twin: url → direct_url, romUrl → romDirectUrl, bundle_url → bundle_direct_url. Pure. */
export function directName(name) {
  if (name === "url") return "direct_url";
  if (name.endsWith("_url")) return `${name.slice(0, -4)}_direct_url`;
  return `${name.replace(/Url$/, "")}DirectUrl`;
}

/** { [directName(name)]: link } to spread next to `name`, or {} when there is none. */
export function directFields(name, pathAndQuery, link) {
  const url = directUrl(pathAndQuery, link);
  return url ? { [directName(name)]: url } : {};
}

/**
 * Gives every file entry of a serialized shop list ("url":"../…") its
 * direct_url. Only the "../" form our own files use is touched, so artwork and
 * absolute custom URLs pass through. Runs before helpers/origin.js anchors the
 * "../" URLs themselves at the origin.
 */
export function withShopDirect(json, link) {
  if (!link) return json;
  return json.replace(/"url":"\.\.\/([^"]*)"/g, (whole, enc) => {
    const url = directUrl(`/${enc}`, link);
    return url ? `${whole},"direct_url":${JSON.stringify(url)}` : whole;
  });
}

/** Whether a raw query carries a link signature (exp and sig). */
export function hasSignature(rawQuery) {
  const params = new URLSearchParams(rawQuery ?? "");
  return params.has("exp") && params.has("sig");
}

function check(filePath, exp, sig, pairs, nowMs) {
  if (!/^\d{1,12}$/.test(exp) || sig.length !== SIG_CHARS) return "bad";
  const want = Buffer.from(mac(filePath, Number(exp), pairs));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return "bad";
  return Number(exp) * 1000 < nowMs ? "expired" : "ok";
}

/**
 * Checks a signed request: `rawPath` and `rawQuery` as sent (percent-encoded).
 * { verdict: "ok" | "expired" | "bad", sig, exp, u, g }; exactly one exp and
 * one sig are accepted.
 */
export function verifyRequest(rawPath, rawQuery, nowMs = Date.now()) {
  const params = new URLSearchParams(rawQuery ?? "");
  const exps = params.getAll("exp");
  const sigs = params.getAll("sig");
  const filePath = decodePath(rawPath);
  if (exps.length !== 1 || sigs.length !== 1 || filePath === null) return { verdict: "bad" };
  const verdict = check(filePath, exps[0], sigs[0], canonicalPairs(params), nowMs);
  if (verdict !== "ok") return { verdict };
  return { verdict, sig: sigs[0], exp: Number(exps[0]), u: params.get("u"), g: params.get("g") };
}
