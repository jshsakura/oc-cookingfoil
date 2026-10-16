import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, SECURITY_MIGRATIONS } from "../../src/db/database.js";
import { deleteSecret, done, markDone, readSecret, readSecretJson, recordStore, settingsStore, writeSecret, writeSecretJson } from "../../src/db/security-stores.js";
import { resetKeyForTests } from "../../src/security/secret-box.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cf-secdb-"));
const fresh = () => openDatabase(":memory:", { migrations: SECURITY_MIGRATIONS });
const rows = (db) => db.prepare("SELECT kind, id, data FROM records").all();

test("records are written a row each, and only the ones that changed", () => {
  const db = fresh();
  const store = recordStore("user", { db });
  assert.deepEqual(store.load(), []);
  store.sync(new Map([["a", { n: 1 }], ["b", { n: 2 }]]));
  assert.equal(rows(db).length, 2);
  // A row rewritten here behind the store's back stays: sync() writes only what it changed itself.
  db.prepare("UPDATE records SET data = '{\"n\":9}' WHERE id = 'b'").run();
  store.sync(new Map([["a", { n: 3 }], ["b", { n: 2 }]]));
  assert.deepEqual(rows(db).map((r) => [r.id, JSON.parse(r.data).n]).sort(), [["a", 3], ["b", 9]]);
  store.sync([]);
  assert.equal(rows(db).length, 0);
});

test("kinds share the table but not their records", () => {
  const db = fresh();
  recordStore("user", { db }).sync([["a", {}]]);
  assert.deepEqual(recordStore("api-token", { db }).load(), []);
});

test("settings are a row each and saving replaces them all", () => {
  const db = fresh();
  const store = settingsStore({ db });
  store.save({ a: true, b: "x" });
  assert.deepEqual(store.load(), { a: true, b: "x" });
  store.save({ b: "y" });
  assert.deepEqual(store.load(), { b: "y" });
});

test("secrets are kept sealed only, and the table refuses anything else", () => {
  const db = fresh();
  assert.equal(readSecret("k", { db }), null);
  writeSecret("k", Buffer.from("top secret"), { db });
  const { sealed } = db.prepare("SELECT sealed FROM secrets WHERE name = 'k'").get();
  assert.match(sealed, /^cfsec:v1:/);
  assert.ok(!sealed.includes("top secret"));
  assert.equal(readSecret("k", { db }).toString(), "top secret");
  writeSecretJson("j", { a: 1 }, { db });
  assert.deepEqual(readSecretJson("j", { db }), { a: 1 });
  deleteSecret("k", { db });
  assert.equal(readSecret("k", { db }), null);
  assert.throws(() => db.prepare("INSERT INTO secrets (name, sealed) VALUES ('p', 'plain')").run(), /CHECK/);
});

test("the secrets table takes the sealed prefix exactly, case included", () => {
  const db = fresh();
  for (const bad of ["plain", "CFSEC:V1:abc", "cfsec:v2:abc"]) {
    assert.throws(() => db.prepare("INSERT INTO secrets (name, sealed) VALUES ('p', ?)").run(bad), /CHECK/, bad);
  }
});

test("a record that does not parse stops the load before anything is trusted", () => {
  const db = fresh();
  const store = recordStore("device", { db });
  store.sync([["a", { n: 1 }], ["b", { n: 2 }]]);
  db.prepare("UPDATE records SET data = '{bad' WHERE id = 'b'").run();
  const again = recordStore("device", { db });
  assert.throws(() => again.load());
  // Nothing was taken as written, so a later sync still sees both rows.
  again.sync([["a", { n: 1 }]]);
  assert.equal(rows(db).length, 1);
});

test("one-time steps are noted", () => {
  const db = fresh();
  assert.equal(done("seed", { db }), false);
  markDone("seed", { db });
  markDone("seed", { db });
  assert.equal(done("seed", { db }), true);
});

test("the security database and its journal are readable by the server's account only", () => {
  const dir = tmp();
  const file = path.join(dir, "security", "s.db");
  const db = openDatabase(file, { migrations: SECURITY_MIGRATIONS, private: true });
  recordStore("user", { db }).sync([["a", {}]]);
  for (const f of [file, `${file}-wal`]) assert.equal(fs.statSync(f).mode & 0o777, 0o600, f);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
});

test("a secret sealed with another key stops instead of reading as missing", () => {
  const db = fresh();
  writeSecret("k", "x", { db });
  const saved = process.env.COOK_SECRET_KEY;
  try {
    process.env.COOK_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
    resetKeyForTests();
    assert.throws(() => readSecret("k", { db }), { name: "SecretKeyError" });
  } finally {
    process.env.COOK_SECRET_KEY = saved;
    resetKeyForTests();
  }
  assert.equal(readSecret("k", { db }).toString(), "x");
});
