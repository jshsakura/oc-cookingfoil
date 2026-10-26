/**
 * Asks the admin for their password again before something that runs new code on the server.
 *
 *   reconfirm(req, password) -> { ok: true } | { ok: false, reason: "wrong" | "locked" | "unavailable", retryAfter? }
 *
 * Who is asked: an account signed in with ID and password gives that account's password; anyone else (a
 * Google admin, a token, a server with an admin password and no accounts) gives the admin password. A
 * Google admin on a server with no admin password has nothing to give: "unavailable", and the page says
 * to set one. A server with no accounts and no admin password has no gate to repeat and passes.
 * Failures are counted per actor: FAIL_LIMIT in WINDOW_MS locks asking for that long.
 */
import { adminActor } from "./admin-actor.js";
import { adminPasswordMode, verifyPassword } from "./admin-session.js";
import * as users from "./users.js";

export const FAIL_LIMIT = 5;
export const WINDOW_MS = 10 * 60_000;
const fails = new Map(); // actor key -> { count, since }

const keyOf = (req) => {
  const a = adminActor(req);
  return a ? `${a.kind}:${a.name ?? a.sub}` : "anonymous";
};

/** What switching a plugin on will ask of this admin: "password", "unavailable" (nothing to give) or "none" (no gate to repeat). */
export function reconfirmKind(req) {
  const actor = adminActor(req);
  if (actor?.kind === "password" && users.hasUsers()) return "password";
  if (adminPasswordMode()) return "password";
  return users.hasUsers() ? "unavailable" : "none";
}

export function resetReconfirm() { fails.clear(); }

export async function reconfirm(req, password, now = Date.now()) {
  const key = keyOf(req);
  const f = fails.get(key);
  if (f && now - f.since < WINDOW_MS && f.count >= FAIL_LIMIT) return { ok: false, reason: "locked", retryAfter: Math.ceil((f.since + WINDOW_MS - now) / 1000) };

  const actor = adminActor(req);
  let ok;
  if (actor?.kind === "password" && users.hasUsers()) ok = await users.verifyAsync(actor.name, password);
  else if (adminPasswordMode()) ok = typeof password === "string" && verifyPassword(password);
  else if (users.hasUsers()) return { ok: false, reason: "unavailable" };
  else return { ok: true };

  if (ok) {
    fails.delete(key);
    return { ok: true };
  }
  const fresh = f && now - f.since < WINDOW_MS ? f : { count: 0, since: now };
  fails.set(key, { count: fresh.count + 1, since: fresh.since });
  return { ok: false, reason: "wrong" };
}
