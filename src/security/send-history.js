/**
 * The games an account recently sent to its own consoles, newest first, so the chat can recommend
 * from what a person actually took. A send leaves the console's queue once the console acks it, so
 * the queue cannot answer "what did I get lately".
 *
 *   entry   { titleId, at }   titleId is the base game's, at the ISO time of the send
 *
 * Kept in the security database. An account holds the last MAX_ENTRIES distinct games; sending a
 * game again moves it to the front.
 */
import { recordStore } from "../db/security-stores.js";

export const MAX_ENTRIES = 30;

let saved = null; // account → [entry], newest first
let rows = null;

const records = () => (rows ??= recordStore("send-history"));
const all = () => (saved ??= Object.fromEntries(records().load()));
const persist = () => records().sync(Object.entries(all()));

/** Notes that `account` sent base game `titleId` to a console. */
export function record(account, titleId, now = Date.now()) {
  if (!account || !titleId) return;
  const kept = (all()[account] ?? []).filter((e) => e.titleId !== titleId);
  saved[account] = [{ titleId, at: new Date(now).toISOString() }, ...kept].slice(0, MAX_ENTRIES);
  persist();
}

/** The account's recent sends, newest first. */
export const recent = (account, limit = MAX_ENTRIES) => (all()[account] ?? []).slice(0, limit);

/** Tests start from an empty store. */
export function resetForTests() {
  saved = {};
  persist();
}
