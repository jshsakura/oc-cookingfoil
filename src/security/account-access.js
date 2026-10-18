/**
 * What an account leaves behind when its access ends. A console it approved keeps
 * its own access key, and an enrollment token it minted still turns into a key,
 * so neither notices the account going away. When the account is removed,
 * disabled or given a new password, both are revoked with it.
 *
 * `owner` is what the server records as the approver: an account name, or
 * "google:<email>" for a Google account.
 */
import * as store from "./store.js";
import * as enrollTokens from "./enroll-tokens.js";
import { SYSTEM_APPROVERS } from "./users.js";
import debug from "../debug.js";

/** @returns {{ consoles: number, tokens: number }} what was revoked */
export function revokeOwnedBy(owner) {
  if (typeof owner !== "string" || !owner || SYSTEM_APPROVERS.has(owner)) return { consoles: 0, tokens: 0 };
  const consoles = store.devicesSnapshot().approved.filter((d) => d.addedBy === owner).map((d) => d.deviceKey);
  for (const key of consoles) store.revokeDevice(key);
  const tokens = enrollTokens.list({ owner }).filter((t) => enrollTokens.revoke(t.id, { owner })).length;
  if (consoles.length || tokens) {
    debug.log("account access: ended %s: %d console(s), %d enrollment token(s)", owner, consoles.length, tokens);
  }
  return { consoles: consoles.length, tokens };
}
