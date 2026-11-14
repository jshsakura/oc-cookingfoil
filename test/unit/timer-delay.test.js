import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TIMER_MS, timerDelay } from "../../src/helpers/timer-delay.js";

test("a timer's wait is held between 0 and the most a Node timer can wait", () => {
  assert.equal(timerDelay(-5), 0);
  assert.equal(timerDelay(1234), 1234);
  assert.equal(timerDelay(2244744438000), MAX_TIMER_MS, "the wait production logged a billion warnings for");
  assert.equal(timerDelay(Infinity), MAX_TIMER_MS);
  assert.equal(timerDelay(NaN), MAX_TIMER_MS);
});
