/**
 * The plugins page as a tool: the read only. Switching a plugin on, deleting or restoring one runs or
 * moves code in this process, so those are for a person on the admin page and are not tools
 * (opt-out.js lists their routes as token-blocked).
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, num, obj, str } from "./shape.js";
import { romsDirPath } from "../helpers/envs.js";

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
        files: { type: "array", items: { type: "string" }, description: "Game file paths as the shop lists them, for example /Game/game.nsp; at most 200." },
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
];
