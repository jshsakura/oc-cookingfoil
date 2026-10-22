// Every route the server answers, read from the same routers src/index.js mounts, and the check that
// each one has a capability or an opt-out. Used by test/unit/capability-coverage.test.js.
//
// How routes are found:
//   - src/index.js is read as text. Each `xRouter()` call is matched to its import and its mount path
//     (`expressApp.use("/path", ..., xRouter())`, `"/path": xRouter()` in a map, or no path).
//   - Each router is built and its stack walked, nested routers included.
//   - Inline `expressApp.get("/path", ...)` routes are read from the text too.
// Import index.js itself and the server would start listening, which is why this reads its text.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const INDEX_URL = new URL("../../src/index.js", import.meta.url);
const VERBS = "get|post|put|patch|delete|all";

// Inline routes whose path is computed, not written out. Each is named with why it needs no capability.
const COMPUTED_INLINE = {
  where: "share images for link previews, one per language (static files)",
};

/** "METHOD /path", the key used by the registry and opt-out.js. */
export const routeKey = (method, path) => `${method.toUpperCase()} ${path}`;

function importsOf(source) {
  const byName = new Map();
  for (const m of source.matchAll(/^import\s+(.+?)\s+from\s+"([^"]+)";/gms)) {
    const [, clause, spec] = m;
    const def = clause.match(/^([A-Za-z_$][\w$]*)/);
    if (def) byName.set(def[1], { spec, name: "default" });
    const named = clause.match(/\{([^}]*)\}/);
    for (const part of named ? named[1].split(",") : []) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (orig) byName.set(alias ?? orig, { spec, name: orig });
    }
  }
  return byName;
}

/** Where each router factory called in index.js is mounted: a path, an imported name, or nothing. */
function mountsOf(source) {
  const mounts = [];
  for (const line of source.split("\n")) {
    for (const call of line.matchAll(/\b(\w+Router)\(\)/g)) {
      const factory = call[1];
      const inMap = line.match(/^\s*"([^"]+)":\s*\w+Router\(\)/);
      const used = line.match(/expressApp\.use\(\s*(?:"([^"]+)"|([A-Z][A-Z0-9_]*)\s*,)/);
      const bare = new RegExp(`expressApp\\.use\\(\\s*${factory}\\(\\)`).test(line);
      if (!inMap && !used && !bare) throw new Error(`src/index.js calls ${factory}() in a way test/support/capability-routes.js cannot read: ${line.trim()}`);
      mounts.push({ factory, at: inMap?.[1] ?? used?.[1] ?? "", atName: used?.[2] });
    }
  }
  return mounts;
}

/** The mount path of a nested router, from the regexp Express 4 keeps for it. */
function nestedPath(layer) {
  if (layer.keys?.length) throw new Error(`nested router with path parameters (${layer.regexp}) is not supported by the coverage walk`);
  if (layer.regexp.fast_slash) return "";
  const src = layer.regexp.source.replace(/^\^/, "").replace(/\\\/\?\(\?=\\\/\|\$\)$/, "");
  if (/[()[\]*+?|]/.test(src.replace(/\\\//g, ""))) throw new Error(`cannot read nested router path ${layer.regexp}`);
  return src.replace(/\\\//g, "/");
}

function walk(stack, prefix, out) {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        if (typeof p !== "string") throw new Error(`route ${prefix}${p} is not a string path; the coverage walk needs one`);
        for (const method of Object.keys(layer.route.methods)) if (method !== "_all") out.add(routeKey(method, prefix + p));
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      walk(layer.handle.stack, prefix + nestedPath(layer), out);
    }
  }
}

/** Every route of the app as "METHOD /path", sorted. Set env flags that gate routes before calling. */
export async function discoverRoutes() {
  const source = fs.readFileSync(fileURLToPath(INDEX_URL), "utf8");
  const imports = importsOf(source);
  const routes = new Set();
  for (const { factory, at, atName } of mountsOf(source)) {
    const from = imports.get(factory);
    const prefix = atName ? await importedValue(atName, imports) : at;
    if (!from) throw new Error(`src/index.js calls ${factory}() but no import names it`);
    const mod = await import(new URL(from.spec, INDEX_URL).href);
    walk(mod[from.name]().stack, prefix, routes);
  }
  for (const m of source.matchAll(new RegExp(`expressApp\\.(${VERBS})\\(\\s*([^,]+),`, "g"))) {
    const [, method, arg] = m;
    const literal = arg.match(/^"([^"]+)"$/);
    const template = arg.match(/^`([^`]+)`$/);
    if (literal) routes.add(routeKey(method, literal[1]));
    else if (template) {
      const resolved = await resolveTemplate(template[1], imports);
      routes.add(routeKey(method, resolved));
    } else if (!(arg.trim() in COMPUTED_INLINE)) {
      throw new Error(`src/index.js has an inline route with a computed path (${arg.trim()}); name it in COMPUTED_INLINE in test/support/capability-routes.js with why`);
    }
  }
  return [...routes].sort();
}

async function importedValue(name, imports) {
  const from = imports.get(name);
  const value = from && (await import(new URL(from.spec, INDEX_URL).href))[from.name];
  if (typeof value !== "string") throw new Error(`cannot resolve ${name}, a route path in src/index.js, to an imported string`);
  return value;
}

async function resolveTemplate(text, imports) {
  let out = text;
  for (const [, name] of text.matchAll(/\$\{(\w+)\}/g)) out = out.replace(`\${${name}}`, await importedValue(name, imports));
  return out;
}

/**
 * Problems with route coverage: routes nobody accounts for, entries that name no route, routes listed
 * twice, and opt-outs without an allowed reason. Empty when everything lines up.
 */
export function coverageProblems({ routes, capabilities, optOut, legacy, reasons }) {
  const problems = [];
  const claimed = new Map();
  const claim = (key, by) => {
    if (claimed.has(key)) problems.push(`Route ${key} is listed twice: ${claimed.get(key)} and ${by}. Keep one.`);
    else claimed.set(key, by);
  };
  for (const cap of capabilities) if (cap.http) claim(routeKey(cap.http.method, cap.http.path), `capability ${cap.id}`);
  for (const [key, reason] of Object.entries(optOut)) {
    if (!(reason in reasons) || reason === "legacy-unregistered") {
      problems.push(`Route ${key} in OPT_OUT has reason "${reason}". Use one of: ${Object.keys(reasons).filter((r) => r !== "legacy-unregistered").join(", ")}.`);
    }
    claim(key, "OPT_OUT");
  }
  for (const key of legacy) claim(key, "LEGACY_UNREGISTERED");

  const known = new Set(routes);
  for (const [key, by] of claimed) {
    if (!known.has(key)) problems.push(`${by} names ${key}, but the server has no such route. Remove it or fix the method and path.`);
  }
  for (const key of routes) {
    if (claimed.has(key)) continue;
    problems.push(
      `Route ${key} has no capability. Add one in src/capabilities/<area>.js with defineCapability() ` +
        `(see src/capabilities/define.js) and list it in src/capabilities/registry.js, or add it to OPT_OUT in ` +
        `src/capabilities/opt-out.js with a reason (browser-only, token-blocked, binary-upload).`,
    );
  }
  return problems;
}

/** A count that may only go down, and whose ceiling follows it down. */
export function ratchetProblems({ name, count, ceiling, where }) {
  if (count > ceiling) return [`${name} grew from ${ceiling} to ${count}. It only shrinks: register the route as a capability instead.`];
  if (count < ceiling) return [`${name} shrank to ${count}. Lower its ceiling in ${where} from ${ceiling} to ${count} so it cannot grow back.`];
  return [];
}
