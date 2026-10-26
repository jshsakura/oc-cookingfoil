/**
 * The plugins page as a tool: the read only. Switching a plugin on, deleting or restoring one runs or
 * moves code in this process, so those are for a person on the admin page and are not tools
 * (opt-out.js lists their routes as token-blocked).
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, num, obj, str } from "./shape.js";

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
];
