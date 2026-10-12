/**
 * The browser session of a Google-signed-in account (cookie `cf_user`), and the
 * short-lived cookie that carries one sign-in attempt across Google (`cf_oauth`).
 *
 * Both are HMAC-signed with a key kept in ${COOK_DATA_DIR}/security/user-session.key,
 * so a session survives restarts. The cookie names the account only by its
 * Google id; whether it may act is looked up on every request, so disabling an
 * account in /admin takes effect at once.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import * as accounts from "./google-accounts.js";

const KEY_FILE = path.join(dataDir, "security", "user-session.key");
export const SESSION_COOKIE = "cf_user";
export const OAUTH_COOKIE = "cf_oauth";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_MS = 10 * 60 * 1000;

let key = null;
function signingKey() {
  if (key) return key;
  try {
    key = fs.readFileSync(KEY_FILE);
    if (key.length >= 32) return key;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  return key;
}

/** `value` (any JSON) with an expiry, signed. */
export function seal(value, ttlMs, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: value, exp: now + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** The value inside a sealed token, or null when it is forged or expired. */
export function unseal(token, now = Date.now()) {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url"));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { v, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isFinite(exp) && now <= exp ? v : null;
  } catch {
    return null;
  }
}

export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    try {
      out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      /* a mangled cookie is no cookie */
    }
  }
  return out;
}

const isHttps = (req) => req.secure || String(req.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";

/** A Set-Cookie value. Lax so it rides the top-level redirect back from Google. */
export function cookieLine(req, name, value, { maxAgeMs, path: cookiePath = "/" }) {
  const age = Math.max(0, Math.floor(maxAgeMs / 1000));
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=${age}${isHttps(req) ? "; Secure" : ""}`;
}

export function issueUserSession(req, res, sub) {
  res.append("Set-Cookie", cookieLine(req, SESSION_COOKIE, seal({ sub }, SESSION_MS), { maxAgeMs: SESSION_MS }));
}

export function clearUserSession(req, res) {
  res.append("Set-Cookie", cookieLine(req, SESSION_COOKIE, "", { maxAgeMs: 0 }));
}

/** The signed-in account (any status), or null. */
export function sessionAccount(req) {
  const v = unseal(cookies(req)[SESSION_COOKIE]);
  return v?.sub ? accounts.get(v.sub) : null;
}

/** The signed-in account when it is approved, else null. */
export function approvedAccount(req) {
  const a = sessionAccount(req);
  return a?.status === "approved" ? a : null;
}
