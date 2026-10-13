/**
 * Public device-pairing endpoints (no basic-auth — that's the whole point).
 * Live only when COOK_DEVICE_PAIRING=true; otherwise the router 404s.
 *
 *   POST /api/pair/request  { deviceKey, label?, message? }  message: a one-line note for the admin (100 chars)
 *        → records the device as "pending" for the admin to approve.
 *        → { status: "pending" }  (or { status: "approved" } if already done)
 *
 *   GET  /api/pair/status?deviceKey=<64hex>   (or the X-Device-Key header)
 *        → { status: "pending" }                              while unapproved
 *        → { status: "approved", accessKey, shopUrl }         ONCE after approval
 *        → { status: "approved" }                             on later polls
 *
 * The accessKey is handed down exactly once (first poll after approval); the
 * device persists it and presents it on every future request. Mounted OUTSIDE
 * the basic-auth perimeter but INSIDE rate-limiting + the probe access-guard.
 */
import express from "express";

import * as store from "../security/store.js";
import {
  normalizeDeviceKey,
  deviceKeyFromHeaders,
  takeAccessKeyDelivery,
  pairMessage,
} from "../security/pairing.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl, devicePairing } from "../helpers/envs.js";
import debug from "../debug.js";
import { issuePairLink } from "../security/pairing-link.js";
import { autoApproveFromPairRequest } from "../security/auth-guard.js";

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

  router.post("/request", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = resolveKey(req, req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
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
    const accessKey = takeAccessKeyDelivery(deviceKey);
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
