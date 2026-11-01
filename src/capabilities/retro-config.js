/**
 * RetroArch's own settings in the base pack (src/routes/admin/retro-config-api.js): read them, change a
 * file's lines, put one line in every core's override, and put a change back. Every write is kept in the
 * history and can be undone; account keys (cheevos_*, passwords) are refused.
 */
import { defineCapability } from "./define.js";
import { arr, nullable, obj, str } from "./shape.js";

const REL = { type: "string", description: "retroarch.cfg, or config/<Core>/<Core>.cfg|.opt, or config/<Core>/<game>.cfg|.opt" };
const CHANGE = obj({ key: str(), from: nullable(str()), to: nullable(str()) });
const ENTRY = obj({ id: str("change id"), rel: str(), at: { type: "integer" }, by: nullable(str()), changes: arr(CHANGE), batch: str(), restoreOf: str() }, { optional: ["batch", "restoreOf"] });

const api = () => import("../routes/admin/retro-config-api.js");
const diff = (values, changes) => Object.entries(changes ?? {}).filter(([k, v]) => (values[k] ?? null) !== v).map(([key, to]) => ({ key, from: values[key] ?? null, to }));

export const retroConfigCapabilities = [
  defineCapability({
    id: "retro_config",
    area: "retro",
    title: "Read RetroArch settings",
    description: "The RetroArch settings the base pack sends: named settings with Switch defaults, each config file and its lines, the installed cores and their options. With rel: one file, and its history.",
    input: { type: "object", properties: { rel: REL } },
    output: { type: "object" },
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro-config" },
    also: ["GET /admin/api/retro-config/file", "GET /admin/api/retro-config/history"],
    handler: async (_ctx, { rel } = {}) => {
      const m = await api();
      if (rel) return { file: await m.raConfig.read(String(rel)), history: await m.raConfig.history({ rel: String(rel), limit: 20 }) };
      return m.retroConfigView("en");
    },
  }),
  defineCapability({
    id: "retro_config_set",
    area: "retro",
    title: "Change RetroArch config lines",
    description: "Sets or removes lines of one RetroArch config file, or with allCores of every core override. Overrides reach consoles with the next pack update, retroarch.cfg only new installs. Undoable.",
    input: {
      type: "object",
      properties: {
        rel: REL,
        changes: { type: "object", description: "Map of setting name to its new value as a string, or null to remove that line" },
        allCores: { type: "boolean", description: "Write the changes into the override of every installed core instead of rel, as one batch" },
      },
      required: ["changes"],
    },
    output: { type: "object" },
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-config/file" },
    also: ["POST /admin/api/retro-config/spread"],
    preview: async (_ctx, { rel, changes, allCores }) => {
      const m = await api();
      const rels = allCores ? (await m.installedCores()).map((c) => `config/${c.dir}/${c.dir}.cfg`) : [String(rel)];
      const files = [];
      for (const r of rels) {
        const d = diff((await m.raConfig.read(r)).values, changes);
        if (d.length) files.push({ rel: r, changes: d });
      }
      return { files };
    },
    previewOutput: obj({ files: arr(obj({ rel: str(), changes: arr(CHANGE) })) }),
    handler: async (ctx, { rel, changes, allCores }) => {
      const m = await api();
      if (!allCores) return m.writeRetroConfig(String(rel), changes, { by: ctx?.actor ?? null });
      return m.spreadRetroConfig(changes, { by: ctx?.actor ?? null });
    },
  }),
  defineCapability({
    id: "retro_config_undo",
    area: "retro",
    title: "Undo a RetroArch config change",
    description: "Puts a config file back as it was before one change, or every file of a batch, from the history retro_config shows with rel. The restore is itself a change that can be undone.",
    input: { type: "object", properties: { id: { type: "string", description: "A change id or batch id from retro_config's history of a file" } }, required: ["id"] },
    output: obj({ restored: arr(ENTRY), batch: nullable(str()) }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-config/restore" },
    preview: async (_ctx, { id }) => {
      const all = await (await api()).raConfig.history({ limit: 500 });
      return { undo: all.filter((e) => e.id === id || e.batch === id) };
    },
    previewOutput: obj({ undo: arr(ENTRY) }),
    handler: async (ctx, { id }) => (await api()).restoreRetroConfig(String(id), { by: ctx?.actor ?? null }),
  }),
];
