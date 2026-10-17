import { test } from "node:test";
import assert from "node:assert/strict";
import { createForwarderSchedule } from "../../src/tasks/forwarder-schedule.js";

const HOUR = 3_600_000;

function rig(hours, at) {
  const timers = [];
  let clock = at.getTime();
  let lists = 0;
  const s = createForwarderSchedule({
    hours: () => hours,
    now: () => clock,
    setTimer: (fn, ms) => timers.push(ms),
    track: () => { throw new Error("nothing to build, so no job"); },
    bootDelayMs: 600_000,
  });
  // keysDir without prod.keys: the source is skipped, so a pass builds nothing.
  s.add("t", { dir: "/nonexistent", keysDir: "/nonexistent", apps: async () => { lists++; return []; } });
  return { s, timers, advance: (ms) => { clock += ms; }, lists: () => lists };
}

test("the first look waits out the boot scans", () => {
  const { timers } = rig("2-7", new Date(2026, 0, 1, 3, 0));
  assert.deepEqual(timers, [600_000]);
});

test("outside the admin's hours it waits until they open", () => {
  const { s, timers } = rig("2-7", new Date(2026, 0, 1, 12, 0));
  s.tick();
  assert.equal(timers.at(-1), 14 * HOUR);
  assert.equal(s.running, null);
});

test("inside the hours it runs once, and not again the same night", async () => {
  const { s, timers, advance } = rig("2-7", new Date(2026, 0, 1, 3, 0));
  s.tick();
  assert.ok(s.running, "a pass started");
  await s.running;
  assert.equal(timers.at(-1), HOUR, "looks again in an hour");
  advance(HOUR);
  s.tick();
  assert.equal(s.running, null, "the same night: no second pass");
  advance(23 * HOUR);
  s.tick();
  assert.ok(s.running, "the next night runs again");
  await s.running;
});

test("hours set to off never run and look again later", () => {
  const { s, timers } = rig("off", new Date(2026, 0, 1, 3, 0));
  s.tick();
  assert.equal(s.running, null);
  assert.equal(timers.at(-1), 6 * HOUR);
});
