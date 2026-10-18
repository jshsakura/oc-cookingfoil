import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { everything } from "../support/security-db.js";
import { webSession } from "../support/web-session.js";

// The web page hands a signed-in user the client and this server in one zip,
// with a one-day, one-use enrollment token in its config; the console spends
// it for its own access key, approved under that user.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-enroll-unit-"));
process.env.COOK_DATA_DIR = dir;
const { zipStore } = await import("../../src/helpers/zip-store.js");
const enroll = await import("../../src/security/enroll-tokens.js");

const KEY_A = "A1".repeat(32);
const KEY_B = "B2".repeat(32);

test("a stored zip opens with the stock unzip, names and bytes intact", () => {
  const zip = zipStore([{ name: "switch/cookingfoil/cookingfoil.nro", data: Buffer.from([0, 1, 2, 255]) }, { name: "switch/cookingfoil/config.json", data: Buffer.from('{"한":1}\n') }]);
  const file = path.join(dir, "t.zip");
  fs.writeFileSync(file, zip);
  execFileSync("unzip", ["-tq", file]);
  assert.deepEqual([...execFileSync("unzip", ["-p", file, "switch/cookingfoil/cookingfoil.nro"])], [0, 1, 2, 255]);
  assert.equal(execFileSync("unzip", ["-p", file, "switch/cookingfoil/config.json"]).toString(), '{"한":1}\n');
});

test("an enrollment token works once, within its day, and lists show no secret", () => {
  enroll.resetForTests();
  const now = Date.UTC(2026, 9, 15);
  const a = enroll.issue("alice", now);
  assert.match(a.token, /^cfe_[A-Za-z0-9_-]{43}$/);
  assert.match(a.id, /^[0-9a-f]{8}$/);
  assert.equal(a.expiresAt, now + enroll.TTL_MS);
  assert.deepEqual(enroll.spend(a.token, KEY_A, { now: now + 1000 }), { owner: "alice", id: a.id });
  assert.equal(enroll.spend(a.token, KEY_B, { now: now + 2000 }), null, "once");
  const late = enroll.issue("alice", now);
  assert.equal(enroll.spend(late.token, KEY_A, { now: now + enroll.TTL_MS }), null, "not after its day");
  assert.equal(enroll.spend("cfe_" + "x".repeat(43), KEY_A, { now }), null);
  assert.equal(enroll.spend("nope", KEY_A, { now }), null);
  const refused = enroll.issue("alice", now);
  assert.equal(enroll.spend(refused.token, KEY_A, { canEnroll: () => false, now }).refused, true);
  assert.equal(enroll.spend(refused.token, KEY_A, { now }).owner, "alice", "a refused try does not spend it");

  const rows = enroll.list({ owner: "alice", now: now + enroll.TTL_MS + 1 });
  assert.ok(!JSON.stringify(rows).includes("cfe_"), "no token in a list");
  assert.deepEqual(rows.map((r) => r.state).sort(), ["expired", "used", "used"]);
  assert.equal(rows.find((r) => r.id === a.id).deviceKey, KEY_A);
  const stored = everything(dir);
  assert.ok(!stored.includes(a.token) && !stored.includes(late.token), "only hashes are kept");

  // At most three waiting per account; a new download withdraws the oldest.
  enroll.resetForTests();
  const issued = [1, 2, 3, 4].map((i) => enroll.issue("bob", now + i));
  assert.equal(enroll.spend(issued[0].token, KEY_B, { now: now + 10 }), null);
  assert.equal(enroll.list({ owner: "bob", now: now + 10 }).filter((r) => r.state === "waiting").length, 3);
  assert.equal(enroll.revoke(issued[1].id, { owner: "alice", now }), false, "only the owner withdraws");
  assert.equal(enroll.revoke(issued[1].id, { owner: "bob", now }), true);
  assert.equal(enroll.spend(issued[1].token, KEY_B, { now: now + 20 }), null);
});

/** A minimal NRO: header, then an ASET block whose NACP carries `version`. */
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

const PORT = 19800 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
// The signed-in pages of alice and bob on the server a test booted.
let ALICE;
let BOB;

async function boot(data, extra = {}) {
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  fs.mkdirSync(path.join(data, "client"), { recursive: true });
  fs.writeFileSync(path.join(data, "client", "cookingfoil.nro"), fakeNro("0.3.63"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password,bob:bob-password-1", COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "false",
      COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false", ...extra },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) {
        ALICE = await webSession(BASE, "alice", "alice-password");
        BOB = await webSession(BASE, "bob", "bob-password-1");
        return child;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

const bundle = (auth, origin = BASE) => fetch(`${BASE}/pair/api/client-bundle`, { method: "POST", headers: { ...auth, Origin: origin } });
const enrollWith = (token, key) => fetch(`${BASE}/api/pair/enroll`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": key }, body: JSON.stringify({ token }) });
async function tokenIn(res, data) {
  const file = path.join(data, `got-${Date.now()}.zip`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  assert.equal(execFileSync("unzip", ["-p", file, "switch/cookingfoil/cookingfoil.nro"]).length, fakeNro("0.3.63").length);
  const config = JSON.parse(execFileSync("unzip", ["-p", file, "switch/cookingfoil/config.json"]).toString());
  assert.equal(config.servers[0].url, BASE);
  assert.equal(config.servers[0].password, "", "no password in the download");
  return config.servers[0].enrollToken;
}

test("a downloaded client connects once, under the account that downloaded it", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-enroll-"));
  const server = await boot(data);
  try {
    const info = await (await fetch(`${BASE}/api/shop/info`, { headers: ALICE })).json();
    assert.ok(info.features.includes("enroll"));
    assert.equal((await bundle(ALICE, "https://evil.example")).status, 403, "never for another site");
    assert.equal((await fetch(`${BASE}/pair/api/client-bundle`, { method: "POST", headers: { Origin: BASE } })).status, 401);
    const icon = await fetch(`${BASE}/api/client/icon`, { headers: ALICE });
    assert.equal(icon.status, 404, "the fake build has no icon");

    const r = await bundle(ALICE);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/zip");
    assert.match(r.headers.get("content-disposition"), /CookingFoil-0\.3\.63\.zip/);
    const token = await tokenIn(r, data);

    let e = await enrollWith(token, KEY_A);
    assert.equal(e.status, 200);
    const { accessKey } = await e.json();
    assert.equal((await fetch(`${BASE}/api/shop/sections`, { headers: { "X-Device-Key": KEY_A, "X-Access-Key": accessKey } })).status, 200, "the console is in, no password");
    e = await enrollWith(token, KEY_B);
    assert.equal(e.status, 401, "once");
    assert.equal(e.headers.get("x-cookingfoil-enroll"), "invalid");

    const mine = await (await fetch(`${BASE}/pair/api/mine`, { headers: ALICE })).json();
    assert.equal(mine.clients[0].state, "used");
    assert.match(mine.clients[0].code, /^[0-9A-F]{8}$/);
    assert.ok(mine.devices.some((d) => d.deviceKey === KEY_A), "approved under alice");
    assert.ok(!JSON.stringify(mine).includes("cfe_"));

    // Bob's download cannot take alice's console; alice's own new one can (the console after a format).
    const bobs = await tokenIn(await bundle(BOB), data);
    assert.equal((await enrollWith(bobs, KEY_A)).status, 409);
    assert.equal((await enrollWith(bobs, KEY_B)).status, 200, "a refused try did not spend bob's token");
    const again = await tokenIn(await bundle(ALICE), data);
    const re = await enrollWith(again, KEY_A);
    assert.equal(re.status, 200);
    const newKey = (await re.json()).accessKey;
    assert.equal((await fetch(`${BASE}/api/shop/sections`, { headers: { "X-Device-Key": KEY_A, "X-Access-Key": accessKey } })).status, 401, "the old key is gone");
    assert.equal((await fetch(`${BASE}/api/shop/sections`, { headers: { "X-Device-Key": KEY_A, "X-Access-Key": newKey } })).status, 200);

    // A waiting download can be withdrawn by its owner.
    const waiting = await bundle(ALICE);
    const id = waiting.headers.get("x-cookingfoil-download-id");
    const left = await tokenIn(waiting, data);
    assert.equal((await fetch(`${BASE}/pair/api/clients/${id}/revoke`, { method: "POST", headers: BOB })).status, 404, "not bob's");
    assert.equal((await fetch(`${BASE}/pair/api/clients/${id}/revoke`, { method: "POST", headers: ALICE })).status, 200);
    assert.equal((await enrollWith(left, "C3".repeat(32))).status, 401);
  } finally {
    server.kill("SIGKILL");
  }
});

test("a console that asks for approval with its download's token is approved under that account at once", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-enroll-req-"));
  const server = await boot(data);
  try {
    const token = await tokenIn(await bundle(ALICE), data);
    const KEY = "D4".repeat(32);
    const SECRET = "e5".repeat(32);
    const ask = await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey: KEY, pairSecret: SECRET, enrollToken: token }) });
    assert.deepEqual(await ask.json(), { status: "approved", passwordOnly: true });
    const st = await (await fetch(`${BASE}/api/pair/status?deviceKey=${KEY}`, { headers: { "X-Pair-Secret": SECRET } })).json();
    assert.equal(st.status, "approved");
    assert.ok(st.accessKey, "the key goes to the console that asked");
    const mine = await (await fetch(`${BASE}/pair/api/mine`, { headers: ALICE })).json();
    assert.ok(mine.devices.some((d) => d.deviceKey === KEY), "under alice, not in the admin's queue");
    assert.equal(mine.clients[0].state, "used");

    // A spent token asks like any console: it waits.
    const other = "F6".repeat(32);
    const late = await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey: other, enrollToken: token }) });
    assert.equal((await late.json()).status, "pending");
  } finally {
    server.kill("SIGKILL");
  }
});

test("the download ships the build being offered and this server's config, with either build source", async () => {
  for (const source of ["manual", "github"]) {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), `cf-bundle-${source}-`));
    // A fetched build newer than the manual one: offered in github mode only.
    const fetched = fakeNro("0.3.70");
    fs.mkdirSync(path.join(data, "client", "github"), { recursive: true });
    fs.writeFileSync(path.join(data, "client", "github", "cookingfoil.nro"), fetched);
    // A repository name the follower refuses before asking anyone: no network in tests.
    const server = await boot(data, { COOK_CLIENT_SOURCE: source, COOK_CLIENT_RELEASE_REPO: "not-a-repo" });
    try {
      const r = await bundle(ALICE);
      assert.equal(r.status, 200, source);
      const want = source === "github" ? "0.3.70" : "0.3.63";
      assert.match(r.headers.get("content-disposition"), new RegExp(`CookingFoil-${want.replaceAll(".", "\\.")}\\.zip`), source);
      const file = path.join(data, "got.zip");
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      const nro = execFileSync("unzip", ["-p", file, "switch/cookingfoil/cookingfoil.nro"]);
      assert.deepEqual(nro, source === "github" ? fetched : fakeNro("0.3.63"), `${source}: the offered build`);
      const config = JSON.parse(execFileSync("unzip", ["-p", file, "switch/cookingfoil/config.json"]).toString());
      assert.equal(config.servers[0].url, BASE, source);
      assert.match(config.servers[0].enrollToken, /^cfe_/, source);
      assert.equal(config.servers[0].password, "", source);
      assert.equal((await enrollWith(config.servers[0].enrollToken, KEY_A)).status, 200, `${source}: the token connects the console`);
    } finally {
      server.kill("SIGKILL");
      await new Promise((r) => server.once("exit", r));
    }
  }
});
