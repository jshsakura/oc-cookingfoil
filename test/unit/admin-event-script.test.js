import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const { ADMIN_EVENT_SCRIPT, activityScript } = await import("../../src/routes/admin/activity-panel.js");

/** Runs the page's event handler with the panels' loaders stubbed; returns what it called. */
function page({ loadDevices = true, loadAccounts = true, accountsLoaded = true } = {}) {
  const calls = [];
  const sandbox = { actSoon: (key, fn) => fn(), accountsLoaded };
  if (loadDevices) sandbox.loadDevices = () => calls.push("devices");
  if (loadAccounts) sandbox.loadAccounts = () => calls.push("accounts");
  vm.createContext(sandbox);
  vm.runInContext(`${ADMIN_EVENT_SCRIPT}\nthis.actEvent=actEvent;`, sandbox);
  return { calls, event: (m) => sandbox.actEvent(m) };
}

test("a device hint reads the waiting consoles again", () => {
  const p = page();
  p.event({ topic: "approvals", payload: { kind: "device" } });
  assert.deepEqual(p.calls, ["devices"]);
});

test("an account hint reads the accounts again, once the accounts tab has been opened", () => {
  const p = page();
  p.event({ topic: "approvals", payload: { kind: "account" } });
  assert.deepEqual(p.calls, ["accounts"]);
  const unopened = page({ accountsLoaded: false });
  unopened.event({ topic: "approvals", payload: { kind: "account" } });
  assert.deepEqual(unopened.calls, []);
});

test("a page that never loaded a panel does not call it, and an unknown topic or odd payload is ignored", () => {
  const split = page({ loadDevices: false, loadAccounts: false });
  split.event({ topic: "approvals", payload: { kind: "device" } });
  split.event({ topic: "approvals", payload: { kind: "account" } });
  assert.deepEqual(split.calls, []);
  const p = page();
  p.event({ topic: "something-else", payload: {} });
  p.event({ topic: "approvals" });
  p.event({ topic: "approvals", payload: null });
  assert.deepEqual(p.calls, ["devices", "devices"], "a hint with no kind still refreshes the consoles, which is harmless");
});

test("the admin page script wires the socket's event frames to the handler, and the web page does not", () => {
  assert.match(activityScript(), /m\.type==='event'\)actEvent\(m\)/);
  assert.doesNotMatch(activityScript({ web: true }), /actEvent/);
});
