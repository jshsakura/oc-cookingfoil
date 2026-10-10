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
import { adminPasswordMode, codeMatches, provisioningUri } from "../../security/admin-session.js";
import {
  isEnrolled, canManage, startEnrollment, pendingSecret, commitEnrollment, disableEnrollment,
} from "../../security/admin-secret.js";
import { resolveOrigin } from "../../helpers/origin.js";
import { publicBaseUrl } from "../../helpers/envs.js";
import debug from "../../debug.js";

function status() {
  return { password: adminPasswordMode(), authenticator: isEnrolled(), manageable: canManage() };
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
      res.status(410).json({ error: "enrollment expired, start again" });
      return;
    }
    if (!(await codeMatches(secret, req.body?.code))) {
      res.status(400).json({ error: "code does not match" });
      return;
    }
    commitEnrollment();
    res.json(status());
  }));

  router.post("/api/2fa/disable", guarded((_req, res) => {
    // Without an admin password the authenticator is the only lock; keep it.
    if (!adminPasswordMode()) {
      res.status(409).json({ error: "set COOK_ADMIN_PASSWORD before turning the authenticator off" });
      return;
    }
    disableEnrollment();
    res.json(status());
  }));
}
