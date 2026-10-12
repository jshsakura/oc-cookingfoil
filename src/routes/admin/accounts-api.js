/**
 * Google sign-in accounts, for the admin to approve.
 *
 *   GET  /admin/api/accounts                  { enabled, accounts: [{ sub, email, status, createdAt, approvedAt, lastAt }] }
 *   POST /admin/api/accounts/status  { sub, status: "approved" | "disabled" | "pending" }
 *   POST /admin/api/accounts/remove  { sub }
 *
 * Google sign-in settings (applied at once, no restart). The secret is write-only:
 * no answer carries it, only whether one is set.
 *   GET  /admin/api/google           { enabled, active, clientId, hasSecret, source, redirectUri }
 *   POST /admin/api/google           { enabled, clientId, clientSecret? }   an empty secret keeps the saved one
 *   POST /admin/api/google/clear     forget the id and secret
 */
import * as accounts from "../../security/google-accounts.js";
import * as googleConfig from "../../security/google-config.js";
import { callbackUri } from "../web-login.js";
import debug from "../../debug.js";

export function mountAccountsApi(router, requireSession) {
  router.get("/api/accounts", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ enabled: googleConfig.googleConfigured(), accounts: accounts.list() });
  });

  router.post("/api/accounts/status", (req, res) => {
    if (!requireSession(req, res)) return;
    const status = String(req.body?.status ?? "");
    if (!accounts.STATUSES.includes(status)) return res.status(400).json({ error: "invalid status" });
    if (!accounts.setStatus(String(req.body?.sub ?? ""), status)) return res.status(404).json({ error: "no such account" });
    debug.log("admin: a Google account is now %s", status);
    res.json({ ok: true });
  });

  router.post("/api/accounts/remove", (req, res) => {
    if (!requireSession(req, res)) return;
    if (!accounts.remove(String(req.body?.sub ?? ""))) return res.status(404).json({ error: "no such account" });
    res.json({ ok: true });
  });

  router.get("/api/google", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ ...googleConfig.describe(), redirectUri: callbackUri(req) });
  });

  router.post("/api/google", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      const saved = googleConfig.save({ enabled: req.body?.enabled === true, clientId: req.body?.clientId, clientSecret: req.body?.clientSecret });
      debug.log("admin: Google sign-in settings saved (%s)", saved.active ? "on" : "off");
      res.json({ ...saved, redirectUri: callbackUri(req) });
    } catch (err) {
      if (!(err instanceof googleConfig.GoogleConfigError)) throw err;
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/api/google/clear", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const cleared = googleConfig.clear();
    debug.log("admin: Google sign-in settings cleared");
    res.json({ ...cleared, redirectUri: callbackUri(req) });
  });
}
