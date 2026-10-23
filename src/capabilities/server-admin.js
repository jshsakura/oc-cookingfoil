/**
 * The server itself: its status and safe restart, the settings tab, and the three jobs the settings
 * tab starts (rescan folders, today's backup, the titledb fetch). Settings that decide who may sign
 * in and which addresses consoles are sent to stay with the admin page (TOKEN_LOCKED), as for any token.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";
import drainer from "../security/drain.js";
import * as serverSettings from "../security/server-settings.js";
import * as folderSync from "../meta/folder-sync.js";
import * as backups from "../db/backup.js";
import * as titledbStore from "../meta/titledb-store.js";
import { TOKEN_LOCKED } from "../routes/admin/server-settings-api.js";
import { applyServerSettings, SettingsRefusal, startTitledbRefresh, titledbFetching } from "../routes/admin/server-settings-apply.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
// The answer to the restart call has to leave before the drain begins.
const RESTART_DELAY_MS = 1500;
const TASKS = {
  sync: "read every library folder again",
  backup: "make today's database backup",
  titledb: "fetch the titledb files again",
};

const STATUS = obj({
  draining: bool("a restart is under way"),
  uptime: int("seconds since start"),
  inflight: int("requests in flight"),
  downloads: int("downloads in flight"),
  graceSeconds: int("how long a restart waits for them"),
}, { description: "also restartId, startedAt, backBy and retryAfter while draining" });

const status = () => ({ ...drainer.status(), uptime: Math.round(process.uptime()) });

export const serverAdminCapabilities = [
  defineCapability({
    id: "server_status",
    area: "admin",
    title: "Server status",
    description: "Whether the server is restarting, how long it has been up, and how many requests and downloads are in flight. Check before server_restart.",
    input: { type: "object", properties: {} },
    output: STATUS,
    safety: "read",
    http: { method: "GET", path: "/admin/api/server/status" },
    handler: async () => status(),
  }),
  defineCapability({
    id: "server_restart",
    area: "admin",
    title: "Restart the server",
    description: "Restarts the server safely: it stops taking new work, waits for downloads in flight up to the grace time, then exits and comes back by itself.",
    input: { type: "object", properties: {} },
    output: obj({ restarting: bool(), graceSeconds: int() }),
    preview: async () => {
      const s = status();
      return {
        inflight: s.inflight, downloads: s.downloads, graceSeconds: s.graceSeconds ?? null, canRestart: drainer.hasRestartHandler(),
        changes: "Consoles and this connection drop for a short while. Downloads in flight get the grace time to finish, then are cut. The server comes back by itself.",
      };
    },
    previewOutput: obj({ inflight: int(), downloads: int(), graceSeconds: nullable(int()), canRestart: bool("false when this run has no restart handler"), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/server/restart" },
    mcp: true,
    handler: async () => {
      if (!drainer.hasRestartHandler()) throw fail(503, "This server was not started in a way that can restart itself");
      setTimeout(() => drainer.requestRestart(), RESTART_DELAY_MS).unref?.();
      return { restarting: true, graceSeconds: status().graceSeconds ?? 0 };
    },
  }),
  defineCapability({
    id: "settings_get",
    area: "admin",
    title: "Read server settings",
    description: "The server settings and their values, which of them were changed from the compose values, and which ones only the admin page may change.",
    input: { type: "object", properties: { name: { type: "string", description: "One setting's name, to read just that one with its compose value" } } },
    output: obj({
      values: { type: "object", description: "setting name to its value" },
      changed: arr(str(), "names saved over the compose value"),
      adminOnly: arr(str(), "names a token cannot change; use the admin page"),
      titledb: obj({ fetching: bool() }, { description: "also the titledb status" }),
      sync: { type: "object", description: "the folder rescan's status" },
      backup: { type: "object", description: "the database backup's status" },
      compose: nullable(str("with name: the value from the compose file")),
    }, { optional: ["compose"] }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/server-settings" },
    handler: async (_ctx, input) => {
      const all = serverSettings.describe();
      if (input.name !== undefined && !all[input.name]) throw fail(404, `no setting ${input.name}; settings_get without name lists them`);
      const names = input.name ? [input.name] : Object.keys(all);
      return {
        values: Object.fromEntries(names.map((k) => [k, all[k].value])),
        changed: names.filter((k) => all[k].source === "saved"),
        adminOnly: TOKEN_LOCKED,
        titledb: { ...titledbStore.status(), fetching: titledbFetching() },
        sync: folderSync.status(),
        backup: backups.status(),
        ...(input.name ? { compose: all[input.name].envValue === null ? null : String(all[input.name].envValue) } : {}),
      };
    },
  }),
  defineCapability({
    id: "settings_set",
    area: "admin",
    title: "Change server settings",
    description: "Saves server settings at once, no restart. A value of null goes back to the compose value. Sign-in and address settings are for the admin page.",
    input: {
      type: "object",
      properties: { values: { type: "object", description: "Setting name to its new value, or null for the compose value; names from settings_get" } },
      required: ["values"],
    },
    output: obj({ changed: arr(str()) }),
    preview: async (_ctx, input) => {
      const values = valuesOf(input);
      const now = serverSettings.describe();
      return { changes: Object.entries(values).map(([name, to]) => ({ name, from: now[name].value, to })), changed: Object.keys(values).filter((k) => JSON.stringify(now[k].value) !== JSON.stringify(values[k])) };
    },
    previewOutput: obj({ changes: arr(obj({ name: str(), from: {}, to: {} }, { description: "from and to are the setting's values" })), changed: arr(str("names whose value would differ")) }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/server-settings" },
    handler: async (_ctx, input) => {
      const values = valuesOf(input);
      try {
        return { changed: await applyServerSettings(values) };
      } catch (err) {
        if (err instanceof SettingsRefusal) throw fail(err.status, `${err.message}${err.field ? ` (${err.field})` : ""}`);
        throw err;
      }
    },
  }),
  defineCapability({
    id: "server_task",
    area: "admin",
    title: "Run a server task now",
    description: "Starts a server task in the background: sync (rescan folders), backup (today's database backup) or titledb (fetch the titledb again). Follow it with jobs_list.",
    input: {
      type: "object",
      properties: { task: { type: "string", enum: Object.keys(TASKS), description: "sync rescans the folders, backup makes today's backup, titledb fetches the titledb again" } },
      required: ["task"],
    },
    output: obj({ started: oneOf(Object.keys(TASKS)), already: bool("it was running, so nothing new started") }),
    preview: async (_ctx, input) => {
      taskOf(input);
      return { task: input.task, changes: `Will ${TASKS[input.task]}. It runs in the background and changes no setting.` };
    },
    previewOutput: obj({ task: str(), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/server-settings/sync-now" },
    also: ["POST /admin/api/server-settings/backup-now", "POST /admin/api/server-settings/titledb-refresh"],
    handler: async (_ctx, input) => {
      taskOf(input);
      if (input.task === "sync") folderSync.syncNow("mcp").catch(() => {});
      else if (input.task === "backup") backups.backupNow();
      else return { started: "titledb", already: !startTitledbRefresh() };
      return { started: input.task, already: false };
    },
  }),
];

function valuesOf(input) {
  const values = input.values;
  if (!values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length) throw fail(400, "values is an object of setting name to value; see settings_get");
  const now = serverSettings.describe();
  for (const name of Object.keys(values)) {
    if (!now[name]) throw fail(404, `no setting ${name}; settings_get lists them`);
    if (TOKEN_LOCKED.includes(name)) throw fail(403, `${name} decides who may sign in or where consoles connect; change it on the admin page`);
  }
  return values;
}

function taskOf(input) {
  if (!Object.hasOwn(TASKS, input.task)) throw fail(400, `task is one of ${Object.keys(TASKS).join(", ")}`);
}
