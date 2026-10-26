/**
 * beforeDownload: plugins that look at a game file's download before it goes out and may change it,
 * refuse it, or add headers. It is the only hook that runs on the request path of a download, together
 * with the variants plan and a plugin's own routes.
 *
 *   createRequestHooks(registry).before(req, { file, query }) -> null | { refusal } | { query, headers, tag }
 *
 * The plugin answers one of
 *   { allow: true }
 *   { rewrite: { query }, headers?, filename? }   the query the variant path then sees (string values, small)
 *   { deny: { code?, text } }                      403 plugin-denied; the plugin chose it
 * and a failure (throw, timeout, a shape the core cannot use) is a 409 plugin-failed: the original file never
 * stands in for it. Plugins are asked in id order, each given the query the one before left; a deny ends it.
 */
import { requestLang } from "../meta/langs.js";
import { CONSOLE_HEADER, parseConsoleHeader, refusalBody, variantTag } from "./variants.js";
import { wordsOf } from "./variant-words.js";
import { dispositionOf, safeHeaders } from "./answer.js";

const OPTION_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const MAX_QUERY_KEYS = 8;
const MAX_QUERY_VALUE = 64;

function queryOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_QUERY_KEYS || !entries.every(([k, v]) => OPTION_KEY_RE.test(k) && typeof v === "string" && v.length <= MAX_QUERY_VALUE)) return null;
  return Object.fromEntries(entries);
}

function textsOf(value) {
  if (typeof value === "string") return value && value.length <= 400 ? { en: value } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.length && entries.every(([k, s]) => /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(k) && typeof s === "string" && s && s.length <= 400) ? value : null;
}

/** What a beforeDownload answer says, checked: { deny } | { query?, headers } or null when the core can not use it. */
function parseAnswer(a) {
  if (a?.deny) {
    const texts = textsOf(a.deny.text);
    return texts ? { deny: texts } : null;
  }
  if (!a || typeof a !== "object" || (a.allow !== true && a.rewrite === undefined)) return null;
  let query;
  if (a.rewrite !== undefined) {
    query = queryOf(a.rewrite?.query);
    if (!query) return null;
  }
  const headers = safeHeaders(a.headers);
  if (!headers) return null;
  if (a.filename !== undefined) {
    const disposition = dispositionOf(a.filename);
    if (!disposition) return null;
    headers["Content-Disposition"] = disposition;
  }
  return { query, headers };
}

export function createRequestHooks(registry, { log = () => {} } = {}) {
  const failed = (lang) => ({ refusal: { status: 409, body: refusalBody(wordsOf("hookFailed"), "plugin-failed", lang) } });

  async function before(req, { file, st, query }) {
    const ids = registry.activeProviding("request");
    const lang = requestLang(req);
    // A plugin paused after failing is not "no plugin": what it would have said (a refusal, say) is not known, so
    // the download waits for it to be back instead of going out as if it had allowed it.
    if (registry.pausedProviding("request").length) return failed(lang);
    if (!ids.length) return null;
    const facts = parseConsoleHeader(req.get?.(CONSOLE_HEADER));
    // Only text values go to a plugin: ?a[]=1 and ?a[b]=1 reach Express as an array and an object.
    let current = Object.fromEntries(Object.entries(query ?? {}).filter(([, v]) => typeof v === "string"));
    let headers = {};
    const used = [];
    for (const id of ids) {
      const r = await registry.callHook(id, "beforeDownload", { file, size: st.size, mtimeMs: st.mtimeMs, query: { ...current } }, { lang, clientVersion: req.get?.("version") ?? null, console: facts, valid: (v) => parseAnswer(v) !== null });
      if (r.skipped) continue;
      if (r.error) {
        log(`${id}: beforeDownload failed: ${r.error.message}`);
        return failed(lang);
      }
      const a = parseAnswer(r.value);
      if (a.deny) return { refusal: { status: 403, body: refusalBody(a.deny, "plugin-denied", lang) } };
      if (a.query) current = a.query;
      headers = { ...headers, ...a.headers };
      used.push([id, registry.versionOf(id), registry.consoleFor(id, facts)]);
    }
    if (!used.length) return null;
    return { query: current, headers, tag: variantTag("before", "1", current, used) };
  }

  return { before };
}
