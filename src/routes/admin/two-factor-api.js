/**
 * Admin login settings, managed from the admin page itself:
 *
 *   GET  /admin/api/2fa          how the page is locked: password, authenticator, or both
 *   POST /admin/api/2fa/start    a new candidate secret: { secret, uri, qr (SVG) }
 *   POST /admin/api/2fa/confirm  { code } from the app → the candidate becomes the live secret
 *   POST /admin/api/2fa/disable  turn the authenticator off (only with an admin password)
 *
 * Every call needs a valid admin session; changes also need a same-origin
 * request. The live secret keeps working until a candidate is confirmed, so a
 * half-finished enrollment never locks anyone out. Automation tokens are refused all of
 * these (tokenBlocked() in routes/admin-page.js).
 */
import { renderSVG } from "uqr";
import { adminPasswordMode, codeMatches, provisioningUri, verifyPassword } from "../../security/admin-session.js";
import * as savedPassword from "../../security/admin-password.js";
import * as twoFactorSkip from "../../security/admin-2fa-skip.js";
import { adminPassword } from "../../helpers/envs.js";
import {
  adminSecret, isEnrolled, canManage, startEnrollment, pendingSecret, commitEnrollment, disableEnrollment,
} from "../../security/admin-secret.js";
import * as totpGuard from "../../security/totp-guard.js";
import { clientIp } from "../../security/deny.js";
import { resolveOrigin } from "../../helpers/origin.js";
import { publicBaseUrl } from "../../helpers/envs.js";
import debug from "../../debug.js";
import { apiWord } from "./api-words.js";

// Sign-in codes are counted against one admin account, as on the sign-in page (routes/admin-page.js).
const TOTP_ACCOUNT = "admin";

function status() {
  return {
    password: adminPasswordMode(), passwordSaved: savedPassword.has(), passwordEnv: Boolean(adminPassword),
    authenticator: isEnrolled(), manageable: canManage(), skipped: twoFactorSkip.skipped() && !isEnrolled(),
  };
}

export function mountTwoFactorApi(router, { requireSession }) {
  const sameOrigin = (req, res) => {
    const origin = req.get("Origin");
    if (!origin || origin === resolveOrigin(req, publicBaseUrl)) return true;
    res.status(403).json({ error: "origin mismatch" });
    return false;
  };
  const guarded = (handler, { write = true } = {}) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!requireSession(req, res) || (write && !sameOrigin(req, res))) return;
    try {
      await handler(req, res);
    } catch (err) {
      debug.error("admin 2fa: %s", err.message);
      res.status(409).json({ error: err.message });
    }
  };

  router.get("/api/2fa", guarded((_req, res) => res.json(status()), { write: false }));

  router.post("/api/2fa/start", guarded(async (_req, res) => {
    const secret = startEnrollment();
    const uri = await provisioningUri(secret);
    res.json({ secret, uri, qr: uri ? renderSVG(uri, { border: 2 }) : null });
  }));

  router.post("/api/2fa/confirm", guarded(async (req, res) => {
    const secret = pendingSecret();
    if (!secret) {
      debug.log("admin 2fa: enrollment code arrived with no enrollment in progress");
      res.status(410).json({ error: "enrollment expired, start again" });
      return;
    }
    // A phone clock a minute off still enrolls; sign-in keeps the tighter window.
    if (!(await codeMatches(secret, req.body?.code, 2))) {
      debug.log("admin 2fa: enrollment code did not match");
      res.status(400).json({ error: "code does not match" });
      return;
    }
    commitEnrollment();
    twoFactorSkip.clear();
    res.json(status());
  }));

  // The password in force, or a code from the authenticator when one is set up, so a forgotten
  // password can be replaced. Wrong codes count toward the sign-in code lockout.
  const provesAdmin = async (req) => {
    const given = req.body?.current;
    if (await verifyPassword(given)) return true;
    if (!isEnrolled() || typeof given !== "string" || !/^\d{6}$/.test(given.trim())) return false;
    const ip = clientIp(req);
    if (totpGuard.lockedFor(TOTP_ACCOUNT, ip)) return false;
    if (await codeMatches(adminSecret(), given.trim(), 1)) { totpGuard.reset(TOTP_ACCOUNT, ip); return true; }
    totpGuard.recordFailure(TOTP_ACCOUNT, ip);
    return false;
  };

  // The admin password set here: the one in force (or an authenticator code) must be given to change or remove it.
  router.post("/api/admin-password", guarded(async (req, res) => {
    if (adminPasswordMode() && !(await provesAdmin(req))) {
      res.status(403).json({ error: apiWord(req, "password.wrong") });
      return;
    }
    const next = req.body?.password;
    if (typeof next !== "string" || next.length < savedPassword.MIN_LENGTH || next.length > savedPassword.MAX_LENGTH) {
      res.status(400).json({ error: apiWord(req, "password.length", { min: savedPassword.MIN_LENGTH, max: savedPassword.MAX_LENGTH }) });
      return;
    }
    savedPassword.set(next);
    debug.log("admin: admin password changed on the admin page");
    res.json(status());
  }));

  router.post("/api/admin-password/clear", guarded(async (req, res) => {
    if (!savedPassword.has()) {
      res.status(404).json({ error: apiWord(req, "password.none") });
      return;
    }
    // Without an authenticator or a compose password, this password is the only way in.
    if (!isEnrolled() && !adminPassword) {
      res.status(409).json({ error: apiWord(req, "password.needTotp") });
      return;
    }
    if (!(await provesAdmin(req))) {
      res.status(403).json({ error: apiWord(req, "password.wrong") });
      return;
    }
    savedPassword.clear();
    debug.log("admin: admin password removed on the admin page");
    res.json(status());
  }));

  router.post("/api/2fa/disable", guarded((req, res) => {
    // Without an admin password the authenticator is the only lock; keep it.
    if (!adminPasswordMode()) {
      res.status(409).json({ error: apiWord(req, "totp.needPassword") });
      return;
    }
    disableEnrollment();
    res.json(status());
  }));
}
