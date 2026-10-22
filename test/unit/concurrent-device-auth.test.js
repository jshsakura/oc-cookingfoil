import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminSession, webSession } from "../support/web-session.js";

// Several consoles signing in at the same moment: each must end up with its own
// access key and session token, and none may turn another away. Drives a real
// server the way the client does (refresh: enroll, pair status, shop info,
// session, then the lists), all consoles at once.
const PORT = 20100 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (user, pass) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
const ACCOUNTS = { alice: "alice-password", bob: "bob-password-1" };
const KEYS = ["A1", "B2", "C3", "D4"].map((b) => b.repeat(32));
const SECRETS = ["a1", "b2", "c3", "d4"].map((b) => b.repeat(32));

/** A minimal NRO the server offers as its client build (client-bundle.test.js). */
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

async function boot(extra) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-concurrent-auth-"));
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  fs.mkdirSync(path.join(data, "client"), { recursive: true });
  fs.writeFileSync(path.join(data, "client", "cookingfoil.nro"), fakeNro("0.3.63"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: Object.entries(ACCOUNTS).map(([n, p]) => `${n}:${p}`).join(","), COOK_DEVICE_PAIRING: "true",
      COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false", ...extra },
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

function stop({ child, data }) {
  child.kill("SIGKILL");
  fs.rmSync(data, { recursive: true, force: true });
}

const get = (url, headers = {}) => fetch(BASE + url, { headers });

/** A console's status poll, as Session::pair sends it. */
async function pairStatus(i, account) {
  const headers = { "X-Device-Key": KEYS[i], "X-Pair-Secret": SECRETS[i] };
  if (account) headers.Authorization = basic(account, ACCOUNTS[account]);
  const r = await get("/api/pair/status", headers);
  assert.equal(r.status, 200, `console ${i}: pair status`);
  return r.json();
}

/** After the access key: session token, then the lists with it. Returns each status. */
async function useShop(i, accessKey) {
  const keys = { "X-Device-Key": KEYS[i], "X-Access-Key": accessKey };
  const info = await get("/api/shop/info", keys);
  const s = await get("/api/session", keys);
  assert.equal(s.status, 200, `console ${i}: /api/session`);
  const { token } = await s.json();
  const bearer = { "X-Device-Key": KEYS[i], Authorization: `Bearer ${token}` };
  const [sections, shop] = await Promise.all([get("/api/shop/sections", bearer), get("/api/homebrew", bearer)]);
  return { info: info.status, sections: sections.status, shop: shop.status, session: sections.headers.get("x-cookingfoil-session"), bearer };
}

const consoles = (n) => [...Array(n).keys()];

for (const [name, owners] of [
  ["one account", ["alice", "alice", "alice", "alice"]],
  ["two accounts", ["alice", "bob", "alice", "bob"]],
]) {
  test(`auto-approve: four consoles of ${name} sign in at once, and every one gets in and stays in`, async () => {
    const server = await boot({ COOK_DEVICE_AUTO_APPROVE: "true" });
    try {
      const paired = await Promise.all(consoles(4).map((i) => pairStatus(i, owners[i])));
      for (const [i, p] of paired.entries()) {
        assert.equal(p.status, "approved", `console ${i}`);
        assert.ok(p.accessKey, `console ${i} got its key`);
      }
      const used = await Promise.all(consoles(4).map((i) => useShop(i, paired[i].accessKey)));
      for (const [i, u] of used.entries()) assert.deepEqual([u.info, u.sections, u.shop], [200, 200, 200], `console ${i}`);
      // Signing in again (the next refresh, with the password still saved) ends nobody's session.
      await Promise.all(consoles(4).map((i) => pairStatus(i, owners[i])));
      const again = await Promise.all(used.map((u) => get("/api/shop/sections", u.bearer)));
      assert.deepEqual(again.map((r) => r.status), [200, 200, 200, 200]);
    } finally {
      stop(server);
    }
  });
}

test("manual approve: four consoles wait at once, the admin approves them all, and each takes its own key", async () => {
  const server = await boot({ COOK_DEVICE_AUTO_APPROVE: "false" });
  try {
    const waiting = await Promise.all(consoles(4).map((i) => pairStatus(i, null)));
    assert.deepEqual(waiting.map((w) => w.status), ["pending", "pending", "pending", "pending"]);
    const ADMIN = { ...(await adminSession(BASE, "alice", ACCOUNTS.alice, "admin-password-123")), "Content-Type": "application/json" };
    const approved = await Promise.all(KEYS.map((deviceKey) =>
      fetch(`${BASE}/admin/api/devices/approve`, { method: "POST", headers: ADMIN, body: JSON.stringify({ deviceKey }) })));
    assert.deepEqual(approved.map((r) => r.status), [200, 200, 200, 200]);
    const paired = await Promise.all(consoles(4).map((i) => pairStatus(i, null)));
    for (const [i, p] of paired.entries()) assert.ok(p.accessKey, `console ${i} got its key`);
    const used = await Promise.all(consoles(4).map((i) => useShop(i, paired[i].accessKey)));
    for (const [i, u] of used.entries()) assert.deepEqual([u.sections, u.shop], [200, 200], `console ${i}`);
  } finally {
    stop(server);
  }
});

/** The enrollment token inside a client download `account` (alice by default) makes on its web page. */
async function downloadToken(data, account = "alice") {
  const web = await webSession(BASE, account, ACCOUNTS[account]);
  const r = await fetch(`${BASE}/pair/api/client-bundle`, { method: "POST", headers: { ...web, Origin: BASE } });
  assert.equal(r.status, 200);
  const file = path.join(data, `bundle-${Date.now()}.zip`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return JSON.parse(execFileSync("unzip", ["-p", file, "switch/cookingfoil/config.json"]).toString()).servers[0].enrollToken;
}

const enrollAs = (i, token) => fetch(`${BASE}/api/pair/enroll`, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": KEYS[i] }, body: JSON.stringify({ token, label: `console ${i}` }),
});

test("auto-approve: a download connects the first console; the second is refused as used and pairs like an address-only console", async () => {
  const server = await boot({ COOK_DEVICE_AUTO_APPROVE: "true" });
  try {
    const token = await downloadToken(server.data);
    const first = await enrollAs(0, token);
    assert.equal(first.status, 200);
    const firstKey = (await first.json()).accessKey;
    assert.deepEqual([(await useShop(0, firstKey)).sections], [200], "the first console is in");

    const second = await enrollAs(1, token);
    assert.equal(second.status, 401);
    assert.equal(second.headers.get("x-cookingfoil-enroll"), "used");
    assert.equal(second.headers.get("x-cookingfoil-auth"), "enroll-used");

    // From here on it is a console that knows only the server address.
    assert.equal((await pairStatus(1, null)).status, "pending", "without sign-in it waits for approval");
    const signedIn = await pairStatus(1, "alice");
    assert.equal(signedIn.status, "approved", "signing in approves it, as for any console");
    assert.ok(signedIn.accessKey && signedIn.accessKey !== firstKey, "with its own key");
    const used = await useShop(1, signedIn.accessKey);
    assert.deepEqual([used.sections, used.shop], [200, 200]);
    assert.equal((await get("/api/shop/sections", (await useShop(0, firstKey)).bearer)).status, 200, "the first console stays in");
  } finally {
    stop(server);
  }
});

test("manual approve: a download still connects one console; the next waits for the admin, told why", async () => {
  const server = await boot({ COOK_DEVICE_AUTO_APPROVE: "false" });
  try {
    const token = await downloadToken(server.data);
    const replies = await Promise.all(consoles(3).map((i) => enrollAs(i, token)));
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 401, 401]);
    assert.deepEqual(replies.filter((r) => r.status === 401).map((r) => r.headers.get("x-cookingfoil-enroll")), ["used", "used"]);
  } finally {
    stop(server);
  }
});

test("a new download withdraws the account's earlier unused one, and leaves another account's alone", async () => {
  const server = await boot({ COOK_DEVICE_AUTO_APPROVE: "true" });
  try {
    const older = await downloadToken(server.data);
    const bobs = await downloadToken(server.data, "bob");
    const newer = await downloadToken(server.data);
    const withdrawn = await enrollAs(0, older);
    assert.equal(withdrawn.status, 401);
    assert.equal(withdrawn.headers.get("x-cookingfoil-enroll"), "revoked");
    assert.equal(withdrawn.headers.get("x-cookingfoil-auth"), "enroll-revoked");
    assert.equal((await pairStatus(0, null)).status, "pending", "it waits for approval like an address-only console");
    assert.equal((await enrollAs(1, newer)).status, 200);
    assert.equal((await enrollAs(2, bobs)).status, 200, "bob's download still works");
  } finally {
    stop(server);
  }
});
