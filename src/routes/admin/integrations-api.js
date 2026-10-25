/**
 * Keys for outside services, from the admin page's settings tab:
 *
 *   GET  /admin/api/integrations                   every service: configured, source, fields (secrets as set / not set)
 *   POST /admin/api/integrations/:service          save its fields; an empty secret keeps the saved one
 *   POST /admin/api/integrations/:service/clear    forget what was saved (env vars apply again)
 *   POST /admin/api/integrations/:service/test     try the saved key against the service: { ok, message }
 * Telegram is stored here too, but set up from the alerts tab (alerts-api.js).
 */
import * as integrations from "../../security/integrations.js";
import debug from "../../debug.js";
import { redirectUriFor } from "../dropbox-bridge.js";
import { test as testAlerts } from "../../helpers/alerts.js";
import { apiWord } from "./api-words.js";
import { securityError } from "../../security/security-messages.js";

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
  async retroAchievements(v, fetchImpl) {
    const r = await fetchImpl(`https://retroachievements.org/API/API_GetConsoleIDs.php?y=${encodeURIComponent(v.apiKey)}`);
    return r.ok;
  },
  async github(v, fetchImpl) {
    const r = await fetchImpl("https://api.github.com/rate_limit", { headers: { Authorization: `Bearer ${v.token}`, "User-Agent": "oc-cookingfoil" } });
    return r.ok;
  },
  async telegram() {
    return (await testAlerts()).ok;
  },
};

/**
 * Tries the saved key of `service` against it. `reason` is the word the admin page says it in:
 * unknown, noKey, noTest, connected, keyRefused or unreachable.
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export async function testIntegration(service, fetchImpl = fetch) {
  if (!(service in integrations.SERVICES)) return { ok: false, reason: "unknown" };
  if (!integrations.configured(service)) return { ok: false, reason: "noKey" };
  const test = TESTS[service];
  if (!test) return { ok: true, reason: "noTest" };
  const timed = (url, opts = {}) => fetchImpl(url, { ...opts, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
  try {
    const ok = await test(integrations.get(service), timed);
    return { ok, reason: ok ? "connected" : "keyRefused" };
  } catch (err) {
    debug.log("admin: %s test failed: %s", service, err.message);
    return { ok: false, reason: "unreachable" };
  }
}

export function mountIntegrationsApi(router, requireSession, { fetchImpl = fetch } = {}) {
  const guarded = (handler) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (err) {
      if (!(err instanceof integrations.IntegrationError)) throw err;
      res.status(400).json(securityError(req, err));
    }
  };

  router.get("/api/integrations", guarded((req, res) => res.json({
    ...integrations.describe(),
    dropboxRedirectUri: redirectUriFor(req),
  })));

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
    const outcome = await testIntegration(req.params.service, fetchImpl);
    if (outcome.reason === "unknown") return res.status(400).json({ error: apiWord(req, "integrations.unknown") });
    res.json({ ok: outcome.ok, message: apiWord(req, `integrations.${outcome.reason}`) });
  }));
}
