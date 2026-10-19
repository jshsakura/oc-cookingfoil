/**
 * Each account's RetroAchievements name, keyed by link-identity's ownerKey
 * ("user:<id>", "google:<sub>", or "paired:<device>" for a console without an
 * account). Only the public name is kept: the console signs in to
 * RetroAchievements itself, and its password and token never reach this server.
 */
import { recordStore } from "../../db/security-stores.js";

let store = null;
let names = null;

const records = () => (store ??= recordStore("ra-player"));

function all() {
  if (!names) names = new Map(records().load().map(([owner, r]) => [owner, r]));
  return names;
}

/** The RetroAchievements name an owner registered, or null. */
export const nameOf = (owner) => all().get(owner)?.username ?? null;

export function register(owner, username, now = Date.now()) {
  const next = new Map(all()).set(owner, { username, at: now });
  records().sync(next);
  names = next;
}

export function unregister(owner) {
  if (!all().has(owner)) return;
  const next = new Map(all());
  next.delete(owner);
  records().sync(next);
  names = next;
}

/** For tests. */
export function reset() {
  store = null;
  names = null;
}
