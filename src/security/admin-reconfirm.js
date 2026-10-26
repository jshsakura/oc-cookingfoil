/**
 * Asks the admin to prove it is them again before something that runs new code on the server.
 *
 *   reconfirmKind(req)               "password" | "totp" | "unavailable" | "none"
 *   reconfirm(req, { password, code })   { ok: true } | { ok: false, reason: "wrong" | "locked" | "unavailable", retryAfter? }
 *
 * What is asked, in this order:
 *   an account signed in with ID and password         that account's password
 *   an admin password is set (COOK_ADMIN_PASSWORD or on the page)   the admin password
 *   accounts exist but this admin has no password to give (a Google admin)   "unavailable": set an admin password first
 *   a Google admin on a server with no accounts and no admin password   "unavailable" too, for the same reason
 *   an authenticator is set up                        a code from it
 *   nothing guards /admin at all                      "none": there is no gate to repeat
 * Attempts are counted before they are checked, so many at once cannot all pass on a count that was
 * read before the first of them finished: FAIL_LIMIT in WINDOW_MS locks asking for that long.
 */
import { adminActor } from "./admin-actor.js";
import { adminSecret, isEnrolled } from "./admin-secret.js";
import { adminPasswordMode, codeMatches, verifyPassword } from "./admin-session.js";
import * as users from "./users.js";

export const FAIL_LIMIT = 5;
export const WINDOW_MS = 10 * 60_000;
const tries = new Map(); // actor key -> { count, since }

const keyOf = (req) => {
  const a = adminActor(req);
  return a ? `${a.kind}:${a.name ?? a.sub}` : "anonymous";
};

export function reconfirmKind(req) {
  const actor = adminActor(req);
  if (actor?.kind === "password" && users.hasUsers()) return "password";
  if (adminPasswordMode()) return "password";
  if (users.hasUsers() || actor?.kind === "google") return "unavailable";
  return isEnrolled() ? "totp" : "none";
}

export function resetReconfirm() { tries.clear(); }

export async function reconfirm(req, { password, code } = {}, now = Date.now()) {
  const kind = reconfirmKind(req);
  if (kind === "none") return { ok: true };
  if (kind === "unavailable") return { ok: false, reason: "unavailable" };

  const key = keyOf(req);
  const kept = tries.get(key);
  const window = kept && now - kept.since < WINDOW_MS ? kept : { count: 0, since: now };
  if (window.count >= FAIL_LIMIT) return { ok: false, reason: "locked", retryAfter: Math.ceil((window.since + WINDOW_MS - now) / 1000) };
  // Counted now, forgiven on success: a check that is still running already counts against the limit.
  window.count++;
  tries.set(key, window);

  let ok;
  if (kind === "totp") ok = await codeMatches(adminSecret(), code, 1);
  else if (adminActor(req)?.kind === "password" && users.hasUsers()) ok = await users.verifyAsync(adminActor(req).name, password);
  else ok = typeof password === "string" && verifyPassword(password);

  if (!ok) return { ok: false, reason: "wrong" };
  window.count = Math.max(0, window.count - 1);
  if (window.count === 0) tries.delete(key);
  return { ok: true };
}
