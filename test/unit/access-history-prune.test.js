import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Addresses are kept 90 days: a sign-in or a console that went quiet loses them too,
// not only one that comes back.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cf-access-prune-"));

const store = await import("../../src/security/store.js");
await store.load();

const DAY = 24 * 60 * 60 * 1000;

test("a sign-in older than 90 days no longer shows its address, and the daily prune drops it", () => {
  const t0 = Date.UTC(2026, 0, 10);
  store.recordLogin("quiet", "password", "192.0.2.10", t0);
  assert.equal(store.lastLogin("quiet", t0 + DAY).ip, "192.0.2.10");

  const later = t0 + 120 * DAY;
  assert.equal(store.lastLogin("quiet", later).ip, null);
  assert.equal(store.pruneAccessHistory(later), true);
  assert.deepEqual(store.loginHistory("quiet", later), []);
  assert.equal(store.lastLogin("quiet", later).ip, null);
  assert.equal(store.pruneAccessHistory(later), false, "nothing left to drop");
});
