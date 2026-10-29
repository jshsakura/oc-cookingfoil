import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolate persisted state per run — store.js resolves its path from dataDir at
// import time, so this must be set before the module graph loads.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cf-denials-"));

const store = await import("../../src/security/store.js");
const { recordDeny, denyResponse, DENY } = await import("../../src/security/deny.js");
const { hintFor } = await import("../../src/security/deny-reasons.js");

function fakeReq({ ip = "203.0.113.9", method = "GET", url = "/api/library/sections", headers = {} } = {}) {
  return {
    ip,
    method,
    originalUrl: url,
    path: url,
    get: (name) => headers[name.toLowerCase()] ?? headers[name],
  };
}

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    type: () => res,
    set(k, v) { res.headers[k] = v; return res; },
    status(code) { res.statusCode = code; return res; },
    send(body) { res.body = body; return res; },
  };
  return res;
}

test("recordDeny captures who/what/where so the dashboard can explain a refusal", () => {
  store.clearDenials();
  const entry = recordDeny(
    fakeReq({ headers: { "user-agent": "OtherClient/17.0" } }),
    { reason: DENY.NO_DEVICE_KEY, status: 403 }
  );

  assert.equal(entry.reason, DENY.NO_DEVICE_KEY);
  assert.equal(entry.status, 403);
  assert.equal(entry.ip, "203.0.113.9");
  assert.equal(entry.path, "/api/library/sections");
  assert.equal(entry.ua, "OtherClient/17.0");
  assert.ok(entry.at > 0);

  const snap = store.denialsSnapshot();
  assert.equal(snap.recent.length, 1);
  assert.equal(snap.recent[0].reason, DENY.NO_DEVICE_KEY);
  assert.equal(snap.counts[DENY.NO_DEVICE_KEY], 1);
});

test("recordDeny strips the IPv4-mapped IPv6 prefix so IPs match what an admin types", () => {
  store.clearDenials();
  const entry = recordDeny(fakeReq({ ip: "::ffff:192.168.1.50" }), { reason: DENY.PROBE });
  assert.equal(entry.ip, "192.168.1.50");
});

test("denialsSnapshot returns newest-first and honours sinceMs", () => {
  store.clearDenials();
  recordDeny(fakeReq({ url: "/first" }), { reason: DENY.BAD_CREDENTIALS });
  recordDeny(fakeReq({ url: "/second" }), { reason: DENY.BAD_CREDENTIALS });

  const snap = store.denialsSnapshot();
  assert.equal(snap.recent[0].path, "/second", "newest first");
  assert.equal(snap.recent[1].path, "/first");

  // A window that predates every entry filters them all out.
  assert.equal(store.denialsSnapshot({ sinceMs: -1 }).recent.length, 0);
});

test("the denial ring is bounded so a scanner cannot grow state.json without limit", () => {
  store.clearDenials();
  for (let i = 0; i < 400; i++) {
    recordDeny(fakeReq({ url: `/probe-${i}` }), { reason: DENY.PROBE });
  }
  const snap = store.denialsSnapshot({ limit: 1000 });
  assert.ok(snap.total <= 300, `expected the ring capped at 300, got ${snap.total}`);
  // The cap must drop the OLDEST rows, not the newest.
  assert.equal(snap.recent[0].path, "/probe-399");
});

test("denyResponse tags the response so `curl -v` shows the reason", () => {
  store.clearDenials();
  const res = fakeRes();
  denyResponse(fakeReq(), res, { reason: DENY.DEVICE_NOT_APPROVED, status: 403 });

  assert.equal(res.statusCode, 403);
  assert.equal(res.headers["X-CookingFoil-Deny"], DENY.DEVICE_NOT_APPROVED);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(store.denialsSnapshot().recent.length, 1);
});

test("denyResponse falls back to a body that states the reason and the fix", () => {
  const res = fakeRes();
  denyResponse(fakeReq(), res, { reason: DENY.IP_LOCKED, status: 429 });
  assert.match(res.body, /ip-locked/);
  assert.match(res.body, /Unlock it from this dashboard/);
});

test("every deny reason carries an operator-facing hint", () => {
  for (const reason of Object.values(DENY)) {
    assert.notEqual(hintFor(reason), "", `${reason} has no hint`);
  }
});

test("recordDeny never throws on a malformed request object", () => {
  // Guards call this on their error path; a bookkeeping bug must not become a 500.
  assert.doesNotThrow(() => recordDeny({}, { reason: DENY.PROBE }));
  assert.doesNotThrow(() => recordDeny(null, { reason: DENY.PROBE }));
});

test("a refusal is recorded without the query, so what a console sent about itself is not kept", () => {
  const entry = recordDeny(
    { method: "GET", originalUrl: "/api/download/a.nsz?tweak=21.0.1", get: () => "" },
    { reason: DENY.ADMIN_NO_SESSION, status: 401 },
  );
  assert.equal(entry.path, "/api/download/a.nsz");
});

test("a refusal and an approval keep the console client's version, cleaned, and none when it sent none", () => {
  store.clearDenials();
  const sent = recordDeny(fakeReq({ headers: { Version: "0.5.29<script>" } }), { reason: DENY.DEVICE_BAD_ACCESS_KEY, status: 403 });
  assert.equal(sent.version, "0.5.29script");
  assert.equal(recordDeny(fakeReq(), { reason: DENY.PROBE }).version, null);

  const since = Date.now() - 1;
  store.recordPendingDevice("VERSIONKEY", { quiet: true, from: { ip: "203.0.113.9", version: "0.5.37" } });
  store.approveDevice("VERSIONKEY", { label: "deck", addedBy: "admin", accessKeyHash: "a".repeat(64) });
  const approved = store.auditSince(since).find((e) => e.kind === "device-approve" && e.deviceKey === "VERSIONKEY");
  assert.equal(approved.version, "0.5.37", "approved from the admin page, it keeps the version the console asked with");
  assert.ok(store.requesterLines({ version: "0.5.37" }).some((l) => l.includes("v0.5.37")), "the approval alert names the version");
});
