import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { everything } from "../support/security-db.js";
import { webSession, adminSession } from "../support/web-session.js";

// The web page hands a signed-in user the client and this server in one zip,
// with a one-hour enrollment token in its config; a console spends
// it for its own access key, approved under that user.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-enroll-unit-"));
process.env.COOK_DATA_DIR = dir;
const { zipStore } = await import("../../src/helpers/zip-store.js");
const enroll = await import("../../src/security/enroll-tokens.js");
const envs = await import("../../src/helpers/envs.js");

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

test("an enrollment token works once, within its hour, and lists show no secret", () => {
  enroll.resetForTests();
  const now = Date.UTC(2026, 9, 15);
  const a = enroll.issue("alice", now);
  assert.match(a.token, /^cfe_[A-Za-z0-9_-]{43}$/);
  assert.match(a.id, /^[0-9a-f]{8}$/);
  assert.equal(a.expiresAt, now + enroll.TTL_MS);
  assert.deepEqual(enroll.spend(a.token, KEY_A, { now: now + 1000 }), { owner: "alice", id: a.id });
  assert.equal(enroll.spend(a.token, KEY_B, { now: now + 2000 }), null, "once");
  const late = enroll.issue("alice", now);
  assert.equal(enroll.spend(late.token, KEY_A, { now: now + enroll.TTL_MS }), null, "not after its hour");
  assert.equal(enroll.spend("cfe_" + "x".repeat(43), KEY_A, { now }), null);
  assert.equal(enroll.spend("nope", KEY_A, { now }), null);
  const refused = enroll.issue("alice", now);
  assert.equal(enroll.spend(refused.token, KEY_A, { canEnroll: () => false, now }).refused, true);
  assert.equal(enroll.spend(refused.token, KEY_A, { now }).owner, "alice", "a refused try does not spend it");

  const rows = enroll.list({ owner: "alice", now: now + enroll.TTL_MS + 1 });
  assert.ok(!JSON.stringify(rows).includes("cfe_"), "no token in a list");
  assert.deepEqual(rows.map((r) => r.state).sort(), ["revoked", "used", "used"], "a newer download withdrew the unused one");
  assert.equal(rows.find((r) => r.id === a.id).deviceKey, KEY_A);
  const stored = everything(dir);
  assert.ok(!stored.includes(a.token) && !stored.includes(late.token), "only hashes are kept");

  // One hour, and one live download per account: a new one withdraws the earlier unused ones.
  assert.equal(enroll.TTL_MS, 60 * 60 * 1000);
  enroll.resetForTests();
  const lapsing = enroll.issue("carol", now);
  assert.equal(enroll.lookup(lapsing.token, now + enroll.TTL_MS)?.state, "expired");
  enroll.resetForTests();
  const spentEarlier = enroll.issue("bob", now);
  assert.ok(enroll.spend(spentEarlier.token, KEY_A, { now: now + 1 }));
  const issued = [1, 2, 3].map((i) => enroll.issue("bob", now + i));
  const other = enroll.issue("alice", now + 4);
  assert.deepEqual(issued.map((d) => enroll.lookup(d.token, now + 5)?.state), ["revoked", "revoked", "waiting"]);
  assert.equal(enroll.lookup(spentEarlier.token, now + 5)?.state, "used", "a used one stays as history");
  assert.equal(enroll.lookup(other.token, now + 5)?.state, "waiting", "another account's download is untouched");
  assert.equal(enroll.spend(issued[0].token, KEY_B, { now: now + 10 }), null);
  assert.equal(enroll.revoke(issued[2].id, { owner: "alice", now }), false, "only the owner withdraws");
  assert.equal(enroll.revoke(issued[2].id, { owner: "bob", now }), true);
  assert.equal(enroll.spend(issued[2].token, KEY_B, { now: now + 20 }), null);
});

test("with manual approval a download enrolls one console, and one saved with several consoles loads as used", async () => {
  enroll.resetForTests();
  const now = Date.UTC(2026, 9, 23);
  const d = enroll.issue("alice", now);
  assert.ok(enroll.spend(d.token, KEY_A, { now: now + 1 }));
  assert.equal(enroll.spend(d.token, KEY_B, { now: now + 2 }), null, "a second console is refused");
  assert.equal(enroll.spend(d.token, KEY_A, { now: now + 3 }), null, "the first console does not spend it again");
  assert.equal(enroll.revoke(d.id, { owner: "alice", now: now + 4 }), true, "a spent download inside its hour can be ended");
  assert.equal(enroll.respend(d.token, KEY_A, { now: now + 5 }), null, "and then re-enrolls nobody");

  // An older build kept every console a download took in `devices`.
  const { recordStore } = await import("../../src/db/security-stores.js");
  const token = "cfe_" + "A".repeat(43);
  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  recordStore("enroll-token").sync([[hashed, { id: "0000000a", owner: "alice", createdAt: now, expiresAt: now + enroll.TTL_MS, usedAt: now + 1, deviceKey: KEY_A, devices: [KEY_A, KEY_B] }]]);
  const fresh = await import("../../src/security/enroll-tokens.js?legacy-devices");
  assert.equal(fresh.lookup(token, now + 2)?.state, "used");
  assert.equal(fresh.spend(token, "C3".repeat(32), { now: now + 2 }), null);
  assert.equal(fresh.spend(token, KEY_B, { now: now + 2 }), null);
  const [row] = fresh.list({ owner: "alice", now: now + 2 });
  assert.deepEqual([row.state, row.deviceKey], ["used", KEY_A]);
});

test("the console that spent a download may enroll again with it within its hour, no other console and not after", () => {
  enroll.resetForTests();
  const now = 1_700_000_000_000;
  const d = enroll.issue("alice", now);
  assert.ok(enroll.spend(d.token, KEY_A, { now: now + 1 }));
  assert.deepEqual(enroll.respend(d.token, KEY_A, { now: now + 4000 }), { owner: "alice", id: d.id }, "the same console, seconds later");
  assert.equal(enroll.respend(d.token, KEY_B, { now: now + 4000 }), null, "another console");
  assert.equal(enroll.respend(d.token, KEY_A, { canEnroll: () => false, now: now + 4000 }), null, "an account that may no longer enroll");
  assert.equal(enroll.respend(d.token, KEY_A, { now: now + enroll.TTL_MS }), null, "not after its hour");
  const waiting = enroll.issue("bob", now);
  assert.equal(enroll.respend(waiting.token, KEY_A, { now: now + 1 }), null, "a token nobody spent is spent, not re-spent");
  assert.equal(enroll.respend("nope", KEY_A, { now }), null);
});

test("a token's life counts from its issue, so one saved with a day's expiry ends an hour after", async () => {
  const now = 1_700_000_000_000;
  const { recordStore } = await import("../../src/db/security-stores.js");
  const token = "cfe_" + "B".repeat(43);
  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  recordStore("enroll-token").sync([[hashed, { id: "0000000b", owner: "alice", createdAt: now, expiresAt: now + 24 * 60 * 60 * 1000 }]]);
  const fresh = await import("../../src/security/enroll-tokens.js?legacy-day");
  assert.equal(fresh.lookup(token, now + enroll.TTL_MS - 1)?.state, "waiting");
  assert.equal(fresh.lookup(token, now + enroll.TTL_MS)?.state, "expired");
  assert.equal(fresh.spend(token, KEY_A, { now: now + enroll.TTL_MS }), null);
  assert.equal(fresh.list({ now }).find((r) => r.id === "0000000b")?.expiresAt, now + enroll.TTL_MS);
});

// Automatic approval: a download enrolls consoles for its hour, at most
// enrollPerHour (5 unless set) per account in any rolling hour across all its downloads.
const consoleKey = (i) => i.toString(16).toUpperCase().padStart(2, "0").repeat(32);
const multi = (now) => ({ multi: true, now });
/** Whether a spend enrolled the console (a refusal names the owner too). */
const took = (r) => Boolean(r?.owner && !r.limit && !r.full && !r.refused);

test("with automatic approval one download enrolls five consoles; the sixth is over the account's limit", () => {
  enroll.resetForTests();
  const now = 1_700_000_000_000;
  assert.equal(envs.enrollPerHour, 5, "five unless set");
  const d = enroll.issue("alice", now);
  for (let i = 1; i <= 5; i++) assert.deepEqual(enroll.spend(d.token, consoleKey(i), multi(now + i)), { owner: "alice", id: d.id }, `console ${i}`);
  const sixth = enroll.spend(d.token, consoleKey(6), multi(now + 6));
  assert.deepEqual(sixth, { limit: true, owner: "alice", id: d.id });
  assert.equal(enroll.spend(d.token, consoleKey(6), multi(now + 7))?.limit, true, "a refusal spends nothing and stays refused");
  const other = enroll.issue("bob", now + 8);
  assert.ok(took(enroll.spend(other.token, consoleKey(6), multi(now + 9))), "another account's limit is its own");
});

test("a fresh download does not reset the limit; once the hour has passed a new download works again", () => {
  enroll.resetForTests();
  const now = 1_700_000_000_000;
  const d = enroll.issue("alice", now);
  for (let i = 1; i <= 5; i++) assert.ok(took(enroll.spend(d.token, consoleKey(i), multi(now + i * 1000))));
  const fresh = enroll.issue("alice", now + 10_000);
  assert.equal(enroll.spend(fresh.token, consoleKey(6), multi(now + 11_000))?.limit, true, "the sixth console within the hour");
  // The first enrollment leaves the window at now + 1000 + TTL_MS; one place opens.
  const later = enroll.issue("alice", now + 1000 + enroll.TTL_MS);
  assert.ok(took(enroll.spend(later.token, consoleKey(6), multi(now + 1000 + enroll.TTL_MS + 1))), "one place has opened");
  assert.equal(enroll.spend(later.token, consoleKey(7), multi(now + 1000 + enroll.TTL_MS + 2))?.limit, true, "but only one");
  const muchLater = enroll.issue("alice", now + 3 * enroll.TTL_MS);
  for (let i = 7; i <= 11; i++) assert.ok(took(enroll.spend(muchLater.token, consoleKey(i), multi(now + 3 * enroll.TTL_MS + i))), `console ${i}`);
});

test("a new download ends the account's earlier one even with room left; its consoles were enrolled and stay counted", () => {
  enroll.resetForTests();
  const now = 1_700_000_000_000;
  const d = enroll.issue("alice", now);
  assert.ok(took(enroll.spend(d.token, consoleKey(1), multi(now + 1))));
  assert.ok(took(enroll.spend(d.token, consoleKey(2), multi(now + 2))));
  const next = enroll.issue("alice", now + 3);
  assert.equal(enroll.spend(d.token, consoleKey(3), multi(now + 4)), null);
  assert.equal(enroll.lookup(d.token, now + 4)?.reason, "revoked");
  assert.equal(enroll.respend(d.token, consoleKey(1), multi(now + 5)), null, "an ended download re-enrolls nobody");
  for (let i = 3; i <= 5; i++) assert.ok(took(enroll.spend(next.token, consoleKey(i), multi(now + 5 + i))), `console ${i}`);
  assert.equal(enroll.spend(next.token, consoleKey(6), multi(now + 20))?.limit, true, "the ended download's two consoles still count");
  assert.equal(enroll.lookup(next.token, now + enroll.TTL_MS + 3)?.reason, "expired", "past its hour");
});

test("the same console enrolling again with its download does not count again", () => {
  enroll.resetForTests();
  const now = 1_700_000_000_000;
  const d = enroll.issue("alice", now);
  assert.ok(took(enroll.spend(d.token, consoleKey(1), multi(now + 1))));
  for (let n = 0; n < 4; n++) {
    assert.equal(enroll.spend(d.token, consoleKey(1), multi(now + 2 + n)), null, "spend leaves it to respend");
    assert.deepEqual(enroll.respend(d.token, consoleKey(1), multi(now + 2 + n)), { owner: "alice", id: d.id });
  }
  for (let i = 2; i <= 5; i++) assert.ok(took(enroll.spend(d.token, consoleKey(i), multi(now + 10 + i))), `console ${i}`);
  assert.deepEqual(enroll.respend(d.token, consoleKey(3), multi(now + 20)), { owner: "alice", id: d.id }, "any console it took");
  assert.equal(enroll.spend(d.token, consoleKey(6), multi(now + 21))?.limit, true);
});

test("the hourly count is of different consoles: one console back with five fresh downloads counts once", () => {
  enroll.resetForTests();
  const now = 1_700_000_000_000;
  for (let n = 0; n < 5; n++) {
    const d = enroll.issue("alice", now + n * 10);
    assert.ok(took(enroll.spend(d.token, consoleKey(1), multi(now + n * 10 + 1))), `download ${n + 1}`);
  }
  const d = enroll.issue("alice", now + 100);
  for (let i = 2; i <= 5; i++) assert.ok(took(enroll.spend(d.token, consoleKey(i), multi(now + 100 + i))), `console ${i}`);
  assert.equal(enroll.spend(d.token, consoleKey(6), multi(now + 110))?.limit, true, "the sixth different console");
});

test("issuing hundreds of downloads cannot push this hour's consoles out of the count", () => {
  enroll.resetForTests();
  const now = 1_700_000_000_000;
  const d = enroll.issue("alice", now);
  for (let i = 1; i <= 5; i++) assert.ok(took(enroll.spend(d.token, consoleKey(i), multi(now + i))));
  let last;
  for (let n = 0; n < 502; n++) last = enroll.issue("alice", now + 10 + n);
  assert.equal(enroll.spend(last.token, consoleKey(6), multi(now + 600))?.limit, true);
});

test("with manual approval a download stays single-use", () => {
  enroll.resetForTests();
  const now = 1_700_000_000_000;
  const d = enroll.issue("alice", now);
  assert.ok(took(enroll.spend(d.token, consoleKey(1), { now: now + 1 })));
  assert.equal(enroll.spend(d.token, consoleKey(2), { now: now + 2 }), null);
  assert.equal(enroll.lookup(d.token, now + 2)?.reason, "used");
  assert.equal(enroll.lookup(d.token, now + enroll.TTL_MS)?.reason, "expired", "past its hour it says expired");
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
const enrollWith = (token, key, label) => fetch(`${BASE}/api/pair/enroll`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": key }, body: JSON.stringify({ token, label }) });
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
    const info = await (await fetch(`${BASE}/api/library/info`, { headers: ALICE })).json();
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
    assert.equal((await fetch(`${BASE}/api/library/sections`, { headers: { "X-Device-Key": KEY_A, "X-Access-Key": accessKey } })).status, 200, "the console is in, no password");
    e = await enrollWith(token, KEY_B);
    assert.equal(e.status, 401, "once");
    assert.equal(e.headers.get("x-cookingfoil-enroll"), "used", "says why");
    // The same console asking again seconds later (production did) gets a fresh key; the earlier one stops.
    e = await enrollWith(token, KEY_A);
    assert.equal(e.status, 200, "the console that spent it may enroll again within its hour");
    const again1 = await e.json();
    assert.equal(again1.status, "approved");
    assert.ok(again1.accessKey && again1.accessKey !== accessKey);
    assert.equal((await fetch(`${BASE}/api/library/sections`, { headers: { "X-Device-Key": KEY_A, "X-Access-Key": accessKey } })).status, 401, "the earlier key is refused");
    assert.equal((await fetch(`${BASE}/api/library/sections`, { headers: { "X-Device-Key": KEY_A, "X-Access-Key": again1.accessKey } })).status, 200);
    e = await enrollWith(token, "C3".repeat(32));
    assert.equal(e.status, 401, "any other console still is refused");
    assert.equal(e.headers.get("x-cookingfoil-enroll"), "used");

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
    assert.equal((await fetch(`${BASE}/api/library/sections`, { headers: { "X-Device-Key": KEY_A, "X-Access-Key": accessKey } })).status, 401, "the old key is gone");
    assert.equal((await fetch(`${BASE}/api/library/sections`, { headers: { "X-Device-Key": KEY_A, "X-Access-Key": newKey } })).status, 200);

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

test("a second console from one download waits as that account's, by its own name, and is approved under it", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-enroll-second-"));
  const server = await boot(data);
  try {
    const token = await tokenIn(await bundle(ALICE), data);
    const KEY_C = "C3".repeat(32);
    assert.equal((await enrollWith(token, KEY_A, "Living room")).status, 200);
    let mine = await (await fetch(`${BASE}/pair/api/mine`, { headers: ALICE })).json();
    assert.equal(mine.devices.find((d) => d.deviceKey === KEY_A)?.label, "Living room", "named by the console");

    const second = await enrollWith(token, KEY_B, "Bedroom");
    assert.equal(second.status, 401);
    assert.equal(second.headers.get("x-cookingfoil-enroll"), "used");
    const unknown = await enrollWith("cfe_" + "x".repeat(43), KEY_C);
    assert.equal(unknown.headers.get("x-cookingfoil-enroll"), "invalid", "a token this server never made");
    // The console then asks as any other does, without the token it dropped.
    const ask = await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey: KEY_B, message: "hello" }) });
    assert.equal((await ask.json()).status, "pending");

    const ADMIN = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")), "Content-Type": "application/json" };
    const queue = (await (await fetch(`${BASE}/admin/api/devices`, { headers: ADMIN })).json()).pending;
    const waiting = queue.find((p) => p.deviceKey === KEY_B);
    assert.equal(waiting.name, "Bedroom");
    assert.equal(waiting.message, "hello");
    assert.deepEqual({ owner: waiting.download.owner, state: waiting.download.state }, { owner: "alice", state: "used" });
    assert.ok(!queue.some((p) => p.deviceKey === KEY_C), "an unknown token names no one, and queues nothing");
    assert.ok(!JSON.stringify(queue).includes("cfe_"));

    assert.equal((await fetch(`${BASE}/admin/api/devices/approve`, { method: "POST", headers: ADMIN, body: JSON.stringify({ deviceKey: KEY_B }) })).status, 200);
    mine = await (await fetch(`${BASE}/pair/api/mine`, { headers: ALICE })).json();
    const approved = mine.devices.find((d) => d.deviceKey === KEY_B);
    assert.ok(approved, "approved under alice, whose download it came with");
    assert.equal(approved.label, "Bedroom");
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
