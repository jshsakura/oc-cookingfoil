/**
 * The account an approved console belongs to, read from its approval (store.js addedBy) on every
 * request rather than carried in a token: a new owner comes with a new access key, which already
 * ends the session and download tokens made before it (link-identity.js dstamp).
 *
 * This is a separate principal on purpose. It is never written into req.auth.user, which the web
 * routes read as a signed-in person (device-pair.js approverOf): a console proves only that it is
 * the account's console, not that the person is signed in.
 *
 *   { state: "bound", owner: { kind: "user" | "google", id, displayName }, active }
 *   { state: "unbound" }   approved by the admin, automatic approval or Telegram, so no account holds it
 *   null                   not an approved console
 */
import * as store from "./store.js";
import * as users from "./users.js";
import * as googleAccounts from "./google-accounts.js";
import { accountFull } from "./device-limit.js";

const GOOGLE = "google:";

/**
 * Whether `approver` (an account name, or "google:<sub>") holds the console approved by `addedBy`.
 * The markers the server writes for its own approvals ("admin", "auto", "telegram") are no
 * account's, the admin session's included, so such a console has no sends, wishlist or chat consoles.
 */
export const holds = (approver, addedBy) => Boolean(approver) && addedBy === approver && !users.SYSTEM_APPROVERS.has(addedBy);

/** The owner principal of `deviceKey`, as above. */
export function deviceOwner(deviceKey) {
  if (!deviceKey || !store.isDeviceApproved(deviceKey)) return null;
  const by = store.deviceAddedBy(deviceKey);
  if (!by || users.SYSTEM_APPROVERS.has(by)) return { state: "unbound" };
  if (by.startsWith(GOOGLE)) {
    const account = googleAccounts.accountOfOwner(by);
    const id = account?.sub ?? by.slice(GOOGLE.length);
    return { state: "bound", owner: { kind: "google", id, displayName: googleAccounts.maskEmail(account?.email) }, active: account?.status === "approved" };
  }
  return { state: "bound", owner: { kind: "user", id: by, displayName: by }, active: users.isActive(by) };
}

/**
 * Why a console is not let in, or null: "account-off" while the account holding it is turned off
 * (or a Google account waits or is refused), "account-gone" once it is removed, and "no-account"
 * for a console no account holds on a server that has accounts. The console keeps its key and its
 * record: it comes back when the account does, or once it is given to one (its re-pair QR, or the
 * admin's "link to an account"). A server without accounts has nobody to hold a console.
 */
export function suspension(deviceKey) {
  const o = deviceOwner(deviceKey);
  if (o?.state === "unbound") return users.hasUsers() || googleAccounts.list().length > 0 ? "no-account" : null;
  if (o?.state !== "bound" || o.active) return null;
  const known = o.owner.kind === "google" ? Boolean(googleAccounts.get(o.owner.id)) : users.list().some((u) => u.name === o.owner.id);
  return known ? "account-off" : "account-gone";
}

/** What a console is told about its own binding: no account id beyond the name it shows. Pure over deviceOwner. */
export function bindingOf(deviceKey) {
  const o = deviceOwner(deviceKey);
  if (!o) return null;
  return o.state === "bound" ? { bound: true, owner: { kind: o.owner.kind, displayName: o.owner.displayName } } : { bound: false };
}

/** The accounts a console may be given to: active password accounts and approved Google ones, as approvers. */
export function ownerChoices() {
  const people = users.list().filter((u) => u.enabled).map((u) => ({ owner: u.name, kind: "user", displayName: u.name }));
  const google = googleAccounts.list().filter((a) => a.status === "approved" && a.email).map((a) => ({ owner: googleAccounts.ownerOf(a.sub), kind: "google", displayName: a.email }));
  return [...people, ...google];
}

/**
 * The admin gives a console that no account holds to one, keeping its key, so nothing changes on the
 * console. Only an account-less console: moving one between accounts is the owner's QR re-pair.
 * @returns {{ ok: true } | { ok: false, code: "no-device" | "has-owner" | "admin-device" | "no-account" | "device-limit", limit?: number }}
 */
export function giveToAccount(deviceKey, owner) {
  const now = deviceOwner(deviceKey);
  if (!now) return { ok: false, code: "no-device" };
  if (now.state === "bound") return { ok: false, code: "has-owner" };
  if (store.isDeviceAdmin(deviceKey)) return { ok: false, code: "admin-device" };
  if (!ownerChoices().some((c) => c.owner === owner)) return { ok: false, code: "no-account" };
  const limit = accountFull(owner, deviceKey);
  if (limit) return { ok: false, code: "device-limit", limit };
  store.setDeviceOwner(deviceKey, owner);
  return { ok: true };
}
