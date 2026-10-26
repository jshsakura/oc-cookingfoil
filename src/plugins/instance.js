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

let shared = null;

/** Tells the operator over Telegram (the "plugin" alert), and the log. */
export function notifyOperator({ id, event, reason, message, minutes }) {
  debug.log("plugins: %s: %s (%s) %s", id, event, reason, message ?? "");
  if (event === "cooling") alert("plugin", (t) => t("pluginCooling", { id, minutes }), { subject: `${id}:cooling` });
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

/** Starts the registry without holding the server back: a slow or failing plugin never delays listening. */
export function startPlugins() {
  const registry = pluginRegistry();
  const guards = createProcessGuards({
    onPluginRejection: (id, err) => registry.pluginRejected(id, err).catch((e) => debug.error("plugins: %s", e.message)),
    writeCrash: registry.writeCrash,
    clearBooting: registry.clearBooting,
  });
  guards.install();
  registry.init().then(() => registry.startWatching()).catch((err) => debug.error("plugins: start failed: %s", err.message));
  return registry;
}
