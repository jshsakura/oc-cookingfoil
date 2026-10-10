/**
 * Admin 2FA session: a TOTP second factor layered on top of the normal
 * basic-auth perimeter for the /admin dashboard.
 *
 * The shop/Tinfoil path stays basic-auth. /admin additionally requires a valid
 * 6-digit TOTP code (Google Authenticator / Aegis / 1Password / …). A correct
 * code mints a short-lived, HMAC-signed httpOnly cookie scoped to /admin.
 *
 * The signing key is random per process start, so sessions don't survive a
 * restart — fine (and arguably desirable) for an admin surface. The TOTP shared
 * secret comes from COOK_ADMIN_TOTP_SECRET; when unset, /admin is disabled.
 */
import crypto from "crypto";
import { generate, verify, generateURI } from "otplib";

import { adminSessionHours, adminEmail, adminPassword } from "../helpers/envs.js";
import { adminSecret, markEnrolled } from "./admin-secret.js";
import debug from "../debug.js";

const COOKIE_NAME = "cf_admin";
const SESSION_MS = adminSessionHours * 60 * 60 * 1000;
// Per-boot signing secret. Sessions invalidate on restart by design.
const SIGNING_SECRET = crypto.randomBytes(32);

/**
 * Always true now: a secret is auto-provisioned when the operator hasn't set
 * one, so the dashboard can never be the reason approvals are impossible.
 */
export function adminTotpEnabled() {
  return Boolean(adminSecret());
}

/** The operator's identity for display + the authenticator account label. */
export function adminOwner() {
  return adminEmail ?? "admin";
}

/** True when /admin asks for COOK_ADMIN_PASSWORD instead of a TOTP code. */
export function adminPasswordMode() {
  return Boolean(adminPassword);
}

/** Constant-time check of the admin password; hashing first evens out the lengths. */
export function verifyPassword(input, expected = adminPassword) {
  if (!expected || typeof input !== "string" || !input) return false;
  const digest = (v) => crypto.createHash("sha256").update(v, "utf8").digest();
  return crypto.timingSafeEqual(digest(input), digest(expected));
}

/** Validate a 6-digit code against the configured secret (±1 step drift). */
/** Whether a 6-digit code matches `secret` (±1 step drift). Marks nothing. */
export async function codeMatches(secret, code) {
  const token = String(code ?? "").trim();
  if (!secret || !/^\d{6}$/.test(token)) return false;
  try {
    const r = await verify({ token, secret, window: 1 });
    return Boolean(r && r.valid);
  } catch (err) {
    debug.error("admin 2fa: verify error: %s", err.message);
    return false;
  }
}

export async function verifyTotp(code) {
  const ok = await codeMatches(adminSecret(), code);
  // First correct code proves the operator holds the secret — retire the QR.
  if (ok) markEnrolled();
  return ok;
}

/**
 * otpauth:// enrollment URI. Always logged at boot; served over HTTP ONLY by
 * the enrollment page, and only while unenrolled + on a private address.
 */
export async function provisioningUri(secret = adminSecret()) {
  if (!secret) return null;
  try {
    return await generateURI({
      secret,
      // The authenticator shows this as the account name. An email makes the
      // entry identifiable among a dozen other "admin" rows.
      label: adminOwner(),
      issuer: "CookingFoil",
      type: "totp",
    });
  } catch (err) {
    debug.error("admin 2fa: uri error: %s", err.message);
    return null;
  }
}

/** Sanity check at boot that the secret actually drives the TOTP generator. */
export async function selfTest() {
  const secret = adminSecret();
  if (!secret) return false;
  try {
    await generate({ secret });
    return true;
  } catch (err) {
    debug.error("admin 2fa: secret rejected by generator: %s", err.message);
    return false;
  }
}

function sign(payload) {
  const sig = crypto.createHmac("sha256", SIGNING_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function readToken(token) {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac("sha256", SIGNING_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { exp };
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function issueSession(res) {
  const exp = Date.now() + SESSION_MS;
  const token = sign(String(exp));
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${Math.floor(SESSION_MS / 1000)}`
  );
}

export function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`
  );
}

export function hasValidSession(req) {
  const cookies = parseCookies(req);
  return Boolean(readToken(cookies[COOKIE_NAME]));
}
