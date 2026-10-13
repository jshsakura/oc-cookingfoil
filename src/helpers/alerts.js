/**
 * Operator alerts on Telegram, set up from the settings tab (the "telegram"
 * integration). Each alert names one of EVENTS; the ones the admin left unticked
 * are dropped, and the same subject is sent at most once per DEDUPE_MS so a
 * console that keeps polling does not flood the chat.
 *
 * Alerts carry no passwords, keys, addresses or e-mail: only enough to know
 * there is something to do on the admin page.
 */
import debug from "../debug.js";
import { publicBaseUrl } from "./envs.js";
import * as integrations from "../security/integrations.js";

export const EVENTS = {
  device: "기기 승인 요청",
  account: "구글 계정 승인 요청",
  lockout: "로그인 실패로 주소 잠금",
};
const DEDUPE_MS = 30 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;
const API = "https://api.telegram.org";

const lastSent = new Map();
let fetchImpl = (...args) => fetch(...args);

/** Whether the admin wants this event: an empty list means all, "-" none. */
export function wanted(event, list) {
  if (!list) return true;
  return list !== "-" && list.split(",").includes(event);
}

/** Sends one message; resolves to Telegram's answer ({ ok, description? }). */
export async function sendTelegram({ botToken, chatId }, text) {
  const r = await fetchImpl(`${API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  return r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
}

/** The chats that wrote to the bot lately, for filling in the chat id: [{ id, title }]. */
export async function recentChats(botToken) {
  const r = await fetchImpl(`${API}/bot${botToken}/getUpdates`, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  const d = await r.json().catch(() => ({ ok: false }));
  if (!d.ok) return null;
  const chats = new Map();
  for (const u of d.result ?? []) {
    const c = (u.message ?? u.channel_post ?? u.my_chat_member ?? {}).chat;
    if (c) chats.set(String(c.id), { id: String(c.id), title: c.title ?? c.first_name ?? c.username ?? "" });
  }
  return [...chats.values()];
}

/**
 * Raises an alert. `subject` tells repeats apart (a device key, an address) and
 * is never sent. Fire and forget: a failure is only logged.
 */
export function alert(event, text, { subject = "", now = Date.now() } = {}) {
  if (!(event in EVENTS) || !integrations.configured("telegram")) return false;
  const conf = integrations.get("telegram");
  if (!wanted(event, conf.events)) return false;
  const key = `${event}:${subject}`;
  if (now - (lastSent.get(key) ?? -Infinity) < DEDUPE_MS) return false;
  lastSent.set(key, now);
  const link = publicBaseUrl ? `\n${publicBaseUrl.replace(/\/$/, "")}/admin` : "";
  sendTelegram(conf, `[CookingFoil] ${EVENTS[event]}\n${text}${link}`)
    .then((d) => { if (!d.ok) debug.log("alerts: telegram refused: %s", d.description ?? "unknown"); })
    .catch((err) => debug.log("alerts: telegram unreachable: %s", err.message));
  return true;
}

/** Test-only: swap the fetch used and forget what was sent. */
export function setFetchForTests(impl) {
  fetchImpl = impl;
  lastSent.clear();
}
