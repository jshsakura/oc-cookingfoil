/**
 * What the admin page and the tools do with the metadata plugins: read how each field is ordered, change
 * the order, and delete one plugin's values. One place, so the page and the tool cannot drift.
 *
 *   agentState()            { fields, order, defaults, plugins: [{ id, state, cached, asked, answered, empty, failed, waiting, lastAt }] }
 *   setAgentOrder(patch)    a field to its list of sources, or to null for the usual order -> the order now
 *   clearAgentValues(id)    deletes what that plugin said about titles; it is asked again as titles come up
 */
import { AGENT_FIELDS } from "./agent-answer.js";
import { OrderError } from "./agent-order.js";
import { ORDER, ADMIN, LOCAL_PREFERRED, TITLEDB, LOCAL, FILENAME, agentSource, orderOf } from "../meta/field-merge.js";
import { agentParts } from "./instance.js";

export { OrderError };
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// The built-in sources a field has where the list screens read it (meta/field-merge.js ORDER, plus the plugins).
const BUILT_IN = Object.freeze({
  name: [ADMIN, LOCAL_PREFERRED, TITLEDB, LOCAL, FILENAME],
  publisher: ORDER.publisher,
  description: ORDER.description,
  releaseDate: ORDER.releaseDate,
  size: ORDER.size,
});

export function agentState() {
  const { registry, order, runner } = agentParts();
  const agents = registry.activeProviding("metadata");
  const plugins = registry.list().filter((p) => p.provides?.includes("metadata")).map((p) => ({ id: p.id, state: p.state, ...runner.stats(p.id) }));
  const defaults = Object.fromEntries(AGENT_FIELDS.map((f) => [f, orderOf(BUILT_IN[f], { agents })]));
  return { fields: [...AGENT_FIELDS], order: order.all(), defaults, plugins, sources: agents.map(agentSource) };
}

export function setAgentOrder(patch) {
  return agentParts().order.set(patch);
}

export async function clearAgentValues(id) {
  const { store, registry } = agentParts();
  if (!ID_RE.test(id) || !registry.list().some((p) => p.id === id)) return false;
  await store.forget(id, { remove: true });
  return true;
}
