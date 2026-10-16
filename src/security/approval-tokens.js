/**
 * The requests a Telegram approval alert's buttons stand for. A button carries
 * only a random token (16 bytes, base64url); what it approves (a console's key,
 * a Google account) stays here, so a pressed button can't name anything else.
 * A token works once and lapses after TTL_MS.
 *
 * Kept in the security database (0600) under the
 * token's SHA-256, so buttons sent before a restart still work and the file
 * alone can't be replayed.
 */
import crypto from "crypto";
import debug from "../debug.js";
import { recordStore } from "../db/security-stores.js";

export const TTL_MS = 24 * 60 * 60 * 1000;
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
// Above what the alerts can issue in a TTL: three per ten minutes for each kind of request (alerts.js).
const MAX_KEPT = 1000;

let saved = null; // hash → { kind, ref, at }

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");

let store = null;
const records = () =>
  (store ??= recordStore("approval"));

const read = () => Object.fromEntries(records().load());

const all = () => (saved ??= read());

function persist() {
  try {
    records().sync(Object.entries(saved));
  } catch (err) {
    debug.log("approval tokens: not saved: %s", err.message);
  }
}

/** Drops lapsed requests, then the oldest beyond MAX_KEPT. */
function prune(now) {
  const kept = Object.entries(all()).filter(([, r]) => now - r.at < TTL_MS).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_KEPT);
  saved = Object.fromEntries(kept);
}

/** A new token for one request ({ kind: "device" | "account", ref }). */
export function issue(kind, ref, now = Date.now()) {
  const token = crypto.randomBytes(16).toString("base64url");
  prune(now);
  saved = { ...saved, [hash(token)]: { kind, ref, at: now } };
  persist();
  return token;
}

/** The request behind a token, which is then spent; null when unknown, spent or lapsed. */
export function take(token, now = Date.now()) {
  if (!TOKEN_RE.test(String(token ?? ""))) return null;
  const key = hash(token);
  const r = all()[key];
  if (!r) return null;
  const { [key]: _spent, ...rest } = saved;
  saved = rest;
  persist();
  return now - r.at < TTL_MS ? { kind: r.kind, ref: r.ref } : null;
}

/** Test-only: forget the cached file. */
export function resetForTests() {
  saved = null;
}
