import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminSession, webSession } from "../support/web-session.js";

// One account holds at most deviceLimit approved consoles (security/device-limit.js), however
// they were approved: a download's key, a sign-in at pairing, the admin approving a queued
// console that came with the account's download, or the account approving by QR. 0 is no limit,
// and the admin page changes it while the server runs. Also: a pair request the pending limit
// refuses keeps no pairSecret.
const PORT = 20500 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const ACCOUNTS = { alice: "alice-password", bob: "bob-password-1" };
const basic = (user) => "Basic " + Buffer.from(`${user}:${ACCOUNTS[user]}`).toString("base64");
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

async function boot(extra) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-device-limit-"));
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

async function downloadToken(data, account = "alice") {
  const web = await webSession(BASE, account, ACCOUNTS[account]);
  const r = await fetch(`${BASE}/pair/api/client-bundle`, { method: "POST", headers: { ...web, Origin: BASE } });
  assert.equal(r.status, 200);
  const file = path.join(data, `bundle-${Date.now()}-${Math.random()}.zip`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return JSON.parse(execFileSync("unzip", ["-p", file, "switch/cookingfoil/config.json"]).toString()).servers[0].enrollToken;
}

const enroll = (deviceKey, token) => fetch(`${BASE}/api/pair/enroll`, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": deviceKey }, body: JSON.stringify({ token }),
});
const status = async (deviceKey, account) => {
  const headers = { "X-Device-Key": deviceKey };
  if (account) headers.Authorization = basic(account);
  const r = await fetch(`${BASE}/api/pair/status`, { headers });
  assert.equal(r.status, 200);
  return r.json();
};

test("an account at its device limit: the download, the sign-in, the admin and the QR approval are all refused, and the limit changes live", async () => {
  const server = await boot({ COOK_DEVICE_AUTO_APPROVE: "true", COOK_DEVICE_LIMIT: "2" });
  try {
    const token = await downloadToken(server.data);
    assert.equal((await enroll(key("1"), token)).status, 200);
    assert.equal((await enroll(key("2"), token)).status, 200);

    // A download: 403 device-limit.
    const third = await enroll(key("3"), token);
    assert.equal(third.status, 403);
    assert.equal(third.headers.get("x-cookingfoil-auth"), "device-limit");
    assert.equal(third.headers.get("x-cookingfoil-enroll"), "limit");
    assert.ok(third.headers.get("x-cookingfoil-server-id"), "proven: the download is this server's");

    // The same consoles again do not count twice.
    assert.equal((await enroll(key("1"), token)).status, 200, "respend");
    assert.equal((await enroll(key("2"), await downloadToken(server.data))).status, 200, "a console already alice's, with a fresh download");

    // A sign-in at pairing: stays pending, told why.
    const signedIn = await status(key("4"), "alice");
    assert.equal(signedIn.status, "pending");
    assert.equal(signedIn.limit, "device");
    assert.equal(signedIn.deviceLimit, 2, "the console can say how many the account may hold");
    assert.ok(signedIn.pairCode);
    const bobs = await status(key("5"), "bob");
    assert.equal(bobs.status, "approved", "another account is not held by alice's limit");

    // The admin approving the console that came with alice's download.
    const ADMIN = { ...(await adminSession(BASE, "alice", ACCOUNTS.alice, "admin-password-123")), "Content-Type": "application/json" };
    const approve = (lang) => fetch(`${BASE}/admin/api/devices/approve`, { method: "POST", headers: { ...ADMIN, "Accept-Language": lang }, body: JSON.stringify({ deviceKey: key("3") }) });
    let r = await approve("ko");
    assert.equal(r.status, 409);
    let body = await r.json();
    assert.equal(body.code, "device-limit");
    assert.equal(body.limit, 2);
    assert.equal(body.error, "이 계정은 기기를 최대 2대까지 등록할 수 있습니다. 쓰지 않는 기기를 해제한 뒤 다시 승인해 주세요.");
    body = await (await approve("en")).json();
    assert.match(body.error, /^This account can register up to 2 consoles\./);

    // alice approving by QR code from her phone.
    const ALICE = await webSession(BASE, "alice", ACCOUNTS.alice);
    r = await fetch(`${BASE}/pair/approve`, { method: "POST", headers: { ...ALICE, "Content-Type": "application/json", Origin: BASE, "Accept-Language": "ja" }, body: JSON.stringify({ code: signedIn.pairCode }) });
    assert.equal(r.status, 409);
    body = await r.json();
    assert.equal(body.code, "device-limit");
    assert.match(body.error, /最大 2 台/);

    // The admin page raises the limit with no restart; then the queued console is approved.
    const save = (deviceLimit) => fetch(`${BASE}/admin/api/server-settings`, { method: "POST", headers: ADMIN, body: JSON.stringify({ deviceLimit }) });
    assert.equal((await save(3)).status, 200);
    assert.equal((await approve("ko")).status, 200, "room for a third");
    const full = await status(key("4"), "alice");
    assert.equal(full.limit, "device", "full again at three");
    assert.equal(full.deviceLimit, 3, "the new limit, with no restart");

    // Removing a console makes room.
    assert.equal((await fetch(`${BASE}/pair/api/devices/revoke`, { method: "POST", headers: { ...ALICE, "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ deviceKey: key("1") }) })).status, 200);
    assert.equal((await status(key("4"), "alice")).status, "approved");

    // 0 is no limit.
    assert.equal((await save(0)).status, 200);
    assert.equal((await status(key("6"), "alice")).status, "approved");
  } finally {
    stop(server);
  }
});

test("unless set an account holds ten consoles and its downloads connect five an hour; the hourly count changes live and every page shows it", async () => {
  const server = await boot({ COOK_DEVICE_AUTO_APPROVE: "true" });
  try {
    const ADMIN = { ...(await adminSession(BASE, "alice", ACCOUNTS.alice, "admin-password-123")), "Content-Type": "application/json" };
    const settings = async () => (await (await fetch(`${BASE}/admin/api/server-settings`, { headers: ADMIN })).json()).settings;
    let s = await settings();
    assert.equal(s.deviceLimit.value, 10);
    assert.equal(s.enrollPerHour.value, 5);

    const save = await fetch(`${BASE}/admin/api/server-settings`, { method: "POST", headers: ADMIN, body: JSON.stringify({ enrollPerHour: 2 }) });
    assert.equal(save.status, 200);
    assert.equal((await settings()).enrollPerHour.value, 2);
    for (const bad of [0, 51, "x"]) {
      const r = await fetch(`${BASE}/admin/api/server-settings`, { method: "POST", headers: ADMIN, body: JSON.stringify({ enrollPerHour: bad }) });
      assert.equal(r.status, 400, `refuses ${bad}`);
    }

    const token = await downloadToken(server.data);
    assert.equal((await enroll(key("1"), token)).status, 200);
    assert.equal((await enroll(key("2"), token)).status, 200);
    const third = await enroll(key("3"), token);
    assert.equal(third.status, 401, "the third different console this hour");
    assert.equal(third.headers.get("x-cookingfoil-auth"), "enroll-limit");
    assert.equal((await enroll(key("1"), token)).status, 200, "a console already counted enrolls again");

    const WEB = await webSession(BASE, "alice", ACCOUNTS.alice);
    const info = await (await fetch(`${BASE}/api/library/info`, { headers: WEB })).json();
    assert.deepEqual(info.enroll, { perHour: 2 }, "the web page reads the number here");
    const pairPage = await (await fetch(`${BASE}/pair`, { headers: { ...WEB, "Accept-Language": "en" } })).text();
    assert.match(pairPage, /Up to 2 consoles connect on their own/);
    const adminPage = await (await fetch(`${BASE}/admin/devices`, { headers: ADMIN })).text();
    assert.match(adminPage, /data-top="dev.clientsLead" data-top-n="2">[^<]*기기 2대까지/);
  } finally {
    stop(server);
  }
});

test("a pair request refused by the pending limit keeps no pairSecret", async () => {
  const server = await boot({ COOK_DEVICE_AUTO_APPROVE: "false" });
  try {
    const keys = [..."123456789"].map((c) => key(c)).slice(0, 8);
    const codes = [];
    for (const [i, k] of keys.entries()) {
      const r = await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey: k, pairSecret: secret("ABCDEFAB"[i]) }) });
      codes.push(r.status);
    }
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429, 429]);
    // Had the refused ones kept their secret, another secret would be a 409 conflict; it is the same 429.
    const again = await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey: keys[6], pairSecret: secret("9") }) });
    assert.equal(again.status, 429);
    const poll = await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": keys[7], "X-Pair-Secret": secret("9") } });
    assert.equal(poll.status, 429);
    // An accepted one keeps it.
    const accepted = await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": keys[0], "X-Pair-Secret": secret("9") } });
    assert.equal(accepted.status, 409);
  } finally {
    stop(server);
  }
});
