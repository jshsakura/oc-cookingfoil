/**
 * Reading environment variables without the two traps this repo kept hitting.
 *
 * Trap 1 — `process.env.X ?? 12` only catches undefined. An EMPTY value sails
 * through, and `Number("")` is 0. docker-compose writes exactly that: a
 * `${COOK_FOO:-}` passthrough sets the variable to an empty string whenever the
 * operator hasn't defined it. So "leave it unset to get the default" silently
 * produced 0 — a 1-request/minute rate limit, a lockout after one typo, a
 * zero-millisecond extraction timeout.
 *
 * Trap 2 — a typo'd value ("1o0") becomes NaN and then some nonsense clamp,
 * with nothing said about it. Here it falls back to the documented default and
 * says so on stderr.
 */

/** Raw value, treating empty/whitespace-only as absent. */
export function envRaw(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === "" ? undefined : trimmed;
}

export function envString(name, fallback = null) {
  return envRaw(name) ?? fallback;
}

/**
 * A number, or `fallback` when unset/blank/unparseable.
 * `min`/`max` clamp; `integer` rounds. An unusable value warns rather than
 * failing the boot — a shop server should still come up.
 */
export function envNumber(name, fallback, { min, max, integer = false } = {}) {
  const raw = envRaw(name);
  let value = fallback;

  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      value = parsed;
    } else {
      process.stderr.write(
        `[oc-cookingfoil] ${name}="${raw}" is not a number — using ${fallback}.\n`
      );
    }
  }

  if (integer) value = Math.round(value);
  if (min !== undefined) value = Math.max(min, value);
  if (max !== undefined) value = Math.min(max, value);
  return value;
}

/** True only for an explicit "true"/"1"/"yes"/"on". Blank means `fallback`. */
export function envBool(name, fallback = false) {
  const raw = envRaw(name);
  if (raw === undefined) return fallback;
  const lowered = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(lowered)) return true;
  if (["false", "0", "no", "off"].includes(lowered)) return false;
  process.stderr.write(
    `[oc-cookingfoil] ${name}="${raw}" is not a boolean — using ${fallback}.\n`
  );
  return fallback;
}
