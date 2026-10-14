import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// The pairSecret: proof that the caller polling /api/pair/status is the console
// that asked. Without it, anyone who learns a device key could take its
// accessKey first and lock the real console out.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-pair-secret-"));
process.env.COOK_DEVICE_PAIRING = "true";
process.env.COOK_DEVICE_AUTO_APPROVE = "false";
const express = (await import("express")).default;
const store = await import("../../src/security/store.js");
const pairing = await import("../../src/security/pairing.js");
const { approveWaitingDevice } = await import("../../src/security/pairing-approve.js");
const { registerPairSecret, deliverAccessKey } = await import("../../src/security/pairing-delivery.js");
const pairRouter = (await import("../../src/routes/pair.js")).default;

const app = express();
app.use("/api/pair", pairRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const newKey = () => crypto.randomBytes(32).toString("hex").toUpperCase();
const newSecret = () => crypto.randomBytes(32).toString("hex");

const request = (body, headers = {}) =>
  fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const status = (deviceKey, headers = {}) =>
  fetch(`${BASE}/api/pair/status?deviceKey=${deviceKey}`, { headers }).then(async (r) => ({ code: r.status, body: await r.json() }));

test("the accessKey goes only to the caller presenting the console's pairSecret", async () => {
  const key = newKey();
  const secret = newSecret();
  assert.equal((await request({ deviceKey: key, pairSecret: secret })).status, 200);
  approveWaitingDevice(key, { addedBy: "admin" });

  // A stranger who knows the device key polls first: approved, no key.
  let r = await status(key);
  assert.deepEqual(r.body, { status: "approved" });
  r = await status(key, { "X-Pair-Secret": newSecret() });
  assert.deepEqual(r.body, { status: "approved" });

  // The console, with its secret, still gets the key.
  r = await status(key, { "X-Pair-Secret": secret });
  assert.equal(r.body.status, "approved");
  assert.ok(pairing.verifyAccessKey(r.body.accessKey, store.getDeviceAccessKeyHash(key)));
  assert.equal(store.pairSecretHash(key), null, "the secret is cleared once the key is taken");

  // One time only.
  r = await status(key, { "X-Pair-Secret": secret });
  assert.deepEqual(r.body, { status: "approved" });
  store.revokeDevice(key);
});

test("the pairSecret header works on /request and the query field on /status", async () => {
  const key = newKey();
  const secret = newSecret();
  await request({ deviceKey: key }, { "X-Pair-Secret": secret.toUpperCase() });
  approveWaitingDevice(key, { addedBy: "admin" });
  const r = await fetch(`${BASE}/api/pair/status?deviceKey=${key}&pairSecret=${secret}`).then((x) => x.json());
  assert.ok(r.accessKey);
  store.revokeDevice(key);
});

test("only a hash of the pairSecret is stored", async () => {
  const key = newKey();
  const secret = newSecret();
  await request({ deviceKey: key, pairSecret: secret });
  assert.equal(store.pairSecretHash(key), crypto.createHash("sha256").update(secret).digest("hex"));
  assert.notEqual(store.pairSecretHash(key), secret);
  store.revokeDevice(key);
});

test("the first pairSecret wins; the same one again is fine, another is refused", async () => {
  const key = newKey();
  const first = newSecret();
  assert.equal((await request({ deviceKey: key, pairSecret: first })).status, 200);
  assert.equal((await request({ deviceKey: key, pairSecret: first })).status, 200);
  const other = await request({ deviceKey: key, pairSecret: newSecret() });
  assert.equal(other.status, 409);
  assert.deepEqual(await other.json(), { error: "pairSecret mismatch" });
  assert.equal((await status(key, { "X-Pair-Secret": newSecret() })).code, 409);

  approveWaitingDevice(key, { addedBy: "admin" });
  // The second caller's secret did not replace the first.
  assert.equal((await status(key, { "X-Pair-Secret": newSecret() })).body.accessKey, undefined);
  assert.ok((await status(key, { "X-Pair-Secret": first })).body.accessKey);
  store.revokeDevice(key);
});

test("a malformed pairSecret is refused on /request", async () => {
  const r = await request({ deviceKey: newKey(), pairSecret: "abc" });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "invalid pairSecret" });
});

test("legacy: a console that asked without a secret gets its key on the first poll", async () => {
  const key = newKey();
  await request({ deviceKey: key });
  approveWaitingDevice(key, { addedBy: "admin" });
  const r = await status(key);
  assert.ok(r.body.accessKey);
  store.revokeDevice(key);
});

test("a GET-only console registers its secret by polling", async () => {
  const key = newKey();
  const secret = newSecret();
  assert.equal((await status(key, { "X-Pair-Secret": secret })).body.status, "pending");
  approveWaitingDevice(key, { addedBy: "admin" });
  assert.equal((await status(key)).body.accessKey, undefined);
  assert.ok((await status(key, { "X-Pair-Secret": secret })).body.accessKey);
  store.revokeDevice(key);
});

test("refusing or forgetting a console clears its pairSecret", () => {
  const refused = newKey();
  store.recordPendingDevice(refused);
  assert.equal(registerPairSecret(refused, newSecret()), "set");
  store.revokeDevice(refused);
  assert.equal(store.pairSecretHash(refused), null);

  const dismissed = newKey();
  store.recordPendingDevice(dismissed);
  registerPairSecret(dismissed, newSecret());
  store.dismissPending(dismissed);
  assert.equal(store.pairSecretHash(dismissed), null);

  // An approved console that never took its key is forgotten too.
  const forgotten = newKey();
  registerPairSecret(forgotten, newSecret());
  approveWaitingDevice(forgotten, { addedBy: "admin" });
  assert.ok(store.pairSecretHash(forgotten));
  store.revokeDevice(forgotten);
  assert.equal(store.pairSecretHash(forgotten), null);
});

test("a poll without the secret does not consume the delivery", () => {
  const key = newKey();
  const secret = newSecret();
  registerPairSecret(key, secret);
  approveWaitingDevice(key, { addedBy: "admin" });
  assert.equal(deliverAccessKey(key, null), null);
  assert.equal(deliverAccessKey(key, "not-hex"), null);
  assert.ok(deliverAccessKey(key, secret));
  store.revokeDevice(key);
});

test("an approved console cannot register a secret afterwards", () => {
  const key = newKey();
  approveWaitingDevice(key, { addedBy: "admin" });
  assert.equal(registerPairSecret(key, newSecret()), "none");
  assert.equal(store.pairSecretHash(key), null);
  store.revokeDevice(key);
});

test("pairSecretMatches compares in constant time against the stored hash", () => {
  const secret = newSecret();
  const hash = pairing.hashPairSecret(secret);
  assert.equal(pairing.pairSecretMatches(secret, hash), true);
  assert.equal(pairing.pairSecretMatches(secret.toUpperCase(), hash), true);
  assert.equal(pairing.pairSecretMatches(newSecret(), hash), false);
  assert.equal(pairing.pairSecretMatches(undefined, hash), false);
  assert.equal(pairing.pairSecretMatches(secret, null), false);
});

test("auto-approval (all consoles) is held to the same pairSecret rule", async () => {
  const env = await import("../../src/helpers/envs.js");
  env.applyServerSettings({ deviceApproval: "all" });
  try {
    const key = newKey();
    const secret = newSecret();
    const r = await request({ deviceKey: key, pairSecret: secret });
    assert.deepEqual(await r.json(), { status: "approved" });
    assert.deepEqual((await status(key)).body, { status: "approved" }, "no key without the secret");
    assert.ok((await status(key, { "X-Pair-Secret": secret })).body.accessKey);
    store.revokeDevice(key);
  } finally {
    env.applyServerSettings({});
  }
});
