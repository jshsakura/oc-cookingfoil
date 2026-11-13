import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A console says which platform it is when it pairs; none said is a Switch. One the server does not know is
// refused, an approved console keeps its platform, and a Vita is kept off the Switch library's addresses.
const root = mkdtempSync(path.join(tmpdir(), "cf-platform-pair-"));
const games = path.join(root, "games");
mkdirSync(games, { recursive: true });
writeFileSync(path.join(games, "Test Game [0100000000010000][v0].nsp"), "nsp");
Object.assign(process.env, {
  COOK_PORT: "0", COOK_DATA_DIR: path.join(root, "data"), COOK_GAMES_DIR: games,
  COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "true",
  COOK_TITLEDB_AUTO_FETCH: "false", COOK_PUBLIC_BASE_URL: "", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
});
const store = await import("../../src/security/store.js");
const enroll = await import("../../src/security/enroll-tokens.js");
const { default: server } = await import("../../src/index.js");
if (!server.listening) await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
  // The whole server runs in this process and keeps its timers: the file ends here once its tests are done.
  setTimeout(() => process.exit(), 100);
});

const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");
const post = (url, headers, body) =>
  fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const approve = async (deviceKey, platform) => {
  const asked = await post("/api/pair/request", { "X-Device-Key": deviceKey, Authorization: ALICE }, platform ? { platform } : {});
  assert.equal(asked.status, 200);
  const status = await (await fetch(`${base}/api/pair/status?deviceKey=${deviceKey}`, { headers: { Authorization: ALICE } })).json();
  assert.equal(status.status, "approved");
  assert.equal("platform" in status, false, "the status answer stays as a Switch reads it");
  return { "X-Device-Key": deviceKey, "X-Access-Key": status.accessKey };
};

test("a console that names no platform is a Switch, and one the server does not know is refused", async () => {
  await approve("A1".repeat(32));
  assert.equal(store.devicePlatform("A1".repeat(32)), "switch");
  const unknown = await post("/api/pair/request", { "X-Device-Key": "A2".repeat(32) }, { platform: "dreamcast" });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).code, "platform");
  assert.equal(store.isDevicePending("A2".repeat(32)), false, "a refused request leaves nothing waiting");
  const odd = await post("/api/pair/enroll", { "X-Device-Key": "A3".repeat(32) }, { token: enroll.issue("alice").token, platform: 7 });
  assert.equal(odd.status, 400);
});

test("a Vita is kept as one, and cannot come back as another platform", async () => {
  const key = "B1".repeat(32);
  await approve(key, "vita");
  assert.equal(store.devicePlatform(key), "vita");
  for (const platform of ["switch"]) {
    const r = await post("/api/pair/request", { "X-Device-Key": key }, { platform });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, "platform-mismatch");
  }
  const again = await post("/api/pair/request", { "X-Device-Key": key }, { platform: "vita" });
  assert.equal(again.status, 200, "asking as what it is stays fine");
  const switchKey = "B2".repeat(32);
  await approve(switchKey);
  const enrolled = await post("/api/pair/enroll", { "X-Device-Key": switchKey }, { token: enroll.issue("alice").token, platform: "vita" });
  assert.equal(enrolled.status, 409, "a Switch does not enroll as a Vita");
  assert.equal(store.devicePlatform(switchKey), "switch");
});

test("a Vita that waits for approval is approved as a Vita", async () => {
  const key = "C1".repeat(32);
  assert.equal((await post("/api/pair/request", { "X-Device-Key": key }, { platform: "vita" })).status, 200);
  assert.equal(store.devicePlatform(key), "vita");
  store.approveDevice(key, { label: "admin's pick", addedBy: "admin", accessKeyHash: null });
  assert.equal(store.devicePlatform(key), "vita");
});

test("a Vita enrolled by a download is a Vita", async () => {
  const key = "C2".repeat(32);
  const r = await post("/api/pair/enroll", { "X-Device-Key": key }, { token: enroll.issue("alice").token, platform: "vita" });
  assert.equal(r.status, 200);
  assert.equal(store.devicePlatform(key), "vita");
});

test("a Vita is refused on the Switch library's addresses, and a Switch is not", async () => {
  const vita = await approve("D1".repeat(32), "vita");
  const nx = await approve("D2".repeat(32));
  for (const url of ["/api/library/sections", "/api/patches", "/api/saves", "/api/title/0100000000010000",
    "/api/device/sends", "/api/firmware", "/api/retro/achievements/x", "/games.json", "/Test%20Game%20%5B0100000000010000%5D%5Bv0%5D.nsp"]) {
    const r = await fetch(base + url, { headers: vita });
    assert.equal(r.status, 404, url);
    assert.deepEqual(await r.json(), { error: "not for this platform", code: "platform" }, url);
  }
  assert.equal((await fetch(`${base}/api/library/sections`, { headers: nx })).status, 200);
  assert.equal((await fetch(`${base}/api/homebrew`, { headers: nx })).status, 200);
  assert.equal((await fetch(`${base}/Test%20Game%20%5B0100000000010000%5D%5Bv0%5D.nsp`, { headers: nx })).status, 200, "a Switch takes the game file");
});

test("a Vita's session token is held to the same rule", async () => {
  const vita = await approve("E1".repeat(32), "vita");
  const session = await (await fetch(`${base}/api/session`, { headers: vita })).json();
  assert.ok(session.token, "the console took a session token");
  const r = await fetch(`${base}/api/library/sections`, { headers: { "X-Device-Key": vita["X-Device-Key"], Authorization: `Bearer ${session.token}` } });
  assert.equal(r.status, 404);
});
