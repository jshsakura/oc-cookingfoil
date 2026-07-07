/**
 * Public device-pairing endpoints (no basic-auth — that's the whole point).
 * Live only when COOK_DEVICE_PAIRING=true; otherwise the router 404s.
 *
 *   POST /api/pair/request  { deviceKey, label? }
 *        → records the device as "pending" for the admin to approve.
 *        → { status: "pending" }  (or { status: "approved" } if already done)
 *
 *   GET  /api/pair/status?deviceKey=<64hex>
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
import { normalizeDeviceKey, takeAccessKeyDelivery } from "../security/pairing.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl, devicePairing } from "../helpers/envs.js";
import debug from "../debug.js";

function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
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

  router.post("/request", (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    if (store.isDeviceApproved(deviceKey)) {
      res.json({ status: "approved" });
      return;
    }
    store.recordPendingDevice(deviceKey, {
      ip: clientIp(req),
      version: req.get("Version") || null,
    });
    debug.log("pair: request from %s… (%s)", deviceKey.slice(0, 12), clientIp(req));
    res.json({ status: "pending" });
  });

  router.get("/status", (req, res) => {
    res.set("Cache-Control", "no-store");
    const deviceKey = normalizeDeviceKey(req.query?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    if (!store.isDeviceApproved(deviceKey)) {
      res.json({ status: "pending" });
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
