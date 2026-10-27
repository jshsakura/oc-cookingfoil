/**
 * plugin.json, checked. A plugin is trusted code in this process, so the manifest is the one thing the
 * loader reads before it decides whether to import anything: a wrong shape never reaches an import.
 *
 * parseManifest(raw, dirName) -> { ok: true, manifest } | { ok: false, problems: [code] }
 *   problems are stable codes the admin page words ("bad-id", "no-name", ...).
 * "console" lists which facts about the asking console the plugin wants (CONSOLE_ITEMS); it is handed
 * only those, never the rest.
 * apiVersion is not judged here: the loader says "incompatible" for a well-formed manifest of another
 * version, which is not the same as broken.
 *
 * start() must be light: it has 10 seconds and three failures in a row switch the plugin off, so
 * network work belongs in a task or a hook, not in start().
 */

export const API_VERSION = 1;
/** "names": a dictionary of retro game names by content hash (names.json in the plugin folder, read by retro/ko-names.js). */
export const PROVIDES = Object.freeze(["metadata", "art", "variant", "task", "request", "route", "event", "names"]);
/** Events a plugin may handle (functions of the same name on its default export), and what a payload may name beyond the plain facts. */
export const EVENT_KINDS = Object.freeze(["afterDownload", "installReported", "libraryChanged", "deviceApproved"]);
export const IDENTITY_ITEMS = Object.freeze(["ip", "account"]);
/** A plugin's own addresses, /api/plugins/<id>/<name>: who may call (device = any console or account the core let in, admin = administrators), and the caps. */
export const ROUTE_ACCESS = Object.freeze(["device", "admin"]);
export const ROUTE_LIMITS = Object.freeze({ bodyDefault: 256 * 1024, bodyMax: 4 * 1024 * 1024, timeoutDefault: 10_000, timeoutMax: 30_000, maxRoutes: 16 });
/**
 * What a console may tell a plugin about itself, and only when the manifest asks for it by name. The
 * language and the client version are not here: the core reads them from the Accept-Language and Version
 * headers and hands every hook `lang` and `clientVersion`.
 */
export const CONSOLE_ITEMS = Object.freeze(["firmware", "region"]);
export const MAX_MANIFEST_BYTES = 64 * 1024;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
// A DNS name with at least one dot; an IP literal is not a host a plugin may name.
const HOST_RE = /^(?=[^:]{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?$/;
const IP_LIKE_RE = /^[0-9.]+(?::\d+)?$/;
// Keys the core's own routes read from a URL; a plugin cannot claim them ("rewrap" is the one legacy key a plugin may).
const CORE_QUERY_KEYS = new Set(["lang", "v", "size"]);
const QUERY_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const ROUTE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const LANG_RE = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStrList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0);

/** { en, ko, ... } of non-empty strings with an English entry. */
function isLabel(v) {
  return isObj(v) && typeof v.en === "string" && v.en.length > 0
    && Object.entries(v).every(([k, s]) => LANG_RE.test(k) && typeof s === "string" && s.length > 0 && s.length <= 400);
}

/** The routes list, checked and filled in; null when it is not valid. */
function parseRoutes(list) {
  if (!Array.isArray(list) || !list.length || list.length > ROUTE_LIMITS.maxRoutes) return null;
  const out = [];
  for (const r of list) {
    if (!isObj(r) || typeof r.name !== "string" || !ROUTE_NAME_RE.test(r.name) || out.some((o) => o.name === r.name)) return null;
    if (!["GET", "POST"].includes(r.method) || !ROUTE_ACCESS.includes(r.access)) return null;
    const body = r.maxBody ?? ROUTE_LIMITS.bodyDefault;
    const timeout = r.timeoutMs ?? ROUTE_LIMITS.timeoutDefault;
    if (!Number.isInteger(body) || body < 1 || body > ROUTE_LIMITS.bodyMax || !Number.isInteger(timeout) || timeout < 100 || timeout > ROUTE_LIMITS.timeoutMax) return null;
    out.push({ name: r.name, method: r.method, access: r.access, maxBody: body, timeoutMs: timeout });
  }
  return out;
}

export function parseManifest(raw, dirName) {
  let m = raw;
  if (typeof raw === "string") {
    try { m = JSON.parse(raw); } catch { return { ok: false, problems: ["bad-json"] }; }
  }
  if (!isObj(m)) return { ok: false, problems: ["not-an-object"] };

  const problems = [];
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) problems.push("bad-id");
  else if (dirName !== undefined && m.id !== dirName) problems.push("id-folder-mismatch");
  if (!Number.isInteger(m.apiVersion) || m.apiVersion < 1) problems.push("bad-api-version");
  if (typeof m.version !== "string" || !VERSION_RE.test(m.version)) problems.push("bad-version");
  if (!isLabel(m.name)) problems.push("bad-name");
  if (m.description !== undefined && !isLabel(m.description)) problems.push("bad-description");
  if (!isStrList(m.provides) || !m.provides.length || !m.provides.every((p) => PROVIDES.includes(p))) problems.push("bad-provides");
  if (m.fields !== undefined && !(isObj(m.fields) && Object.values(m.fields).every(isStrList))) problems.push("bad-fields");
  if (m.libraries !== undefined && !isStrList(m.libraries)) problems.push("bad-libraries");
  if (m.hosts !== undefined && !(isStrList(m.hosts) && m.hosts.every((h) => HOST_RE.test(h) && !IP_LIKE_RE.test(h)))) problems.push("bad-hosts");
  if (m.needsKeys !== undefined && typeof m.needsKeys !== "boolean") problems.push("bad-needs-keys");
  if (m.settings !== undefined && !isObj(m.settings)) problems.push("bad-settings");
  if (m.variantKeys !== undefined && !(isStrList(m.variantKeys) && m.variantKeys.every((k) => QUERY_KEY_RE.test(k) && !CORE_QUERY_KEYS.has(k)))) problems.push("bad-variant-keys");
  if (m.console !== undefined && !(Array.isArray(m.console) && m.console.every((c) => CONSOLE_ITEMS.includes(c)) && new Set(m.console).size === m.console.length)) problems.push("bad-console");
  else if (m.console?.length && Array.isArray(m.provides) && !m.provides.some((k) => ["variant", "request", "route"].includes(k))) problems.push("console-without-variant");
  if (m.variantKeys?.length && Array.isArray(m.provides) && !m.provides.includes("variant")) problems.push("variant-keys-without-variant");
  const routes = m.routes === undefined ? [] : parseRoutes(m.routes);
  if (routes === null) problems.push("bad-routes");
  else if (Array.isArray(m.provides) && m.provides.includes("route") !== (routes.length > 0)) problems.push("routes-mismatch");
  if (m.events !== undefined && !(isObj(m.events) && (m.events.identity === undefined || (Array.isArray(m.events.identity) && m.events.identity.every((i) => IDENTITY_ITEMS.includes(i)) && new Set(m.events.identity).size === m.events.identity.length)))) problems.push("bad-events");
  else if (m.events?.identity?.length && Array.isArray(m.provides) && !m.provides.includes("event")) problems.push("identity-without-event");
  if (problems.length) return { ok: false, problems };

  return {
    ok: true,
    manifest: {
      id: m.id,
      apiVersion: m.apiVersion,
      version: m.version,
      name: m.name,
      description: m.description ?? null,
      provides: [...m.provides],
      fields: m.fields ?? {},
      libraries: m.libraries ?? [],
      hosts: m.hosts ?? [],
      needsKeys: m.needsKeys === true,
      settings: m.settings ?? {},
      variantKeys: m.variantKeys ?? [],
      console: m.console ?? [],
      routes,
      events: { identity: m.events?.identity ?? [] },
    },
  };
}
