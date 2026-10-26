/**
 * A plugin's own addresses: /api/plugins/<id>/<name>, as its manifest declares them.
 *
 *   pluginRoutes(registry, { log, now, perMinute }) -> express router (mount at /api/plugins)
 *
 * The core authenticates first (the server's auth guard and the device guard run ahead of this router); here a
 * route marked "admin" also needs an administrator, an automation token is refused outright, and everything the
 * core rejects (wrong method, wrong content type, too big a body, too many calls, a plugin that is off or
 * pausing) is answered without counting against the plugin. Only the plugin's own failure counts: it threw,
 * ran out of time, or answered in a shape the core can not send. Routes count and pause on their own
 * (registry.routePausedUntil), apart from the plugin's downloads.
 *
 * Handler: routes[name]({ method, query, body }, { signal, lang, clientVersion, console }) ->
 *   { status?, headers?, json | text | bytes }     status 200-299 or 400-499; headers as answer.js allows
 */
import express from "express";
import { requestLang } from "../meta/langs.js";
import { mayAdminister } from "../security/admin-actor.js";
import { hasValidSession } from "../security/admin-session.js";
import * as users from "../security/users.js";
import { consoleLane } from "../security/admin-only.js";
import { deviceKeyFromHeaders } from "../security/pairing.js";
import { CONSOLE_HEADER, parseConsoleHeader, refusalBody } from "./variants.js";
import { wordsOf } from "./variant-words.js";
import { safeHeaders } from "./answer.js";

export const ROUTE_PER_MINUTE = 120;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const WINDOW_MS = 60_000;
// Callers counted at once; past it a caller not seen before is refused until older windows expire.
const MAX_WINDOWS = 20_000;

/** Who is calling, for the rate limit: the signed-in account, else the device key, else the address. A header cannot change an account. */
function callerOf(req) {
  const who = req.webUser;
  if (who) return `${who.kind}:${who.sub ?? who.name}`;
  if (req.auth?.user) return `auth:${req.auth.user}`;
  return deviceKeyFromHeaders(req) ?? `ip:${req.ip}`;
}

const bodyOf = (value) => (Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : null);

/** A route's answer, checked: { status, headers, form, bytes } or null when the core can not send it. */
function parseAnswer(a) {
  if (!a || typeof a !== "object") return null;
  const status = a.status ?? 200;
  const headers = safeHeaders(a.headers);
  const forms = ["json", "text", "bytes"].filter((k) => a[k] !== undefined);
  if (!headers || forms.length !== 1 || !Number.isInteger(status)) return null;
  if (!((status >= 200 && status < 300) || (status >= 400 && status < 500))) return null;
  const form = forms[0];
  const bytes = bodyOf(a.bytes);
  if (form === "text" && typeof a.text !== "string") return null;
  if (form === "bytes" && !bytes) return null;
  if (form === "json") {
    try { if (JSON.stringify(a.json) === undefined) return null; } catch { return null; }
  }
  const size = form === "bytes" ? bytes.length : form === "text" ? Buffer.byteLength(a.text) : Buffer.byteLength(JSON.stringify(a.json));
  return size > MAX_RESPONSE_BYTES ? null : { status, headers, form, bytes };
}

export function pluginRoutes(registry, { log = () => {}, now = Date.now, perMinute = ROUTE_PER_MINUTE } = {}) {
  const router = express.Router();
  const parsers = new Map();
  const jsonParser = (limit) => {
    if (!parsers.has(limit)) parsers.set(limit, express.json({ limit, strict: true, type: () => true }));
    return parsers.get(limit);
  };

  // One window per (plugin, route, caller): a caller that sends nonsense uses up only its own calls.
  const windows = new Map(); // key -> { start, n }
  function allowed(key) {
    const t = now();
    if (windows.size > 5000) for (const [k, w] of windows) if (t - w.start >= WINDOW_MS) windows.delete(k);
    const w = windows.get(key);
    if (!w && windows.size >= MAX_WINDOWS) return false;
    if (!w || t - w.start >= WINDOW_MS) {
      windows.set(key, { start: t, n: 1 });
      return true;
    }
    return ++w.n <= perMinute;
  }

  const refuse = (res, status, code, key, lang) => res.status(status).set("Cache-Control", "no-store").json(refusalBody(wordsOf(key), code, lang));

  router.all("/:id/:name", async (req, res) => {
    // An async handler's throw is not caught by Express 4, and outside a plugin's own code it would reach the process guard.
    try {
      await handle(req, res);
    } catch (err) {
      log(`${req.params.id}: route ${req.params.name}: ${err?.message ?? err}`);
      if (!res.headersSent) refuse(res, 502, "plugin-failed", "routeFailed", requestLang(req));
    }
  });

  async function handle(req, res) {
    const lang = requestLang(req);
    const plain = (status, code) => res.status(status).set("Cache-Control", "no-store").json({ error: code, code });
    if (req.apiToken) return plain(403, "token-blocked");
    const { id, name } = req.params;
    const manifest = registry.manifestOf(id);
    const route = manifest?.provides.includes("route") ? manifest.routes.find((r) => r.name === name) : null;
    if (!route) return plain(404, "no-such-route");
    if (req.method !== route.method) return res.set("Allow", route.method).status(405).json({ error: "method", code: "method-not-allowed" });
    const state = registry.stateOf(id);
    // Only the plugin's own addresses pause here; a plugin cooling on its downloads still answers them.
    if (state !== "on" && state !== "cooling") return plain(404, "no-such-route");
    if (registry.routePausedUntil(id)) return plain(503, "plugin-cooling");
    // A server with no accounts lets mayAdminister say yes to anyone: an admin route there needs a signed-in admin session.
    if (route.access === "admin" && (consoleLane(req) || !mayAdminister(req) || (!users.hasUsers() && !hasValidSession(req)))) return plain(403, "admin-only");
    if (!allowed(`${id}\0${name}\0${callerOf(req)}`)) return refuse(res, 429, "plugin-rate-limited", "rateLimited", lang);

    let body;
    if (route.method === "POST") {
      if (!/^application\/json\b/i.test(req.get("content-type") ?? "")) return plain(415, "json-only");
      try {
        await new Promise((resolve, reject) => jsonParser(route.maxBody)(req, res, (err) => (err ? reject(err) : resolve())));
      } catch (err) {
        return plain(err?.status === 413 || err?.type === "entity.too.large" ? 413 : 400, err?.status === 413 || err?.type === "entity.too.large" ? "body-too-large" : "bad-json");
      }
      body = req.body ?? null;
    }

    const facts = parseConsoleHeader(req.get(CONSOLE_HEADER));
    const r = await registry.callHook(id, "route", { name, method: req.method, query: { ...req.query }, body }, {
      pick: (instance) => instance.routes?.[name], timeoutMs: route.timeoutMs, lang, clientVersion: req.get("version") ?? null, console: facts,
      valid: (v) => parseAnswer(v) !== null,
    });
    if (r.skipped) return plain(r.skipped === "cooling" ? 503 : 404, r.skipped === "cooling" ? "plugin-cooling" : "no-such-route");
    const failed = (why) => {
      log(`${id}: route ${name}: ${why}`);
      return refuse(res, 502, "plugin-failed", "routeFailed", lang);
    };
    if (r.error) return failed(r.error.message);

    const a = parseAnswer(r.value);
    const { status, headers, form, bytes } = a;
    res.set(headers).set("Cache-Control", "no-store").status(status);
    if (form === "json") return res.type("application/json").send(JSON.stringify(r.value.json));
    if (form === "text") return res.type("text/plain; charset=utf-8").send(r.value.text);
    return res.type("application/octet-stream").send(bytes);
  }

  return router;
}
