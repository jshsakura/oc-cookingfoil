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
 * A metadata plugin is a source too, named "agent:<plugin id>". orderOf() puts the plugins of the
 * library after the built-in sources unless the admin set an order for the field (plugins/agent-order.js);
 * a field the admin locked is read without them.
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

export const agentSource = (id) => `agent:${id}`;
const isAgent = (source) => typeof source === "string" && source.startsWith("agent:");

/**
 * The order a field is read in when metadata plugins may take part.
 *   base        the field's order without plugins
 *   agents      ids of the active metadata plugins
 *   configured  the admin's list for the field, or null
 *   locked      true when the admin locked the field: plugins are left out
 * The admin's own text stays first. A configured list names sources in the order wanted; a built-in
 * source it leaves out keeps its place after them, and a plugin that is not active is skipped.
 */
export function orderOf(base, { agents = [], configured = null, locked = false } = {}) {
  const live = new Set(agents.map(agentSource));
  if (locked || (!live.size && !configured)) return base;
  if (!configured) {
    const last = base[base.length - 1] === FILENAME ? base.length - 1 : base.length;
    return [...base.slice(0, last), ...live, ...base.slice(last)];
  }
  const wanted = configured.filter((s) => s !== ADMIN && (!isAgent(s) || live.has(s)));
  const unlisted = base.filter((s) => s !== ADMIN && !wanted.includes(s));
  const rest = [...live].filter((s) => !wanted.includes(s));
  const all = [...wanted, ...unlisted];
  const last = all[all.length - 1] === FILENAME ? all.length - 1 : all.length;
  return [...(base.includes(ADMIN) ? [ADMIN] : []), ...all.slice(0, last), ...rest, ...all.slice(last)];
}

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
