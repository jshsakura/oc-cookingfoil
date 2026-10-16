import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOrigin } from "../../src/helpers/origin.js";
import { isPrivateCaller } from "../../src/security/net.js";
import adminOnly, { consoleLane } from "../../src/security/admin-only.js";

const raw = (headers, remoteAddress = "203.0.113.5") => ({ headers, socket: { remoteAddress }, protocol: "http" });

test("a Host that is not a host name never reaches a URL or the shop's JSON", () => {
  assert.equal(resolveOrigin(raw({ host: "shop.example.org:8443" }), ""), "http://shop.example.org:8443");
  assert.equal(resolveOrigin(raw({ host: "10.0.0.5" }), ""), "http://10.0.0.5");
  assert.equal(resolveOrigin(raw({ host: "[::1]:80" }), ""), "http://[::1]:80");
  for (const bad of ['evil.example"},{"url":"x', "a b", "host\r\nX: y", "x/../y", "a@b"]) {
    assert.equal(resolveOrigin(raw({ host: bad }), ""), "", bad);
  }
  // A trusted proxy's forwarded proto is only http or https.
  assert.equal(resolveOrigin(raw({ host: "a.example", "x-forwarded-proto": "javascript" }), "", { trusted: true }), "http://a.example");
  assert.equal(resolveOrigin(raw({ host: "a.example", "x-forwarded-proto": "HTTPS" }), "", { trusted: true }), "https://a.example");
});

test("a private caller is private at every hop it names, not just the one req.ip picked", () => {
  const req = (socket, ip, xff) => ({ socket: { remoteAddress: socket }, ip, headers: xff ? { "x-forwarded-for": xff } : {} });
  assert.equal(isPrivateCaller(req("127.0.0.1", "192.168.1.20")), true);
  assert.equal(isPrivateCaller(req("127.0.0.1", "192.168.1.20", "192.168.1.20")), true);
  // Behind a tunnel that appends: the client wrote 10.0.0.1, the tunnel added its real address.
  assert.equal(isPrivateCaller(req("127.0.0.1", "10.0.0.1", "10.0.0.1, 203.0.113.9")), false);
  assert.equal(isPrivateCaller(req("203.0.113.5", "10.0.0.1", "10.0.0.1")), false, "a public connection never counts");
});

test("only admin accounts change artwork or see uploads; consoles never do", () => {
  const run = (mw, req) => {
    let status = 200;
    let passed = false;
    mw(req, { status: (s) => ((status = s), { json: () => {} }) }, () => (passed = true));
    return passed ? "next" : status;
  };
  const writes = adminOnly();
  const all = adminOnly({ reads: true });
  // No accounts on the server: nobody to check (the shop is open by choice).
  assert.equal(run(writes, { method: "POST" }), "next");
  assert.equal(run(writes, { method: "GET", pairedDevice: "AB" }), "next", "reads stay open for art");
  for (const lane of [{ pairedDevice: "AB" }, { deviceLogin: "cf-abcdef" }, { sessionLane: true }]) {
    assert.equal(consoleLane(lane), true);
    assert.equal(run(writes, { method: "POST", ...lane }), 403);
    assert.equal(run(all, { method: "GET", ...lane }), 403);
  }
});

test("a user-role account reads the shop but cannot change artwork or see uploads", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { hashPassword } = await import("../../src/security/password-hash.js");
  const data = mkdtempSync(path.join(tmpdir(), "cook-adminonly-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  mkdirSync(path.join(data, "security"), { recursive: true });
  const now = Date.now();
  const user = (role, password) => ({ hash: hashPassword(password), enabled: true, role, createdAt: now, updatedAt: now });
  writeFileSync(path.join(data, "security", "users.json"), JSON.stringify({ version: 1, users: { alice: user("admin", "alice-password"), bob: user("user", "bob-password-1") } }));
  const port = 19400 + (process.pid % 400);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_CONSOLE_PASSWORDS: "true", COOK_PORT: String(port), COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_UPLOADS_ENABLED: "true", COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false" },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${base}/healthz`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const as = (name, password) => ({ Authorization: "Basic " + Buffer.from(`${name}:${password}`).toString("base64") });
    const bob = as("bob", "bob-password-1");
    const alice = as("alice", "alice-password");
    assert.equal((await fetch(`${base}/api/shop/sections`, { headers: bob })).status, 200, "bob reads the shop");
    assert.equal((await fetch(`${base}/api/uploads`, { headers: bob })).status, 403);
    const write = (headers) => fetch(`${base}/api/art/0100000000010000/description`, { method: "POST", headers: { ...headers, "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ description: "x" }) });
    assert.equal((await write(bob)).status, 403, "bob cannot rewrite a description");
    assert.equal((await fetch(`${base}/api/uploads`, { headers: alice })).status, 200, "alice sees the upload list");
    assert.notEqual((await write(alice)).status, 403, "alice gets past the gate");
    // Another site's page (a sibling subdomain carries the Lax cookie) is refused before the gate; a client with no Origin is not.
    const fromSite = (url, origin) => fetch(`${base}${url}`, { method: "POST", headers: { ...alice, "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ description: "x" }) });
    for (const url of ["/api/art/0100000000010000/description", "/api/uploads/x/apply", "/api/uploads"]) {
      const r = await fromSite(url, "https://evil.example.org");
      assert.equal(r.status, 403, url);
      assert.equal((await r.json()).error, "origin mismatch", url);
    }
    assert.notEqual((await fromSite("/api/art/0100000000010000/description", null)).status, 403, "no Origin: judged by its sign-in alone");
  } finally {
    child.kill("SIGKILL");
  }
});
