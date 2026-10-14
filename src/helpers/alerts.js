/**
 * Operator alerts on Telegram, set up from the admin page's alerts tab (kept as
 * the "telegram" integration). Each alert names one of EVENTS, and it is sent
 * only when the admin left that event on.
 *
 * Kept quiet on purpose:
 *   - the same subject (a console, an address) is told once per DEDUPE_MS, so a
 *     console that keeps polling does not flood the chat;
 *   - a digest event (dangerous access) sends its first hit at once, then
 *     gathers the rest for DIGEST_MS and sends one summary with the count, the
 *     number of addresses and the paths tried most.
 * Every alert, sent or not, lands in a short history the alerts tab shows.
 *
 * Alerts carry no passwords, keys, addresses or e-mail: only enough to know
 * what happened and that something may need doing on the admin page.
 *
 * An approval alert (a console, a Google account) also carries [승인] [거절]
 * buttons once the admin turned them on; each stands for a one-time token
 * (approval-tokens.js) and telegram-updates.js receives the presses.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { dataDir, publicBaseUrl } from "./envs.js";
import * as integrations from "../security/integrations.js";
import * as approvalTokens from "../security/approval-tokens.js";

/** What can be told, with what the admin page says about each; `on` is the default. */
export const EVENTS = {
  device: { label: "기기 승인 요청", desc: "처음 보는 기기가 승인을 기다릴 때 알립니다. 기기가 남긴 메시지도 함께 보냅니다.", on: true },
  account: { label: "구글 계정 승인 요청", desc: "새 구글 계정이 들어와 승인을 기다릴 때 알립니다.", on: true },
  lockout: { label: "로그인 실패 잠금", desc: "아이디나 비밀번호를 여러 번 틀린 주소를 잠갔을 때 알립니다. 우리 기기라면 로그 탭에서 풉니다.", on: true },
  probe: { label: "위험한 접근", desc: "알려진 공격 경로나 도구를 로그인 전에 막았을 때 알립니다. 첫 건은 바로, 이어지는 것은 10분씩 모아 한 번에 보냅니다.", on: true },
  server: { label: "서버 시작", desc: "서버가 켜질 때 알립니다. 업데이트 뒤나 예상하지 못한 재시작을 알 수 있습니다.", on: false },
};
export const DEDUPE_MS = 30 * 60 * 1000;
export const DIGEST_MS = 10 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;
const HISTORY_MAX = 50;
const API = "https://api.telegram.org";
const HISTORY_FILE = path.join(dataDir, "security", "alerts-history.json");

const lastSent = new Map();
const digests = new Map(); // event → { since, count, subjects: Set, paths: Map, timer }
let fetchImpl = (...args) => fetch(...args);
let history = null;

function readHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.slice(-HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function remember(entry) {
  history ??= readHistory();
  history.push(entry);
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${HISTORY_FILE}.tmp`, JSON.stringify(history));
    fs.renameSync(`${HISTORY_FILE}.tmp`, HISTORY_FILE);
  } catch (err) {
    debug.log("alerts: history not saved: %s", err.message);
  }
  return entry;
}

/**
 * The newest alerts first: [{ at, event, text, status: sent|failed|held|off, detail? }].
 * By when each happened: a sent one is written down only once Telegram answers.
 */
export const recent = () => (history ??= readHistory())
  .map((e, i) => [e, i])
  .sort((a, b) => b[0].at - a[0].at || b[1] - a[1])
  .map(([e]) => e);

/** The events the admin has on: a saved comma list, "-" for none, empty for the defaults. */
export function enabledEvents(list = integrations.get("telegram").events) {
  if (!list) return Object.keys(EVENTS).filter((k) => EVENTS[k].on);
  if (list === "-") return [];
  return list.split(",").filter((k) => k in EVENTS);
}

/** Whether the admin wants this event (see enabledEvents). */
export const wanted = (event, list) => enabledEvents(list).includes(event);

/** Whether approval alerts carry buttons: only once the admin saved "on" (off by default). */
export const buttonsOn = (conf = integrations.get("telegram")) => conf.buttons === "on";

/**
 * Calls one Bot API method; resolves to Telegram's answer ({ ok, result?, description? }).
 * `signal` cuts it short as well as the timeout.
 */
export async function callTelegram(botToken, method, body, { timeoutMs = SEND_TIMEOUT_MS, signal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const r = await fetchImpl(`${API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  return r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
}

/** Sends one message; resolves to Telegram's answer ({ ok, description? }). */
export function sendTelegram({ botToken, chatId }, text, extra = {}) {
  return callTelegram(botToken, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra });
}

/** The [승인] [거절] row for a request; each button carries "y:" or "n:" and the token. */
export const approvalKeyboard = (token) => ({
  inline_keyboard: [[{ text: "승인", callback_data: `y:${token}` }, { text: "거절", callback_data: `n:${token}` }]],
});

/** The bot's own name, to show which bot is set up; null when the token is refused. */
export async function botName(botToken) {
  const r = await fetchImpl(`${API}/bot${botToken}/getMe`, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  const d = await r.json().catch(() => ({ ok: false }));
  return d.ok ? d.result?.username ?? "" : null;
}

/** The chat an update came from, as the alerts tab lists it: { id, title }, or null. */
export function updateChat(u) {
  const c = (u.message ?? u.channel_post ?? u.my_chat_member ?? u.callback_query?.message ?? {}).chat;
  return c ? { id: String(c.id), title: c.title ?? c.first_name ?? c.username ?? "" } : null;
}

/**
 * The chats that wrote to the bot lately, for filling in the chat id: [{ id, title }].
 * Asks Telegram directly, so only for when the button loop isn't reading
 * updates (telegram-updates.js answers from its own while it runs).
 */
export async function recentChats(botToken) {
  const r = await fetchImpl(`${API}/bot${botToken}/getUpdates`, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  const d = await r.json().catch(() => ({ ok: false }));
  if (!d.ok) return null;
  const chats = new Map();
  for (const u of d.result ?? []) {
    const c = updateChat(u);
    if (c) chats.set(c.id, c);
  }
  return [...chats.values()];
}

const link = () => (publicBaseUrl ? `\n${publicBaseUrl.replace(/\/$/, "")}/admin` : "");

/** Sends now and records how it went. Resolves to the history entry. */
async function deliver(event, text, now, title = EVENTS[event]?.label ?? event, extra = {}) {
  const conf = integrations.get("telegram");
  try {
    const d = await sendTelegram(conf, `[CookingFoil] ${title}\n${text}${link()}`, extra);
    if (!d.ok) debug.log("alerts: telegram refused: %s", d.description ?? "unknown");
    return remember({ at: now, event, text, status: d.ok ? "sent" : "failed", ...(d.ok ? {} : { detail: d.description ?? "" }) });
  } catch (err) {
    debug.log("alerts: telegram unreachable: %s", err.message);
    return remember({ at: now, event, text, status: "failed", detail: "텔레그램에 닿지 못했습니다" });
  }
}

function flushDigest(event) {
  const d = digests.get(event);
  digests.delete(event);
  if (!d || !d.count) return;
  const top = [...d.paths].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, n]) => `${p} (${n})`).join(", ");
  const mins = Math.round(DIGEST_MS / 60000);
  deliver(event, `지난 ${mins}분 동안 ${d.count}건을 더 막았습니다. 주소 ${d.subjects.size}곳에서 왔고, 많이 노린 경로는 ${top} 입니다.`, Date.now());
}

/**
 * Raises an alert. `subject` tells repeats apart (a device key, an address) and
 * is never sent. `digest: { path }` gathers the event as described at the top.
 * `approval: { kind, ref }` names the request the buttons approve or refuse.
 * Fire and forget; returns whether a message is on its way.
 */
export function alert(event, text, { subject = "", now = Date.now(), digest = null, approval = null } = {}) {
  if (!(event in EVENTS)) return false;
  if (!integrations.configured("telegram")) return false;
  if (!wanted(event)) {
    remember({ at: now, event, text, status: "off" });
    return false;
  }
  if (digest) {
    const d = digests.get(event);
    if (d) {
      d.count++;
      d.subjects.add(subject);
      if (digest.path) d.paths.set(digest.path, (d.paths.get(digest.path) ?? 0) + 1);
      return false;
    }
    const timer = setTimeout(() => flushDigest(event), DIGEST_MS);
    timer.unref?.();
    digests.set(event, { since: now, count: 0, subjects: new Set(), paths: new Map(), timer });
  } else {
    const key = `${event}:${subject}`;
    if (now - (lastSent.get(key) ?? -Infinity) < DEDUPE_MS) {
      remember({ at: now, event, text, status: "held", detail: "같은 일을 30분 안에 이미 알렸습니다" });
      return false;
    }
    lastSent.set(key, now);
  }
  const extra = approval && buttonsOn() ? { reply_markup: approvalKeyboard(approvalTokens.issue(approval.kind, approval.ref, now)) } : {};
  deliver(event, text, now, undefined, extra);
  return true;
}

/** Sends a test message now, whatever the events; resolves to { ok, message }. */
export async function test() {
  if (!integrations.configured("telegram")) return { ok: false, message: "봇 토큰과 채팅 ID 를 먼저 넣습니다" };
  const on = enabledEvents().map((k) => EVENTS[k].label).join(", ") || "없음";
  const e = await deliver("test", `알림 연결을 확인했습니다. 지금 받는 알림: ${on}`, Date.now(), "알림 시험");
  return e.status === "sent" ? { ok: true, message: "시험 메시지를 보냈습니다" } : { ok: false, message: e.detail || "보내지 못했습니다" };
}

/** Test-only: swap the fetch used and forget what was sent and gathered. */
export function setFetchForTests(impl) {
  fetchImpl = impl;
  lastSent.clear();
  for (const d of digests.values()) clearTimeout(d.timer);
  digests.clear();
  history = [];
  approvalTokens.resetForTests();
}

/** Test-only: send a gathered digest now. */
export const flushForTests = (event) => flushDigest(event);
