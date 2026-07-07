import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  normalizeDeviceKey,
  generateAccessKey,
  hashAccessKey,
  verifyAccessKey,
  stageAccessKeyDelivery,
  takeAccessKeyDelivery,
} from "../../src/security/pairing.js";

const VALID = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";

test("normalizeDeviceKey accepts 64-hex and canonicalises to upper/trimmed", () => {
  assert.equal(normalizeDeviceKey(VALID), VALID);
  assert.equal(normalizeDeviceKey(VALID.toLowerCase()), VALID);
  assert.equal(normalizeDeviceKey(`  ${VALID}  `), VALID);
});

test("normalizeDeviceKey rejects the all-zero eMMC-read-failure fallback", () => {
  // CyberFoil emits 64 zeros when fsDeviceOperatorGetMmcCid fails — a value
  // shared by every broken console. It must never become a valid identity.
  assert.equal(normalizeDeviceKey("0".repeat(64)), null);
});

test("normalizeDeviceKey rejects malformed keys", () => {
  assert.equal(normalizeDeviceKey(""), null);
  assert.equal(normalizeDeviceKey("XYZ"), null);
  assert.equal(normalizeDeviceKey("A".repeat(63)), null);
  assert.equal(normalizeDeviceKey("A".repeat(65)), null);
  assert.equal(normalizeDeviceKey("G".repeat(64)), null); // non-hex char
  assert.equal(normalizeDeviceKey(null), null);
  assert.equal(normalizeDeviceKey(12345), null);
});

test("accessKey hash/verify roundtrip is correct and rejects mismatches", () => {
  const key = generateAccessKey();
  const hash = hashAccessKey(key);
  assert.ok(key.length >= 40, "32 random bytes → ≥43 base64url chars");
  assert.ok(verifyAccessKey(key, hash));
  assert.ok(!verifyAccessKey(`${key}x`, hash));
  assert.ok(!verifyAccessKey("", hash));
  assert.ok(!verifyAccessKey(key, ""));
  assert.ok(!verifyAccessKey(generateAccessKey(), hash));
});

test("generateAccessKey is unique per call", () => {
  assert.notEqual(generateAccessKey(), generateAccessKey());
});

test("one-time delivery yields the key exactly once", () => {
  stageAccessKeyDelivery(VALID, "secret-token");
  assert.equal(takeAccessKeyDelivery(VALID), "secret-token");
  assert.equal(takeAccessKeyDelivery(VALID), null); // consumed
});

test("store device lifecycle: pending → approve → revoke", async () => {
  // Set an isolated data dir BEFORE the first (dynamic) import of store, whose
  // envs.js dependency reads COOK_DATA_DIR at module-eval time.
  process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-store-"));
  const store = await import("../../src/security/store.js");

  assert.equal(store.isDeviceApproved(VALID), false);

  store.recordPendingDevice(VALID, { ip: "1.2.3.4", version: "1.0" });
  let snap = store.devicesSnapshot();
  assert.equal(snap.pending.length, 1);
  assert.equal(snap.pending[0].deviceKey, VALID);
  assert.equal(snap.approved.length, 0);

  const hash = hashAccessKey("k");
  store.approveDevice(VALID, { label: "friend switch", addedBy: "admin", accessKeyHash: hash });
  assert.equal(store.isDeviceApproved(VALID), true);
  assert.equal(store.getDeviceAccessKeyHash(VALID), hash);

  snap = store.devicesSnapshot();
  assert.equal(snap.pending.length, 0, "approval clears the pending entry");
  assert.equal(snap.approved.length, 1);
  assert.equal(snap.approved[0].label, "friend switch");

  assert.equal(store.revokeDevice(VALID), true);
  assert.equal(store.isDeviceApproved(VALID), false);
  assert.equal(store.revokeDevice(VALID), false, "revoke is idempotent");
});
