/**
 * The envelope a console seals prod.keys in, so they never travel in clear even
 * over plain http on the LAN. Same construction as the RetroAchievements link
 * (retro/achievements/link.js), with the server holding the private half:
 *
 *   open(holder)   a fresh P-256 key pair and nonce for one admin console, 5 minutes, one use
 *   unseal(holder, { nonce, epk, iv, ct })  → { text } or { error: "gone" | "sealed" | "too-large" }
 *
 *   publicKey, epk  uncompressed P-256 point, 65 bytes (0x04 || X || Y), base64url
 *   key             HKDF-SHA256(ikm = ECDH X coordinate (32 bytes), salt = none, info = INFO), 32 bytes
 *   iv              12 bytes, base64url
 *   ct              AES-256-GCM(prod.keys as UTF-8) || 16-byte tag, AAD = the nonce string (UTF-8), base64url
 *
 * A nonce is spent by the first unseal that names it, readable or not; another
 * console's nonce reads as gone and stays for its owner. Nothing is kept on disk.
 */
import crypto from "crypto";
import { MAX_BYTES } from "./prod-keys.js";

export const INFO = "cookingfoil-prod-keys";
export const SEAL_TTL_MS = 5 * 60 * 1000;
const MAX_OPEN = 32;
const TAG_BYTES = 16;

const boxes = new Map(); // nonce → { holder, ecdh, expiresAt }

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const bytesOf = (text) => (typeof text === "string" && B64URL_RE.test(text) ? Buffer.from(text, "base64url") : null);

/** A new box for the console `holder`: { publicKey, nonce, expiresAt }. */
export function open(holder, now = Date.now()) {
  for (const [nonce, box] of boxes) if (box.expiresAt <= now) boxes.delete(nonce);
  if (boxes.size >= MAX_OPEN) boxes.delete(boxes.keys().next().value);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const nonce = crypto.randomBytes(16).toString("base64url");
  const expiresAt = now + SEAL_TTL_MS;
  boxes.set(nonce, { holder, ecdh, expiresAt });
  return { publicKey: ecdh.getPublicKey().toString("base64url"), nonce, expiresAt };
}

/** Opens one envelope of `holder`'s. → { text } or { error }. */
export function unseal(holder, { nonce, epk, iv, ct } = {}, now = Date.now()) {
  if (typeof nonce !== "string" || !nonce) return { error: "sealed" };
  const box = boxes.get(nonce);
  if (!box || box.holder !== holder) return { error: "gone" };
  boxes.delete(nonce);
  if (box.expiresAt < now) return { error: "gone" };
  const point = bytesOf(epk), ivBytes = bytesOf(iv), body = bytesOf(ct);
  if (point?.length !== 65 || point[0] !== 0x04 || ivBytes?.length !== 12 || !body || body.length <= TAG_BYTES) return { error: "sealed" };
  if (body.length > MAX_BYTES + TAG_BYTES) return { error: "too-large" };
  try {
    const x = box.ecdh.computeSecret(point);
    const key = Buffer.from(crypto.hkdfSync("sha256", x, Buffer.alloc(0), INFO, 32));
    const d = crypto.createDecipheriv("aes-256-gcm", key, ivBytes);
    d.setAAD(Buffer.from(nonce, "utf8"));
    d.setAuthTag(body.subarray(-TAG_BYTES));
    return { text: Buffer.concat([d.update(body.subarray(0, -TAG_BYTES)), d.final()]).toString("utf8") };
  } catch {
    return { error: "sealed" };
  }
}

/** For tests. */
export function reset() {
  boxes.clear();
}
