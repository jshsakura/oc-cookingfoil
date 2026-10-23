/**
 * Safe restart from the admin page:
 *
 *   GET  /admin/api/server/status    { draining, restartId, startedAt, backBy, retryAfter, graceSeconds, inflight, downloads }
 *   GET  /admin/api/activity         { running, recent }: what the server is doing (tasks/activity.js); the page
 *                                    gets the same over /admin/ws and reads this only while that is down
 *   POST /admin/api/activity/:id/cancel  asks a running job that can be stopped to stop: { ok: true },
 *                                    404 when it is not running or cannot be stopped
 *   POST /admin/api/server/restart   answers 202, then drains and exits with code 75 (security/drain.js
 *                                    RESTART_EXIT_CODE), so restart: always and Restart=on-failure both start it again
 *
 * Automation tokens may read the status but not restart (admin-page.js TOKEN_BLOCKED_RE).
 *
 * The status holds counts only: no addresses, keys or accounts. Both paths stay
 * open while the server drains (security/drain.js), so the page can watch it.
 */
import defaultDrainer from "../../security/drain.js";
import { resolveOrigin } from "../../helpers/origin.js";
import { publicBaseUrl } from "../../helpers/envs.js";
import * as defaultActivity from "../../tasks/activity.js";
import debug from "../../debug.js";
import { hasValidSession } from "../../security/admin-session.js";
import { apiWord } from "./api-words.js";

export function mountServerApi(router, requireSession, { drainer = defaultDrainer, activity = defaultActivity } = {}) {
  // The router already checks the admin account. Probe the second step without a denial log.
  router.get("/api/activity/access", (req, res) => {
    res.set("Cache-Control", "no-store").json({ canCancel: hasValidSession(req) });
  });
  router.get("/api/activity", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").json(activity.list());
  });

  router.post("/api/activity/:id/cancel", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (!activity.cancel(String(req.params.id))) return res.status(404).json({ error: "not-cancellable", message: apiWord(req, "server.notCancellable") });
    debug.log("admin: job %s asked to stop", req.params.id);
    res.json({ ok: true });
  });

  router.get("/api/server/status", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").json({ ...drainer.status(), uptime: Math.round(process.uptime()) });
  });

  router.post("/api/server/restart", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, publicBaseUrl)) return res.status(403).json({ error: "origin mismatch" });
    if (!drainer.hasRestartHandler()) return res.status(503).json({ error: apiWord(req, "server.noRestart") });
    // The answer goes out before the drain starts, so this request is never the one waited for.
    res.once("finish", () => setImmediate(() => {
      debug.log("admin: safe restart requested");
      drainer.requestRestart();
    }));
    res.status(202).json({ ok: true, message: apiWord(req, "server.restarting"), ...drainer.status() });
  });
}
