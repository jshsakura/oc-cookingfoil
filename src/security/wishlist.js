/**
 * Games a signed-in account wants ("찜"), kept per account by title id so the same
 * game on any server is the same wish. The web page adds and removes them; a console
 * reads the list of the account that approved it and merges the lists of every server
 * it knows by titleId.
 *
 *   wish   { titleId, name, addedAt }
 *   titleId  16 hex digits, upper case: the base game's id
 *   addedAt  ISO time the server stamped, newest first in a list
 *
 * Kept in the security database, so a restart keeps them. An account holds at most
 * MAX_WISHES; adding a game already wished returns the one there.
 */
import { recordStore } from "../db/security-stores.js";

export const MAX_WISHES = 500;
const TITLE_RE = /^[0-9A-F]{16}$/;
const MAX_NAME = 200;

let saved = null; // account → [wish], newest first
let rows = null;

const records = () => (rows ??= recordStore("wishlist"));
const all = () => (saved ??= Object.fromEntries(records().load()));
const persist = () => records().sync(Object.entries(all()));

/** `value` as a title id (16 hex digits, upper case), or null. Pure. */
export function cleanTitleId(value) {
  const id = typeof value === "string" ? value.trim().toUpperCase() : "";
  return TITLE_RE.test(id) ? id : null;
}

/** The account's wishes, newest first. */
export const list = (account) => [...(all()[account] ?? [])];

/** Adds a wish: { wish, existing }, or { refused: "full" } at MAX_WISHES. `titleId` must be clean. */
export function add(account, titleId, name, now = Date.now()) {
  const wishes = all()[account] ?? [];
  const same = wishes.find((w) => w.titleId === titleId);
  if (same) return { wish: same, existing: true };
  if (wishes.length >= MAX_WISHES) return { refused: "full" };
  const wish = { titleId, name: String(name ?? "").slice(0, MAX_NAME), addedAt: new Date(now).toISOString() };
  saved[account] = [wish, ...wishes];
  persist();
  return { wish, existing: false };
}

/** Removes a wish; whether one went. */
export function remove(account, titleId) {
  const wishes = all()[account] ?? [];
  const kept = wishes.filter((w) => w.titleId !== titleId);
  if (kept.length === wishes.length) return false;
  if (kept.length) saved[account] = kept;
  else delete saved[account];
  persist();
  return true;
}

/** Tests start from an empty store. */
export function resetForTests() {
  saved = {};
  persist();
}
