/**
 * Who is using /admin, and whether that account may.
 *
 * With accounts on the server, /admin is for admin accounts only: signed in at
 * /login (ID and password, or a Google account made admin) or, for scripts,
 * sending Basic. The admin's own password or authenticator code is still asked
 * on top. A server with no accounts has nobody to check and keeps that gate alone.
 */
import * as users from "./users.js";
import * as googleAccounts from "./google-accounts.js";

/** { kind: "password", name } | { kind: "google", sub, email } | null */
export function adminActor(req) {
  if (req.deviceLogin || req.pairedDevice) return null;
  if (req.webUser?.kind === "google") return { kind: "google", sub: req.webUser.sub, email: req.webUser.email };
  const name = req.webUser?.kind === "password" ? req.webUser.name : req.auth?.user;
  return name ? { kind: "password", name } : null;
}

export function mayAdminister(req) {
  if (!users.hasUsers()) return true;
  const actor = adminActor(req);
  if (actor?.kind === "google") return googleAccounts.isAdmin(actor.sub);
  return Boolean(actor) && users.isAdmin(actor.name);
}

/** Whether a change aims at the account making it. */
export const isSelf = (req, kind, id) => {
  const actor = adminActor(req);
  return Boolean(actor) && actor.kind === kind && (kind === "google" ? actor.sub === id : actor.name === id);
};
