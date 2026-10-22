/**
 * Server behaviour the admin page can change while the server runs: device
 * approval, whether consoles may sign in with a password, uploads, the share inbox, the public address, the direct download address, where names come from,
 * titledb, the outside lookups, how many connections a console opens per
 * download, how a safe restart waits and the NSZ conversion queue. Saved in the security database (one row a setting)
 * (0600) over what compose set; a setting with nothing saved keeps its compose
 * value, so existing compose files behave as before.
 *
 * Saving applies at once through envs.js applyServerSettings (live bindings).
 */
import { ASSET_RE, REPO_RE, TAG_RE } from "../meta/client-release.js";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";
import { settingsStore } from "../db/security-stores.js";

const URL_RE = /^https?:\/\/[^\s/]+[^\s]{0,300}$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/;
const REGION_RE = /^[A-Z]{2}\.[a-z]{2}$/;

const bareOrigin = (v) => {
  try {
    const u = new URL(v);
    return u.pathname === "/" && !u.search && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
};
const bool = { check: (v) => typeof v === "boolean" };
const oneOf = (...values) => ({ check: (v) => values.includes(v) });
// A byte count, whole and positive, up to 16 TiB.
const bytes = { parse: (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), check: (v) => Number.isSafeInteger(v) && v > 0 && v <= 16 * 1024 ** 4 };
// Whole seconds from 1 up to max; the page sends them as text.
const seconds = (max) => ({ parse: (v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v), check: (v) => Number.isInteger(v) && v >= 1 && v <= max });
// A whole number from min to max; the page may send it as text.
const whole = (min, max) => ({ parse: (v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v), check: (v) => Number.isInteger(v) && v >= min && v <= max });
const list = (re, max) => ({
  parse: (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean),
  check: (v) => Array.isArray(v) && v.length <= max && v.every((s) => re.test(s)) && new Set(v).size === v.length,
});

/** Each setting and what it accepts. `empty` is allowed for the ones that may be blank. */
export const SETTINGS = {
  devicePairing: bool,
  passwordLogin: bool,
  deviceApproval: oneOf("manual", "signin", "all"),
  uploadsEnabled: bool,
  inboxEnabled: bool,
  inboxMaxBytes: bytes,
  inboxQuotaBytes: bytes,
  publicBaseUrl: { parse: (v) => String(v ?? "").trim().replace(/\/+$/, ""), check: (v) => v === "" || URL_RE.test(v) },
  extractIcons: oneOf("missing", "all", "off"),
  langPriority: { ...list(LANG_RE, 10), check: (v) => list(LANG_RE, 10).check(v) && v.length > 0 },
  titledbAutoFetch: bool,
  titledbRegions: list(REGION_RE, 30),
  titledbSource: { parse: (v) => String(v ?? "").trim().replace(/\/+$/, ""), check: (v) => v === "" || URL_RE.test(v) },
  eshopPrices: bool,
  eshopPopularity: bool,
  eshopArtwork: bool,
  ratingSync: bool,
  retroMeta: bool,
  // Ready-made ROM and BIOS folders and the storage guide (retro/scaffold.js).
  retroScaffold: bool,
  // The RetroArch bundle's address; empty is the official one in the pack lock. The lock's SHA-256 decides what is accepted.
  retroPackUrl: { parse: (v) => String(v ?? "").trim(), check: (v) => v === "" || URL_RE.test(v) },
  downloadMaxConnections: { parse: (v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v), check: (v) => Number.isInteger(v) && v >= 1 && v <= 8 },
  // Scheme, host and port only: links are signed over the file path from the root.
  publicDirectBaseUrl: { parse: (v) => String(v ?? "").trim().replace(/\/+$/, ""), check: (v) => v === "" || (URL_RE.test(v) && v.startsWith("https://") && bareOrigin(v)) },
  directDownloads: bool,
  // An hour up to a week; the page sends one of its choices as text.
  downloadLinkTtl: { parse: (v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v), check: (v) => Number.isInteger(v) && v >= 3600 && v <= 604800 },
  restartRetryAfter: seconds(300),
  // Inside compose's stop_grace_period (40 s), so docker never kills a drain.
  restartGrace: seconds(35),
  // The NSZ conversion queue (meta/nsz-queue.js).
  nszEnabled: bool,
  nszAutoQueue: bool,
  nszLevel: whole(1, 22),
  nszThreads: whole(1, 32),
  nszWorkers: whole(1, 3),
  nszMinSizeMb: whole(1, 1048576),
  nszDiskFloorGb: whole(0, 1048576),
  nszKeepHours: whole(0, 168),
  nszKeepGb: whole(0, 4096),
  nszBlock: bool,
  nszXci: bool,
  backupDays: whole(0, 365),
  logKeepDays: whole(1, 365),
  syncHours: whole(0, 168),
  verifyHours: oneOf(...env.VERIFY_HOURS),
  // Entries older than this are pointed out on the trash page; nothing is emptied by itself.
  trashNoticeDays: whole(1, 3650),
  // Where the client build comes from, and the GitHub release followed in "github" mode (meta/client-release.js).
  clientSource: oneOf("manual", "github"),
  clientReleaseRepo: { parse: (v) => String(v ?? "").trim(), check: (v) => v.length <= 140 && REPO_RE.test(v) },
  clientReleaseTag: { parse: (v) => String(v ?? "").trim(), check: (v) => v === "" || TAG_RE.test(v) },
  clientReleaseAsset: { parse: (v) => String(v ?? "").trim(), check: (v) => ASSET_RE.test(v) },
};

let saved = {};

let warnedRetired = false;
/** The old download-only address is gone; say once that its value is not used. */
function warnRetired(what) {
  if (warnedRetired) return;
  warnedRetired = true;
  debug.error("settings: %s is no longer used and is ignored; set publicDirectBaseUrl (COOK_PUBLIC_DIRECT_BASE_URL) instead", what);
}

let store = null;
const settingsRows = () => (store ??= settingsStore());

function read() {
  if (process.env.COOK_DOWNLOAD_BASE_URL) warnRetired("COOK_DOWNLOAD_BASE_URL");
  const all = settingsRows().load();
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (SETTINGS[k]?.check(v)) out[k] = v;
  }
  if (all.downloadBaseUrl) warnRetired("the saved downloadBaseUrl");
  return out;
}

function write(next) {
  settingsRows().save(next);
}

/** Reads the saved settings and applies them. Runs once on import; tests call it again. */
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
    out[k] = { value: value ?? (k === "publicBaseUrl" || k === "titledbSource" || k === "publicDirectBaseUrl" || k === "retroPackUrl" ? "" : value), source: k in saved ? "saved" : "env", envValue: fromEnv ?? null };
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
