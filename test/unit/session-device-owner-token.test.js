import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A session token an account was given for a console it does not hold (as the server handed out before
// requester checked the holder) is refused on every address a console's session reaches: the wishlist,
// the sends and their ack, the admin device's item settings and the votes. The holder's own token works.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-session-owner-token-"));
Object.assign(process.env, {
  COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"), COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "false",
  COOK_AUTH_USERS: "alice:alice-password,bob:bob-password", COOK_TITLEDB_AUTO_FETCH: "false", COOK_PUBLIC_BASE_URL: "",
});
fs.mkdirSync(path.join(data, "games"), { recursive: true });
const { default: express } = await import("express");
const store = await import("../../src/security/store.js");
const users = await import("../../src/security/users.js");
const session = await import("../../src/security/session-token.js");
const { hashAccessKey } = await import("../../src/security/pairing.js");
const { stillAllowed, requester } = await import("../../src/security/link-identity.js");
const { default: sessionGate } = await import("../../src/security/session-gate.js");
const { consoleSendsRouter } = await import("../../src/routes/device-sends.js");
const { consoleWishlistRouter } = await import("../../src/routes/wishlist.js");
const { default: adminItemsRouter } = await import("../../src/routes/admin-items.js");
const { default: votesRouter } = await import("../../src/routes/votes.js");

const CONSOLE = "B2".repeat(32);
store.approveDevice(CONSOLE, { label: "alice console", addedBy: "alice", accessKeyHash: hashAccessKey("alice-console-key") });
store.setDeviceAdmin(CONSOLE, true);
// Consoles no account holds: approved by the admin, one of them an admin device.
const ADMIN_APPROVED = "C3".repeat(32);
const ADMIN_DEVICE = "D4".repeat(32);
store.approveDevice(ADMIN_APPROVED, { label: "admin approved", addedBy: "admin", accessKeyHash: hashAccessKey("admin-approved-key") });
store.approveDevice(ADMIN_DEVICE, { label: "admin device", addedBy: "admin", accessKeyHash: hashAccessKey("admin-device-key") });
store.setDeviceAdmin(ADMIN_DEVICE, true);

const app = express();
app.use(sessionGate());
app.use("/api/device/sends", consoleSendsRouter());
app.use("/api/device/wishlist", consoleWishlistRouter());
app.use("/api/admin/items", adminItemsRouter());
app.use("/api/votes", votesRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(data, { recursive: true, force: true });
});

const dstamp = crypto.createHash("sha256").update(String(store.getDeviceAccessKeyHash(CONSOLE))).digest("base64url").slice(0, 16);
const subFor = (name) => ({ acct: { kind: "user", id: name }, dev: CONSOLE, paired: true, stamp: users.sessionStamp(name), dstamp });
const lane = (name) => ({ "X-Device-Key": CONSOLE, Authorization: `Bearer ${session.issue(subFor(name)).token}`, "Content-Type": "application/json" });
const call = (method, url, headers, body) => fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });

const ADDRESSES = [
  ["GET", "/api/device/wishlist"],
  ["GET", "/api/device/sends"],
  ["POST", "/api/device/sends/ack", { ids: [], result: "declined" }],
  ["GET", "/api/admin/items/homebrew/m-0123456789ab/fields"],
  ["PATCH", "/api/admin/items/homebrew/m-0123456789ab/fields", { key: "verified", value: true }],
  ["POST", "/api/votes/homebrew/m-0123456789ab", { vote: "up" }],
];

test("a token for an account on a console it does not hold is no longer good", () => {
  assert.equal(stillAllowed(subFor("bob")), false);
  assert.equal(stillAllowed(subFor("alice")), true);
});

for (const [method, url, body] of ADDRESSES) {
  test(`${method} ${url}: refused to another account's token on alice's console`, async () => {
    assert.equal((await call(method, url, lane("bob"), body)).status, 401);
  });
}

test("alice's own token on her console still reaches her console's addresses", async () => {
  assert.equal((await call("GET", "/api/device/wishlist", lane("alice"))).status, 200);
  assert.equal((await call("GET", "/api/device/sends", lane("alice"))).status, 200);
  assert.notEqual((await call("GET", "/api/admin/items/homebrew/m-0123456789ab/fields", lane("alice"))).status, 401);
});

/** A request as the gates leave it: a console proven by its access key, and an account signed in beside it. */
const proven = (deviceKey, user) => ({ pairedDevice: deviceKey, auth: user ? { user } : undefined, get: () => undefined });

test("a console proven by its access key keeps its identity when an account that does not hold it comes along", () => {
  for (const key of [ADMIN_APPROVED, ADMIN_DEVICE]) {
    const who = requester(proven(key, "alice"));
    assert.deepEqual({ acct: who.acct, dev: who.dev, paired: who.paired }, { acct: null, dev: key, paired: true });
    assert.equal(stillAllowed(who), true);
    assert.equal(stillAllowed(requester(proven(key))), true);
  }
  const own = requester(proven(CONSOLE, "alice"));
  assert.deepEqual({ acct: own.acct, dev: own.dev, paired: own.paired }, { acct: { kind: "user", id: "alice" }, dev: CONSOLE, paired: true });
  assert.equal(stillAllowed(own), true);
});

test("consoles no account holds answer as before: suspended for no account, never revoked by the holder check", async () => {
  // On a server with accounts such a console is held back by suspension() whatever its token says; the holder
  // check must not turn that into "revoked", which tells the console to pair again.
  for (const [key, withAccount] of [[ADMIN_APPROVED, false], [ADMIN_DEVICE, false], [ADMIN_DEVICE, true]]) {
    const headers = { "X-Device-Key": key, Authorization: `Bearer ${session.issue(requester(proven(key, withAccount ? "alice" : null))).token}` };
    const r = await call("GET", "/api/device/sends", headers);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: "suspended", reason: "no-account" });
  }
});

test("alice's admin device: her own session, made with her account beside its access key, keeps its admin rights", async () => {
  const headers = { "X-Device-Key": CONSOLE, Authorization: `Bearer ${session.issue(requester(proven(CONSOLE, "alice"))).token}` };
  assert.equal((await call("GET", "/api/device/sends", headers)).status, 200);
  const items = await call("GET", "/api/admin/items/homebrew/m-0123456789ab/fields", headers);
  assert.ok(![401, 403].includes(items.status), String(items.status));
});
