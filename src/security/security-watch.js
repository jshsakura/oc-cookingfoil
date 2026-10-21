/**
 * The "보안 감시" alerts:
 *
 *   noteFailure   someone has got the password wrong half as often as the lockout allows:
 *                 warned once per address, before the lockout lands
 *   sendDigest    every DIGEST_HOURS, what happened since: failed sign-ins, locked
 *                 addresses, refused requests. Nothing is sent for a quiet stretch.
 */
import * as store from "./store.js";
import { alert } from "../helpers/alerts.js";
import { maxAuthFailures } from "./limits.js";

export const DIGEST_HOURS = 6;
const DIGEST_MS = DIGEST_HOURS * 60 * 60 * 1000;

/** The failure count that earns a warning: half the budget, when the budget leaves room for one. Pure. */
export function warnAt(max = maxAuthFailures) {
  return max >= 3 ? Math.ceil(max / 2) : null;
}

export function noteFailure(ip, count, path, max = maxAuthFailures) {
  if (count !== warnAt(max)) return false;
  return alert("security", (t) => t("securityTrying", { ip, place: store.addressPlace(ip, t), count, max, path }), { subject: `trying:${ip}` });
}

/** What the last `hours` held, from the audit trail and the refusals. */
export function summary(now = Date.now(), hours = DIGEST_HOURS) {
  const since = now - hours * 60 * 60 * 1000;
  const audit = store.auditSince(since);
  const byIp = new Map();
  for (const e of audit) if (e.kind === "auth-fail") byIp.set(e.ip, (byIp.get(e.ip) ?? 0) + 1);
  const fails = [...byIp.values()].reduce((a, b) => a + b, 0);
  const [topIp, topCount] = [...byIp].sort((a, b) => b[1] - a[1])[0] ?? [];
  return {
    hours,
    fails,
    ips: byIp.size,
    locks: audit.filter((e) => e.kind === "lockout").length,
    locked: store.snapshot().lockouts.length,
    denied: store.denialsSnapshot({ limit: Infinity, sinceMs: hours * 60 * 60 * 1000 }).recent.length,
    top: topIp ? `${topIp} (${topCount})` : "",
  };
}

export function sendDigest(now = Date.now()) {
  const s = summary(now);
  if (!s.fails && !s.locks) return null;
  alert("security", (t) => t("securityDigest", s), { subject: `digest:${Math.floor(now / DIGEST_MS)}`, now });
  return s;
}

let timer = null;
export function start() {
  if (timer) return;
  timer = setInterval(() => sendDigest(), DIGEST_MS);
  timer.unref?.();
}
