/**
 * Google sign-in accounts, for the admin to approve.
 *
 *   GET  /admin/api/accounts                  { enabled, accounts: [{ sub, email, status, createdAt, approvedAt, lastAt }] }
 *   POST /admin/api/accounts/status  { sub, status: "approved" | "disabled" | "pending" }
 *   POST /admin/api/accounts/remove  { sub }
 */
import * as accounts from "../../security/google-accounts.js";
import { googleConfigured } from "../google-auth.js";
import debug from "../../debug.js";

export function mountAccountsApi(router, requireSession) {
  router.get("/api/accounts", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ enabled: googleConfigured(), accounts: accounts.list() });
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
}
