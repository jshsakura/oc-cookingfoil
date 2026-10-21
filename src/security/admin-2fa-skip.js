/**
 * The admin chose, at first-run setup, to go on without an authenticator. Until
 * one is registered, an enabled admin account signed in with its password opens
 * the admin page on its own. The server warns about it on every start and on
 * the admin page (config-health.js).
 */
import { recordStore } from "../db/security-stores.js";

let store = null;
const records = () => (store ??= recordStore("admin-2fa-skip"));

let cached; // undefined until read

export function skipped() {
  if (cached === undefined) cached = Boolean(records().load()[0]?.[1]?.at);
  return cached;
}

export function skip(now = Date.now()) {
  records().sync([["admin", { at: now }]]);
  cached = true;
}

export function clear() {
  records().sync([]);
  cached = false;
}

/** For tests. */
export function reset() {
  cached = undefined;
}
