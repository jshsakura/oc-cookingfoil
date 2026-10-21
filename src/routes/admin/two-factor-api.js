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
 * half-finished enrollment never locks anyone out.
 */
import { renderSVG } from "uqr";
import { adminPasswordMode, codeMatches, provisioningUri, verifyPassword } from "../../security/admin-session.js";
import * as savedPassword from "../../security/admin-password.js";
import * as twoFactorSkip from "../../security/admin-2fa-skip.js";
import { adminPassword } from "../../helpers/envs.js";
import {
  isEnrolled, canManage, startEnrollment, pendingSecret, commitEnrollment, disableEnrollment,
} from "../../security/admin-secret.js";
import { resolveOrigin } from "../../helpers/origin.js";
import { publicBaseUrl } from "../../helpers/envs.js";
import debug from "../../debug.js";

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
    if (req.apiToken) return res.status(403).json({ error: "automation tokens cannot change the admin login" });
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

  // The admin password set here: a password already in force must be given to change or remove it.
  router.post("/api/admin-password", guarded((req, res) => {
    if (adminPasswordMode() && !verifyPassword(req.body?.current)) {
      res.status(403).json({ error: "지금 비밀번호가 맞지 않습니다" });
      return;
    }
    const next = req.body?.password;
    if (typeof next !== "string" || next.length < savedPassword.MIN_LENGTH || next.length > savedPassword.MAX_LENGTH) {
      res.status(400).json({ error: `새 비밀번호는 ${savedPassword.MIN_LENGTH}자 이상 ${savedPassword.MAX_LENGTH}자 이하입니다` });
      return;
    }
    savedPassword.set(next);
    debug.log("admin: admin password changed on the admin page");
    res.json(status());
  }));

  router.post("/api/admin-password/clear", guarded((req, res) => {
    if (!savedPassword.has()) {
      res.status(404).json({ error: "여기서 정한 비밀번호가 없습니다" });
      return;
    }
    // Without an authenticator or a compose password, this password is the only way in.
    if (!isEnrolled() && !adminPassword) {
      res.status(409).json({ error: "인증 앱을 먼저 등록해야 비밀번호를 지울 수 있습니다" });
      return;
    }
    if (!verifyPassword(req.body?.current)) {
      res.status(403).json({ error: "지금 비밀번호가 맞지 않습니다" });
      return;
    }
    savedPassword.clear();
    debug.log("admin: admin password removed on the admin page");
    res.json(status());
  }));

  router.post("/api/2fa/disable", guarded((_req, res) => {
    // Without an admin password the authenticator is the only lock; keep it.
    if (!adminPasswordMode()) {
      res.status(409).json({ error: "관리자 비밀번호를 먼저 정해야 인증 앱을 끌 수 있습니다" });
      return;
    }
    disableEnrollment();
    res.json(status());
  }));
}
