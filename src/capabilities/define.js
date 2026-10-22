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
 *     safety: "read",                 read | write | destructive
 *     access: "read",                 optional; lowest token level that sees it, never below what safety needs
 *     http: { method: "GET", path: "/admin/api/..." },   the route that does the same thing, if any
 *     token: false,                   optional; derived from http, may only narrow it
 *     handler: async (ctx, input) => ...,                 calls module functions, never the HTTP route
 *   })
 *
 * Token reach is not listed here by hand. It comes from the lists the server enforces:
 * TOKEN_PATHS (security/auth-guard.js), TOKEN_BLOCKED_RE (routes/admin-page.js) and
 * TOKEN_LOCKED (routes/admin/server-settings-api.js).
 */
import { TOKEN_PATHS } from "../security/auth-guard.js";
import { TOKEN_BLOCKED_RE } from "../routes/admin-page.js";
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
const ARG_DESCRIPTION = { min: 12, max: 120 };
const SCHEMA_KEYS = new Set(["type", "properties", "required", "additionalProperties", "description"]);
const JSON_TYPES = new Set(["string", "integer", "number", "boolean", "array", "object", "null"]);

const rank = (level) => ACCESS.indexOf(level);

/** "METHOD /path", the key the registry, opt-out.js and the coverage test share. */
export const routeKey = (http) => `${http.method.toUpperCase()} ${http.path}`;

/** Whether an automation token gets through to this route at all. */
export function tokenReach(http) {
  if (!TOKEN_PATHS(http.path)) return false;
  if (http.method.toUpperCase() === "GET") return true;
  // admin-page.js tests the path inside its router, without the /admin mount.
  const inner = http.path.startsWith("/admin/") ? http.path.slice("/admin".length) : http.path;
  return !TOKEN_BLOCKED_RE.test(inner);
}

function textProblems(field, value, { min = 1, max }) {
  if (typeof value !== "string") return [`${field} must be a string`];
  const out = [];
  if (value.length < min) out.push(`${field} must be at least ${min} characters (has ${value.length})`);
  if (value.length > max) out.push(`${field} must be at most ${max} characters (has ${value.length})`);
  if (!ENGLISH_RE.test(value)) out.push(`${field} must be plain English (printable ASCII only, so no Korean and no em dashes)`);
  return out;
}

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
  const reach = tokenReach(spec.http);
  if (spec.token === true && !reach) {
    return [`token is true, but ${routeKey(spec.http)} is closed to tokens (TOKEN_PATHS or TOKEN_BLOCKED_RE); drop token or the capability`];
  }
  const locked = TOKEN_LOCKED_ROUTES[routeKey(spec.http)];
  if (reach && spec.token !== false && locked) {
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
    token: spec.token ?? (spec.http ? tokenReach(spec.http) : false),
  });
}
