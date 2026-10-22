/**
 * Device approval for signed-in shop users (/pair), mounted inside the shop's
 * sign-in. The console's QR points at /pair/<token>; the same page can scan
 * that QR with the phone's camera or take the 8-character device code, and the
 * console is approved under the account that is signed in. A pairing-only shop
 * (no accounts) falls back to the admin session.
 *
 *   GET  /pair             scanner + device-code field
 *   GET  /pair/<token>     confirm one console (what the QR opens)
 *   POST /pair/approve     { token | code, label? } → { ok: true }
 *   GET  /pair/qr.js       QR decoder for browsers without BarcodeDetector
 *
 * This account's consoles:
 *   GET  /pair/api/mine                    the consoles it approved and its client downloads
 *   POST /pair/api/devices/revoke  { deviceKey }  a QR console this account approved
 *
 * The CookingFoil client, ready to connect (needs device pairing):
 *   POST /pair/api/client-bundle           a zip of switch/cookingfoil/cookingfoil.nro and a config.json
 *                                          holding this server and a one-day enrollment token
 *   POST /pair/api/clients/<id>/revoke     withdraw a download's token before a console used it
 *   /pair/api/mine lists the downloads too (no token in it: id, when, state, the console's code)
 */
import express from "express";
import { createRequire } from "node:module";

import * as store from "../security/store.js";
import { readPairLink, findPairLinkByCode } from "../security/pairing-link.js";
import { approvePairLink } from "../security/pairing-approve.js";
import { hasValidSession } from "../security/admin-session.js";
import { devicePairing, publicBaseUrl } from "../helpers/envs.js";
import { resolveOrigin } from "../helpers/origin.js";
import { requestLang } from "../meta/langs.js";
import { devicePairPage } from "./device-pair-page.js";
import * as users from "../security/users.js";
import { normalizeDeviceKey } from "../security/pairing.js";
import debug from "../debug.js";
import * as enrollTokens from "../security/enroll-tokens.js";
import { deviceCode } from "../security/pairing-link.js";
import { latestBuild, publishedNroPath } from "./client-update.js";
import { zipStore } from "../helpers/zip-store.js";
import fs from "node:fs";

const JSQR_PATH = createRequire(import.meta.url).resolve("jsqr/dist/jsQR.js");
const TOKEN_RE = /^[a-f0-9]{32}$/;

/** Who approves: the signed-in shop account, else the admin. A console's own key never does. */
export function approverOf(req) {
  if (req.auth?.user) return req.auth.user;
  if (req.pairedDevice) return null;
  return hasValidSession(req) ? "admin" : null;
}

/**
 * Whether a console approved by `addedBy` is this approver's own. A shop account
 * never owns the markers the server writes for other approvals ("admin",
 * "auto", "telegram"), whatever it is called; only the admin's own session owns "admin".
 */
export function ownsApproval(req, approver, addedBy) {
  if (!approver || addedBy !== approver) return false;
  if (!users.SYSTEM_APPROVERS.has(addedBy)) return true;
  return addedBy === "admin" && !req.auth?.user;
}

/**
 * A change made from the browser: someone to act as, and the same origin (the
 * browser sends its session cookie on its own, so anything cross-site is refused).
 * Returns the approver, or null after answering.
 */
function guardWrite(req, res) {
  res.set("Cache-Control", "no-store");
  const approver = approverOf(req);
  if (!approver) {
    res.status(401).json({ error: "sign in first" });
    return null;
  }
  const origin = req.get("Origin");
  if (!origin || origin !== resolveOrigin(req, publicBaseUrl)) {
    res.status(403).json({ error: "origin mismatch" });
    return null;
  }
  return approver;
}

/** The downloads of the client, for a list: no token, the console only by its code. */
export const clientRows = (filter) =>
  enrollTokens.list(filter).map(({ deviceKey, ...row }) => ({ ...row, code: deviceKey ? deviceCode(deviceKey) : null }));

function mountMineApi(router) {
  const json = express.json({ limit: "4kb" });

  router.get("/api/mine", (req, res) => {
    res.set("Cache-Control", "no-store");
    const approver = approverOf(req);
    if (!approver) return res.status(401).json({ error: "sign in first" });
    const devices = store.devicesSnapshot().approved
      .filter((d) => ownsApproval(req, approver, d.addedBy))
      .map(({ deviceKey, label, addedAt }) => ({ deviceKey, label, addedAt }));
    res.json({ devices, clients: clientRows({ owner: approver }) });
  });

  router.post("/api/client-bundle", async (req, res) => {
    const approver = guardWrite(req, res);
    if (!approver) return;
    if (!devicePairing) return res.status(409).json({ error: "device pairing is off on this server" });
    const origin = resolveOrigin(req, publicBaseUrl);
    if (!origin) return res.status(503).json({ error: "server origin unavailable" });
    const build = await latestBuild().catch(() => null);
    if (!build) return res.status(404).json({ error: "no client build on this server" });
    let nro;
    try {
      nro = await fs.promises.readFile(publishedNroPath());
    } catch {
      return res.status(404).json({ error: "no client build on this server" });
    }
    const { token, id, expiresAt } = enrollTokens.issue(approver);
    const config = {
      servers: [{ title: new URL(origin).hostname, url: origin, username: "", password: "", enrollToken: token, cfClientId: "", cfClientSecret: "", enabled: true }],
      language: requestLang(req),
      installTarget: "sd",
    };
    const zip = zipStore([
      { name: "switch/cookingfoil/cookingfoil.nro", data: nro },
      { name: "switch/cookingfoil/config.json", data: Buffer.from(JSON.stringify(config, null, 2) + "\n") },
    ]);
    debug.log("pair: %s downloaded the client %s (download %s)", approver, build.version, id);
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="CookingFoil-${String(build.version).replace(/[^0-9A-Za-z.-]/g, "")}.zip"`,
      "X-CookingFoil-Download-Id": id,
      "X-CookingFoil-Expires-At": String(expiresAt),
    });
    res.send(zip);
  });

  router.post("/api/clients/:id/revoke", (req, res) => {
    const approver = guardWrite(req, res);
    if (!approver) return;
    if (!/^[0-9a-f]{8}$/.test(req.params.id) || !enrollTokens.revoke(req.params.id, { owner: approver })) return res.status(404).json({ error: "no such download waiting" });
    res.json({ ok: true });
  });

  router.post("/api/devices/revoke", json, (req, res) => {
    const approver = guardWrite(req, res);
    if (!approver) return;
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    const mine = deviceKey && store.devicesSnapshot().approved.some((d) => d.deviceKey === deviceKey && ownsApproval(req, approver, d.addedBy));
    if (!mine) return res.status(404).json({ error: "no such device" });
    store.revokeDevice(deviceKey);
    res.json({ ok: true });
  });
}

function pageHeaders(res) {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    // The site-wide policy turns the camera off; this page is the one place that scans.
    "Permissions-Policy": "camera=(self), geolocation=(), microphone=()",
  });
}

export default function devicePairRouter() {
  const router = express.Router();

  // QR approval needs COOK_DEVICE_PAIRING; device logins need shop accounts.
  const qrOnly = (req, res, next) => (devicePairing ? next() : res.status(404).type("text/plain").send("not found"));
  router.use((req, res, next) => {
    if (!devicePairing && !users.hasUsers()) return res.status(404).type("text/plain").send("not found");
    next();
  });

  router.get("/qr.js", qrOnly, (req, res) => {
    res.set("Cache-Control", "public, max-age=86400");
    res.type("application/javascript").sendFile(JSQR_PATH);
  });

  router.get("/", (req, res) => {
    pageHeaders(res);
    const approver = approverOf(req);
    res.type("html").send(devicePairPage({
      view: approver ? "scan" : "signin", lang: requestLang(req), approver, pairing: devicePairing,
    }));
  });

  mountMineApi(router);

  router.get("/:token", qrOnly, (req, res, next) => {
    if (!TOKEN_RE.test(req.params.token)) return next();
    pageHeaders(res);
    const lang = requestLang(req);
    const approver = approverOf(req);
    const link = readPairLink(req.params.token);
    if (!link) return res.status(410).type("html").send(devicePairPage({ view: "expired", lang }));
    const done = link.used || store.isDeviceApproved(link.deviceKey);
    // No account to approve as: the admin page's own QR screen signs the admin in inline.
    if (!done && !approver) return res.redirect(302, `/admin/pair/${req.params.token}`);
    res.type("html").send(devicePairPage({ view: done ? "done" : "confirm", lang, code: link.code, approver }));
  });

  router.post("/approve", qrOnly, express.json({ limit: "4kb" }), (req, res) => {
    const approver = guardWrite(req, res);
    if (!approver) return;
    let token = req.body?.token;
    if (token === undefined && req.body?.code !== undefined) {
      const link = findPairLinkByCode(req.body.code);
      if (!link) return res.status(404).json({ error: "no device is waiting with that code" });
      token = link.token;
    }
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return res.status(400).json({ error: "token or code required" });
    const result = approvePairLink(token, { label: req.body?.label, addedBy: approver });
    if (result === "expired") return res.status(410).json({ error: "pair link expired" });
    if (result === "used") return res.status(409).json({ error: "pair link already approved" });
    debug.log("pair: %s approved a device", approver);
    res.json({ ok: true });
  });

  return router;
}
