// A backup unit's manifest, as the Vita client and the import tool make it (the Vita repo's core/Manifest.cpp
// and tests/golden/fixture.jsonl are the reference): one object, keys in this order, written by JSON.stringify.
import { PLATFORMS } from "../platforms/index.js";

const SHA256_RE = /^[0-9a-f]{64}$/;
const NAME_MAX = 200;
const FILES_MAX = 200_000;

/** Whether `unit` may name a unit of `kind` on `platform`. */
export function validUnit(platform, kind, unit) {
  const spec = PLATFORMS[platform];
  if (!spec?.backupKinds.includes(kind)) return false;
  if (typeof unit !== "string" || !unit || Buffer.byteLength(unit) > NAME_MAX) return false;
  if (unit.includes("..") || unit.includes("\\") || unit.includes("\0")) return false;
  if (spec.titledKinds?.includes(kind) && !spec.titleId.test(unit)) return false;
  return true;
}

/** "<kind>:<unit>" split, or null when it names no unit of `platform`. */
export function parseUnitKey(platform, key) {
  if (typeof key !== "string") return null;
  const at = key.indexOf(":");
  if (at < 0) return null;
  const kind = key.slice(0, at);
  const unit = key.slice(at + 1);
  return validUnit(platform, kind, unit) ? { kind, unit, key } : null;
}

// A relative path inside a unit: '/' separated, no empty, '.' or '..' part, no backslash or NUL.
function validPath(path) {
  if (typeof path !== "string" || !path || Buffer.byteLength(path) > 1024 || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((part) => part && part !== "." && part !== "..");
}

const whole = (n) => Number.isSafeInteger(n) && n >= 0;
const text = (v) => typeof v === "string" && Buffer.byteLength(v) <= 4096;

/**
 * The manifest a console sent for `key`, checked and rewritten with its keys in order, or null when anything
 * is off: another platform, kind or unit than the key, a bad path, a secret listed with the files (or the other
 * way round), a path twice, a size or hash that is not one.
 */
export function normalizeManifest(platform, key, raw) {
  const unit = parseUnitKey(platform, key);
  if (!unit || !raw || typeof raw !== "object") return null;
  if (raw.format !== 1 || raw.platform !== platform || raw.kind !== unit.kind || raw.unit !== unit.unit) return null;
  if (![raw.root, raw.title, raw.version, raw.category].every(text)) return null;
  if (!Array.isArray(raw.files) || !Array.isArray(raw.secrets) || raw.files.length + raw.secrets.length > FILES_MAX) return null;
  const isSecret = PLATFORMS[platform].isSecretPath;
  const seen = new Set();
  const files = [];
  for (const f of raw.files) {
    if (!f || !validPath(f.path) || seen.has(f.path) || !whole(f.size) || !Number.isSafeInteger(f.mtime) || !SHA256_RE.test(f.sha256)) return null;
    if (isSecret(unit.kind, f.path)) return null;
    seen.add(f.path);
    files.push({ path: f.path, size: f.size, mtime: f.mtime, sha256: f.sha256 });
  }
  const secrets = [];
  for (const f of raw.secrets) {
    if (!f || !validPath(f.path) || seen.has(f.path) || !whole(f.size) || !Number.isSafeInteger(f.mtime) || "sha256" in f) return null;
    if (!isSecret(unit.kind, f.path)) return null;
    seen.add(f.path);
    secrets.push({ path: f.path, size: f.size, mtime: f.mtime });
  }
  return {
    format: 1, platform, kind: unit.kind, unit: unit.unit, root: raw.root, title: raw.title, version: raw.version,
    category: raw.category, files, secrets,
  };
}

export const manifestText = (manifest) => JSON.stringify(manifest);
