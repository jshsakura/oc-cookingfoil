// Whose backups a request reaches. Backups belong to an account, never to one console: any console the account
// holds sees them all. The id never changes for the account's life and is never reused by another: a Google
// account's subject, or a password account's name with the moment it was made (a removed name made again is a
// new account with no backups).
import crypto from "node:crypto";
import * as users from "../security/users.js";
import * as googleAccounts from "../security/google-accounts.js";
import { deviceOwner } from "../security/device-owner.js";

/** The account behind an owner principal ({ kind, id }), as { id, name }, or null when there is none. */
export function accountOfOwner(owner) {
  if (owner?.kind === "google") {
    const account = googleAccounts.get(owner.id);
    return account ? { id: googleAccounts.ownerOf(account.sub), name: account.email ?? owner.id } : null;
  }
  if (owner?.kind === "user") {
    const user = users.list().find((u) => u.name === owner.id);
    return user ? { id: `user:${user.name}:${user.createdAt}`, name: user.name } : null;
  }
  return null;
}

/** The account a console belongs to, or null for an unknown console or one no account holds. */
export function accountOfDevice(deviceKey) {
  const o = deviceOwner(deviceKey);
  return o?.state === "bound" ? accountOfOwner(o.owner) : null;
}

/** The account a name on the command line means: a password account's name, or a Google account's address. */
export function accountNamed(name) {
  if (users.list().some((u) => u.name === name)) return accountOfOwner({ kind: "user", id: name });
  const google = googleAccounts.list().find((a) => a.email === name);
  return google ? accountOfOwner({ kind: "google", id: google.sub }) : null;
}

/** The folder name an account's backups live under: no name or address on the disk. */
export const accountFolder = (id) => crypto.createHash("sha256").update(`cookingfoil-backups\0${id}`).digest("hex").slice(0, 32);
