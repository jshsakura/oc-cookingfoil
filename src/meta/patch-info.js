/**
 * What each user patch is called and says about itself, kept by the server in
 * ${COOK_DATA_DIR}/patches/info.json and edited from the admin page:
 *
 *   { version: 1, patches: { <key>: { info, missing_since } } }
 *
 *   key   "<base title id>/<patch folder>" for a game's patch (the id in capitals),
 *         "homebrew/<app>/<patch folder>" for a homebrew app's; the folder name in NFC
 *   info  { name?, version?, game_version?, update_version?, author?, description?,
 *           required?, ko?: { name?, description? } }  (the shape a patch is listed with)
 *
 * This file is the only source of a patch's information. A patch.json in a
 * patch folder is an import file: the first time a folder is seen and this
 * file has no entry for it, its patch.json is copied in once. From then on
 * the patch.json is not read again, even when it changes, and the server
 * never writes one. That one rule covers both the patches that were there
 * before this file existed and a folder the operator drops in by hand later.
 * A patch with neither shows the defaults (its folder name, nothing else).
 *
 * An upload writes its entry here; moving a patch to another game moves the
 * entry, and deleting a patch from the admin page drops it.
 *
 * Retention: an entry whose folder a finished scan did not find is kept and
 * marked with the time it went missing; it is forgotten once it has been
 * missing for 30 days. A folder that comes back before then (renamed back,
 * a disk mounted again) finds its edits as they were, and its patch.json is
 * not imported over them.
 *
 * Loaded once, then read from memory; every change is written to a temporary
 * file and renamed over the old one.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "patches", "info.json");
export const FIELD_MAX = { name: 120, version: 40, game_version: 40, author: 120, description: 2000 };
const KO_MAX = { name: FIELD_MAX.name, description: FIELD_MAX.description };
export const RETAIN_MS = 30 * 24 * 3600_000;
const TITLE_ID_RE = /^[0-9A-F]{16}$/;
const APP_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
const FIELD_LABEL = { name: "이름", version: "버전", game_version: "게임 버전", author: "만든 사람", description: "설명" };

let saved = null; // key → { info, missing_since }

export class InfoError extends Error {}

/**
 * The store key of a patch folder: `dir` is the title id folder (any case) or
 * "homebrew/<app>". null when it is neither. Pure.
 */
export function keyOf(dir, folder) {
  const name = String(folder ?? "").normalize("NFC");
  if (!name || name.includes("/")) return null;
  const d = String(dir ?? "");
  if (d.startsWith("homebrew/")) {
    const app = d.slice("homebrew/".length);
    return APP_RE.test(app) ? `homebrew/${app}/${name}` : null;
  }
  return TITLE_ID_RE.test(d.toUpperCase()) ? `${d.toUpperCase()}/${name}` : null;
}

/** A positive update version number (from a number or a digit string), else null. Pure. */
export function updateVersionOf(value) {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff ? n : null;
}

function strings(raw, limits) {
  const out = {};
  for (const [key, max] of Object.entries(limits)) {
    const v = raw?.[key];
    if (typeof v === "string" || typeof v === "number") {
      const s = String(v).replace(/\r\n/g, "\n").trim().slice(0, max);
      if (s) out[key] = s;
    }
  }
  return out;
}

/**
 * Patch information as trimmed, length-capped strings; anything else dropped.
 * Lenient: what a hand-written patch.json holds is taken as far as it fits.
 * `required: true` marks a patch the game does not start without. `ko` holds
 * the Korean name and description when they differ from the default text.
 * `update_version` is the update the patch was made for (2097152 for
 * v2097152), for reference only. Pure.
 */
export function normalize(raw) {
  const out = strings(raw, FIELD_MAX);
  if (raw?.required === true) out.required = true;
  const update = updateVersionOf(raw?.update_version);
  if (update) out.update_version = update;
  const ko = strings(raw?.ko, KO_MAX);
  if (Object.keys(ko).length) out.ko = ko;
  return out;
}

/**
 * An edit checked strictly: every text field a string (or absent) within its
 * limit, `ko` an object, `required` a boolean, `update_version` a version
 * number or empty. Throws InfoError with a message for the admin. Pure.
 */
export function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InfoError("패치 정보는 JSON 객체로 보냅니다");
  const check = (obj, limits, prefix) => {
    for (const [key, max] of Object.entries(limits)) {
      const v = obj[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== "string") throw new InfoError(`${prefix}${FIELD_LABEL[key]}은 글자로 적습니다`);
      if (v.trim().length > max) throw new InfoError(`${prefix}${FIELD_LABEL[key]}은 ${max}자까지 적습니다`);
    }
  };
  check(input, FIELD_MAX, "");
  if (!String(input.name ?? "").trim()) throw new InfoError("이름을 적습니다");
  if (input.ko !== undefined && input.ko !== null && (typeof input.ko !== "object" || Array.isArray(input.ko))) {
    throw new InfoError("ko 는 { name, description } 객체로 보냅니다");
  }
  check(input.ko ?? {}, KO_MAX, "한국어 ");
  if (input.required !== undefined && typeof input.required !== "boolean") throw new InfoError("required 는 true 나 false 입니다");
  const raw = input.update_version;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "" && !updateVersionOf(raw)) {
    throw new InfoError("필요한 업데이트는 v 뒤의 숫자(예: 2097152)로 고릅니다");
  }
  return normalize(input);
}

function all() {
  if (saved) return saved;
  saved = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const [key, entry] of Object.entries(raw?.patches ?? {})) {
      if (!entry || typeof entry !== "object") continue;
      saved.set(key, { info: normalize(entry.info), missing_since: Number.isFinite(entry.missing_since) ? entry.missing_since : null });
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return saved;
}

function persist(next) {
  const body = { version: 1, patches: Object.fromEntries([...next].sort(([a], [b]) => (a < b ? -1 : 1))) };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(body, null, 1)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
}

/** True when the store holds an entry for the key (imported, uploaded or edited). */
export function has(key) {
  return all().has(key);
}

/** The patch's information, or null when the store has none for it. */
export function get(key) {
  return all().get(key)?.info ?? null;
}

/** Every entry, for the admin: [{ key, info, missing_since }]. */
export function entries() {
  return [...all()].map(([key, e]) => ({ key, info: e.info, missing_since: e.missing_since }));
}

/** Save a patch's information (already normalized or validated). */
export function set(key, info) {
  if (!key) return false;
  persist(new Map(all()).set(key, { info: normalize(info), missing_since: null }));
  return true;
}

/**
 * Take a patch.json's fields into the store when it has no entry for the key
 * yet; true when it did. Once imported, a later patch.json is never read.
 */
export function importOnce(key, raw) {
  if (!key || has(key)) return false;
  set(key, raw);
  return true;
}

/** The entry under a new key (a patch moved to another game); one already there is replaced. */
export function move(from, to) {
  const entry = all().get(from);
  if (!entry || !to || from === to) return false;
  const next = new Map(all());
  next.delete(from);
  next.set(to, { ...entry, missing_since: null });
  persist(next);
  return true;
}

/** Forget a patch deleted from the admin page. */
export function remove(key) {
  if (!has(key)) return false;
  const next = new Map(all());
  next.delete(key);
  persist(next);
  return true;
}

/**
 * After a finished scan: entries of folders it found are marked present, the
 * others missing from now, and those missing for longer than RETAIN_MS are
 * dropped. Written only when something changed.
 */
export function sweep(foundKeys, now = Date.now()) {
  const found = new Set(foundKeys);
  const next = new Map();
  let changed = false;
  for (const [key, entry] of all()) {
    if (found.has(key)) {
      if (entry.missing_since !== null) changed = true;
      next.set(key, entry.missing_since === null ? entry : { ...entry, missing_since: null });
    } else if (entry.missing_since === null) {
      changed = true;
      next.set(key, { ...entry, missing_since: now });
    } else if (now - entry.missing_since > RETAIN_MS) {
      changed = true;
    } else {
      next.set(key, entry);
    }
  }
  if (changed) persist(next);
  return changed;
}

/** For tests: forget everything, on disk too. */
export function reset() {
  saved = new Map();
  fs.rmSync(FILE, { force: true });
}
