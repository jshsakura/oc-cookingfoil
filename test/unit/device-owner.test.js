import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A valid download proves whose console it is: the enroll binds the console to that account, the
// web page lists it as theirs, a send reaches it, and every later request of the console can tell
// its owner, without ever counting as that person signed in on the web.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-device-owner-"));
Object.assign(process.env, {
  COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"), COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "false",
  COOK_AUTH_USERS: "alice:alice-password,bob:bob-password,carol:carol-password", COOK_TITLEDB_AUTO_FETCH: "false", COOK_PUBLIC_BASE_URL: "",
});
const { default: express } = await import("express");
const store = await import("../../src/security/store.js");
const enroll = await import("../../src/security/enroll-tokens.js");
const { hashAccessKey } = await import("../../src/security/pairing.js");
const { default: pairRouter } = await import("../../src/routes/pair.js");
const { default: webRouter } = await import("../../src/routes/device-pair.js");
const { default: pairGate } = await import("../../src/security/pairing-gate.js");
const { accountOf } = await import("../../src/security/link-identity.js");
const { default: sessionGate } = await import("../../src/security/session-gate.js");
const { default: sessionRoute } = await import("../../src/routes/session.js");

let webUser = "alice";
const app = express();
app.use("/api/pair", pairRouter());
app.use("/pair", (req, res, next) => { req.auth = { user: webUser }; next(); }, webRouter());
app.get("/api/session", pairGate(), sessionRoute);
app.get("/via-session", sessionGate(), (req, res) => res.json({ owner: req.deviceOwner ?? null, account: accountOf(req), lane: req.sessionLane === true }));
app.get("/identity", pairGate(), (req, res) => res.json({ owner: req.deviceOwner ?? null, account: accountOf(req), webUser: req.auth?.user ?? null }));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(data, { recursive: true, force: true });
});

const post = (url, headers, body) => fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const enrollAs = async (owner, deviceKey, label, accessKey) => {
  const r = await post("/api/pair/enroll", { "X-Device-Key": deviceKey, ...(accessKey ? { "X-Access-Key": accessKey } : {}) }, { token: enroll.issue(owner).token, label });
  return { status: r.status, body: await r.json() };
};
const mine = async (who) => { webUser = who; return (await (await fetch(`${base}/pair/api/mine`)).json()).devices.map((d) => d.deviceKey); };
const send = async (who, deviceKey) => { webUser = who; return (await post("/pair/api/sends", { Origin: base }, { deviceKey, path: "fixture.nsp" })).json(); };

for (const by of ["auto", "admin", "telegram"]) {
  test(`a console approved by ${by} is bound to the account whose download enrolls it, and takes its name`, async () => {
    const key = (by.charCodeAt(0).toString(16) + "A").repeat(32).slice(0, 64).toUpperCase();
    store.approveDevice(key, { label: "old label", addedBy: by, accessKeyHash: hashAccessKey("old-key") });
    const r = await enrollAs("alice", key, "alice console", "old-key");
    assert.equal(r.status, 200);
    assert.deepEqual({ bound: r.body.bound, owner: r.body.owner }, { bound: true, owner: { kind: "user", displayName: "alice" } });
    assert.equal(store.deviceAddedBy(key), "alice");
    assert.equal(store.devicesSnapshot().approved.find((d) => d.deviceKey === key).label, "alice console");
    assert.ok((await mine("alice")).includes(key));
    assert.equal((await send("alice", key)).error, "not in the library", "the send gets past the ownership check");
  });
}

test("enrolling again with the same account is idempotent; another account's download is refused with 409 and takes nothing", async () => {
  const key = "C3".repeat(32);
  const first = await enrollAs("alice", key, "mine");
  assert.equal(first.body.bound, true);
  const again = await enrollAs("alice", key, "mine", first.body.accessKey);
  assert.equal(again.status, 200);
  assert.equal(again.body.owner.displayName, "alice");
  const other = await enrollAs("bob", key, "bob wants it", again.body.accessKey);
  assert.equal(other.status, 409);
  assert.equal(store.deviceAddedBy(key), "alice");
  assert.ok(!(await mine("bob")).includes(key));
});

test("an admin device stays the admin's: with its key it takes a new one but is not bound; without it nothing happens", async () => {
  const key = "D4".repeat(32);
  store.approveDevice(key, { label: "admin console", addedBy: "admin", accessKeyHash: hashAccessKey("x"), admin: true });
  const before = store.getDeviceAccessKeyHash(key);
  const blind = await enrollAs("alice", key, "alice console");
  assert.equal(blind.status, 403);
  assert.equal(blind.body.accessKey, undefined);
  assert.equal(store.getDeviceAccessKeyHash(key), before, "no key handed out");
  const r = await enrollAs("alice", key, "alice console", "x");
  assert.equal(r.status, 200);
  assert.equal(r.body.bound, false);
  assert.equal(store.deviceAddedBy(key), "admin");
  assert.equal(store.isDeviceAdmin(key), true);
});

test("a console's own requests carry its owner, never as a web sign-in", async () => {
  const key = "E5".repeat(32);
  const { status, body } = await enrollAs("alice", key, "c");
  assert.equal(status, 200);
  const id = await (await fetch(`${base}/identity`, { headers: { "X-Device-Key": key, "X-Access-Key": body.accessKey } })).json();
  assert.deepEqual(id.owner, { state: "bound", owner: { kind: "user", id: "alice", displayName: "alice" }, active: true });
  assert.equal(id.account, null, "accountOf stays the web account's");
  assert.equal(id.webUser, null);
  const wrong = await (await fetch(`${base}/identity`, { headers: { "X-Device-Key": key, "X-Access-Key": "not-the-key" } })).json();
  assert.equal(wrong.owner, null, "no owner without the access key");
});

test("the status poll tells the binding only to a caller holding the key", async () => {
  const key = "F6".repeat(32);
  const { status, body } = await enrollAs("bob", key, "c");
  assert.equal(status, 200);
  const held = await (await fetch(`${base}/api/pair/status`, { headers: { "X-Device-Key": key, "X-Access-Key": body.accessKey } })).json();
  assert.equal(held.bound, true);
  assert.equal(held.owner.displayName, "bob");
  const bare = await (await fetch(`${base}/api/pair/status`, { headers: { "X-Device-Key": key } })).json();
  assert.equal(bare.owner, undefined);
  assert.equal(bare.bound, undefined);
});

test("a session made by the console carries the same owner, and a new binding ends it", async () => {
  const key = "A7".repeat(32);
  const { status, body } = await enrollAs("bob", key, "c");
  assert.equal(status, 200);
  const dev = { "X-Device-Key": key, "X-Access-Key": body.accessKey };
  const { token } = await (await fetch(`${base}/api/session`, { headers: dev })).json();
  const via = async () => (await fetch(`${base}/via-session`, { headers: { "X-Device-Key": key, Authorization: `Bearer ${token}` } }));
  const ok = await (await via()).json();
  assert.equal(ok.lane, true);
  assert.equal(ok.owner.owner.id, "bob");
  assert.equal(ok.account, null, "a session of a console is no web sign-in");
  store.approveDevice(key, { addedBy: "auto", accessKeyHash: hashAccessKey("rotated") });
  assert.equal((await via()).status, 401, "a new key for the console ends its old session");
});

test("an approved console without its access key is refused before the download is spent: a stranger gets no key", async () => {
  const key = "B8".repeat(32);
  store.approveDevice(key, { label: "someone's", addedBy: "auto", accessKeyHash: hashAccessKey("theirs") });
  const before = store.getDeviceAccessKeyHash(key);
  const token = enroll.issue("bob").token;
  const r = await post("/api/pair/enroll", { "X-Device-Key": key }, { token, label: "taken?" });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).accessKey, undefined);
  assert.equal(store.getDeviceAccessKeyHash(key), before, "the holder keeps its key");
  assert.equal(store.deviceAddedBy(key), "auto");
  // The download was not spent: the same token still enrolls a console of bob's.
  const r2 = await post("/api/pair/enroll", { "X-Device-Key": "B9".repeat(32) }, { token, label: "bob's" });
  assert.equal(r2.status, 200);
});

test("a console that never got its enroll answer repeats it with the same download and gets in again", async () => {
  const key = "BA".repeat(32);
  const token = enroll.issue("carol").token;
  const first = await post("/api/pair/enroll", { "X-Device-Key": key }, { token, label: "c" });
  assert.equal(first.status, 200);
  const again = await post("/api/pair/enroll", { "X-Device-Key": key }, { token, label: "c" });
  assert.equal(again.status, 200);
  const body = await again.json();
  assert.equal(body.bound, true);
  assert.equal(body.owner.displayName, "carol");
});

test("a person renames their own console from /pair; another account's console is answered as missing", async () => {
  const key = "D7".repeat(32);
  assert.equal((await enrollAs("bob", key, "bob's")).status, 200);
  const rename = async (who, label) => { webUser = who; return post("/pair/api/devices/label", { Origin: base }, { deviceKey: key, label }); };
  assert.equal((await rename("alice", "taken")).status, 404);
  assert.equal((await rename("bob", "   ")).status, 400);
  const ok = await rename("bob", "  Den  ");
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).label, "Den");
  webUser = "bob";
  const listed = (await (await fetch(`${base}/pair/api/mine`)).json()).devices.find((d) => d.deviceKey === key);
  assert.equal(listed.label, "Den");
  assert.match(listed.code, /^[0-9A-F]{8}$/);
  assert.ok("lastSeenAt" in listed);
});
