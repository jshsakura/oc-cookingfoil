/**
 * One capability = one thing an agent can do, described once. MCP tools, API docs and the admin
 * page's token notes are all built from these entries (src/capabilities/registry.js).
 *
 *   defineCapability({
 *     id: "game_get",                 snake_case, area first; the MCP tool name
 *     area: "games",                  one of AREAS
 *     title: "Get one game",          English, short
 *     description: "...",             English, 40-200 characters: what it does, when, what comes next
 *     input: { type: "object", properties: { titleId: { type: "string", description: "..." } }, required: ["titleId"] },
 *                                     JSON Schema; argument descriptions 40-120 characters, about 80
 *     safety: "read",                 read | write | destructive
 *     access: "read",                 optional; lowest token level that sees it, never below what safety needs
 *     http: { method: "GET", path: "/admin/api/..." },   the route that does the same thing, if any
 *     token: false,                   optional; derived from http, may only narrow it
 *     handler: async (ctx, input) => ...,                 calls module functions, never the HTTP route
 *   })
 *
 * Token reach is not listed here by hand. It comes from what the server enforces: TOKEN_PATHS
 * (security/auth-guard.js), tokenBlocked() (routes/admin-page.js, the predicate requireSession
 * calls) and TOKEN_LOCKED (routes/admin/server-settings-api.js). A route the server refuses tokens
 * on is never a tool; one refused for some values of a parameter needs an input enum that leaves
 * those values out, or token: false.
 */
import { TOKEN_PATHS } from "../security/auth-guard.js";
import { TOKEN_BLOCKED_RE, TOKEN_BLOCKED_READ_RE, tokenBlocked } from "../routes/admin-page.js";
import { TOKEN_LOCKED } from "../routes/admin/server-settings-api.js";

export const AREAS = ["server", "library", "games", "retro", "homebrew", "content", "incoming", "jobs", "nsz", "settings", "inbox"];
export const SAFETY = ["read", "write", "destructive"];
export const ACCESS = ["read", "manage", "full"];
// The lowest token level each safety tier needs.
const MIN_ACCESS = { read: "read", write: "manage", destructive: "full" };
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
// Arguments whose name says it all; a description would only cost tokens.
export const OBVIOUS_ARGS = new Set(["page", "perPage", "fields", "dry_run"]);
// Injected by the MCP layer for destructive tools (preview, then apply with confirm='approve').
export const RESERVED_ARGS = new Set(["plan_id", "confirm"]);
// Routes that take settings by name, and the settings a token may never send them.
const TOKEN_LOCKED_ROUTES = { "POST /admin/api/server-settings": TOKEN_LOCKED };

const ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ID_MAX = 48;
const ENGLISH_RE = /^[\x20-\x7E]*$/;
const TITLE_MAX = 48;
const DESCRIPTION = { min: 40, max: 200 };
// About 80 characters (plan 3.2, ServiceNow's measurement). The lower bound is the firm one:
// shorter argument descriptions make agents pick the wrong tool or fill the argument wrongly.
const ARG_DESCRIPTION = { min: 40, max: 120 };
const SCHEMA_KEYS = new Set(["type", "properties", "required", "additionalProperties", "description"]);
const JSON_TYPES = new Set(["string", "integer", "number", "boolean", "array", "object", "null"]);

const rank = (level) => ACCESS.indexOf(level);

/** "METHOD /path" of an http route, the key the registry, opt-out.js and the coverage test share. */
export const routeKey = (http) => `${http.method.toUpperCase()} ${http.path}`;

// Values tried for a path parameter the route and the input leave open. The blocked patterns are
// literal path words between slashes plus "any segment", so every word they spell out, and one
// word they do not ("x", standing for every other value), covers every outcome.
const PARAM_TRIALS = [...new Set([TOKEN_BLOCKED_RE, TOKEN_BLOCKED_READ_RE].flatMap((re) => re.source.match(/[a-z0-9][a-z0-9-]*/gi)).map((w) => w.toLowerCase())), "x"];
// One Express path parameter, its optional inline values `:kind(homebrew|patch)`, or a wildcard.
const PARAM_RE = /:(\w+)(?:\(([^)]*)\))?\??|\*/;
const PLAIN_VALUES_RE = /^[\w-]+(?:\|[\w-]+)*$/;

/** The values a path parameter can take: the input's enum, else the route's own list, else PARAM_TRIALS. */
function paramValues(name, inline, input) {
  const declared = name && input?.properties?.[name]?.enum;
  if (Array.isArray(declared) && declared.length && declared.every((v) => typeof v === "string")) return declared;
  if (inline && PLAIN_VALUES_RE.test(inline)) return inline.split("|");
  return PARAM_TRIALS;
}

/** Every concrete path a route pattern stands for, as far as token blocking can tell them apart. */
function concretePaths(path, input) {
  const m = path.match(PARAM_RE);
  if (!m) return [path];
  return paramValues(m[1], m[2], input).flatMap((v) => concretePaths(path.replace(m[0], v), input));
}

/** The concrete paths of this route an automation token is refused on (empty when it is open to them). */
export function tokenBlockedPaths(http, input) {
  const method = http.method.toUpperCase();
  return concretePaths(http.path, input).filter((p) => {
    if (!TOKEN_PATHS(p)) return true;
    // admin-page.js tests the path inside its router, without the /admin mount.
    return p.startsWith("/admin/") && tokenBlocked(method, p.slice("/admin".length));
  });
}

/**
 * Whether an automation token gets through to this route for every value its parameters can take.
 * Pass the capability's input so an enum on a path parameter narrows the values tried.
 */
export function tokenReach(http, input) {
  return tokenBlockedPaths(http, input).length === 0;
}

function textProblems(field, value, { min = 1, max }) {
  if (typeof value !== "string") return [`${field} must be a string`];
  const out = [];
  if (value.length < min) out.push(`${field} must be at least ${min} characters (has ${value.length})`);
  if (value.length > max) out.push(`${field} must be at most ${max} characters (has ${value.length})`);
  if (!ENGLISH_RE.test(value)) out.push(`${field} must be plain English (printable ASCII only, so no Korean and no em dashes)`);
  return out;
}

// Inputs are plain JSON Schema, the shape MCP's tools/list carries. If PR 2 adopts zod for the SDK's
// registerTool, convert at that boundary (or write entries in zod and run z.toJSONSchema() before
// these checks) so the registry keeps one schema shape.
function inputProblems(input) {
  if (!input || typeof input !== "object" || input.type !== "object") return ["input must be a JSON Schema with type \"object\""];
  const out = [];
  for (const key of Object.keys(input)) if (!SCHEMA_KEYS.has(key)) out.push(`input has unsupported key ${key}`);
  const props = input.properties ?? {};
  if (typeof props !== "object" || Array.isArray(props)) return [...out, "input.properties must be an object"];
  for (const [name, schema] of Object.entries(props)) {
    if (RESERVED_ARGS.has(name)) out.push(`argument ${name} is reserved: the MCP layer adds it to destructive tools`);
    if (!schema || typeof schema !== "object") {
      out.push(`argument ${name} must be a schema object`);
      continue;
    }
    const typed = (typeof schema.type === "string" && JSON_TYPES.has(schema.type)) || Array.isArray(schema.type) || Array.isArray(schema.enum) || Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf);
    if (!typed) out.push(`argument ${name} needs a type (or enum/anyOf/oneOf)`);
    if (schema.description === undefined && OBVIOUS_ARGS.has(name)) continue;
    out.push(...textProblems(`argument ${name} description`, schema.description, ARG_DESCRIPTION));
  }
  if (input.required !== undefined) {
    if (!Array.isArray(input.required)) out.push("input.required must be an array");
    else for (const name of input.required) if (!(name in props)) out.push(`input.required names ${name}, which is not in properties`);
  }
  return out;
}

function httpProblems(http) {
  if (http === undefined) return [];
  if (!http || !METHODS.includes(http.method) || typeof http.path !== "string" || !http.path.startsWith("/")) {
    return [`http must be { method: ${METHODS.join("|")}, path: "/..." }`];
  }
  return [];
}

function tokenProblems(spec) {
  if (spec.token !== undefined && typeof spec.token !== "boolean") return ["token must be true or false"];
  if (!spec.http || httpProblems(spec.http).length) {
    return spec.token === undefined ? ["token must be given when there is no http route to derive it from"] : [];
  }
  const key = routeKey(spec.http);
  // Outside TOKEN_PATHS the token lane is not open at all; that is not work tokens are kept from.
  if (!TOKEN_PATHS(spec.http.path)) {
    return spec.token === true ? [`token is true, but ${key} is outside TOKEN_PATHS (security/auth-guard.js); drop token`] : [];
  }
  const all = concretePaths(spec.http.path, spec.input);
  const blocked = tokenBlockedPaths(spec.http, spec.input);
  if (blocked.length === all.length) {
    return [`${key} is work automation tokens may never do (tokenBlocked in src/routes/admin-page.js), so it is not a tool. Remove the capability and list the route in OPT_OUT as token-blocked`];
  }
  if (blocked.length && spec.token !== false) {
    const shown = blocked.slice(0, 5).join(", ") + (blocked.length > 5 ? ", ..." : "");
    return [`${key} refuses tokens on ${shown}. Give the path parameter an enum in input that leaves those values out, or set token: false`];
  }
  const locked = TOKEN_LOCKED_ROUTES[key];
  if (spec.token !== false && locked) {
    const names = Object.keys(spec.input?.properties ?? {}).filter((k) => locked.includes(k));
    if (names.length) return [`${names.join(", ")} ${names.length > 1 ? "are" : "is"} in TOKEN_LOCKED; remove ${names.length > 1 ? "them" : "it"} from input or set token: false`];
  }
  return [];
}

/** Everything wrong with a capability spec, as readable sentences. Empty when it is fine. */
export function capabilityProblems(spec) {
  const out = [];
  if (typeof spec.id !== "string" || !ID_RE.test(spec.id) || spec.id.length > ID_MAX) out.push(`id must be snake_case, at most ${ID_MAX} characters`);
  if (!AREAS.includes(spec.area)) out.push(`area must be one of ${AREAS.join(", ")}`);
  out.push(...textProblems("title", spec.title, { max: TITLE_MAX }));
  out.push(...textProblems("description", spec.description, DESCRIPTION));
  out.push(...inputProblems(spec.input));
  if (!SAFETY.includes(spec.safety)) out.push(`safety must be one of ${SAFETY.join(", ")}`);
  if (spec.access !== undefined && !ACCESS.includes(spec.access)) out.push(`access must be one of ${ACCESS.join(", ")}`);
  else if (spec.access !== undefined && SAFETY.includes(spec.safety) && rank(spec.access) < rank(MIN_ACCESS[spec.safety])) {
    out.push(`access ${spec.access} is below what a ${spec.safety} capability needs (${MIN_ACCESS[spec.safety]})`);
  }
  out.push(...httpProblems(spec.http));
  if (spec.http?.method === "GET" && (spec.safety === "write" || spec.safety === "destructive")) out.push(`a ${spec.safety} capability cannot sit on a GET route`);
  out.push(...tokenProblems(spec));
  if (typeof spec.handler !== "function") out.push("handler must be a function (ctx, input) => result");
  return out;
}

/** A checked, frozen capability with access and token filled in. Throws listing every problem. */
export function defineCapability(spec) {
  const problems = capabilityProblems(spec);
  if (problems.length) throw new Error(`capability ${spec.id ?? "(no id)"}: ${problems.join("; ")}`);
  return Object.freeze({
    ...spec,
    access: spec.access ?? MIN_ACCESS[spec.safety],
    token: spec.token ?? (spec.http ? tokenReach(spec.http, spec.input) : false),
  });
}
