import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { webSession } from "../support/web-session.js";

// A console that reaches the server can always show a QR. An approved console
// that asks /api/pair/status with a pairSecret and gets no key (it lost its key,
// or another account holds it) is shown a re-pair QR. Nothing changes until an
// account approves that QR: then the console gets a new key, only at the secret
// that asked, the old key stops, and the approving account owns it within its
// device limit. A waiting console that asks again with a new secret takes its
// request over.
const PORT = 25900 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const ACCOUNTS = { alice: "alice-password", bob: "bob-password-1" };
const key = (c) => c.repeat(64);
const secret = (c) => c.toLowerCase().repeat(64);

function fakeNro(version) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write("CookingFoil", 0);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

async function boot() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-pair-repair-"));
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  fs.mkdirSync(path.join(data, "client"), { recursive: true });
  fs.writeFileSync(path.join(data, "client", "cookingfoil.nro"), fakeNro("0.3.63"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: Object.entries(ACCOUNTS).map(([n, p]) => `${n}:${p}`).join(","), COOK_DEVICE_PAIRING: "true",
      COOK_DEVICE_AUTO_APPROVE: "false", COOK_DEVICE_LIMIT: "2",
      COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return { child, data };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

async function withServer(run) {
  const server = await boot();
  try {
    await run(server);
  } finally {
    server.child.kill("SIGKILL");
    fs.rmSync(server.data, { recursive: true, force: true });
  }
}

const request = (deviceKey, pairSecret) => fetch(`${BASE}/api/pair/request`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey, pairSecret }),
}).then(async (r) => ({ code: r.status, body: await r.json() }));

async function poll(deviceKey, pairSecret) {
  const headers = { "X-Device-Key": deviceKey };
  if (pairSecret) headers["X-Pair-Secret"] = pairSecret;
  const r = await fetch(`${BASE}/api/pair/status`, { headers });
  return { code: r.status, auth: r.headers.get("x-cookingfoil-auth"), body: await r.json() };
}

const shop = async (deviceKey, accessKey) =>
  (await fetch(`${BASE}/api/shop/sections`, { headers: { "X-Device-Key": deviceKey, "X-Access-Key": accessKey } })).status;

const sessions = {};
const signedIn = async (account) => (sessions[account] ??= await webSession(BASE, account, ACCOUNTS[account]));

async function approveQr(account, pairCode) {
  const r = await fetch(`${BASE}/pair/approve`, {
    method: "POST", headers: { ...(await signedIn(account)), "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ code: pairCode }),
  });
  return { code: r.status, body: await r.json() };
}

/** A console `account` approved by QR, with the key it took. */
async function pairAs(account, deviceKey, pairSecret) {
  const asked = await request(deviceKey, pairSecret);
  assert.equal(asked.body.status, "pending");
  assert.equal((await approveQr(account, asked.body.pairCode)).code, 200);
  const { body } = await poll(deviceKey, pairSecret);
  assert.ok(body.accessKey, "the console takes its key");
  return body.accessKey;
}

async function downloadToken(data, account) {
  const r = await fetch(`${BASE}/pair/api/client-bundle`, { method: "POST", headers: { ...(await signedIn(account)), Origin: BASE } });
  assert.equal(r.status, 200);
  const file = path.join(data, `bundle-${account}-${Date.now()}.zip`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return JSON.parse(execFileSync("unzip", ["-p", file, "switch/cookingfoil/config.json"]).toString()).servers[0].enrollToken;
}

const enroll = (deviceKey, token) => fetch(`${BASE}/api/pair/enroll`, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": deviceKey }, body: JSON.stringify({ token }),
});

const mine = async (account) =>
  (await (await fetch(`${BASE}/pair/api/mine`, { headers: await signedIn(account) })).json()).devices.map((d) => d.deviceKey);

const pageText = async (account, pairUrl) =>
  (await fetch(pairUrl, { headers: { ...(await signedIn(account)), "Accept-Language": "en" } })).text();

test("a console that lost its key gets a re-pair QR; approving it hands a new key once, to that secret only, and the old key stops", () => withServer(async () => {
  for (const k of Object.keys(sessions)) delete sessions[k];
  const console1 = key("1");
  const oldKey = await pairAs("alice", console1, secret("a"));
  await pairAs("alice", key("2"), secret("b"));
  assert.equal(await shop(console1, oldKey), 200);

  // The console was formatted: a new secret, no key.
  const lost = secret("c");
  const qr = await poll(console1, lost);
  assert.equal(qr.code, 200);
  assert.deepEqual(Object.keys(qr.body).sort(), ["expiresAt", "pairCode", "pairUrl", "passwordOnly", "repair", "status"]);
  assert.equal(qr.body.status, "pending");
  assert.equal(qr.body.repair, true);
  assert.match(qr.body.pairUrl, /\/pair\/[a-f0-9]{32}$/);
  assert.match(qr.body.pairCode, /^[A-F0-9]{8}$/);
  const again = await poll(console1, lost);
  assert.equal(again.body.pairUrl, qr.body.pairUrl, "one re-pair link per console while it lives");
  assert.equal(again.body.pairCode, qr.body.pairCode);

  // Another secret cannot slip under the QR the owner is about to approve.
  const other = await poll(console1, secret("d"));
  assert.equal(other.code, 409);
  assert.equal(other.auth, "pair-secret-mismatch");

  assert.equal(await shop(console1, oldKey), 200, "asking changes nothing");
  assert.match(await pageText("alice", qr.body.pairUrl), /This console is already registered\. Approving reconnects it with a new key/);
  assert.match(await pageText("bob", qr.body.pairUrl), /already registered to another account/);

  // alice holds two consoles (the limit), but this one is already hers.
  assert.equal((await approveQr("alice", qr.body.pairCode)).code, 200);
  assert.deepEqual((await poll(console1)).body, { status: "approved", passwordOnly: true }, "no key without the secret");
  const handed = await poll(console1, lost);
  assert.ok(handed.body.accessKey);
  assert.equal(handed.body.status, "approved");
  assert.equal(handed.body.shopUrl, BASE);
  assert.equal((await poll(console1, lost)).body.accessKey, undefined, "once");
  assert.equal(await shop(console1, oldKey), 401, "the old key stops");
  assert.equal(await shop(console1, handed.body.accessKey), 200);
  assert.deepEqual((await mine("alice")).sort(), [console1, key("2")]);
}));

test("without a pairSecret, or knowing only the device key, nobody changes an approved console", () => withServer(async () => {
  for (const k of Object.keys(sessions)) delete sessions[k];
  const target = key("3");
  const accessKey = await pairAs("alice", target, secret("a"));

  assert.deepEqual((await poll(target)).body, { status: "approved", passwordOnly: true });
  assert.deepEqual((await poll(target, "not-hex")).body, { status: "approved", passwordOnly: true });
  assert.deepEqual((await request(target, secret("e"))).body, { status: "approved", passwordOnly: true });
  assert.equal((await enroll(target, "made-up-token")).status, 401);

  // A stranger with their own secret gets a QR, but with nobody approving it nothing moves.
  const stranger = await poll(target, secret("e"));
  assert.equal(stranger.body.repair, true);
  assert.equal((await poll(target, secret("e"))).body.accessKey, undefined);
  assert.equal(await shop(target, accessKey), 200, "the console's key still works");
  assert.deepEqual(await mine("alice"), [target]);
}));

test("a console another account holds: enroll 409, then the re-pair QR moves it to the approving account within its limit", () => withServer(async ({ data }) => {
  for (const k of Object.keys(sessions)) delete sessions[k];
  const moved = key("5");
  const r = await enroll(moved, await downloadToken(data, "alice"));
  assert.equal(r.status, 200);
  const alicesKey = (await r.json()).accessKey;

  const refused = await enroll(moved, await downloadToken(data, "bob"));
  assert.equal(refused.status, 409);
  assert.equal(refused.headers.get("x-cookingfoil-auth"), "enroll-other-account");

  const bobs = secret("f");
  const qr = await poll(moved, bobs);
  assert.equal(qr.body.repair, true);

  // bob holds his two consoles: the approval is refused and nothing moves.
  await pairAs("bob", key("6"), secret("1"));
  await pairAs("bob", key("7"), secret("2"));
  const full = await approveQr("bob", qr.body.pairCode);
  assert.equal(full.code, 409);
  assert.equal(full.body.code, "device-limit");
  assert.equal(await shop(moved, alicesKey), 200);
  assert.deepEqual(await mine("alice"), [moved]);

  // Room again: the console becomes bob's, with a new key at bob's console's secret.
  const revoke = await fetch(`${BASE}/pair/api/devices/revoke`, {
    method: "POST", headers: { ...(await signedIn("bob")), "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ deviceKey: key("6") }),
  });
  assert.equal(revoke.status, 200);
  assert.equal((await approveQr("bob", qr.body.pairCode)).code, 200);
  const handed = await poll(moved, bobs);
  assert.ok(handed.body.accessKey);
  assert.equal(await shop(moved, alicesKey), 401);
  assert.equal(await shop(moved, handed.body.accessKey), 200);
  assert.deepEqual(await mine("alice"), []);
  assert.deepEqual((await mine("bob")).sort(), [moved, key("7")]);
}));

test("a waiting console that asks again with a new secret takes its request over; the first secret is refused on /status", () => withServer(async () => {
  for (const k of Object.keys(sessions)) delete sessions[k];
  const waiting = key("8");
  const first = await request(waiting, secret("a"));
  assert.equal(first.body.status, "pending");
  const swapped = await request(waiting, secret("b"));
  assert.equal(swapped.code, 200);
  assert.equal(swapped.body.status, "pending");
  assert.equal(swapped.body.pairCode, first.body.pairCode, "the same QR");

  const stale = await poll(waiting, secret("a"));
  assert.equal(stale.code, 409);
  assert.equal(stale.auth, "pair-secret-mismatch");

  assert.equal((await approveQr("alice", swapped.body.pairCode)).code, 200);
  assert.equal((await poll(waiting, secret("a"))).body.accessKey, undefined, "the old secret gets no key");
  assert.ok((await poll(waiting, secret("b"))).body.accessKey);
}));
