/**
 * The longest a Node timer waits. A setTimeout given more fires after 1 ms with a TimeoutOverflowWarning, so a
 * timer that rearms itself for a far-off time spins. A wait capped here only wakes early and is worked out again.
 */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** `ms` as a timer can wait it: at least 0, at most MAX_TIMER_MS. Pure. */
export const timerDelay = (ms) => Math.min(Math.max(0, Number.isFinite(ms) ? ms : MAX_TIMER_MS), MAX_TIMER_MS);
