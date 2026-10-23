/**
 * Google sign-in settings: on/off, the OAuth client id and its secret.
 *
 * The admin sets them from /admin (users tab); they are kept in
 * the security database, sealed, and apply at once, no restart.
 * Until the admin saves them, COOK_GOOGLE_CLIENT_ID / COOK_GOOGLE_CLIENT_SECRET seed
 * them. The secret never leaves this module except to Google's token endpoint:
 * describe() reports only whether one is set.
 */
import { googleClientId as envId, googleClientSecret as envSecret } from "../helpers/envs.js";
import { readSecretJson, writeSecretJson } from "../db/security-stores.js";
import { codedError } from "./security-messages.js";

const ID_RE = /^[A-Za-z0-9._-]{8,200}$/;
const SECRET_RE = /^[\x21-\x7e]{8,200}$/;

let current = null;

function load() {
  const saved = readSecretJson("google-oauth");
  if (saved) return { enabled: saved.enabled === true, clientId: String(saved.clientId ?? ""), clientSecret: String(saved.clientSecret ?? ""), source: "admin" };
  return { enabled: Boolean(envId && envSecret), clientId: envId, clientSecret: envSecret, source: envId || envSecret ? "env" : "none" };
}

function settings() {
  current ??= load();
  return current;
}

/** The id and secret to sign in with, or null when Google sign-in is off. */
export function activeClient() {
  const s = settings();
  return s.enabled && s.clientId && s.clientSecret ? { clientId: s.clientId, clientSecret: s.clientSecret } : null;
}

export const googleConfigured = () => activeClient() !== null;

/** What the admin page shows: never the secret. */
export function describe() {
  const s = settings();
  return { enabled: s.enabled, active: googleConfigured(), clientId: s.clientId, hasSecret: Boolean(s.clientSecret), source: s.source };
}

export class GoogleConfigError extends Error {}

function persist(next) {
  writeSecretJson("google-oauth", { version: 1, enabled: next.enabled, clientId: next.clientId, clientSecret: next.clientSecret });
  current = { ...next, source: "admin" };
}

/**
 * Save the settings. An empty or missing `clientSecret` keeps the one already
 * set, so the masked field can be left alone. Turning it on needs both values.
 */
export function save({ enabled, clientId, clientSecret }) {
  const s = settings();
  const id = String(clientId ?? "").trim();
  const secretIn = String(clientSecret ?? "").trim();
  if (id && !ID_RE.test(id)) throw codedError(GoogleConfigError, "google.badId");
  if (secretIn && !SECRET_RE.test(secretIn)) throw codedError(GoogleConfigError, "google.badSecret");
  const next = { enabled: enabled === true, clientId: id, clientSecret: secretIn || (id === s.clientId || !s.clientId ? s.clientSecret : "") };
  if (next.enabled && !(next.clientId && next.clientSecret)) throw codedError(GoogleConfigError, "google.needBoth");
  persist(next);
  return describe();
}

/** Forget the id and secret; Google sign-in goes off (env values don't come back). */
export function clear() {
  persist({ enabled: false, clientId: "", clientSecret: "" });
  return describe();
}
