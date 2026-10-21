/**
 * First-run setup. A server with no accounts is open to anyone on the network,
 * so until the first admin account exists every page leads to /setup.
 *
 * /setup asks for a one-time setup code that only the operator can see: it is
 * printed to the container log at start. Without it nobody who merely reaches
 * the server first can claim it. The code changes on every start and dies once
 * the authenticator is registered (or setup is otherwise finished).
 */
import crypto from "crypto";
import * as users from "./users.js";
import { isEnrolled, canManage } from "./admin-secret.js";
import { adminPasswordMode } from "./admin-session.js";
import * as twoFactorSkip from "./admin-2fa-skip.js";
import { firstRunSetup } from "../helpers/envs.js";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const CODE_LEN = 8;

let code = null;
let finished = false;

/** True while the server has no account: the only thing to do is setup. */
export function needsSetup() {
  return firstRunSetup && !users.hasUsers();
}

/**
 * True while /admin must wait for setup: no account yet, and the admin gate holds
 * nothing the operator has proven they know (no admin password, no enrolled or
 * pinned authenticator). /admin would otherwise show its fresh secret to anyone.
 */
export function adminAwaitsSetup() {
  return needsSetup() && !adminPasswordMode() && !isEnrolled();
}

/** Whether the authenticator step still has something to do. */
export function needsAuthenticator() {
  return canManage() && !isEnrolled() && !adminPasswordMode() && !twoFactorSkip.skipped();
}

/** Setup is open while there is no account, or right after one was made here and the authenticator is not yet registered. */
export function setupOpen() {
  if (needsSetup()) return true;
  return !finished && code !== null && needsAuthenticator();
}

/** The code for this start, made on first use. "ABCD-EFGH". */
export function setupCode() {
  if (!code) {
    const bytes = crypto.randomBytes(CODE_LEN);
    code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Constant-time check of a typed code; dashes, spaces and case don't matter. */
export function codeMatches(input) {
  if (!code || !setupOpen()) return false;
  const typed = Buffer.from(String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const want = Buffer.from(code);
  return typed.length === want.length && crypto.timingSafeEqual(typed, want);
}

/** Closes setup for good (until the next start with no accounts). */
export function finish() {
  finished = true;
}

/** Test-only. */
export function resetForTests() {
  code = null;
  finished = false;
}
