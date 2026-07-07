/**
 * Device-pairing primitives (CyberFoil lane).
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
 * Rejects the all-zero fallback CyberFoil emits when the eMMC CID read fails —
 * that value is shared by every failed console and must never be a valid identity.
 */
export function normalizeDeviceKey(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toUpperCase();
  if (!DEVICE_KEY_RE.test(key)) return null;
  if (key === ALL_ZERO) return null;
  return key;
}

/**
 * Read the device key a client presents as a request header. oc-cookfoil-sdl
 * sends `X-Device-Key`; the CyberFoil-family Tinfoil fork sends the legacy
 * `UID` header — accept either. Returns the normalised key or null.
 */
export function deviceKeyFromHeaders(req) {
  return normalizeDeviceKey(req.get("X-Device-Key") || req.get("UID"));
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

// ── One-time plaintext delivery (in-memory, not persisted) ──────────────────
const oneTimeDelivery = new Map(); // deviceKey → plaintext accessKey

export function stageAccessKeyDelivery(deviceKey, accessKey) {
  oneTimeDelivery.set(deviceKey, accessKey);
}

/** Return + consume the staged accessKey for a device (single use), or null. */
export function takeAccessKeyDelivery(deviceKey) {
  const key = oneTimeDelivery.get(deviceKey);
  if (key === undefined) return null;
  oneTimeDelivery.delete(deviceKey);
  return key;
}
