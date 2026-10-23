/**
 * Where consoles and accounts connected from, for the admin page only.
 *
 *   GET /admin/api/access-history?device=<deviceKey>   { device, days: [{ day, n, ips: [{ ip, n }], other }] } newest day first
 *   GET /admin/api/access-history?account=<owner>      { account, logins: [{ at, method, ip }] } newest first
 *     owner is a password account's name, or "google:<sub>".
 *
 * Automation tokens may not read it (TOKEN_BLOCKED_READ_RE), and the lists the
 * admin page shares with them leave the addresses out (withoutIps).
 */
import * as store from "../../security/store.js";
import { normalizeDeviceKey } from "../../security/pairing.js";

const OWNER_MAX = 200;

/** A user or console row without the addresses it was seen from, for an automation token. Pure. */
export function withoutIps(row) {
  const { lastIp, ips, lastLoginIp, ...rest } = row;
  return rest;
}

export function mountAccessHistoryApi(router, requireSession) {
  router.get("/api/access-history", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (typeof req.query.device === "string") {
      const device = normalizeDeviceKey(req.query.device);
      const days = device ? store.deviceIpHistory(device) : null;
      if (!days) return res.status(404).json({ error: "no such device" });
      return res.json({ device, days });
    }
    if (typeof req.query.account === "string" && req.query.account && req.query.account.length <= OWNER_MAX) {
      return res.json({ account: req.query.account, logins: store.loginHistory(req.query.account) });
    }
    res.status(400).json({ error: "device or account required" });
  });
}
