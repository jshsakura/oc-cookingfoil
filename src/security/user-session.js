/**
 * Web sessions. Signing in at /login (ID and password, or Google) sets the
 * cookie `cf_user`; `cf_oauth` carries one Google attempt across Google, and
 * `cf_csrf` holds the token every form and write must echo back.
 *
 * All are HMAC-signed with a key kept in ${COOK_DATA_DIR}/security/user-session.key,
 * so a session survives restarts. The cookie names the account only (an ID
 * plus a fingerprint of its password, or a Google id); whether it may still
 * act is looked up on every request, so a new password, a disabled account or
 * a Google account turned off in /admin ends its sessions at once.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import * as accounts from "./google-accounts.js";
import * as users from "./users.js";

const KEY_FILE = path.join(dataDir, "security", "user-session.key");
export const SESSION_COOKIE = "cf_user";
export const CSRF_COOKIE = "cf_csrf";
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

/** Whether the browser reached us over https (directly, or through a proxy that says so). */
export const isHttps = (req) => req.secure || String(req.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";

/** A Set-Cookie value. Lax so it rides the top-level redirect back from Google. */
export function cookieLine(req, name, value, { maxAgeMs, path: cookiePath = "/" }) {
  const age = Math.max(0, Math.floor(maxAgeMs / 1000));
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=${age}${isHttps(req) ? "; Secure" : ""}`;
}

export function issueUserSession(req, res, sub) {
  res.append("Set-Cookie", cookieLine(req, SESSION_COOKIE, seal({ sub }, SESSION_MS), { maxAgeMs: SESSION_MS }));
}

/** Signed in with an ID and password. */
export function issuePasswordSession(req, res, name) {
  res.append("Set-Cookie", cookieLine(req, SESSION_COOKIE, seal({ user: name, s: users.sessionStamp(name) }, SESSION_MS), { maxAgeMs: SESSION_MS }));
}

export function clearUserSession(req, res) {
  res.append("Set-Cookie", cookieLine(req, SESSION_COOKIE, "", { maxAgeMs: 0 }));
}

/** The signed-in account (any status), or null. */
export function sessionAccount(req) {
  const v = unseal(cookies(req)[SESSION_COOKIE]);
  return v?.sub ? accounts.get(v.sub) : null;
}

/**
 * Who is signed in to the web pages, or null:
 *   { kind: "password", name, approver: name }
 *   { kind: "google", sub, email, approver: "google:<email>" }   (approved accounts only)
 */
export function webUser(req) {
  const v = unseal(cookies(req)[SESSION_COOKIE]);
  if (v?.user) {
    const stamp = users.sessionStamp(v.user);
    return stamp && stamp === v.s ? { kind: "password", name: v.user, approver: v.user } : null;
  }
  const a = v?.sub ? accounts.get(v.sub) : null;
  return a?.status === "approved" ? { kind: "google", sub: a.sub, email: a.email, approver: `google:${a.email}` } : null;
}

/** This browser's CSRF token, minted (and set as a cookie) on first use. */
export function csrfToken(req, res) {
  const have = cookies(req)[CSRF_COOKIE];
  if (typeof have === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(have)) return have;
  const token = crypto.randomBytes(32).toString("base64url");
  res.append("Set-Cookie", `${cookieLine(req, CSRF_COOKIE, token, { maxAgeMs: SESSION_MS })}`.replace("SameSite=Lax", "SameSite=Strict"));
  return token;
}

/** Whether a write carries this browser's CSRF token (form field or X-CSRF-Token). */
export function csrfOk(req) {
  const want = cookies(req)[CSRF_COOKIE];
  const got = req.get("x-csrf-token") ?? req.body?.csrf;
  if (typeof want !== "string" || typeof got !== "string" || !want || want.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

/** The signed-in account when it is approved, else null. */
export function approvedAccount(req) {
  const a = sessionAccount(req);
  return a?.status === "approved" ? a : null;
}
