import { test } from "node:test";
import assert from "node:assert/strict";
import { keysGate, MESSAGE } from "../../src/security/keys-gate.js";
import { configWarnings, authLanes } from "../../src/security/config-health.js";
import { usable } from "../../src/security/prod-keys.js";

function call(gate, path, accept = "application/json") {
  const res = { code: 200, headers: {}, body: null, kind: null };
  Object.assign(res, {
    status(c) { res.code = c; return res; },
    set(k, v) { res.headers[k] = v; return res; },
    type(t) { res.kind = t; return res; },
    json(b) { res.body = b; return res; },
    send(b) { res.body = b; return res; },
  });
  let passed = false;
  gate({ path, headers: { accept } }, res, () => { passed = true; });
  return { passed, res };
}

test("without keys the shop, the game files and the libraries answer 503 with what to do", () => {
  const gate = keysGate({ isReady: () => false });
  for (const p of ["/shop.json", "/api/shop/sections", "/api/retro/games", "/api/homebrew/list", "/games/Some Game [0100000000010000][v0].nsp", "/x%2Ey.nsz"]) {
    const { passed, res } = call(gate, p);
    assert.equal(passed, false, p);
    assert.equal(res.code, 503, p);
    assert.deepEqual(res.body, { error: MESSAGE, code: "no-prod-keys" });
  }
  assert.match(call(gate, "/shop.json", "text/html").res.body, /관리 페이지/);
});

test("without keys the admin page, its console API, sign-in, setup and pairing stay open", () => {
  const gate = keysGate({ isReady: () => false });
  for (const p of ["/admin", "/admin/api/keys", "/api/admin/keys", "/login", "/setup", "/pair", "/api/pair/request", "/api/client/latest", "/", "/api/shopkeeper"]) {
    assert.equal(call(gate, p).passed, true, p);
  }
});

test("with keys nothing is held", () => {
  assert.equal(call(keysGate({ isReady: () => true }), "/shop.json").passed, true);
});

test("keys are usable with a header key and a content key, and their absence is the first warning", () => {
  assert.equal(usable(new Map([["header_key", "a".repeat(64)], ["master_key_00", "b".repeat(32)]])), true);
  assert.equal(usable(new Map([["header_key", "a".repeat(64)]])), false);
  assert.equal(usable(null), false);
  assert.equal(configWarnings(authLanes(), { keys: false })[0].code, "no-prod-keys");
  assert.ok(!configWarnings(authLanes(), { keys: true }).some((w) => w.code === "no-prod-keys"));
});
