/**
 * Reads what happens in the bot's chats, so a press on an approval alert's
 * button reaches telegram-approve.js. One long poll (getUpdates, POLL_S) at a
 * time, and only while a bot token and chat are set and buttons are on: no
 * webhook, no public endpoint.
 *
 * Telegram lets one getUpdates reader per bot at a time, so while this runs the
 * alerts tab's chat finder reads the chats this loop has seen (recentChats)
 * instead of asking Telegram itself.
 *
 * Each batch is acknowledged by asking for the next offset. A failure (bad
 * token, another reader, no network) waits BACKOFF_MIN_MS, doubling up to
 * BACKOFF_MAX_MS, before trying again. Saving the alerts tab restarts or stops
 * the loop at once (integrations.onChange).
 */
import debug from "../debug.js";
import * as alerts from "../helpers/alerts.js";
import * as integrations from "./integrations.js";
import { handleCallback } from "./telegram-approve.js";

export const POLL_S = 25;
export const BACKOFF_MIN_MS = 2000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;
const CHATS_MAX = 20;
const UPDATES = ["message", "channel_post", "my_chat_member", "callback_query"];

let loop = null; // { botToken, abort, done }
let offset = 0;
let lastToken = ""; // whose updates `offset` and `chats` are
const chats = new Map(); // id → { id, title }, in the order they first wrote
let sleepImpl = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
});

/** Whether the loop should run with the settings as they are now. */
export const wanted = (conf = integrations.get("telegram")) => integrations.configured("telegram") && alerts.buttonsOn(conf);

export const running = () => Boolean(loop);

function noteChat(u) {
  const c = alerts.updateChat(u);
  if (!c || chats.has(c.id)) return;
  chats.set(c.id, c);
  if (chats.size > CHATS_MAX) chats.delete(chats.keys().next().value);
}

const nextDelay = (ms) => Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, ms * 2));

async function run(state) {
  let delay = 0;
  while (!state.abort.signal.aborted) {
    if (delay) await sleepImpl(delay, state.abort.signal);
    if (state.abort.signal.aborted) break;
    try {
      const d = await alerts.callTelegram(state.botToken, "getUpdates", { offset, timeout: POLL_S, allowed_updates: UPDATES }, { timeoutMs: (POLL_S + 10) * 1000, signal: state.abort.signal });
      if (!d.ok) {
        delay = nextDelay(delay);
        debug.log("telegram updates: refused (%s), next try in %ds", d.description ?? "unknown", delay / 1000);
        continue;
      }
      delay = 0;
      for (const u of d.result ?? []) {
        if (state.abort.signal.aborted) break;
        if (!Number.isInteger(u?.update_id) || u.update_id < offset) continue;
        offset = u.update_id + 1;
        noteChat(u);
        if (u.callback_query) await handleCallback(u.callback_query).catch((err) => debug.log("telegram updates: button failed: %s", err.message));
      }
    } catch (err) {
      if (state.abort.signal.aborted) break;
      delay = nextDelay(delay);
      debug.log("telegram updates: unreachable (%s), next try in %ds", err.message, delay / 1000);
    }
  }
}

/** Stops the loop; resolves once its last request has ended. */
export async function stop() {
  const state = loop;
  if (!state) return;
  loop = null;
  state.abort.abort();
  await state.done;
}

/** Starts, restarts (a new token) or stops the loop to match the settings. */
export function sync() {
  const conf = integrations.get("telegram");
  if (loop && (!wanted(conf) || loop.botToken !== conf.botToken)) stop();
  if (loop || !wanted(conf)) return;
  if (conf.botToken !== lastToken) {
    offset = 0;
    chats.clear();
    lastToken = conf.botToken;
  }
  const state = { botToken: conf.botToken, abort: new AbortController() };
  state.done = run(state);
  loop = state;
}

/** Follows the alerts tab's saves from now on, and starts the loop if it is set up. */
export function watch() {
  integrations.onChange((service) => service === "telegram" && sync());
  sync();
}

/**
 * The chats that wrote to the bot lately: from this loop while it reads this
 * bot's updates, else straight from Telegram (alerts.recentChats).
 */
export function recentChats(botToken) {
  if (loop && loop.botToken === botToken) return Promise.resolve([...chats.values()]);
  return alerts.recentChats(botToken);
}

/** Test-only: swap the wait between failed tries, and forget the offset and chats. */
export async function resetForTests({ sleep } = {}) {
  await stop();
  if (sleep) sleepImpl = sleep;
  offset = 0;
  lastToken = "";
  chats.clear();
}

/** Test-only: the next update id asked for. */
export const offsetForTests = () => offset;
