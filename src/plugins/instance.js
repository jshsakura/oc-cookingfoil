/**
 * The one registry the server runs, and what it tells the operator. COOK_PLUGINS_SAFE_MODE=1 starts the
 * server with every plugin off (their switches are kept) for the day a plugin makes it unusable.
 */
import debug from "../debug.js";
import { securityDb } from "../db/database.js";
import { alert } from "../helpers/alerts.js";
import * as env from "../helpers/envs.js";
import * as prodKeys from "../security/prod-keys.js";
import { createProcessGuards } from "./guard.js";
import { createRegistry } from "./registry.js";
import { createVariants } from "./variants.js";
import { createPluginCache } from "./cache.js";
import { createInstaller } from "./installer.js";
import { createRequestHooks } from "./request-hooks.js";
import { createEvents } from "./events.js";
import { connectPluginEvents } from "./emit.js";
import { pluginRoutes } from "./routes.js";
import { signingKey } from "../security/download-token.js";
import { createAgentCache } from "./agent-cache.js";
import { createAgentOrder } from "./agent-order.js";
import { createAgentRunner } from "./agent-runner.js";
import path from "node:path";
import * as libraryCache from "../meta/library-cache.js";
import { setNameSources } from "../retro/ko-names.js";

let shared = null;

/** Tells the operator over Telegram (the "plugin" alert), and the log. */
export function notifyOperator({ id, event, reason, message, minutes }) {
  debug.log("plugins: %s: %s (%s) %s", id, event, reason, message ?? "");
  if (event === "installed") alert("plugin", (t) => t("pluginInstalled", { id, version: message }), { subject: `${id}:installed` });
  else if (event === "cooling") alert("plugin", (t) => t("pluginCooling", { id, minutes }), { subject: `${id}:cooling` });
  else alert("plugin", (t) => t("pluginAutoOff", { id, why: message || reason }), { subject: `${id}:${event}` });
}

export const pluginRegistry = () => (shared ??= createRegistry({
  db: securityDb(),
  dataDir: env.dataDir,
  safeMode: process.env.COOK_PLUGINS_SAFE_MODE === "1",
  notify: notifyOperator,
  debug: { info: debug.log, warn: debug.log, error: debug.error },
  // What a plugin that says needsKeys may ask. The reading functions come with the first plugin that needs them.
  keysReader: Object.freeze({ present: () => prodKeys.status().present }),
  // Handed to the plan hook of a plugin that said needsKeys, for that call only.
  keysProvider: () => prodKeys.loadKeys(),
}));

let variantsShared = null;
/** The generic variant path (plugins/variants.js) on the shared registry. */
export const pluginVariants = () => (variantsShared ??= createVariants(pluginRegistry(), { log: (m) => debug.log("plugins: %s", m) }));

let requestShared = null;
/** beforeDownload (plugins/request-hooks.js) on the shared registry. */
export const pluginRequestHooks = () => (requestShared ??= createRequestHooks(pluginRegistry(), { log: (m) => debug.log("plugins: %s", m) }));

let eventsShared = null;
/** The event queues (plugins/events.js); the server's modules reach them through plugins/emit.js. */
export const pluginEvents = () => (eventsShared ??= createEvents(pluginRegistry(), { secret: () => signingKey(), log: (m) => debug.log("plugins: %s", m) }));

/** The router for /api/plugins/<id>/<name> (plugins/routes.js). */
export const pluginRouter = () => pluginRoutes(pluginRegistry(), { log: (m) => debug.log("plugins: %s", m) });
let cacheShared = null;
/** The bounded cache folders of the plugins (plugins/cache.js). */
export const pluginCache = () => (cacheShared ??= createPluginCache({ dataDir: env.dataDir, log: (m) => debug.log("plugins: %s", m) }));

let agentsShared = null;
/** What the metadata plugins said (plugins/agent-cache.js), the admin's order for each field, and the background runner that asks. */
export function agentParts() {
  if (!agentsShared) {
    const registry = pluginRegistry();
    const store = createAgentCache({ cacheDirOf: (id) => pluginCache().dirOf(id) });
    const order = createAgentOrder({ file: path.join(env.dataDir, "agent-order.json") });
    // A new answer changes names on screen: drop the lists the library kept.
    const runner = createAgentRunner({ registry, store, log: (m) => debug.log("plugins: %s", m), onChange: () => libraryCache.invalidate() });
    agentsShared = { registry, store, order, runner };
  }
  return agentsShared;
}

let installerShared = null;
/** Uploads of plugin zips from the admin page (plugins/installer.js) on the shared registry. */
export const pluginInstaller = () => (installerShared ??= createInstaller({ registry: pluginRegistry(), dataDir: env.dataDir, notify: notifyOperator }));

/** Starts the registry without holding the server back: a slow or failing plugin never delays listening. */
export function startPlugins() {
  const registry = pluginRegistry();
  const guards = createProcessGuards({
    onPluginRejection: (id, err) => registry.pluginRejected(id, err).catch((e) => debug.error("plugins: %s", e.message)),
    writeCrash: registry.writeCrash,
    clearBooting: registry.clearBooting,
  });
  guards.install();
  connectPluginEvents((kind, facts, who) => pluginEvents().emit(kind, facts, who));
  pluginCache().startSweeper();
  pluginInstaller().sweep().catch((err) => debug.error("plugins: clearing old uploads failed: %s", err.message));
  // Retro name dictionaries (provides "names") are data the core reads itself, never a hook call per game.
  setNameSources(() => registry.activeProviding("names").map((id) => ({ id, version: registry.versionOf(id), file: path.join(registry.paths.root, id, "names.json") })));
  registry.init().then(() => registry.startWatching()).catch((err) => debug.error("plugins: start failed: %s", err.message));
  return registry;
}
