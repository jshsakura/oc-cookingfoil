import { test } from "node:test";
import assert from "node:assert/strict";
import { isBusy } from "../../src/security/busy-guard.js";
import busyGuard from "../../src/security/busy-guard.js";

const block = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* hold the event loop */ } };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("one hiccup is not busy; a loop that stays behind is, and browsers get a page", async () => {
  busyGuard();
  await tick(300);
  block(1300); // a single late sample
  await tick(300);
  assert.equal(isBusy(), false, "a single hiccup is let through");
  for (let i = 0; i < 4; i++) { block(1300); await tick(1); }
  assert.equal(isBusy(), true, "sustained lag turns requests away");
  const sent = {};
  const res = { set: () => res, status: (s) => { sent.status = s; return res; }, type: () => res, send: (b) => { sent.body = b; }, json: (b) => { sent.json = b; } };
  busyGuard()({ path: "/login", headers: { accept: "text/html" } }, res, () => { sent.next = true; });
  assert.equal(sent.status, 503);
  assert.match(sent.body, /http-equiv="refresh"/);
  busyGuard()({ path: "/api/library/sections", headers: {} }, res, () => {});
  assert.deepEqual(sent.json, { error: "busy", retryAfter: 5 });
  let passed = false;
  busyGuard()({ path: "/healthz", headers: {} }, res, () => { passed = true; });
  assert.ok(passed, "/healthz always answers");
});
