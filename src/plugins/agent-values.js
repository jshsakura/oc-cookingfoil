/**
 * The values of the metadata plugins for one title, in the shape field-merge.js reads.
 *
 *   agentValues(field, titleId, { lang? }) -> { "agent:<id>": value | undefined }
 *   agentOrder(field, base, titleId) -> the order to read the field in (field-merge orderOf)
 *
 * Only plugins that are switched on and providing metadata take part: turning one off takes its values
 * out of every screen at once, and turning it on brings them back without asking it again. Text a
 * plugin gave per language is read in the reader's language, then English (a Korean text is never shown
 * to a German reader); plain text counts for every language. Nothing here touches the disk or a plugin.
 */
import { fallbacks } from "../meta/langs.js";
import { agentSource, orderOf } from "../meta/field-merge.js";
import * as gameDescriptions from "../meta/game-descriptions.js";
import { agentParts } from "./instance.js";

const textIn = (value, lang) => {
  if (typeof value !== "object" || value === null) return value;
  for (const l of fallbacks(lang)) if (value[l]) return value[l];
  return undefined;
};

export function agentValues(field, titleId, { lang = "en" } = {}) {
  const { registry, store } = agentParts();
  const out = {};
  for (const id of registry.activeProviding("metadata")) {
    const entry = store.get(id, titleId);
    out[agentSource(id)] = entry && !entry.miss ? textIn(entry.fields[field], lang) : undefined;
  }
  return out;
}

export function agentOrder(field, base, titleId) {
  const { registry, order } = agentParts();
  const agents = registry.activeProviding("metadata");
  if (!agents.length) return base;
  return orderOf(base, { agents, configured: order.get(field), locked: gameDescriptions.locked(titleId).includes(field) });
}

/** The credit line of the plugin whose value the field took, for the detail view. */
export function creditOf(source, titleId) {
  if (!source?.startsWith("agent:")) return null;
  return agentParts().store.get(source.slice(6), titleId)?.credit ?? null;
}
