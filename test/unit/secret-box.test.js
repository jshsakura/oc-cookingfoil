import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Secrets at rest: sealed with the key from COOK_SECRET_KEY, never readable
// with another key, plain files from before sealed on first read, and no
// server without the key.
const box = await import("../../src/security/secret-box.js");
const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("hex");
const withKey = (k, fn) => {
  const was = process.env.COOK_SECRET_KEY;
  process.env.COOK_SECRET_KEY = k;
  box.resetKeyForTests();
  try { return fn(); } finally { process.env.COOK_SECRET_KEY = was; box.resetKeyForTests(); }
};

test("keys are 32 bytes in base64 or hex; anything else is refused", () => {
  assert.equal(box.parseKey(KEY_A).length, 32);
  assert.equal(box.parseKey(KEY_B).length, 32);
  for (const bad of [undefined, "", "short", Buffer.alloc(16).toString("base64"), "z".repeat(64)]) assert.equal(box.parseKey(bad), null, String(bad));
  withKey("", () => assert.throws(() => box.assertKey(), box.SecretKeyError));
});

test("a sealed value opens with its key only, and differs every time", () => {
  const sealed = withKey(KEY_A, () => box.seal("client-secret-value"));
  assert.match(sealed, /^cfsec:v1:/);
  assert.ok(!sealed.includes("client-secret-value"));
  withKey(KEY_A, () => {
    assert.equal(box.open(sealed).toString(), "client-secret-value");
    assert.notEqual(box.seal("x"), box.seal("x"), "a fresh IV each time");
  });
  withKey(KEY_B, () => assert.throws(() => box.open(sealed), box.SecretKeyError));
  const tampered = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
  withKey(KEY_A, () => assert.throws(() => box.open(tampered)));
});

test("a plain file from before is read once and sealed in place", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-seal-"));
  const file = path.join(dir, "integrations.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, services: { igdb: { clientSecret: "plain-before" } } }));
  withKey(KEY_A, () => {
    assert.equal(box.readSealedJson(file).services.igdb.clientSecret, "plain-before");
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /^cfsec:v1:/);
    assert.ok(!text.includes("plain-before"));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(box.readSealedJson(file).services.igdb.clientSecret, "plain-before");
    assert.equal(box.readSealedJson(path.join(dir, "missing.json")), null);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the server does not start without the key", () => {
  const env = { ...process.env, COOK_SECRET_KEY: "", COOK_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "cf-nokey-")) };
  const r = spawnSync(process.execPath, ["./src/index.js"], { cwd: path.join(import.meta.dirname, "../.."), env, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /COOK_SECRET_KEY/);
});
