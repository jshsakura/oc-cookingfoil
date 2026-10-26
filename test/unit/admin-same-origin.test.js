import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Every state-changing admin API refuses another site's Origin before any
// handler, so a page elsewhere cannot ride the admin's session cookie.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-admin-origin-"));
process.env.COOK_ADMIN_TOKEN = "test-admin-token-0123456789";
const express = (await import("express")).default;
const adminPageRouter = (await import("../../src/routes/admin-page.js")).default;
const adminRouter = (await import("../../src/routes/admin.js")).default;
const { sameOrigin, sameHost } = await import("../../src/security/same-origin.js");

const app = express();
app.use("/admin", adminPageRouter());
app.use("/api/admin", adminRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;
const SELF = BASE;
after(() => server.close());

const call = async (method, url, origin) => {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  const r = await fetch(`${BASE}${url}`, { method, headers, body: method === "GET" ? undefined : "{}" });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const WRITES = [
  ["POST", "/admin/api/users"],
  ["POST", "/admin/api/accounts/someone/role"],
  ["POST", "/admin/api/homebrew/sources"],
  ["POST", "/admin/api/integrations/github"],
  ["POST", "/admin/api/server-settings"],
  ["DELETE", "/admin/api/tokens/x"],
  ["PUT", "/admin/api/anything"],
  ["PATCH", "/admin/api/anything"],
  ["POST", "/admin/verify"],
  ["POST", "/api/admin/unlock"],
];

test("a write from another site's page is refused before the handler", async () => {
  for (const [method, url] of WRITES) {
    const r = await call(method, url, "https://evil.example.net");
    assert.equal(r.status, 403, `${method} ${url}`);
    assert.deepEqual(r.body, { error: "origin mismatch" }, `${method} ${url}`);
  }
});

test("a write from this site's page, or with no Origin, reaches the usual checks", async () => {
  for (const [method, url] of WRITES) {
    for (const origin of [SELF, null]) {
      const r = await call(method, url, origin);
      assert.notDeepEqual(r.body, { error: "origin mismatch" }, `${method} ${url} from ${origin}`);
    }
  }
});

test("reads are not origin-checked", async () => {
  const r = await call("GET", "/admin/api/stats", "https://evil.example.net");
  assert.notDeepEqual(r.body, { error: "origin mismatch" });
});

const fakeReq = (headers, socket = { remoteAddress: "203.0.113.5" }) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: lower, socket, protocol: "http", get: (n) => lower[n.toLowerCase()] };
};

test("sameOrigin: no Origin passes; a forged X-Forwarded-Host does not make another site same-origin", () => {
  assert.equal(sameOrigin(fakeReq({ host: "library.example.org" })), true);
  assert.equal(sameOrigin(fakeReq({ host: "library.example.org", origin: "http://library.example.org" })), true);
  assert.equal(sameOrigin(fakeReq({ host: "library.example.org", origin: "http://evil.example.net", "x-forwarded-host": "evil.example.net" })), false);
});

test("sameHost: compares the Origin's host with the host the request reached", () => {
  assert.equal(sameHost(fakeReq({ host: "library.example.org" })), null);
  assert.equal(sameHost(fakeReq({ host: "library.example.org", origin: "https://library.example.org" })), true);
  assert.equal(sameHost(fakeReq({ host: "library.example.org", origin: "https://evil.example.net" })), false);
  assert.equal(sameHost(fakeReq({ host: "library.example.org", origin: "null" })), false);
});
