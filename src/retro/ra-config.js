/**
 * RetroArch's config text (retroarch.cfg, a core's <Core>.cfg override, its <Core>.opt options):
 * one `key = "value"` per line, `#` comments, blank lines. Edits keep every other line as it was.
 *
 *   readCfg(text)            Map key → value, the last line of a key winning as RetroArch reads it
 *   editCfg(text, changes)   text with changes { key: value | null } applied: a set key replaces its first
 *                            line (and drops repeats), a new key goes at the end, null removes the key
 *
 * Keys that carry an account (cheevos_*, anything named for a password, token or user name) are never
 * read out or written here: base-pack.js strips cheevos_ lines from what consoles get, and the
 * client writes the RetroAchievements sign-in itself.
 */

const LINE_RE = /^[ \t]*([A-Za-z0-9_.\-]+)[ \t]*=[ \t]*(?:"([^"\n]*)"|([^\s#"]*))[ \t]*(?:#.*)?$/;
export const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}$/;
export const VALUE_MAX = 1024;
const SECRET_RE = /^cheevos_|pass|token|secret|user(name)?$|_user$|nickname/i;

export const isSecretKey = (key) => SECRET_RE.test(key);

export class CfgError extends Error {
  constructor(code, vars = {}) {
    super(code);
    this.code = code;
    this.vars = vars;
  }
}

/** Why `key = value` can't be written, as a code, or null. Pure. */
export function badPair(key, value) {
  if (typeof key !== "string" || !KEY_RE.test(key)) return "badKey";
  if (isSecretKey(key)) return "secretKey";
  if (value === null) return null;
  if (typeof value !== "string" || value.length > VALUE_MAX || /["\r\n\0]/.test(value)) return "badValue";
  return null;
}

const lineKey = (line) => LINE_RE.exec(line)?.[1] ?? null;

/** Map key → value of the text, secrets left out. Pure. */
export function readCfg(text) {
  const out = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (m && !isSecretKey(m[1])) out.set(m[1], m[2] ?? m[3] ?? "");
  }
  return out;
}

/** The text with `changes` applied; throws CfgError for a pair badPair refuses. Pure. */
export function editCfg(text, changes) {
  const entries = Object.entries(changes ?? {});
  for (const [key, value] of entries) {
    const bad = badPair(key, value);
    if (bad) throw new CfgError(bad, { key });
  }
  const want = new Map(entries);
  const done = new Set();
  const src = String(text ?? "");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.length ? src.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const out = [];
  for (const line of lines) {
    const key = lineKey(line);
    if (key === null || !want.has(key)) {
      out.push(line);
      continue;
    }
    if (done.has(key) || want.get(key) === null) continue;
    done.add(key);
    out.push(`${key} = "${want.get(key)}"`);
  }
  for (const [key, value] of want) if (value !== null && !done.has(key)) out.push(`${key} = "${value}"`);
  return out.length ? out.join(eol) + eol : "";
}

/** Whether the text holds anything but blank lines. Pure. */
export const hasContent = (text) => /\S/.test(String(text ?? ""));

/** [{ key, from, to }] between two texts' readable values. Pure. */
export function cfgDiff(before, after) {
  const a = readCfg(before);
  const b = readCfg(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  return keys.filter((k) => a.get(k) !== b.get(k)).map((k) => ({ key: k, from: a.get(k) ?? null, to: b.get(k) ?? null }));
}
