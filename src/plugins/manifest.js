/**
 * plugin.json, checked. A plugin is trusted code in this process, so the manifest is the one thing the
 * loader reads before it decides whether to import anything: a wrong shape never reaches an import.
 *
 * parseManifest(raw, dirName) -> { ok: true, manifest } | { ok: false, problems: [code] }
 *   problems are stable codes the admin page words ("bad-id", "no-name", ...).
 * apiVersion is not judged here: the loader says "incompatible" for a well-formed manifest of another
 * version, which is not the same as broken.
 *
 * start() must be light: it has 10 seconds and three failures in a row switch the plugin off, so
 * network work belongs in a task or a hook, not in start().
 */

export const API_VERSION = 1;
export const PROVIDES = Object.freeze(["metadata", "art", "variant", "task"]);
export const MAX_MANIFEST_BYTES = 64 * 1024;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
// A DNS name with at least one dot; an IP literal is not a host a plugin may name.
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IP_LIKE_RE = /^[0-9.]+$/;
const QUERY_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const LANG_RE = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStrList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0);

/** { en, ko, ... } of non-empty strings with an English entry. */
function isLabel(v) {
  return isObj(v) && typeof v.en === "string" && v.en.length > 0
    && Object.entries(v).every(([k, s]) => LANG_RE.test(k) && typeof s === "string" && s.length > 0 && s.length <= 400);
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
  if (m.variantKeys !== undefined && !(isStrList(m.variantKeys) && m.variantKeys.every((k) => QUERY_KEY_RE.test(k)))) problems.push("bad-variant-keys");
  if (m.variantKeys?.length && Array.isArray(m.provides) && !m.provides.includes("variant")) problems.push("variant-keys-without-variant");
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
    },
  };
}
