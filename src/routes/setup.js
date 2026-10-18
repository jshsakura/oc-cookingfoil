/**
 * First-run setup (see security/setup.js):
 *
 *   GET  /setup                   the setup page
 *   POST /setup/api/unlock        { code }            the code from the container log → setup cookie
 *   POST /setup/api/account       { name, password }  the first admin account; signs it in
 *   POST /setup/api/otp/start     → { secret, uri, qr } a candidate authenticator secret
 *   POST /setup/api/otp/confirm   { code }            registers it and opens /admin
 *
 * While the server has no account, a browser asking for /, /login or /admin is
 * sent here. Clients that don't ask for HTML (the console client, scripts) are not. Until the admin
 * gate holds something the operator proved (security/setup.js adminAwaitsSetup),
 * every /admin request is sent here or refused, whatever it asks for.
 */
import crypto from "crypto";
import express from "express";
import { renderSVG } from "uqr";
import * as setup from "../security/setup.js";
import * as users from "../security/users.js";
import * as store from "../security/store.js";
import { lockoutRetryAfter, tooManyRequests } from "../security/retry-after.js";
import { cookieLine, cookies, issuePasswordSession } from "../security/user-session.js";
import { codeMatches as totpMatches, issueSession, provisioningUri } from "../security/admin-session.js";
import { startEnrollment, pendingSecret, commitEnrollment } from "../security/admin-secret.js";
import { recordFailure } from "../security/auth-guard.js";
import { clientIp } from "../security/deny.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import { setupPage } from "./setup-page.js";
import debug from "../debug.js";

const COOKIE = "cf_setup";
const TOKEN_MS = 30 * 60 * 1000;
const tokens = new Map(); // token → expiry

const wantsHtml = (req) => (req.headers.accept || "").includes("text/html");

function hasToken(req) {
  const t = cookies(req)[COOKIE];
  const until = t && tokens.get(t);
  return Boolean(until && until > Date.now());
}

/** One step of setup: open, same origin, unlocked with the code. */
function guard(req, res, { unlocked = true } = {}) {
  res.set("Cache-Control", "no-store");
  if (!setup.setupOpen()) return res.status(410).json({ error: "setup-closed" }), false;
  const origin = req.get("Origin");
  if (origin && origin !== resolveOrigin(req, publicBaseUrl)) return res.status(403).json({ error: "origin" }), false;
  if (unlocked && !hasToken(req)) return res.status(401).json({ error: "locked" }), false;
  return true;
}

export default function setupRouter() {
  const router = express.Router();

  router.get(["/", "/login", "/admin", "/admin/"], (req, res, next) => {
    if (setup.needsSetup() && wantsHtml(req)) return res.redirect(302, "/setup");
    next();
  });

  // The setup code is the only way in until setup has made the first admin (see adminAwaitsSetup).
  router.use("/admin", (req, res, next) => {
    if (!setup.adminAwaitsSetup()) return next();
    res.set("Cache-Control", "no-store");
    if (req.method === "GET" && wantsHtml(req)) return res.redirect(302, "/setup");
    res.status(403).json({ error: "setup-required" });
  });

  router.get("/setup", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
    if (!setup.setupOpen()) return res.redirect(302, "/admin");
    const step = !hasToken(req) ? "code" : setup.needsSetup() ? "account" : "otp";
    res.type("html").send(setupPage({ step, lang: req.acceptsLanguages("ko", "en", "ja", "zh") || "en" }));
  });

  router.use("/setup/api", express.json({ limit: "4kb" }));

  router.post("/setup/api/unlock", (req, res) => {
    if (!guard(req, res, { unlocked: false })) return;
    const ip = clientIp(req);
    if (store.isLocked(ip)) return tooManyRequests(res, lockoutRetryAfter(ip)).json({ error: "locked-out" });
    if (!setup.codeMatches(req.body?.code)) {
      recordFailure(ip, req);
      return res.status(401).json({ error: "bad-code" });
    }
    store.clearFailure(ip);
    const token = crypto.randomBytes(24).toString("base64url");
    tokens.set(token, Date.now() + TOKEN_MS);
    res.append("Set-Cookie", cookieLine(req, COOKIE, token, { maxAgeMs: TOKEN_MS, path: "/setup" }));
    res.json({ ok: true, next: setup.needsSetup() ? "account" : "otp" });
  });

  router.post("/setup/api/account", (req, res) => {
    if (!guard(req, res)) return;
    if (!setup.needsSetup()) return res.status(409).json({ error: "exists" });
    const name = String(req.body?.name ?? "").trim();
    const password = String(req.body?.password ?? "");
    try {
      users.add(name, password, "admin");
    } catch (err) {
      if (err instanceof users.UserError) return res.status(400).json({ error: err.code });
      throw err;
    }
    debug.log("setup: first admin account %s created", name);
    issuePasswordSession(req, res, name);
    const next = setup.needsAuthenticator() ? "otp" : "done";
    if (next === "done") {
      setup.finish();
      issueSession(res);
    }
    res.json({ ok: true, next });
  });

  router.post("/setup/api/otp/start", async (req, res) => {
    if (!guard(req, res)) return;
    if (setup.needsSetup() || !setup.needsAuthenticator()) return res.status(409).json({ error: "not-now" });
    const secret = startEnrollment();
    const uri = await provisioningUri(secret);
    res.json({ secret, uri, qr: uri ? renderSVG(uri, { border: 2 }) : null });
  });

  router.post("/setup/api/otp/confirm", async (req, res) => {
    if (!guard(req, res)) return;
    const secret = pendingSecret();
    if (!secret) return res.status(410).json({ error: "expired" });
    if (!(await totpMatches(secret, req.body?.code))) return res.status(400).json({ error: "bad-otp" });
    commitEnrollment();
    setup.finish();
    tokens.clear();
    issueSession(res);
    debug.log("setup: authenticator registered, setup finished");
    res.json({ ok: true, next: "done" });
  });

  return router;
}
