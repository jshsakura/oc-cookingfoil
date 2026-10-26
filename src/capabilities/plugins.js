/**
 * The plugins page as a tool: the read only. Switching a plugin on, deleting or restoring one runs or
 * moves code in this process, so those are for a person on the admin page and are not tools
 * (opt-out.js lists their routes as token-blocked).
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, num, obj, str } from "./shape.js";
import { romsDirPath } from "../helpers/envs.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const agents = () => import("../plugins/agent-admin.js");
const FIELDS = ["name", "publisher", "description", "releaseDate", "size"];

const registry = async () => (await import("../plugins/instance.js")).pluginRegistry();

export const pluginsCapabilities = [
  defineCapability({
    id: "plugin_list",
    area: "plugins",
    title: "List plugins",
    description: "Lists the plugins found in data/plugins with their state (on, off, cooling, failed, broken ...), last error and why one was switched off. Read only.",
    input: { type: "object", properties: {} },
    output: obj({
      safeMode: bool("true when COOK_PLUGINS_SAFE_MODE holds every plugin off"),
      plugins: arr(obj({
        id: str(),
        name: { type: "object", description: "display name by language code, at least en" },
        version: nullable(str()),
        state: str("on, off, cooling, starting, failed, auto-disabled, crash-disabled, broken, incompatible or missing"),
        enabled: bool("the operator's switch; a plugin can be enabled and not running"),
        provides: arr(str(), "metadata, art, variant or task"),
        needsKeys: bool(),
        problems: arr(str(), "why a broken plugin does not load"),
        lastError: nullable(str("first line of the last error")),
        lastErrorAt: nullable(num("epoch ms")),
        failStreak: int("start failures in a row"),
        hookStreak: int("hook failures in a row"),
        disabledReason: nullable(str()),
        retryAt: nullable(num("epoch ms a cooling plugin is tried again")),
      }, { description: "also description, hosts, needs, disabledAt, variantKeys, safeMode" })),
      trashed: arr(obj({ name: str(), id: str(), version: nullable(str()), trashedAt: num("epoch ms") }), "plugins deleted into the plugins' own trash"),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/plugins" },
    handler: async () => {
      const r = await registry();
      return { safeMode: r.safeMode, plugins: r.list(), trashed: await r.listTrashed() };
    },
  }),
  defineCapability({
    id: "library_variants",
    area: "library",
    title: "Download options of game files",
    description: "Asks the plugins which download options each game file has (up to 200 files). The answer is read only and changes nothing on the server.",
    input: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Game file paths as the library lists them, for example /Game/game.nsp; at most 200." },
        firmware: { type: "string", description: "The console's firmware, for example 21.0.1, if the options depend on it. Optional." },
        region: { type: "string", description: "The console's region: jpn, usa, eur, aus, htk, chn, kor or twn. Optional." },
        lang: { type: "string", description: "Language code for the option texts, for example ko. Optional, English by default." },
      },
      required: ["files"],
    },
    output: obj({
      variants: { type: "object", description: "per file as asked: a list of { id, label, note?, confirm?, query }" },
    }),
    safety: "read",
    http: { method: "POST", path: "/api/library/variants" },
    handler: async (_ctx, input) => {
      const { pluginVariants } = await import("../plugins/instance.js");
      const { variantsOf } = await import("../routes/library-variants.js");
      const { parseConsoleHeader } = await import("../plugins/variants.js");
      const { parseLang } = await import("../meta/langs.js");
      const facts = parseConsoleHeader(Object.entries({ firmware: input.firmware, region: input.region }).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; "));
      return { variants: await variantsOf({ root: romsDirPath, variants: pluginVariants }, (input.files ?? []).slice(0, 200), { lang: parseLang(input.lang ?? "") ?? "en", facts, clientVersion: null }) };
    },
  }),
  defineCapability({
    id: "agent_list",
    area: "plugins",
    title: "Where field values come from",
    description: "For name, publisher, description, release date and size: the order the sources are read in, the usual order, and what each metadata plugin has asked, answered and kept.",
    input: { type: "object", properties: {} },
    output: obj({
      fields: arr(str(), "the fields that can take a value from a metadata plugin"),
      order: { type: "object", description: "field to the order the admin set: built-in sources and agent:<plugin id>; fields not listed read in the usual order" },
      defaults: { type: "object", description: "field to its usual order with the active metadata plugins placed in it; the admin's own text is always first and not listed" },
      sources: arr(str(), "agent:<plugin id> of each metadata plugin that is on"),
      plugins: arr(obj({ id: str(), state: str(), asked: int(), answered: int(), empty: int("titles it knew nothing of"), failed: int(), waiting: int(), cached: int("titles with a kept answer"), lastAt: nullable(num("epoch ms")) })),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/plugins/agents" },
    handler: async () => (await agents()).agentState(),
  }),
  defineCapability({
    id: "agent_order",
    area: "plugins",
    title: "Set where field values come from",
    description: "Sets the order sources are read in for one or more fields; null puts a field back to the usual order. Saved at once, no restart. The admin's own text always stays first.",
    input: {
      type: "object",
      properties: { order: { type: "object", description: "Field name to a list of sources (built-in or agent:<plugin id>), or null for the usual order; see agent_list" } },
      required: ["order"],
    },
    output: obj({ order: { type: "object", description: "the order saved for each field now" } }),
    preview: async (_ctx, input) => {
      const { agentState } = await agents();
      const now = agentState();
      const changes = Object.entries(input.order ?? {}).filter(([f]) => FIELDS.includes(f)).map(([field, to]) => ({ field, from: now.order[field] ?? null, to }));
      return { changes };
    },
    previewOutput: obj({ changes: arr(obj({ field: str(), from: nullable(arr(str())), to: nullable(arr(str())) })) }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/plugins/agents/order" },
    handler: async (_ctx, input) => {
      const { setAgentOrder, OrderError } = await agents();
      try {
        return { order: setAgentOrder(input.order) };
      } catch (err) {
        if (err instanceof OrderError) throw fail(400, `The order is not valid (${err.code}): fields are ${FIELDS.join(", ")}, each a list of up to 16 different sources`);
        throw err;
      }
    },
  }),
  defineCapability({
    id: "agent_clear",
    area: "plugins",
    title: "Delete a metadata plugin's values",
    description: "Deletes what one metadata plugin said about titles. The plugin is asked again as titles come up; its own cache and the other plugins are not touched.",
    input: { type: "object", properties: { id: { type: "string", description: "The plugin's id as plugin_list shows it, for example retro-db" } }, required: ["id"] },
    output: obj({ cleared: bool() }),
    preview: async (_ctx, input) => {
      const { agentState } = await agents();
      const p = agentState().plugins.find((x) => x.id === input.id);
      if (!p) throw fail(404, "No metadata plugin with that id");
      return { changes: `Deletes the ${p.cached} kept answers of ${input.id}. It is asked again as titles come up.` };
    },
    previewOutput: obj({ changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/plugins/agents/clear" },
    handler: async (_ctx, input) => {
      const { clearAgentValues } = await agents();
      if (!(await clearAgentValues(String(input.id)))) throw fail(404, "No metadata plugin with that id");
      return { cleared: true };
    },
  }),
];
