/**
 * Which source a field of an item comes from, in one place.
 *
 *   mergeField(field, values, { order?, skipEmpty? }) -> { value, source }
 *
 * `values` maps a source to what it has for the item (undefined or null when it has nothing). The field's
 * order (ORDER, or the caller's) says which source is asked first; the first one that has a value wins and
 * the result names it, so a screen can say where a value came from. `skipEmpty` also passes over "" and 0,
 * for the places that always read a field with `||`; the others read it with `??`. Like `a || b || c`, the
 * last source in the order gives its value even when empty. A value may be a function, called only when the
 * sources before it had nothing.
 *
 * The sources are the admin's own text (game.json, which also wins when it locks a field), the game file's own
 * title (local-files), titledb, and last the file name. "local-preferred" is the game file's title when its
 * language outranks every language titledb has (meta/name-pick.js); "local" is it as a fallback.
 */

export const ADMIN = "admin";
export const LOCAL_PREFERRED = "local-preferred";
export const TITLEDB = "titledb";
export const LOCAL = "local";
export const FILENAME = "filename";

/** The order each field is read in today. A field not listed here reads its values in the order the caller gave them. */
export const ORDER = Object.freeze({
  name: Object.freeze([ADMIN, LOCAL_PREFERRED, TITLEDB, LOCAL, FILENAME]),
  publisher: Object.freeze([TITLEDB, LOCAL]),
  description: Object.freeze([ADMIN, TITLEDB, LOCAL]),
  releaseDate: Object.freeze([TITLEDB, LOCAL]),
  size: Object.freeze([TITLEDB, LOCAL]),
});

const NONE = Object.freeze({ value: null, source: null });

export function mergeField(field, values, { order = ORDER[field] ?? Object.keys(values), skipEmpty = false } = {}) {
  for (const source of order) {
    const raw = values[source];
    const value = typeof raw === "function" ? raw() : raw;
    if (value === undefined || value === null) continue;
    if (skipEmpty && !value && source !== order[order.length - 1]) continue;
    return { value, source };
  }
  return NONE;
}

/** The value alone, for a caller that does not show where it came from. */
export const valueOf = (field, values, options) => mergeField(field, values, options).value;
