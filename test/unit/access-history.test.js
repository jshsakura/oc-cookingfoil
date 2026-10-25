import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONSOLE, CONSOLE_KEY, seedConsole } from "../support/console.js";
import { seedRecords } from "../support/security-db.js";
import { adminSession, webSession } from "../support/web-session.js";

// The admin sees when each console and account was last used, kept across
// restarts, so unused ones can be told apart and revoked by hand.
const PORT = 26300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DAY = 24 * 60 * 60 * 1000;
const OLD_KEY = "EF".repeat(32);
const BOBS_KEY = "CD".repeat(32);
const FROM = { "X-Forwarded-For": "192.0.2.10" };

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function boot(data) {
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  return spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "owner:owner-password-1,alice:alice-password-1,bob:bob-password-1",
      COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "true", COOK_TRUST_PROXY: "loopback",
      COOK_ADMIN_PASSWORD: "admin-password-123", COOK_ADMIN_TOTP_SECRET: "",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
    },
    stdio: "ignore",
  });
}

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready");
}

async function stop(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await once(server, "exit");
}

async function asAdmin() {
  const admin = { ...(await adminSession(BASE, "owner", "owner-password-1", "admin-password-123")), "Content-Type": "application/json" };
  return async (method, url, body) => {
    const r = await fetch(`${BASE}${url}`, { method, headers: admin, body: body && JSON.stringify(body) });
    assert.equal(r.status, 200, `${method} ${url}`);
    return r.json();
  };
}

const row = (devices, key) => devices.approved.find((d) => d.deviceKey === key);
const user = (stats, name) => stats.users.find((u) => u.user === name);

test("console activity and account sign-ins are kept across a restart and dropped with the console", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-access-"));
  const now = Date.now();
  await seedConsole(data, { addedBy: "alice" });
  await seedRecords(data, "device", { [OLD_KEY]: { label: "old console", addedAt: 1, addedBy: "alice", accessKeyHash: null } });
  await seedRecords(data, "device-activity", {
    [CONSOLE_KEY]: { lastSeenAt: now - 10 * DAY, lastIp: "198.51.100.7", days: { [dayKey(now - 100 * DAY)]: 5, [dayKey(now - 10 * DAY)]: 2 } },
  });

  let server = boot(data);
  try {
    await waitReady();
    let call = await asAdmin();

    let devices = await call("GET", "/admin/api/devices");
    let mine = row(devices, CONSOLE_KEY);
    assert.deepEqual(mine.days, { [dayKey(now - 10 * DAY)]: 2 }, "days past 90 are trimmed");
    assert.equal(mine.lastIp, "198.51.100.7");
    assert.equal(mine.activeDays30, 1);
    assert.equal(mine.idleSince, now - 10 * DAY, "idle since its last access");
    const old = row(devices, OLD_KEY);
    assert.equal(old.lastSeenAt, null);
    assert.equal(old.idleSince, null, "approved before history began and not seen since: no record, not unused");
    assert.ok(devices.activitySince > 0);

    for (let i = 0; i < 3; i++) {
      assert.equal((await fetch(`${BASE}/api/library/sections`, { headers: { ...CONSOLE, ...FROM } })).status, 200);
    }
    devices = await call("GET", "/admin/api/devices");
    mine = row(devices, CONSOLE_KEY);
    assert.equal(mine.days[dayKey(Date.now())], 3, "each request counts toward today");
    assert.equal(mine.lastIp, "192.0.2.10");
    assert.equal(mine.activeDays30, 2);
    assert.ok(mine.lastSeenAt >= now && mine.idleSince === mine.lastSeenAt);

    await webSession(BASE, "alice", "alice-password-1");
    const knock = await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": BOBS_KEY, Authorization: "Basic " + Buffer.from("bob:bob-password-1").toString("base64") } });
    assert.equal((await knock.json()).status, "approved");
    let stats = await call("GET", "/admin/api/stats");
    assert.equal(user(stats, "alice").lastLoginMethod, "password");
    assert.ok(user(stats, "alice").lastLoginAt >= now);
    assert.ok(user(stats, "alice").lastActiveAt >= mine.lastSeenAt, "an account is active when a console it approved is");
    assert.equal(user(stats, "bob").lastLoginMethod, "console");
    assert.equal(user(stats, "owner").lastLoginMethod, "password");

    await stop(server);
    server = boot(data);
    await waitReady();
    call = await asAdmin();

    devices = await call("GET", "/admin/api/devices");
    const kept = row(devices, CONSOLE_KEY);
    assert.equal(kept.days[dayKey(Date.now())], 3, "counts survive a restart");
    assert.equal(kept.lastIp, "192.0.2.10");
    assert.equal(kept.lastSeenAt, mine.lastSeenAt);
    stats = await call("GET", "/admin/api/stats");
    assert.equal(user(stats, "alice").lastLoginMethod, "password");
    assert.equal(user(stats, "bob").lastLoginMethod, "console");

    await call("POST", "/admin/api/devices/revoke", { deviceKey: CONSOLE_KEY });
    const { pairCode } = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": CONSOLE_KEY } })).json();
    await call("POST", "/admin/api/devices/approve", { code: pairCode });
    const again = row(await call("GET", "/admin/api/devices"), CONSOLE_KEY);
    assert.equal(again.lastSeenAt, null, "a revoked console's history is gone");
    assert.deepEqual(again.days, {});
    assert.equal(again.lastIp, null);
    assert.equal(again.idleSince, again.addedAt, "approved after history began: idle counts from approval");
  } finally {
    await stop(server);
  }
});

const ipHistory = async (call, query) => call("GET", `/admin/api/access-history?${query}`);

test("the admin sees each console's IPs by day and each account's sign-ins, and nobody else does", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-access-ips-"));
  const now = Date.now();
  const yesterday = dayKey(now - DAY);
  await seedConsole(data, { addedBy: "alice" });
  await seedRecords(data, "device-activity", { [CONSOLE_KEY]: { lastSeenAt: now - DAY, lastIp: "198.51.100.7", days: { [yesterday]: 4 } } });
  const old = Array.from({ length: 105 }, (_, i) => ({ at: now - (106 - i) * 60_000, method: "password", ip: "198.51.100.20" }));
  await seedRecords(data, "account-login", { alice: { at: old.at(-1).at, method: "password", ip: "198.51.100.20", history: [{ at: now - 100 * DAY, method: "password", ip: null }, ...old] } });

  let server = boot(data);
  try {
    await waitReady();
    let call = await asAdmin();

    const shop = (ip) => fetch(`${BASE}/api/library/sections`, { headers: { ...CONSOLE, "X-Forwarded-For": ip } });
    for (const ip of ["192.0.2.10", "192.0.2.10", "198.51.100.7", ...Array.from({ length: 8 }, (_, i) => `203.0.113.${i + 1}`)]) {
      assert.equal((await shop(ip)).status, 200);
    }
    let { days } = await ipHistory(call, `device=${CONSOLE_KEY}`);
    assert.deepEqual(days.map((d) => d.day), [dayKey(Date.now()), yesterday], "newest day first");
    const [today] = days;
    assert.equal(today.n, 11);
    assert.deepEqual(today.ips.slice(0, 2), [{ ip: "192.0.2.10", n: 2 }, { ip: "198.51.100.7", n: 1 }], "both addresses of the day, each with its count");
    assert.equal(today.ips.length, 8, "at most 8 addresses a day");
    assert.equal(today.other, 2, "the rest count as other");
    assert.deepEqual(days[1], { day: yesterday, n: 4, ips: [], other: 0 }, "a day counted before addresses were kept by day still reads");

    await webSession(BASE, "alice", "alice-password-1", { "X-Forwarded-For": "192.0.2.33" });
    await webSession(BASE, "bob", "bob-password-1", FROM);
    let { logins } = await ipHistory(call, "account=alice");
    assert.equal(logins.length, 100, "the last 100 sign-ins are kept");
    assert.equal(logins[0].ip, "192.0.2.33");
    assert.equal(logins[0].method, "password");
    assert.ok(logins.every((l) => l.at > now - 90 * DAY), "nothing older than 90 days");
    const stats = await call("GET", "/admin/api/stats");
    assert.equal(user(stats, "alice").lastLoginIp, "192.0.2.33");
    assert.equal(user(stats, "alice").lastLoginMethod, "password");

    const userRole = await webSession(BASE, "alice", "alice-password-1", FROM);
    for (const q of [`device=${CONSOLE_KEY}`, "account=alice"]) {
      assert.equal((await fetch(`${BASE}/admin/api/access-history?${q}`, { headers: userRole })).status, 403, "a regular account cannot read it");
    }
    const { token } = await call("POST", "/admin/api/tokens", { label: "ips" });
    const bearer = { Authorization: `Bearer ${token}` };
    for (const q of [`device=${CONSOLE_KEY}`, "account=alice"]) {
      assert.equal((await fetch(`${BASE}/admin/api/access-history?${q}`, { headers: bearer })).status, 403, "an automation token cannot read it");
    }
    const tokenDevices = await (await fetch(`${BASE}/admin/api/devices`, { headers: bearer })).json();
    assert.ok(tokenDevices.approved.length > 0 && tokenDevices.approved.every((d) => !("lastIp" in d)), "a token's device list has no addresses");
    const tokenStats = await (await fetch(`${BASE}/admin/api/stats`, { headers: bearer })).json();
    assert.ok(tokenStats.users.every((u) => !("lastIp" in u) && !("ips" in u) && !("lastLoginIp" in u)), "a token's user list has no addresses");
    const adminDenials = (await call("GET", "/admin/api/stats")).denials.recent;
    assert.ok(adminDenials.length > 0 && adminDenials.every((d) => "ip" in d), "the admin page sees where refused requests came from");
    assert.ok(tokenStats.denials.recent.length > 0, "the token sees the refusals");
    assert.ok([...tokenStats.denials.recent, ...tokenStats.lockouts].every((d) => !("ip" in d)), "a token's denials and lockouts have no addresses");

    await stop(server);
    server = boot(data);
    await waitReady();
    call = await asAdmin();

    ({ days } = await ipHistory(call, `device=${CONSOLE_KEY}`));
    assert.deepEqual(days[0], today, "a console's addresses survive a restart");
    ({ logins } = await ipHistory(call, "account=alice"));
    assert.equal(logins.length, 100);
    assert.equal(logins.find((l) => l.ip === "192.0.2.33")?.method, "password", "sign-ins survive a restart");
    assert.equal((await ipHistory(call, "account=bob")).logins[0].ip, "192.0.2.10");

    await call("DELETE", "/admin/api/users/bob");
    assert.deepEqual((await ipHistory(call, "account=bob")).logins, [], "a deleted account's sign-ins are gone");
  } finally {
    await stop(server);
  }
});
