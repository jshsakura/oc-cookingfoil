/**
 * The download records (helpers/transfer-log.js) for the admin page.
 *
 *   GET /admin/api/transfers?route=<tunnel|direct|lan|other>&limit=<1..500>
 *     { active, recent, total, summary, quietSeconds }
 *     active   transfers still open, with their bytes and speed so far
 *     recent   finished ones, newest first (only that route when one is named)
 *     summary  the last 24 hours per route: { count, medianMbps, bestMbps }
 */
import transferLog, { ROUTES, MAX_RECENT } from "../../helpers/transfer-log.js";

export function mountTransfersApi(router, requireSession, log = transferLog) {
  router.get("/api/transfers", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const route = ROUTES.includes(req.query.route) ? req.query.route : null;
    const n = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(n) ? Math.min(MAX_RECENT, Math.max(1, n)) : 200;
    res.json(log.snapshot({ route, limit }));
  });
}
