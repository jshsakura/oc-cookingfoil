/**
 * The admin page's alerts tab (Telegram):
 *
 *   GET  /admin/api/alerts           { configured, source, tokenSet, chatId, bot, events: [{ id, label, desc, on }], history }
 *   POST /admin/api/alerts           { botToken?, chatId, events: [id…] }  save; an empty token keeps the saved one
 *   POST /admin/api/alerts/test      send a test message now: { ok, message }
 *   POST /admin/api/alerts/chats     { botToken? } the chats that wrote to the bot lately: { ok, chats, message }
 *   POST /admin/api/alerts/clear     forget what was saved (env vars apply again)
 *
 * The token and chat are stored as the "telegram" integration, so the secret
 * stays in integrations.json and is only ever reported as set or not set.
 */
import * as integrations from "../../security/integrations.js";
import * as alerts from "../../helpers/alerts.js";
import debug from "../../debug.js";

const TOKEN_RE = integrations.SERVICES.telegram.fields.botToken.re;

export function mountAlertsApi(router, requireSession) {
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

  router.get("/api/alerts", guarded(async (_req, res) => {
    const d = integrations.describe().telegram;
    const { botToken, chatId } = integrations.get("telegram");
    const on = new Set(alerts.enabledEvents());
    // Which bot it is, so the admin sees the token is the one they meant; null when Telegram refuses it.
    const bot = botToken ? await alerts.botName(botToken).catch(() => undefined) : undefined;
    res.json({
      configured: d.configured,
      source: d.source,
      tokenSet: d.fields.botToken.set,
      chatId,
      bot,
      events: Object.entries(alerts.EVENTS).map(([id, e]) => ({ id, label: e.label, desc: e.desc, on: on.has(id) })),
      history: alerts.recent(),
    });
  }));

  router.post("/api/alerts", guarded((req, res) => {
    const ids = Array.isArray(req.body?.events) ? req.body.events.map(String).filter((k) => k in alerts.EVENTS) : [];
    integrations.save("telegram", {
      botToken: String(req.body?.botToken ?? ""),
      chatId: String(req.body?.chatId ?? ""),
      events: ids.length ? ids.join(",") : "-",
    });
    debug.log("admin: alert settings saved (%s)", ids.join(",") || "none");
    res.json({ ok: true });
  }));

  router.post("/api/alerts/test", guarded(async (_req, res) => {
    res.json(await alerts.test());
  }));

  router.post("/api/alerts/chats", guarded(async (req, res) => {
    const token = String(req.body?.botToken ?? "").trim() || integrations.get("telegram").botToken;
    if (!token) return res.json({ ok: false, message: "봇 토큰을 먼저 넣습니다" });
    if (!TOKEN_RE.test(token)) return res.json({ ok: false, message: "봇 토큰 형식이 맞지 않습니다" });
    try {
      const chats = await alerts.recentChats(token);
      if (!chats) return res.json({ ok: false, message: "텔레그램이 이 토큰을 받아들이지 않았습니다" });
      res.json({ ok: true, chats, message: chats.length ? "" : "아직 봇에게 온 메시지가 없습니다. 알림을 받을 대화에서 봇에게 아무 말이나 보낸 뒤 다시 누릅니다" });
    } catch (err) {
      debug.log("admin: telegram chats failed: %s", err.message);
      res.json({ ok: false, message: "텔레그램에 닿지 못했습니다" });
    }
  }));

  router.post("/api/alerts/clear", guarded((_req, res) => {
    integrations.clear("telegram");
    res.json({ ok: true });
  }));
}
