/**
 * Wrong admin authenticator codes, counted per account and per client address.
 *
 * A 6-digit code is a million guesses; the ordinary lockout skips loopback
 * callers and anyone already signed in, so the code alone had no limit there.
 * This counter has no exemptions: MAX_FAILURES wrong codes within WINDOW_MS
 * stop code checks for that account (and that address) until the window has
 * passed. A correct code clears both. In memory: a restart starts over, which
 * costs an attacker a restart they can't cause.
 */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 10_000;

export const LOCKED_MESSAGE = "인증 코드를 너무 여러 번 틀려 잠갔습니다. 15분 뒤에 다시 시도합니다.";

const failures = new Map(); // key → timestamps of recent wrong codes

const keysOf = (account, ip) => [`account:${account}`, ...(ip ? [`ip:${ip}`] : [])];

function recent(key, now) {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

/** Seconds until codes are checked again for this account or address; 0 when they are. */
export function lockedFor(account, ip, now = Date.now()) {
  let wait = 0;
  for (const key of keysOf(account, ip)) {
    const list = recent(key, now);
    if (list.length >= MAX_FAILURES) wait = Math.max(wait, Math.ceil((list[list.length - MAX_FAILURES] + WINDOW_MS - now) / 1000));
  }
  return wait;
}

/** One wrong code. */
export function recordFailure(account, ip, now = Date.now()) {
  for (const key of keysOf(account, ip)) {
    failures.set(key, [...recent(key, now), now].slice(-MAX_FAILURES));
  }
  while (failures.size > MAX_KEYS) failures.delete(failures.keys().next().value);
}

/** A correct code: the account and the address start over. */
export function reset(account, ip) {
  for (const key of keysOf(account, ip)) failures.delete(key);
}

/** Tests only. */
export function _clear() {
  failures.clear();
}
