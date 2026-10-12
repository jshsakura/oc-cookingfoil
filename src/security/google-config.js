/**
 * Google sign-in settings: on/off, the OAuth client id and its secret.
 *
 * The admin sets them from /admin (users tab); they are kept in
 * ${COOK_DATA_DIR}/security/google-oauth.json and apply at once, no restart.
 * Until that file exists, COOK_GOOGLE_CLIENT_ID / COOK_GOOGLE_CLIENT_SECRET seed
 * them. The secret never leaves this module except to Google's token endpoint:
 * describe() reports only whether one is set.
 */
import fs from "fs";
import path from "path";
import { dataDir, googleClientId as envId, googleClientSecret as envSecret } from "../helpers/envs.js";

const FILE = path.join(dataDir, "security", "google-oauth.json");
const ID_RE = /^[A-Za-z0-9._-]{8,200}$/;
const SECRET_RE = /^[\x21-\x7e]{8,200}$/;

let current = null;

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { enabled: saved.enabled === true, clientId: String(saved.clientId ?? ""), clientSecret: String(saved.clientSecret ?? ""), source: "admin" };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return { enabled: Boolean(envId && envSecret), clientId: envId, clientSecret: envSecret, source: envId || envSecret ? "env" : "none" };
  }
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
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, enabled: next.enabled, clientId: next.clientId, clientSecret: next.clientSecret }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
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
  if (id && !ID_RE.test(id)) throw new GoogleConfigError("클라이언트 ID 형식이 아닙니다");
  if (secretIn && !SECRET_RE.test(secretIn)) throw new GoogleConfigError("클라이언트 시크릿 형식이 아닙니다");
  const next = { enabled: enabled === true, clientId: id, clientSecret: secretIn || (id === s.clientId || !s.clientId ? s.clientSecret : "") };
  if (next.enabled && !(next.clientId && next.clientSecret)) throw new GoogleConfigError("켜려면 클라이언트 ID 와 시크릿이 모두 필요합니다");
  persist(next);
  return describe();
}

/** Forget the id and secret; Google sign-in goes off (env values don't come back). */
export function clear() {
  persist({ enabled: false, clientId: "", clientSecret: "" });
  return describe();
}
