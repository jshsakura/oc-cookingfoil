/**
 * The tools the model is shown, kept small however many MCP servers are connected.
 *
 * The built-in server's tools are always shown as they are (they are few: one per area). Tools of
 * external servers are shown in full, named `<server>__<tool>`, only while all of them fit the
 * budget. Past it they collapse into `tool_search` and `tool_call`: the model searches by what it
 * wants done, gets the few matching tools with their schemas, and calls one by name. The list the
 * model sees never changes during a conversation, so a prompt cache keeps hitting; new schemas
 * arrive as search results, not as a changed list.
 *
 * A tool of an external server is offered only when it says it is read-only or the admin gave it
 * a tier. Anything else is left out here, so it cannot be searched or called.
 */

export const SURFACE_BUDGET = 2000;
const SEARCH_LIMIT = 8;
const HIT_TEXT_MAX = 160;
const TIERS = new Set(["auto", "approve", "blocked"]);

/** A rough token count, enough to keep the list inside its budget (about 3 characters each). */
export const estimateTokens = (value) => Math.ceil(JSON.stringify(value).length / 3);

/** The tier of an external tool: the admin's choice when there is one, else auto for a read-only tool and blocked for the rest. */
export function externalTier(tool, configured) {
  if (configured !== undefined) return TIERS.has(configured) ? configured : "blocked";
  return tool?.annotations?.readOnlyHint === true ? "auto" : "blocked";
}

const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const SEARCH_TOOL = {
  name: "tool_search",
  description: "Find a tool of the connected services by what it should do. Returns a few matches with their input schemas; call one with tool_call.",
  inputSchema: { type: "object", properties: { q: { type: "string", description: "What you want to do, in a few words" } }, required: ["q"] },
};
const CALL_TOOL = {
  name: "tool_call",
  description: "Call a tool that tool_search returned, by its exact name.",
  inputSchema: { type: "object", properties: { name: { type: "string" }, args: { type: "object" } }, required: ["name"] },
};

export function buildToolSurface(servers, { budget = SURFACE_BUDGET, allow = {} } = {}) {
  const ordered = [...servers].sort(byName);
  const builtin = ordered.filter((s) => s.builtin).flatMap((s) => s.tools).map((t) => structuredClone(t)).sort(byName);

  const entries = new Map();
  for (const server of ordered.filter((s) => !s.builtin)) {
    for (const tool of [...server.tools].sort(byName)) {
      const tier = externalTier(tool, allow?.[server.name]?.[tool.name]);
      if (tier === "blocked") continue;
      let key = `${slug(server.name)}__${slug(tool.name)}`.slice(0, 64);
      for (let n = 2; entries.has(key); n++) key = `${key.slice(0, 60)}_${n}`;
      entries.set(key, {
        server: server.name,
        tool: tool.name,
        tier,
        def: { name: key, description: tool.description ?? "", inputSchema: structuredClone(tool.inputSchema ?? { type: "object", properties: {} }) },
      });
    }
  }

  const full = [...builtin, ...[...entries.values()].map((e) => e.def)];
  const collapsed = estimateTokens(full) > budget;
  const tools = collapsed ? [...builtin, SEARCH_TOOL, CALL_TOOL] : full;

  return {
    tools,
    collapsed,

    /** The external tool a name stands for, or null. */
    resolve(name) {
      const e = typeof name === "string" ? entries.get(name) : undefined;
      return e ? { server: e.server, tool: e.tool } : null;
    },

    tierOf(name) {
      return entries.get(name)?.tier ?? null;
    },

    /** Up to a few external tools that match the words of `q`, best first, each with its schema. */
    search(q) {
      const wanted = [...new Set(words(q))];
      if (!wanted.length) return [];
      const need = Math.ceil(wanted.length / 2);
      const scored = [];
      for (const [key, e] of entries) {
        const nameWords = new Set(words(key));
        const descWords = new Set(words(e.def.description));
        let matched = 0;
        let score = 0;
        for (const w of wanted) {
          if (nameWords.has(w)) { matched++; score += 3; } else if (descWords.has(w)) { matched++; score += 1; }
        }
        if (matched >= need) scored.push({ key, score, e });
      }
      scored.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
      return scored.slice(0, SEARCH_LIMIT).map(({ e }) => ({ ...e.def, description: e.def.description.slice(0, HIT_TEXT_MAX) }));
    },
  };
}
