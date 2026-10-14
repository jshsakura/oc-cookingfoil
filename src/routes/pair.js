/**
 * Public device-pairing endpoints (no basic-auth — that's the whole point).
 * Live only when COOK_DEVICE_PAIRING=true; otherwise the router 404s.
 *
 *   POST /api/pair/request  { deviceKey, pairSecret?, label?, message? }  message: a one-line note for the admin (100 chars)
 *        pairSecret: 64 hex the client generated (32 random bytes), or the X-Pair-Secret header
 *        → records the device as "pending" for the admin to approve.
 *        → { status: "pending" }  (or { status: "approved" } if already done)
 *        → 400 { error: "invalid pairSecret" } when one is sent but is not 64 hex
 *        → 409 { error: "pairSecret mismatch" } when another secret already asked for this device
 *
 *   GET  /api/pair/status?deviceKey=<64hex>   (or the X-Device-Key header)
 *        + the same pairSecret as the X-Pair-Secret header (or ?pairSecret=)
 *        → { status: "pending" }                              while unapproved
 *        → { status: "approved", accessKey, shopUrl }         ONCE after approval, to the caller with the secret
 *        → { status: "approved" }                             on later polls, or without the secret
 *        → 409 { error: "pairSecret mismatch" }               while pending, with a secret other than the first
 *
 * The accessKey is handed down exactly once (first poll after approval that
 * presents the pairSecret the console asked with); the device persists it and
 * presents it on every future request. The server keeps only the secret's
 * SHA-256, the first secret for a device wins, and a poll without it (or with
 * another) never consumes the delivery. A console that asked without a secret
 * (an older client) gets the key on its first poll, as before
 * (security/pairing-delivery.js). Mounted OUTSIDE the basic-auth perimeter but
 * INSIDE rate-limiting + the probe access-guard.
 */
import express from "express";

import * as store from "../security/store.js";
import {
  normalizeDeviceKey,
  deviceKeyFromHeaders,
  pairMessage,
} from "../security/pairing.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl, devicePairing } from "../helpers/envs.js";
import debug from "../debug.js";
import { issuePairLink } from "../security/pairing-link.js";
import { autoApproveFromPairRequest } from "../security/auth-guard.js";
import { deliverAccessKey, registerPairSecret } from "../security/pairing-delivery.js";

function pendingResponse(req, deviceKey) {
  const link = issuePairLink(deviceKey);
  const origin = resolveOrigin(req, publicBaseUrl);
  return {
    status: "pending",
    pairUrl: origin ? `${origin}/pair/${link.token}` : null,
    pairCode: link.code,
    expiresAt: link.expiresAt,
  };
}

// Another secret already claimed this device key: the console cannot get a key
// until the admin refuses or forgets the request, so it should say so rather
// than show a QR the admin might approve for someone else.
function secretConflict(res) {
  res.status(409).json({ error: "pairSecret mismatch" });
}

export default function pairRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "8kb" }));

  // Hard 404 when the pairing lane is off — no surface to probe.
  router.use((req, res, next) => {
    if (!devicePairing) {
      res.status(404).type("text/plain").send("not found");
      return;
    }
    next();
  });

  // The device key may arrive in the body/query OR as the header the client
  // already stamps on every other request — accept either so a caller can't
  // half-work depending on which endpoint it hits.
  const resolveKey = (req, explicit) =>
    normalizeDeviceKey(explicit) ?? deviceKeyFromHeaders(req);
  // The pairSecret, likewise: a body or query field, or the X-Pair-Secret header.
  const pairSecretOf = (req, explicit) => explicit ?? req.get("X-Pair-Secret");

  router.post("/request", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = resolveKey(req, req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    // Before auto-approval, so a console approved right here is held to its secret too.
    const registered = registerPairSecret(deviceKey, pairSecretOf(req, req.body?.pairSecret));
    if (registered === "invalid") {
      res.status(400).json({ error: "invalid pairSecret" });
      return;
    }
    if (registered === "conflict") return secretConflict(res);
    await autoApproveFromPairRequest(req, deviceKey).catch(() => false);
    if (store.isDeviceApproved(deviceKey)) {
      res.json({ status: "approved" });
      return;
    }
    // The console's own note, so the admin can tell which one asks; a request without one keeps the last.
    const message = req.body && "message" in req.body ? pairMessage(req.body.message) : undefined;
    store.recordPendingDevice(deviceKey, { message });
    debug.log("pair: request from %s…", deviceKey.slice(0, 12));
    res.json(pendingResponse(req, deviceKey));
  });

  router.get("/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = resolveKey(req, req.query?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const secret = pairSecretOf(req, req.query?.pairSecret);
    // A GET-only client asks here, so its secret registers here too (a malformed one is ignored).
    if (registerPairSecret(deviceKey, secret) === "conflict") return secretConflict(res);
    // A console that knocks with its account is approved right here (COOK_DEVICE_AUTO_APPROVE).
    await autoApproveFromPairRequest(req, deviceKey).catch(() => false);
    if (!store.isDeviceApproved(deviceKey)) {
      // Polling doubles as the knock: record the device as pending so a
      // GET-only client (oc-cookfoil-sdl has no POST helper) surfaces in the
      // admin dashboard without a separate /request call.
      store.recordPendingDevice(deviceKey);
      res.json(pendingResponse(req, deviceKey));
      return;
    }
    const out = { status: "approved" };
    // Only to the caller holding the pairSecret the console asked with (or any caller, for a legacy console).
    const accessKey = deliverAccessKey(deviceKey, typeof secret === "string" ? secret : null);
    if (accessKey) {
      out.accessKey = accessKey;
      const origin = resolveOrigin(req, publicBaseUrl);
      out.shopUrl = origin ? origin + "/shop.tfl" : null;
      debug.log("pair: delivered accessKey to %s…", deviceKey.slice(0, 12));
    }
    res.json(out);
  });

  return router;
}
