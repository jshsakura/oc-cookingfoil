import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, SECURITY_MIGRATIONS } from "../../src/db/database.js";
import { deleteSecret, done, markDone, readSecret, readSecretJson, recordStore, settingsStore, writeSecret, writeSecretJson } from "../../src/db/security-stores.js";
import { resetKeyForTests, seal } from "../../src/security/secret-box.js";

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

test("a file from before is taken over once and left in place", () => {
  const dir = tmp();
  const file = path.join(dir, "users.json");
  fs.writeFileSync(file, JSON.stringify({ users: { a: { hash: "h" } } }));
  const db = openDatabase(path.join(dir, "s.db"), { migrations: SECURITY_MIGRATIONS });
  const legacy = { file, entries: (json) => Object.entries(json.users) };
  assert.deepEqual(recordStore("user", { db, legacy }).load(), [["a", { hash: "h" }]]);
  assert.ok(fs.existsSync(file));
  recordStore("user", { db }).sync([]);
  assert.deepEqual(recordStore("user", { db, legacy }).load(), [], "not taken over again once the records changed");
});

test("a file from before that does not read stops the start, unless it only holds what lapses", () => {
  const dir = tmp();
  const file = path.join(dir, "broken.json");
  fs.writeFileSync(file, "{nope");
  const db = fresh();
  assert.throws(() => recordStore("user", { db, legacy: { file, entries: () => [] } }), /fix or restore/);
  assert.equal(done("x", { db }), false);
  assert.deepEqual(recordStore("approval", { db, legacy: { file, lenient: true, entries: () => [] } }).load(), []);
  // The refused one is tried again next time, so a fixed file still comes in.
  fs.writeFileSync(file, JSON.stringify({ users: { a: {} } }));
  assert.deepEqual(recordStore("user", { db, legacy: { file, entries: (j) => Object.entries(j.users) } }).load(), [["a", {}]]);
});

test("settings are a row each and saving replaces them all", () => {
  const db = fresh();
  const store = settingsStore({ db });
  store.save({ a: true, b: "x" });
  assert.deepEqual(store.load(), { a: true, b: "x" });
  store.save({ b: "y" });
  assert.deepEqual(store.load(), { b: "y" });
});

test("saved settings from before are taken over; a broken file falls back to the compose values", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "s.json"), JSON.stringify({ settings: { a: 1 } }));
  fs.writeFileSync(path.join(dir, "bad.json"), "{");
  assert.deepEqual(settingsStore({ db: fresh(), legacyFile: path.join(dir, "s.json") }).load(), { a: 1 });
  assert.deepEqual(settingsStore({ db: fresh(), legacyFile: path.join(dir, "bad.json") }).load(), {});
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

test("a secret file from before, sealed or not, is taken over; one sealed with another key stops", () => {
  const dir = tmp();
  const plainFile = path.join(dir, "plain.key");
  fs.writeFileSync(plainFile, "abc");
  const sealedFile = path.join(dir, "sealed.json");
  fs.writeFileSync(sealedFile, seal(JSON.stringify({ s: 1 })) + "\n");
  const db = fresh();
  assert.equal(readSecret("p", { db, legacyFile: plainFile }).toString(), "abc");
  assert.match(fs.readFileSync(plainFile, "utf8"), /^cfsec:v1:/, "the plain file is sealed in place");
  assert.deepEqual(readSecretJson("s", { db, legacyFile: sealedFile }), { s: 1 });

  const other = path.join(dir, "other.json");
  fs.writeFileSync(other, seal("x") + "\n");
  const saved = process.env.COOK_SECRET_KEY;
  try {
    process.env.COOK_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
    resetKeyForTests();
    assert.throws(() => readSecret("o", { db, legacyFile: other }), /COOK_SECRET_KEY/);
  } finally {
    process.env.COOK_SECRET_KEY = saved;
    resetKeyForTests();
  }
  assert.equal(readSecret("o", { db, legacyFile: other }).toString(), "x", "tried again with the right key");
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
