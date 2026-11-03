/**
 * Passkeys (WebAuthn): a sign-in that the browser holds, unlocked by the device's fingerprint,
 * face or PIN. Two scopes share one store:
 *   "web"    signs in at /login, as the account that added it (an ID or a Google account)
 *   "admin"  passes the admin page's own check (/admin/verify), in place of the code or password
 *
 * A passkey is added only while signed in to its scope, so it never creates an account. Each is
 * bound to the host it was added on (its RP ID); sign-in accepts it only there. Every ceremony
 * needs user verification. The challenge rides a sealed cookie and is spent on first use.
 * Only the public key and the signature counter are kept, in the security database.
 */
import crypto from "crypto";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { recordStore } from "../db/security-stores.js";
import { resolveOrigin } from "../helpers/origin.js";
import { seal, unseal, cookies, cookieLine } from "./user-session.js";
import debug from "../debug.js";

export const SCOPES = ["web", "admin"];
export const CHALLENGE_COOKIE = "cf_pk";
const CHALLENGE_MS = 5 * 60 * 1000;
export const MAX_PER_OWNER = 20;
const RP_NAME = "CookingFoil";
const ID_RE = /^[A-Za-z0-9_-]{16,1366}$/;

export class PasskeyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

let store = null;
let keys = null;
const records = () => (store ??= recordStore("passkey"));
const load = () => (keys ??= records().load().map(([, k]) => k));
function persist(next) {
  records().sync(next.map((k) => [k.id, k]));
  keys = next;
}

/** The key an owner is filed under: "admin", "password:<name>" or "google:<sub>". Pure. */
export function ownerKey(scope, owner) {
  if (scope === "admin") return "admin";
  if (owner?.kind === "password" && owner.name) return `password:${owner.name}`;
  if (owner?.kind === "google" && owner.sub) return `google:${owner.sub}`;
  return null;
}

/** The origin and RP ID a request's ceremony runs under: the host the browser is on. */
export function relyingParty(req) {
  const origin = resolveOrigin(req, null);
  if (!origin) return null;
  const { protocol, hostname } = new URL(origin);
  // Browsers allow passkeys on https, and on localhost for development; never on a bare IP.
  const secure = protocol === "https:" || hostname === "localhost";
  if (!secure || /^[0-9.]+$|:/.test(hostname)) return null;
  return { origin, rpID: hostname };
}

// A challenge is good once: a replayed answer finds it spent.
const spent = new Map();
function spend(challenge, now = Date.now()) {
  for (const [c, exp] of spent) if (exp < now) spent.delete(c);
  if (spent.has(challenge)) return false;
  spent.set(challenge, now + CHALLENGE_MS);
  return true;
}

function challengeCookie(req, value) {
  return cookieLine(req, CHALLENGE_COOKIE, value ? seal(value, CHALLENGE_MS) : "", { maxAgeMs: value ? CHALLENGE_MS : 0 });
}

/** The pending ceremony this browser started for `purpose`, taken (the cookie is cleared by the caller). */
function pending(req, purpose) {
  const v = unseal(cookies(req)[CHALLENGE_COOKIE]);
  return v?.p === purpose && typeof v.c === "string" ? v : null;
}

const userHandle = (key) => crypto.createHash("sha256").update(`cookingfoil:${key}`).digest().subarray(0, 16);

/** The passkeys an owner holds, newest first, without their keys. */
export function list(scope, owner) {
  const key = ownerKey(scope, owner);
  return load().filter((k) => k.scope === scope && k.owner === key)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ id, createdAt, lastUsedAt, backedUp, rpID }) => ({ id, createdAt, lastUsedAt: lastUsedAt ?? null, backedUp: Boolean(backedUp), rpID }));
}

/** Whether any passkey of `scope` was added on this request's host, so a sign-in page offers the button. */
export function usableHere(req, scope) {
  const rp = relyingParty(req);
  return Boolean(rp) && load().some((k) => k.scope === scope && k.rpID === rp.rpID);
}

/** Removes one of an owner's passkeys; false when it holds no such key. */
export function remove(scope, owner, id) {
  const key = ownerKey(scope, owner);
  const all = load();
  const next = all.filter((k) => !(k.id === id && k.scope === scope && k.owner === key));
  if (next.length === all.length) return false;
  persist(next);
  debug.log("passkey: removed one (%s)", scope);
  return true;
}

/** Removes every passkey an owner holds (its account went away). */
export function forget(scope, owner) {
  const key = ownerKey(scope, owner);
  const next = load().filter((k) => !(k.scope === scope && k.owner === key));
  if (next.length !== load().length) persist(next);
}

/** Options to add a passkey for a signed-in owner, and the Set-Cookie line that remembers the challenge. */
export async function startAdd(req, scope, owner, userName) {
  const rp = relyingParty(req);
  if (!rp) throw new PasskeyError("insecure");
  const key = ownerKey(scope, owner);
  if (!key) throw new PasskeyError("owner");
  const held = load().filter((k) => k.scope === scope && k.owner === key);
  if (held.length >= MAX_PER_OWNER) throw new PasskeyError("limit");
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: rp.rpID, userName: String(userName || key).slice(0, 64), userID: userHandle(`${scope}:${key}`),
    attestationType: "none",
    excludeCredentials: held.filter((k) => k.rpID === rp.rpID).map((k) => ({ id: k.id, transports: k.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return { options, cookie: challengeCookie(req, { p: `add:${scope}`, c: options.challenge, o: key, rp: rp.rpID }) };
}

/** Checks the browser's answer to startAdd and keeps the new passkey. */
export async function finishAdd(req, scope, owner, response, now = Date.now()) {
  const rp = relyingParty(req);
  const want = pending(req, `add:${scope}`);
  const key = ownerKey(scope, owner);
  if (!rp || !want || !key || want.o !== key || want.rp !== rp.rpID || !spend(want.c, now)) throw new PasskeyError("expired");
  let result;
  try {
    result = await verifyRegistrationResponse({
      response, expectedChallenge: want.c, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
    });
  } catch (err) {
    debug.log("passkey: add refused: %s", err.message);
    throw new PasskeyError("failed");
  }
  if (!result.verified) throw new PasskeyError("failed");
  const { credential, credentialBackedUp } = result.registrationInfo;
  if (!ID_RE.test(credential.id) || load().some((k) => k.id === credential.id)) throw new PasskeyError("failed");
  if (load().filter((k) => k.scope === scope && k.owner === key).length >= MAX_PER_OWNER) throw new PasskeyError("limit");
  const record = {
    id: credential.id, scope, owner: key, rpID: rp.rpID,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter,
    transports: Array.isArray(credential.transports) ? credential.transports.slice(0, 8) : [],
    backedUp: Boolean(credentialBackedUp), createdAt: now, lastUsedAt: null,
  };
  persist([...load(), record]);
  debug.log("passkey: added one (%s)", scope);
  return { id: record.id, createdAt: now };
}

/** Options to sign in with any passkey of `scope` the browser holds for this host. */
export async function startSignIn(req, scope) {
  const rp = relyingParty(req);
  if (!rp) throw new PasskeyError("insecure");
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required", allowCredentials: [] });
  return { options, cookie: challengeCookie(req, { p: `in:${scope}`, c: options.challenge, rp: rp.rpID }) };
}

/** The owner key of the passkey that answered startSignIn, after checking its signature. */
export async function finishSignIn(req, scope, response, now = Date.now()) {
  const rp = relyingParty(req);
  const want = pending(req, `in:${scope}`);
  if (!rp || !want || want.rp !== rp.rpID || !spend(want.c, now)) throw new PasskeyError("expired");
  const id = typeof response?.id === "string" ? response.id : "";
  const record = load().find((k) => k.id === id && k.scope === scope && k.rpID === rp.rpID);
  if (!record) throw new PasskeyError("unknown");
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge: want.c, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
      credential: { id: record.id, publicKey: Buffer.from(record.publicKey, "base64url"), counter: record.counter, transports: record.transports },
    });
  } catch (err) {
    debug.log("passkey: sign-in refused: %s", err.message);
    throw new PasskeyError("failed");
  }
  if (!result.verified) throw new PasskeyError("failed");
  const { newCounter } = result.authenticationInfo;
  persist(load().map((k) => (k.id === record.id ? { ...k, counter: newCounter, lastUsedAt: now } : k)));
  return record.owner;
}

/** The Set-Cookie line that drops a spent challenge. */
export const clearChallenge = (req) => challengeCookie(req, null);

/** For tests: forget what was loaded and spent. */
export function _reset() {
  keys = null;
  store = null;
  spent.clear();
}
