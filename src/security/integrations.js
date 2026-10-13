/**
 * Keys for outside services, set from the admin page (settings tab) and kept in
 * ${COOK_DATA_DIR}/security/integrations.json (0600). They apply at once, no
 * restart. A service with nothing saved falls back to its env vars, so compose
 * files that already set them keep working.
 *
 * Secrets never leave this module except to the service they belong to:
 * describe() reports only whether one is set.
 */
import fs from "fs";
import path from "path";
import * as env from "../helpers/envs.js";

const FILE = path.join(env.dataDir, "security", "integrations.json");
const TOKEN_RE = /^[\x21-\x7e]{8,300}$/;
const URL_RE = /^https?:\/\/[^\s]{3,300}$/;

/** Each service: its fields, which are secret, and the env vars they fall back to. */
export const SERVICES = {
  igdb: {
    fields: {
      clientId: { env: () => env.igdbClientId, re: /^[A-Za-z0-9]{8,100}$/ },
      clientSecret: { env: () => env.igdbClientSecret, re: /^[A-Za-z0-9]{8,100}$/, secret: true },
    },
  },
  steamgriddb: {
    fields: { apiKey: { env: () => env.steamGridDbKey, re: /^[A-Za-z0-9]{16,100}$/, secret: true } },
  },
  dropbox: {
    fields: {
      appKey: { env: () => env.dropboxAppKey, re: /^[A-Za-z0-9]{8,100}$/ },
      redirectBase: { env: () => env.dropboxRedirectBase, re: URL_RE, optional: true },
    },
  },
  github: {
    fields: { token: { env: () => env.githubToken, re: TOKEN_RE, secret: true } },
  },
  ratings: {
    fields: { url: { env: () => env.ratingsUrl, re: URL_RE } },
  },
  telegram: {
    fields: {
      botToken: { env: () => env.telegramBotToken, re: /^\d{5,15}:[A-Za-z0-9_-]{30,80}$/, secret: true },
      chatId: { env: () => env.telegramChatId, re: /^(-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/ },
      // Comma list of alert events; empty means all, "-" means none.
      events: { env: () => env.telegramEvents, re: /^(-|[a-z]+(,[a-z]+)*)$/, optional: true },
    },
  },
};

export class IntegrationError extends Error {}

let saved = null;

function readSaved() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && typeof parsed.services === "object" && parsed.services ? parsed.services : {};
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return {};
  }
}

const all = () => (saved ??= readSaved());

/** The values a service runs with: what the admin saved, else the env vars. Empty strings when unset. */
export function get(service) {
  const spec = SERVICES[service];
  if (!spec) throw new IntegrationError(`unknown service ${service}`);
  const own = all()[service];
  return Object.fromEntries(Object.entries(spec.fields).map(([k, f]) => [k, String(own ? own[k] ?? "" : f.env() ?? "").trim()]));
}

/** Whether every field of a service has a value (optional ones aside). */
export function configured(service) {
  const v = get(service);
  return Object.entries(v).every(([k, x]) => x || SERVICES[service].fields[k].optional);
}

/** What the admin page shows: plain fields as they are, secrets only as set / not set. */
export function describe() {
  return Object.fromEntries(Object.entries(SERVICES).map(([service, spec]) => {
    const v = get(service);
    const fields = Object.fromEntries(Object.entries(spec.fields).map(([k, f]) => [k, f.secret ? { set: Boolean(v[k]) } : { value: v[k] }]));
    return [service, { configured: configured(service), source: all()[service] ? "admin" : Object.values(v).some(Boolean) ? "env" : "none", fields }];
  }));
}

function persist(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, services: next }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  saved = next;
}

/** Saves one service. An empty secret keeps the one already set, so a masked field can be left alone. */
export function save(service, input = {}) {
  const spec = SERVICES[service];
  if (!spec) throw new IntegrationError("알 수 없는 서비스입니다");
  const current = get(service);
  const next = {};
  for (const [k, f] of Object.entries(spec.fields)) {
    const value = String(input[k] ?? "").trim();
    if (value && !f.re.test(value)) throw new IntegrationError(`${k} 형식이 맞지 않습니다`);
    next[k] = value || (f.secret ? current[k] : "");
  }
  persist({ ...all(), [service]: next });
  return describe()[service];
}

/** Forgets what the admin saved; the service goes back to its env vars, if any. */
export function clear(service) {
  if (!SERVICES[service]) throw new IntegrationError("알 수 없는 서비스입니다");
  const { [service]: _gone, ...rest } = all();
  persist(rest);
  return describe()[service];
}

/** Test-only: forget the cached file. */
export function resetForTests() {
  saved = null;
}
