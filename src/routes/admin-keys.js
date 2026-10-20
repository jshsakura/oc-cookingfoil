/**
 * prod.keys from an admin device: a console the admin allowed on the devices tab
 * (security/device-admin.js; shop info then lists "keys-upload" and keys.present).
 * Any other caller, a browser included, gets 403 { error: "admin device only" }.
 * Each server takes keys from its own admin only, so a client with several
 * servers seals and sends to each one separately.
 *
 *   GET  /api/admin/keys        → 200 S
 *   POST /api/admin/keys/seal   → 200 { publicKey, nonce, expiresAt }  a one-use box, 5 minutes
 *   PUT  /api/admin/keys  { nonce, epk, iv, ct }  → 200 S  the keys installed and in use at once
 *
 * S = { present, source: "upload"|"file"|null, uploadedAt, keyCount, hasHeaderKey, titleKekCount }, never a key value.
 *
 * The console may talk plain http on the LAN, so the keys travel sealed (security/keys-seal.js):
 *   publicKey, epk  P-256 (secp256r1) public keys, uncompressed: 65 bytes 0x04 || X(32) || Y(32), base64url
 *   nonce           the string from /seal, as given (base64url of 16 random bytes)
 *   shared          ECDH(console's ephemeral secret, publicKey): the 32-byte X coordinate
 *   key             HKDF-SHA256(ikm = shared, salt = empty, info = "cookingfoil-prod-keys"), 32 bytes
 *   iv              12 random bytes, base64url
 *   ct              AES-256-GCM(key, iv, AAD = nonce as UTF-8 bytes) over the prod.keys file's bytes
 *                   (UTF-8 text, at most 64 KB), followed by the 16-byte tag, base64url
 * A nonce is spent by the first PUT naming it, whatever the outcome; ask /seal again to retry.
 *
 * Errors, as { error } (400 also { reason }):
 *   400 reason "sealed"         the envelope is malformed or does not open
 *       reason "format"         not a prod.keys: only "name = hex" lines, blanks and #/; comments,
 *                               with key_area_key_application_* or master_key_* entries
 *       reason "no-header-key"  header_key (64 hex digits) is missing
 *       reason "too-large"      over 64 KB
 *   403 not an admin device     410 the nonce is unknown, spent, expired or another console's
 */
import express from "express";
import { adminDeviceOf } from "../security/device-admin.js";
import * as store from "../security/store.js";
import * as prodKeys from "../security/prod-keys.js";
import * as keysSeal from "../security/keys-seal.js";
import { keysChanged } from "../meta/keys-refresh.js";

export default function adminKeysRouter() {
  const router = express.Router();
  // 64 KB of keys in base64url, plus the rest of the envelope.
  router.use(express.json({ limit: "128kb" }));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!adminDeviceOf(req)) return res.status(403).json({ error: "admin device only" });
    next();
  });

  router.get("/", (req, res) => res.json(prodKeys.status()));

  router.post("/seal", (req, res) => res.json(keysSeal.open(adminDeviceOf(req))));

  router.put("/", (req, res) => {
    const device = adminDeviceOf(req);
    const opened = keysSeal.unseal(device, req.body ?? {});
    if (opened.error === "gone") return res.status(410).json({ error: "nonce expired or already used" });
    if (opened.error) return res.status(400).json({ error: "bad envelope", reason: opened.error });
    const deviceName = store.devicesSnapshot().approved.find((d) => d.deviceKey === device)?.label || null;
    let st;
    try {
      st = prodKeys.install(opened.text, { actor: `device ${deviceName ?? device.slice(0, 12)}`, via: "device", device, deviceName });
    } catch (err) {
      if (err instanceof prodKeys.KeysError) return res.status(400).json({ error: "bad keys", reason: err.reason });
      throw err;
    }
    keysChanged();
    res.json(st);
  });

  return router;
}
