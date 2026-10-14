/**
 * Is the direct address answering? Watched, never acted on.
 *
 * A check looks the host of publicDirectBaseUrl up and asks `GET <base>/`
 * with one CHECK_TIMEOUT_MS limit over both. An answer below 500 counts as up
 * (the proxy in front answers a plain 404 there); a failed lookup, connection,
 * TLS handshake, a 5xx or the time running out counts as a failure. One
 * success makes it up; it goes down only after FAILS_FOR_DOWN failures in a
 * row. It starts unknown (down) until the first check.
 *
 * There is no timer. One check runs at start; after that a check runs only
 * while requests come in (touch) and the last one is at least RECHECK_MS old.
 * Only one runs at a time, and the request that started it does not wait.
 *
 * The state only shows on /healthz and the admin page, and a change is logged
 * once and told on Telegram (helpers/alerts.js event "direct"). Lists, URLs
 * and tokens never depend on it: there is no fallback and nothing restarts.
 */
import dns from "dns/promises";
import * as env from "../helpers/envs.js";
import { alert } from "../helpers/alerts.js";
import debug from "../debug.js";

export const RECHECK_MS = 60 * 1000;
export const CHECK_TIMEOUT_MS = 3000;
export const FAILS_FOR_DOWN = 2;

const DOWN_TEXT = "외부 다운로드 전용 주소가 응답하지 않습니다.";
const UP_TEXT = "외부 다운로드 전용 주소가 다시 응답합니다.";

let health = { up: false, since: null, fails: 0, checkedAt: null, error: null };
let checkedBase = null;
let probeOptions = {};
let running = null;
// Bumped whenever the state is set from outside; a check that started before
// then reports into a state that no longer exists, so its result is dropped.
let epoch = 0;

/**
 * Looks the host up and asks `base/`, both inside one `timeoutMs`; resolves
 * when the proxy answered (any status below 500, such as its 404), rejects on
 * a 5xx, a failure or the time running out.
 */
export async function probe(base, { timeoutMs = CHECK_TIMEOUT_MS, fetchImpl = fetch, lookup = dns.lookup } = {}) {
  const abort = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    }, timeoutMs);
  });
  const ask = (async () => {
    await lookup(new URL(base).hostname);
    const res = await fetchImpl(`${base}/`, { method: "GET", redirect: "manual", signal: abort.signal });
    await res.body?.cancel?.().catch(() => {});
    if (res.status >= 500) throw Object.assign(new Error(`answered ${res.status}`), { code: `HTTP${res.status}` });
  })();
  ask.catch(() => {});
  try {
    await Promise.race([ask, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The state after one check: `ok` from the probe. Pure. */
export function nextHealth(prev, ok, nowMs, error = null) {
  if (ok) return { up: true, since: prev.up ? prev.since : nowMs, fails: 0, checkedAt: nowMs, error: null };
  const fails = prev.fails + 1;
  const up = prev.up && fails < FAILS_FOR_DOWN;
  return { up, since: up === prev.up ? prev.since : nowMs, fails, checkedAt: nowMs, error };
}

function apply(next) {
  const changed = next.up !== health.up;
  health = next;
  if (!changed) return;
  debug.log("direct downloads: %s is %s%s", env.publicDirectBaseUrl, next.up ? "answering" : "not answering", next.error ? ` (${next.error})` : "");
  alert("direct", next.up ? UP_TEXT : DOWN_TEXT, { subject: next.up ? "up" : "down" });
}

/** Runs one check now (when a direct address is set). */
export async function check(options = probeOptions, nowMs = Date.now()) {
  const base = env.publicDirectBaseUrl;
  if (!base) return health;
  // A new address starts over.
  if (base !== checkedBase) {
    checkedBase = base;
    health = { up: false, since: null, fails: 0, checkedAt: null, error: null };
  }
  const started = epoch;
  // Late answers (the address changed, or the state was reset meanwhile) are dropped.
  const current = () => started === epoch && base === env.publicDirectBaseUrl;
  try {
    await probe(base, options);
    if (current()) apply(nextHealth(health, true, nowMs));
  } catch (err) {
    if (current()) apply(nextHealth(health, false, nowMs, err?.cause?.code ?? err?.code ?? err?.name ?? "error"));
  }
  return health;
}

/** Whether a check is due at `nowMs`: none yet for this address, or the last one too old. Pure. */
export function due(h, base, checked, nowMs) {
  if (base !== checked || h.checkedAt === null) return true;
  return nowMs - h.checkedAt >= RECHECK_MS;
}

/** Starts a check in the background when one is due and none is running. */
function checkIfDue(nowMs) {
  if (running || !due(health, env.publicDirectBaseUrl, checkedBase, nowMs)) return;
  running = check(probeOptions, nowMs)
    .catch((err) => debug.error("direct downloads: check failed: %s", err.message))
    .finally(() => (running = null));
}

/** A request came in: starts a check in the background when one is due. */
export function touch(nowMs = Date.now()) {
  if (env.publicDirectBaseUrl) checkIfDue(nowMs);
}

/** Whether the last checks found the address answering. */
export function isUp() {
  return Boolean(env.publicDirectBaseUrl) && health.up && checkedBase === env.publicDirectBaseUrl;
}

/** The check running now, if any (tests wait for it). */
export const pending = () => running ?? Promise.resolve();

/** For /healthz and the admin page. */
export function status() {
  if (!env.publicDirectBaseUrl) return { configured: false, up: false, since: null, checkedAt: null };
  const up = health.up && checkedBase === env.publicDirectBaseUrl;
  return { configured: true, up, since: health.since, checkedAt: health.checkedAt, ...(health.error ? { error: health.error } : {}) };
}

/** Checks now (after a change of address) but gives up waiting after `waitMs`; the check still finishes. */
export function checkSoon(waitMs = 5000) {
  const run = check();
  return Promise.race([run, new Promise((resolve) => setTimeout(resolve, waitMs).unref())]);
}

/** One check now; later ones run while requests come in (touch). */
export function start({ options = {} } = {}) {
  probeOptions = options;
  checkIfDue(Date.now());
}

/** Tests set the state, the probe and the time of the last check directly. */
export function setForTests(up, { options, checkedAt = Date.now() } = {}) {
  if (options) probeOptions = options;
  checkedBase = env.publicDirectBaseUrl;
  health = { up, since: checkedAt, fails: 0, checkedAt, error: null };
  epoch += 1;
  running = null;
}
