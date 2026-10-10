/**
 * Where the admin TOTP secret comes from.
 *
 * Previously /admin simply did not exist unless the operator had already set
 * COOK_ADMIN_TOTP_SECRET by hand — which meant a server that needed device
 * approvals could end up with no way to approve anything. Now a secret always
 * exists:
 *
 *   1. COOK_ADMIN_TOTP_SECRET   — operator-managed, treated as already enrolled
 *   2. ${COOK_DATA_DIR}/security/admin-totp.json — generated on first boot
 *
 * Until the first successful code entry the secret is UNENROLLED, and the
 * dashboard is allowed to show its QR to LAN callers so the operator can adopt
 * it without shell access. After that the QR is never served again.
 *
 * Reads/writes are synchronous on purpose: this resolves once, at boot, before
 * anything can ask for it.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { dataDir, adminTotpSecret as envSecret } from "../helpers/envs.js";
import debug from "../debug.js";

const SECRET_PATH = path.join(dataDir, "security", "admin-totp.json");
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SECRET_BYTES = 20; // 160-bit, the RFC 4226 recommendation

function toBase32(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function readPersisted() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SECRET_PATH, "utf-8"));
    if (typeof parsed?.secret === "string" && parsed.secret.length >= 16) return parsed;
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("admin secret: read failed: %s", err.message);
  }
  return null;
}

function persist(record) {
  try {
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, JSON.stringify(record), { mode: 0o600 });
  } catch (err) {
    debug.error("admin secret: persist failed: %s", err.message);
  }
}

let cached = null;

function resolve() {
  if (cached) return cached;

  if (envSecret) {
    cached = { secret: envSecret, source: "env", enrolled: true };
    return cached;
  }

  const persisted = readPersisted();
  if (persisted) {
    cached = { ...persisted, source: "file" };
    return cached;
  }

  const record = {
    secret: toBase32(crypto.randomBytes(SECRET_BYTES)),
    enrolled: false,
    createdAt: Date.now(),
  };
  persist(record);
  cached = { ...record, source: "generated" };
  debug.log("admin secret: generated a new TOTP secret at %s", SECRET_PATH);
  return cached;
}

export function adminSecret() {
  return resolve().secret;
}

/** True once a correct code has been entered at least once. */
export function isEnrolled() {
  return resolve().enrolled === true;
}

export function secretSource() {
  return resolve().source;
}

/** Called after the first successful verification — retires the QR for good. */
export function markEnrolled() {
  const current = resolve();
  if (current.enrolled) return;
  cached = { ...current, enrolled: true, enrolledAt: Date.now() };
  if (current.source !== "env") {
    persist({
      secret: cached.secret,
      enrolled: true,
      createdAt: current.createdAt ?? null,
      enrolledAt: cached.enrolledAt,
    });
  }
  debug.log("admin secret: enrolled — the enrollment QR is no longer served");
}

// ── Enrollment from the admin page ──────────────────────────────────────
// A new secret is only a candidate until the operator types a code it
// produced; the live secret keeps working until then. Ten minutes to finish.
const PENDING_MS = 10 * 60 * 1000;
let pending = null; // { secret, at }

/** False when COOK_ADMIN_TOTP_SECRET pins the secret; then the page cannot change it. */
export function canManage() {
  return resolve().source !== "env";
}

/** A fresh candidate secret for the authenticator app (replaces any earlier candidate). */
export function startEnrollment(now = Date.now()) {
  if (!canManage()) throw new Error("the TOTP secret is set by COOK_ADMIN_TOTP_SECRET");
  pending = { secret: toBase32(crypto.randomBytes(SECRET_BYTES)), at: now };
  return pending.secret;
}

/** The candidate secret, or null when none was started or it expired. */
export function pendingSecret(now = Date.now()) {
  return pending && now - pending.at < PENDING_MS ? pending.secret : null;
}

/** Makes the candidate the live, enrolled secret. Call only after its code checked out. */
export function commitEnrollment(now = Date.now()) {
  const secret = pendingSecret(now);
  if (!secret) throw new Error("no enrollment in progress");
  const record = { secret, enrolled: true, createdAt: now, enrolledAt: now };
  persist(record);
  cached = { ...record, source: "file" };
  pending = null;
  debug.log("admin secret: authenticator enrolled from the admin page");
}

/** Turns the authenticator off (only sensible while an admin password guards the page). */
export function disableEnrollment(now = Date.now()) {
  if (!canManage()) throw new Error("the TOTP secret is set by COOK_ADMIN_TOTP_SECRET");
  const record = { secret: toBase32(crypto.randomBytes(SECRET_BYTES)), enrolled: false, createdAt: now };
  persist(record);
  cached = { ...record, source: "file" };
  pending = null;
  debug.log("admin secret: authenticator turned off from the admin page");
}

/** Test-only escape hatch so a suite can start from a clean slate. */
export function resetForTests() {
  cached = null;
  pending = null;
}
