/**
 * The ctx a plugin's start() receives. Small on purpose: what a plugin may touch is what is listed here.
 *
 *   settings.get(key)      the operator's value, else the manifest's default
 *   fetch(url, init)       only https, port 443 and the hosts the manifest names ("host:port" for another
 *                          port), redirects included.
 *                          This catches mistakes; it does not isolate code that runs in this process.
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

/**
 * fetch that refuses a host the manifest did not name, and re-checks every redirect hop. Port 443 only,
 * unless the manifest names the host as "host:port" (then that port). A Request keeps its method, headers
 * and body; a 303, and a 301 or 302 after a POST, continue as a GET without the body, as a browser does.
 */
export function limitedFetch(hosts, base = globalThis.fetch) {
  const ports = new Map(); // hostname -> allowed ports
  for (const entry of hosts) {
    const [name, port = "443"] = entry.toLowerCase().split(":");
    ports.set(name, [...(ports.get(name) ?? []), port]);
  }
  const check = (url) => {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new HostNotAllowed(`${u.protocol}//${u.hostname}`);
    const allowed = ports.get(u.hostname.toLowerCase());
    if (!allowed) throw new HostNotAllowed(u.hostname);
    if (!allowed.includes(u.port || "443")) throw new HostNotAllowed(`${u.hostname}:${u.port}`);
    return u;
  };
  return async function pluginFetch(input, init = {}) {
    const req = typeof input === "string" || input instanceof URL ? null : input;
    let url = check(req ? req.url : input);
    let opts = {
      ...(req ? {
        method: req.method,
        headers: new Headers(req.headers),
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.clone().arrayBuffer(),
        signal: req.signal,
      } : {}),
      ...init,
    };
    for (let hop = 0; ; hop++) {
      const res = await base(url, { ...opts, redirect: "manual" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
        const next = check(new URL(res.headers.get("location"), url));
        const method = String(opts.method ?? "GET").toUpperCase();
        const toGet = res.status === 303 ? method !== "HEAD" : (res.status === 301 || res.status === 302) && method === "POST";
        if (toGet || next.host !== url.host) {
          const headers = new Headers(opts.headers);
          if (toGet) for (const h of ["content-type", "content-length", "content-encoding"]) headers.delete(h);
          if (next.host !== url.host) for (const h of ["authorization", "cookie"]) headers.delete(h);
          opts = { ...opts, headers };
        }
        if (toGet) opts = { ...opts, method: "GET", body: undefined };
        url = next;
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
