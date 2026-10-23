/**
 * Telegram alerts. The bot token is a secret and never passes through here: a save keeps the token
 * already stored, and the token is only reported as set or not. The save, test and clear routes refuse
 * tokens, so those are served by MCP alone (mcp: true), behind the preview and confirm='approve'.
 */
import { defineCapability } from "./define.js";
import { arr, bool, nullable, obj, oneOf, str } from "./shape.js";
import { LANGS } from "../helpers/alert-messages.js";
import * as integrations from "../security/integrations.js";
import * as alerts from "../helpers/alerts.js";
import * as updates from "../security/telegram-updates.js";

const OPS = ["save", "test", "chats", "clear"];
const TOKEN_RE = integrations.SERVICES.telegram.fields.botToken.re;
const fail = (status, message) => Object.assign(new Error(message), { status });
const HISTORY = 5;

const EVENT = obj({ id: str(), label: str(), on: bool("sent now") });

export const alertsCapabilities = [
  defineCapability({
    id: "alerts_get",
    area: "admin",
    title: "Read the alert settings",
    description: "The Telegram alert settings: whether the bot is configured (its token is never shown), the chat, the events and who may approve from an alert, and recent alerts.",
    input: { type: "object", properties: {} },
    output: obj({
      configured: bool(), tokenSet: bool("a bot token is stored"), chatId: nullable(str()), buttons: bool("approve from the alert"), lang: nullable(str()),
      approvers: arr(str()), events: arr(EVENT), recent: arr({ type: "object", description: "the latest alerts sent, newest first" }),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/alerts" },
    handler: async () => {
      const d = integrations.describe().telegram;
      const { chatId, approvers } = integrations.get("telegram");
      const on = new Set(alerts.enabledEvents());
      return {
        configured: d.configured, tokenSet: d.fields.botToken.set, chatId: chatId || null, buttons: alerts.buttonsOn(), lang: alerts.alertLang() || null,
        approvers: approvers ? approvers.split(",") : [],
        events: Object.entries(alerts.EVENTS).map(([id, e]) => ({ id, label: e.label, on: on.has(id) })),
        recent: alerts.recent().slice(0, HISTORY),
      };
    },
  }),
  defineCapability({
    id: "alerts_set",
    area: "admin",
    title: "Change or test the alerts",
    description: "op save sets the chat, events, buttons, approvers and language; test sends a test alert; chats lists the chats that wrote to the bot; clear forgets the settings.",
    input: {
      type: "object",
      properties: {
        op: { type: "string", enum: OPS, description: "save, test (send a test alert now), chats (list recent chats) or clear (forget the saved settings)" },
        chatId: { type: "string", description: "For save: the Telegram chat id the alerts go to; find it with op chats" },
        events: { type: "array", description: "For save: event ids to send, from alerts_get; an empty list sends none" },
        buttons: { type: "boolean", description: "For save: true lets an approver approve a console from the alert" },
        approvers: { type: "array", description: "For save: Telegram user ids who may use the alert's buttons" },
        lang: { type: "string", enum: LANGS, description: "For save: the language the alert messages are written in" },
      },
      required: ["op"],
    },
    output: obj({ done: oneOf(OPS), ok: bool(), message: nullable(str()), chats: arr({ type: "object", description: "chat id and name" }) }, { optional: ["message", "chats"] }),
    preview: async (_ctx, input) => {
      plan(input);
      const now = integrations.get("telegram");
      return {
        op: input.op,
        configured: integrations.describe().telegram.configured,
        changes: {
          save: `Saves ${["chatId", "events", "buttons", "approvers", "lang"].filter((k) => input[k] !== undefined).join(", ") || "nothing"}. The bot token stays as stored; the button loop restarts at once.`,
          test: `Sends a test alert to chat ${now.chatId || "(none set)"} now.`,
          chats: "Asks Telegram for the chats that wrote to the bot lately. Nothing is saved.",
          clear: "Forgets the stored bot token, chat and events. Alerts stop until they are set up again, and the token has to be entered on the admin page.",
        }[input.op],
      };
    },
    previewOutput: obj({ op: str(), configured: bool(), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/alerts" },
    also: ["POST /admin/api/alerts/test", "POST /admin/api/alerts/chats", "POST /admin/api/alerts/clear"],
    mcp: true,
    handler: async (_ctx, input) => {
      plan(input);
      if (input.op === "test") return { done: "test", ...(await alerts.test()) };
      if (input.op === "clear") {
        integrations.clear("telegram");
        return { done: "clear", ok: true };
      }
      if (input.op === "chats") {
        const token = integrations.get("telegram").botToken;
        if (!token || !TOKEN_RE.test(token)) throw fail(409, "No bot token is stored; enter it on the admin page's alerts tab first");
        const chats = await updates.recentChats(token).catch(() => null);
        if (!chats) throw fail(502, "Telegram did not answer for the stored token");
        return { done: "chats", ok: true, chats, message: chats.length ? null : "No chat has written to the bot lately; send it a message first" };
      }
      const current = integrations.get("telegram");
      const ids = Array.isArray(input.events) ? input.events.map(String).filter((k) => k in alerts.EVENTS) : null;
      const buttons = typeof input.buttons === "boolean" ? input.buttons : alerts.buttonsOn(current);
      const approvers = Array.isArray(input.approvers) ? [...new Set(input.approvers.map((x) => String(x).trim()).filter(Boolean))].join(",") : current.approvers;
      try {
        integrations.save("telegram", {
          botToken: "",
          chatId: input.chatId !== undefined ? String(input.chatId) : current.chatId ?? "",
          events: ids === null ? (alerts.enabledEvents().join(",") || "-") : ids.length ? ids.join(",") : "-",
          buttons: buttons ? "on" : "off",
          approvers,
          lang: input.lang ?? current.lang ?? "",
        });
      } catch (err) {
        if (err instanceof integrations.IntegrationError) throw fail(400, err.message);
        throw err;
      }
      return { done: "save", ok: true };
    },
  }),
];

function plan(input) {
  if (!OPS.includes(input.op)) throw fail(400, `op is one of ${OPS.join(", ")}`);
  if (input.op === "save" && input.events !== undefined && !Array.isArray(input.events)) throw fail(400, "events is a list of event ids from alerts_get");
  if (input.op === "save" && input.approvers !== undefined && !Array.isArray(input.approvers)) throw fail(400, "approvers is a list of Telegram user ids");
}
