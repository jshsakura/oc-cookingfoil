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

const GOOGLE = "google:";

/** The owner principal of `deviceKey`, as above. */
export function deviceOwner(deviceKey) {
  if (!deviceKey || !store.isDeviceApproved(deviceKey)) return null;
  const by = store.deviceAddedBy(deviceKey);
  if (!by || users.SYSTEM_APPROVERS.has(by)) return { state: "unbound" };
  if (by.startsWith(GOOGLE)) {
    const email = by.slice(GOOGLE.length);
    const account = googleAccounts.list().find((a) => a.email === email);
    return { state: "bound", owner: { kind: "google", id: email, displayName: googleAccounts.maskEmail(email) }, active: account?.status === "approved" };
  }
  return { state: "bound", owner: { kind: "user", id: by, displayName: by }, active: users.isActive(by) };
}

/** What a console is told about its own binding: no account id beyond the name it shows. Pure over deviceOwner. */
export function bindingOf(deviceKey) {
  const o = deviceOwner(deviceKey);
  if (!o) return null;
  return o.state === "bound" ? { bound: true, owner: { kind: o.owner.kind, displayName: o.owner.displayName } } : { bound: false };
}
