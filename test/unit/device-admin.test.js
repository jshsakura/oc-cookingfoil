import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// store.js reads COOK_DATA_DIR when it is first imported.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-device-admin-"));
const store = await import("../../src/security/store.js");
const { adminDeviceOf } = await import("../../src/security/device-admin.js");

const ADMIN = "A0A0000000000000000000000000000000000000000000000000000000000A0A";
const PLAIN = "B0B0000000000000000000000000000000000000000000000000000000000B0B";
const GONE = "C0C0000000000000000000000000000000000000000000000000000000000C0C";

await store.load();
store.approveDevice(ADMIN, { label: "admin console", addedBy: "admin", accessKeyHash: "h1" });
store.approveDevice(PLAIN, { label: "kid console", addedBy: "admin", accessKeyHash: "h2" });
store.setDeviceAdmin(ADMIN, true);
after(() => store.shutdown());

test("a flagged console on its access key or session is an admin device", () => {
  assert.equal(adminDeviceOf({ pairedDevice: ADMIN }), ADMIN);
  assert.equal(adminDeviceOf({ pairedDevice: ADMIN, sessionLane: true, sessionDevice: ADMIN }), ADMIN);
  // A shop account's session made on the flagged console.
  assert.equal(adminDeviceOf({ sessionLane: true, sessionDevice: ADMIN, auth: { user: "alice" } }), ADMIN);
});

test("an unflagged or unknown console is not", () => {
  assert.equal(adminDeviceOf({ pairedDevice: PLAIN }), null);
  assert.equal(adminDeviceOf({ sessionLane: true, sessionDevice: PLAIN, auth: { user: "alice" } }), null);
  assert.equal(adminDeviceOf({ pairedDevice: GONE }), null);
});

test("a browser, the admin's included, is never an admin device", () => {
  assert.equal(adminDeviceOf({ auth: { user: "alice" } }), null);
  // A session device without the session lane was never verified.
  assert.equal(adminDeviceOf({ sessionDevice: ADMIN, auth: { user: "alice" } }), null);
  assert.equal(adminDeviceOf({}), null);
});

test("revoking the console ends it", () => {
  store.revokeDevice(ADMIN);
  assert.equal(adminDeviceOf({ pairedDevice: ADMIN }), null);
});
