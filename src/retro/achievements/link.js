/**
 * Phone-to-console hand-off of a RetroAchievements password, held in memory only.
 *
 * The console makes a P-256 key pair and opens a link (open). The phone page
 * encrypts { u, p } to the console's public key and leaves the envelope here
 * (seal); the console takes it once (take), signs in to RetroAchievements
 * itself and says how it went (finish). This server never has the key to open
 * the envelope, keeps it until it is taken, and forgets every link after
 * LINK_TTL_MS. A wrong password reopens the same link for the phone, up to
 * MAX_TRIES envelopes.
 *
 * Waiting is event driven: wait() parks a promise that the next change (or its
 * own timeout) settles, so a long request costs one timer and nothing else.
 *
 * Envelope (the client and the phone page agree on it):
 *   publicKey, epk  uncompressed P-256 point, 65 bytes (0x04 || X || Y), base64url
 *   key             HKDF-SHA256(ikm = ECDH X coordinate, salt = none, info = "cookingfoil-ra-link"), 32 bytes
 *   iv              12 bytes, base64url
 *   ct              AES-256-GCM ciphertext || 16-byte tag, AAD = the link code (UTF-8), base64url
 */
import crypto from "crypto";

export const LINK_TTL_MS = 5 * 60 * 1000;
export const MAX_TRIES = 3;
const MAX_LINKS = 200;
const MAX_CT_BYTES = 1024;

// waiting: for the phone · sealed: an envelope for the console · taken: the console is signing in
// done: signed in · wrong: the password was refused, the phone may try again · failed: out of tries
const links = new Map(); // code → { owner, publicKey, username, state, envelope, tries, expiresAt, waiters, timer }

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const bytesOf = (text) => (typeof text === "string" && B64URL_RE.test(text) ? Buffer.from(text, "base64url") : null);

/** A base64url P-256 point as the envelope wants it (65 bytes, 0x04 first), or null. Pure. */
export function pointOf(text) {
  const b = bytesOf(text);
  return b && b.length === 65 && b[0] === 0x04 ? b : null;
}

function notify(link) {
  const waiters = [...link.waiters];
  link.waiters.clear();
  for (const w of waiters) w();
}

function drop(code) {
  const link = links.get(code);
  if (!link) return;
  links.delete(code);
  clearTimeout(link.timer);
  link.state = "expired";
  link.envelope = null;
  notify(link);
}

/** A new link for `owner`, replacing that owner's earlier one: { code, expiresAt }, or null when publicKey is not a P-256 point. */
export function open(owner, publicKey, { username = null, now = Date.now() } = {}) {
  if (!pointOf(publicKey)) return null;
  for (const [code, l] of links) if (l.owner === owner) drop(code);
  if (links.size >= MAX_LINKS) drop(links.keys().next().value);
  const code = crypto.randomBytes(16).toString("base64url");
  const expiresAt = now + LINK_TTL_MS;
  const timer = setTimeout(() => drop(code), LINK_TTL_MS);
  timer.unref?.();
  links.set(code, { owner, publicKey, username, state: "waiting", envelope: null, tries: 0, expiresAt, waiters: new Set(), timer });
  return { code, expiresAt };
}

const live = (code) => (typeof code === "string" ? links.get(code) ?? null : null);

/** Whether `code` is a live link of `owner`'s. */
export const isOwner = (code, owner) => live(code)?.owner === owner;

/** What the phone page may know: { state, username, triesLeft, expiresAt }, or null. */
export function view(code) {
  const l = live(code);
  return l ? { state: l.state, username: l.username, triesLeft: MAX_TRIES - l.tries, expiresAt: l.expiresAt } : null;
}

/**
 * The phone leaves an envelope. → "ok", "gone" (no such link), "busy" (not waiting for one), or "invalid".
 */
export function seal(code, { epk, iv, ct } = {}) {
  const l = live(code);
  if (!l) return "gone";
  const ivBytes = bytesOf(iv), ctBytes = bytesOf(ct);
  if (!pointOf(epk) || ivBytes?.length !== 12 || !ctBytes || ctBytes.length <= 16 || ctBytes.length > MAX_CT_BYTES) return "invalid";
  if (l.state !== "waiting" && l.state !== "wrong") return "busy";
  l.tries++;
  l.envelope = { epk, iv, ct };
  l.state = "sealed";
  notify(l);
  return "ok";
}

/** The console takes its envelope, once: the envelope, "none" yet, or "gone" (no such link, or not this owner's). */
export function take(code, owner) {
  const l = live(code);
  if (!l || l.owner !== owner) return "gone";
  if (l.state !== "sealed") return "none";
  const envelope = l.envelope;
  l.envelope = null;
  l.state = "taken";
  notify(l);
  return envelope;
}

/** The console says how signing in went. → the new state, or null when there is no such link of this owner's. */
export function finish(code, owner, { ok, username = null }) {
  const l = live(code);
  if (!l || l.owner !== owner || l.state !== "taken") return null;
  if (ok) {
    l.state = "done";
    if (username) l.username = username;
  } else {
    l.state = l.tries >= MAX_TRIES ? "failed" : "wrong";
  }
  notify(l);
  return l.state;
}

/**
 * Resolves once `ready(link)` holds, the link goes, `ms` pass or `signal` aborts;
 * with the link (null when it is gone).
 */
export function wait(code, ready, ms, signal) {
  const l = live(code);
  if (!l || ready(l)) return Promise.resolve(l);
  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", settle);
      l.waiters.delete(check);
      resolve(links.get(code) ?? null);
    };
    const check = () => {
      if (!links.has(code) || ready(l)) settle();
      else l.waiters.add(check);
    };
    const timer = setTimeout(settle, ms);
    timer.unref?.();
    signal?.addEventListener("abort", settle, { once: true });
    l.waiters.add(check);
  });
}

/** For tests. */
export function reset() {
  for (const code of [...links.keys()]) drop(code);
}
