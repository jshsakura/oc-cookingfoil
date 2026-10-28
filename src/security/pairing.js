/**
 * Device-pairing primitives (the console lane).
 *
 *   deviceKey  — the client's UID header = SHA-256(eMMC CID), 64 uppercase hex.
 *                Hardware-bound per console. Travels UP from device to server.
 *   accessKey  — a random server-issued token bound to one deviceKey. Travels
 *                DOWN once, on approval. The server persists only its SHA-256
 *                HASH; the plaintext is delivered exactly once and never stored.
 *
 * The one-time delivery buffer below is IN-MEMORY ONLY (never persisted): it
 * holds the plaintext accessKey between "admin approves" and "device's next
 * status poll picks it up". If the process restarts before pickup, the admin
 * simply re-approves to mint a fresh key.
 */
import crypto from "crypto";

const DEVICE_KEY_RE = /^[0-9A-F]{64}$/;
const ALL_ZERO = "0".repeat(64);

/**
 * Normalise + validate a raw UID into a canonical deviceKey, or null.
 * Rejects the all-zero fallback the client sends when its eMMC CID read fails:
 * that value is shared by every failed console and must never be a valid identity.
 */
export function normalizeDeviceKey(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toUpperCase();
  if (!DEVICE_KEY_RE.test(key)) return null;
  if (key === ALL_ZERO) return null;
  return key;
}

/** The device key a client presents in its `X-Device-Key` header, normalised, or null. */
export function deviceKeyFromHeaders(req) {
  return normalizeDeviceKey(req.get("X-Device-Key"));
}

export function generateAccessKey() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashAccessKey(accessKey) {
  return crypto.createHash("sha256").update(String(accessKey)).digest("base64url");
}

/** Constant-time compare of a presented accessKey against a stored hash. */
export function verifyAccessKey(accessKey, expectedHash) {
  if (!accessKey || !expectedHash) return false;
  const a = Buffer.from(hashAccessKey(accessKey));
  const b = Buffer.from(String(expectedHash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Pair secret (proof of possession for the one-time delivery) ─────────────
// The device key is no secret: anyone who learns it could poll /status first
// and take the accessKey. So a client sends a random pairSecret with its
// request; the server keeps only the SHA-256 and hands the accessKey only to
// the caller that presents the same secret again.
const PAIR_SECRET_RE = /^[0-9a-f]{64}$/;

/** A 64-hex pairSecret (case ignored), lowercased, or null. */
export function normalizePairSecret(raw) {
  if (typeof raw !== "string") return null;
  const secret = raw.trim().toLowerCase();
  return PAIR_SECRET_RE.test(secret) ? secret : null;
}

export function hashPairSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

/** Constant-time compare of a presented pairSecret against a stored hash. */
export function pairSecretMatches(secret, expectedHash) {
  const presented = normalizePairSecret(secret);
  if (!presented || typeof expectedHash !== "string") return false;
  const a = Buffer.from(hashPairSecret(presented));
  const b = Buffer.from(expectedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── One-time plaintext delivery (in-memory, not persisted) ──────────────────
const oneTimeDelivery = new Map(); // deviceKey → plaintext accessKey

export function stageAccessKeyDelivery(deviceKey, accessKey) {
  oneTimeDelivery.set(deviceKey, accessKey);
}

/** Drop a staged accessKey nobody took: the attempt it was for has ended. */
export function discardAccessKeyDelivery(deviceKey) {
  oneTimeDelivery.delete(deviceKey);
}

/** Return + consume the staged accessKey for a device (single use), or null. */
export function takeAccessKeyDelivery(deviceKey) {
  const key = oneTimeDelivery.get(deviceKey);
  if (key === undefined) return null;
  oneTimeDelivery.delete(deviceKey);
  return key;
}

const MESSAGE_MAX = 100;

/**
 * The note a console sends with its approval request ("철수 거실 기기"), so the
 * admin knows which one it is: one line, control characters dropped, at most
 * 100 characters. null when there is none. Pure.
 */
export function pairMessage(raw) {
  if (typeof raw !== "string") return null;
  const line = raw.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim();
  return line ? [...line].slice(0, MESSAGE_MAX).join("") : null;
}
