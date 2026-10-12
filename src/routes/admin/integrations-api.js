/**
 * Keys for outside services, from the admin page's settings tab:
 *
 *   GET  /admin/api/integrations                   every service: configured, source, fields (secrets as set / not set)
 *   POST /admin/api/integrations/:service          save its fields; an empty secret keeps the saved one
 *   POST /admin/api/integrations/:service/clear    forget what was saved (env vars apply again)
 *   POST /admin/api/integrations/:service/test     try the saved key against the service: { ok, message }
 */
import * as integrations from "../../security/integrations.js";
import debug from "../../debug.js";
import { redirectUriFor } from "../dropbox-bridge.js";

const TEST_TIMEOUT_MS = 10_000;

/** One cheap call per service that only succeeds with a working key. */
const TESTS = {
  async igdb(v, fetchImpl) {
    const r = await fetchImpl(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(v.clientId)}&client_secret=${encodeURIComponent(v.clientSecret)}&grant_type=client_credentials`, { method: "POST" });
    return r.ok;
  },
  async steamgriddb(v, fetchImpl) {
    const r = await fetchImpl("https://www.steamgriddb.com/api/v2/search/autocomplete/tetris", { headers: { Authorization: `Bearer ${v.apiKey}` } });
    return r.ok;
  },
  async github(v, fetchImpl) {
    const r = await fetchImpl("https://api.github.com/rate_limit", { headers: { Authorization: `Bearer ${v.token}`, "User-Agent": "oc-cookingfoil" } });
    return r.ok;
  },
  async ratings(v, fetchImpl) {
    const r = await fetchImpl(new URL("/", v.url));
    return r.status < 500;
  },
};

export function mountIntegrationsApi(router, requireSession, { fetchImpl = fetch } = {}) {
  const guarded = (handler) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (err) {
      if (!(err instanceof integrations.IntegrationError)) throw err;
      res.status(400).json({ error: err.message });
    }
  };

  router.get("/api/integrations", guarded((req, res) => res.json({ ...integrations.describe(), dropboxRedirectUri: redirectUriFor(req) })));

  router.post("/api/integrations/:service", guarded((req, res) => {
    const saved = integrations.save(req.params.service, req.body ?? {});
    debug.log("admin: %s keys saved", req.params.service);
    res.json(saved);
  }));

  router.post("/api/integrations/:service/clear", guarded((req, res) => {
    const cleared = integrations.clear(req.params.service);
    debug.log("admin: %s keys cleared", req.params.service);
    res.json(cleared);
  }));

  router.post("/api/integrations/:service/test", guarded(async (req, res) => {
    const { service } = req.params;
    if (!(service in integrations.SERVICES)) throw new integrations.IntegrationError("알 수 없는 서비스입니다");
    if (!integrations.configured(service)) return res.json({ ok: false, message: "키가 아직 없습니다" });
    const test = TESTS[service];
    if (!test) return res.json({ ok: true, message: "저장돼 있습니다. 이 서비스는 연결 확인을 하지 않습니다" });
    const timed = (url, opts = {}) => fetchImpl(url, { ...opts, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    try {
      const ok = await test(integrations.get(service), timed);
      res.json({ ok, message: ok ? "연결됩니다" : "키가 받아들여지지 않았습니다" });
    } catch (err) {
      debug.log("admin: %s test failed: %s", service, err.message);
      res.json({ ok: false, message: "서비스에 닿지 못했습니다" });
    }
  }));
}
