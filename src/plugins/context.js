/**
 * The ctx a plugin's start() receives. Small on purpose: what a plugin may touch is what is listed here.
 *
 *   settings.get(key)      the operator's value, else the manifest's default
 *   fetch(url, init)       only https and only the hosts the manifest names, redirects included. This
 *                          catches mistakes; it does not isolate code that runs in this process.
 *   log.info/warn/error    prefixed with the plugin id
 *   cacheDir               data/plugin-cache/<id>, made on first use
 *   keys                   only when the manifest says needsKeys: a function that reads, never the key text
 *   defineCapability(def)  the id must start with plugin_<id with _>_ ; area is always "plugins"
 */
import fs from "node:fs";
import path from "node:path";

const MAX_REDIRECTS = 5;

export class HostNotAllowed extends Error {
  constructor(host) {
    super(`host ${host} is not listed in the plugin's manifest`);
    this.name = "HostNotAllowed";
    this.code = "PLUGIN_HOST_NOT_ALLOWED";
  }
}

/** fetch that refuses a host the manifest did not name, and re-checks every redirect hop. */
export function limitedFetch(hosts, base = globalThis.fetch) {
  const allowed = new Set(hosts);
  const check = (url) => {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new HostNotAllowed(`${u.protocol}//${u.hostname}`);
    if (!allowed.has(u.hostname.toLowerCase())) throw new HostNotAllowed(u.hostname);
    return u;
  };
  return async function pluginFetch(input, init = {}) {
    let url = check(typeof input === "string" || input instanceof URL ? input : input.url);
    for (let hop = 0; ; hop++) {
      const res = await base(url, { ...init, redirect: "manual" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
        url = check(new URL(res.headers.get("location"), url));
        continue;
      }
      return res;
    }
  };
}

export function makeCtx(manifest, { dataDir, settingsOf, keysReader, fetchImpl, debug, onCapability }) {
  const id = manifest.id;
  const capPrefix = `plugin_${id.replaceAll("-", "_")}_`;
  const cacheDir = path.join(dataDir, "plugin-cache", id);
  const say = (level) => (...args) => debug?.[level]?.(`plugin ${id}: ${args.map(String).join(" ")}`);
  const ctx = {
    id,
    // Which facts about the asking console this plugin asked for in its manifest; hooks get only these.
    console: Object.freeze({ wants: Object.freeze([...manifest.console]) }),
    settings: { get: (key) => settingsOf?.(id)?.[key] ?? manifest.settings?.[key]?.default },
    fetch: limitedFetch(manifest.hosts, fetchImpl),
    log: { info: say("info"), warn: say("warn"), error: say("error") },
    get cacheDir() {
      fs.mkdirSync(cacheDir, { recursive: true });
      return cacheDir;
    },
    defineCapability(def) {
      if (typeof def?.id !== "string" || !def.id.startsWith(capPrefix)) {
        throw new Error(`capability ids of this plugin start with ${capPrefix}`);
      }
      onCapability?.(id, { ...def, area: "plugins" });
    },
  };
  if (manifest.needsKeys) ctx.keys = keysReader;
  return Object.freeze(ctx);
}
