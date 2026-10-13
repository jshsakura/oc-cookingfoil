/**
 * Server behaviour the admin page can change while the server runs: device
 * approval, uploads, the public address, where names come from, titledb and
 * the outside lookups. Saved in ${COOK_DATA_DIR}/security/server-settings.json
 * (0600) over what compose set; a setting with nothing saved keeps its compose
 * value, so existing compose files behave as before.
 *
 * Saving applies at once through envs.js applyServerSettings (live bindings).
 */
import fs from "fs";
import path from "path";
import * as env from "../helpers/envs.js";

const FILE = path.join(env.dataDir, "security", "server-settings.json");
const URL_RE = /^https?:\/\/[^\s/]+[^\s]{0,300}$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/;
const REGION_RE = /^[A-Z]{2}\.[a-z]{2}$/;

const bool = { check: (v) => typeof v === "boolean" };
const oneOf = (...values) => ({ check: (v) => values.includes(v) });
const list = (re, max) => ({
  parse: (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean),
  check: (v) => Array.isArray(v) && v.length <= max && v.every((s) => re.test(s)) && new Set(v).size === v.length,
});

/** Each setting and what it accepts. `empty` is allowed for the ones that may be blank. */
export const SETTINGS = {
  devicePairing: bool,
  deviceApproval: oneOf("manual", "signin", "all"),
  uploadsEnabled: bool,
  publicBaseUrl: { parse: (v) => String(v ?? "").trim().replace(/\/+$/, ""), check: (v) => v === "" || URL_RE.test(v) },
  extractIcons: oneOf("missing", "all", "off"),
  langPriority: { ...list(LANG_RE, 10), check: (v) => list(LANG_RE, 10).check(v) && v.length > 0 },
  titledbAutoFetch: bool,
  titledbRegions: list(REGION_RE, 30),
  eshopPrices: bool,
  eshopPopularity: bool,
  eshopArtwork: bool,
  ratingSync: bool,
  welcomeMessage: { parse: (v) => String(v ?? "").trim(), check: (v) => v.length <= 300 && !/[\r\n]/.test(v) },
};

let saved = {};

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const out = {};
    for (const [k, v] of Object.entries(parsed?.settings ?? {})) {
      if (SETTINGS[k]?.check(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function write(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, settings: next }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

/** Reads the saved file and applies it. Runs once on import; tests call it again. */
export function load() {
  saved = read();
  env.applyServerSettings(saved);
}

/** Every setting with its value and where that value comes from. */
export function describe() {
  const out = {};
  for (const k of Object.keys(SETTINGS)) {
    const fromEnv = env.ENV_SETTINGS[k];
    const value = k in saved ? saved[k] : fromEnv;
    out[k] = { value: value ?? (k === "publicBaseUrl" || k === "welcomeMessage" ? "" : value), source: k in saved ? "saved" : "env", envValue: fromEnv ?? null };
  }
  return out;
}

/**
 * Saves some settings. A value of null goes back to the compose value.
 * Throws an Error naming the first setting that doesn't fit; nothing is saved then.
 * Returns the names that changed.
 */
export function save(input = {}) {
  const next = { ...saved };
  for (const [k, raw] of Object.entries(input)) {
    const spec = SETTINGS[k];
    if (!spec) throw new Error(`unknown setting: ${k}`);
    if (raw === null) {
      delete next[k];
      continue;
    }
    const v = spec.parse ? spec.parse(raw) : raw;
    if (!spec.check(v)) throw new Error(k);
    next[k] = v;
  }
  const changed = Object.keys(SETTINGS).filter((k) => JSON.stringify(effective(next, k)) !== JSON.stringify(effective(saved, k)));
  write(next);
  saved = next;
  env.applyServerSettings(saved);
  return changed;
}

const effective = (s, k) => (k in s ? s[k] : env.ENV_SETTINGS[k] ?? null);

load();
