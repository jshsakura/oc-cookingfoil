import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { makeCard, fixtureLines, FAKE_WORK, FAKE_RIF, FAKE_DB } from "./fixtures/vita-card.js";

// The import tool takes the first backup of a Vita from a card copy on the server. What it stores is what the
// Vita client makes of the same card (test/golden/vita-fixture.jsonl, the client's own output), it reads the
// copy only, a second run adds nothing, its output names nothing, and secrets are stored sealed only.
const root = mkdtempSync(path.join(tmpdir(), "cf-backups-import-"));
const data = path.join(root, "data");
const backups = path.join(root, "backups");
mkdirSync(backups, { recursive: true });
const ux0 = makeCard(path.join(root, "card"));
const env = {
  COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(root, "games"), COOK_BACKUPS_DIR: backups,
  COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false",
};
Object.assign(process.env, env);
const { importUx0 } = await import("../../src/backups/import.js");
const { accountNamed } = await import("../../src/backups/account.js");
const store = await import("../../src/backups/store.js");
const { readSecret } = await import("../../src/backups/secrets.js");
const { scanUx0 } = await import("../../src/backups/vita-scan.js");
after(() => rmSync(root, { recursive: true, force: true }));

const FIXTURE = fixtureLines(readFileSync(path.join(import.meta.dirname, "..", "golden", "vita-fixture.jsonl"), "utf8"));
const alice = () => accountNamed("alice");
const files = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
const stamp = (dir) => files(dir).map((f) => `${f}:${statSync(f).mtimeMs}:${statSync(f).size}`).sort().join("\n");

test("the stored manifests are the Vita client's, line for line and byte for byte", async () => {
  const card = stamp(ux0);
  const totals = await importUx0({ ux0, accountId: alice().id });
  assert.equal(totals.added, FIXTURE.length);
  assert.equal(stamp(ux0), card, "the card copy is only read");
  const stored = [];
  for (const unit of await scanUx0(ux0)) {
    const [latest] = await store.unitVersions(alice().id, "vita", `${unit.kind}:${unit.id}`);
    stored.push(JSON.stringify(latest.manifest));
  }
  assert.deepEqual(stored, FIXTURE);
});

test("importing again adds no version", async () => {
  const totals = await importUx0({ ux0, accountId: alice().id });
  assert.equal(totals.added, 0);
  assert.equal(totals.kept, FIXTURE.length);
  for (const line of FIXTURE) {
    const m = JSON.parse(line);
    assert.equal((await store.unitVersions(alice().id, "vita", `${m.kind}:${m.unit}`)).length, 1);
  }
});

test("secrets are kept sealed only, and open again for their own place", async () => {
  const everything = Buffer.concat(files(backups).map((f) => readFileSync(f)));
  for (const fake of [FAKE_WORK, FAKE_RIF, FAKE_DB]) {
    assert.equal(everything.includes(fake), false, "no plain secret on the disk");
    assert.equal(everything.includes(createHash("sha256").update(fake).digest("hex")), false, "nor its hash");
  }
  const plain = await readSecret(alice().id, "vita", "app:PCSE00001", 1, "sce_sys/package/work.bin");
  assert.equal(plain.toString(), FAKE_WORK);
});

test("the tool prints counts only: no title, path, hash or secret", () => {
  const out = execFileSync(process.execPath, ["scripts/import-backup.mjs", "--platform", "vita", "--account", "alice"], {
    cwd: path.join(import.meta.dirname, "../.."), env: { ...process.env, ...env, COOK_IMPORT_SOURCE: ux0 }, encoding: "utf8",
  });
  assert.match(out, /imported: units 17, files \d+, secret files 4, .*new versions 0, unchanged 17/);
  for (const word of ["Game", "VitaShell", "PCSE00001", "eboot", "work.bin", ".rif", FAKE_WORK, FAKE_RIF, FAKE_DB]) assert.equal(out.includes(word), false, word);
  assert.equal(/[0-9a-f]{32}/.test(out), false, "no hash");
  const dry = execFileSync(process.execPath, ["scripts/import-backup.mjs", "--platform", "vita", "--account", "alice", "--dry"], {
    cwd: path.join(import.meta.dirname, "../.."), env: { ...process.env, ...env, COOK_IMPORT_SOURCE: ux0 }, encoding: "utf8",
  });
  assert.match(dry, /^would import: units 17, files \d+, secret files 4, [\d.]+ GiB\n$/);
});

test("the tool stops on a key other than the server's", () => {
  assert.throws(() => execFileSync(process.execPath, ["scripts/import-backup.mjs", "--platform", "vita", "--account", "alice"], {
    cwd: path.join(import.meta.dirname, "../.."), stdio: "pipe",
    env: { ...process.env, ...env, COOK_IMPORT_SOURCE: ux0, COOK_SECRET_KEY: Buffer.alloc(32, 7).toString("base64") },
  }), (err) => /not the key the server seals backups with/.test(String(err.stderr)));
});

test("the server sets the key check and turns backups off for another key; the tool never sets it", () => {
  const fresh = path.join(root, "fresh-backups");
  mkdirSync(fresh);
  const run = (extra) => execFileSync(process.execPath, ["scripts/import-backup.mjs", "--platform", "vita", "--account", "alice"], {
    cwd: path.join(import.meta.dirname, "../.."), stdio: "pipe", encoding: "utf8",
    env: { ...process.env, ...env, COOK_IMPORT_SOURCE: ux0, COOK_BACKUPS_DIR: fresh, ...extra },
  });
  assert.throws(() => run({}), (err) => /has not turned backups on with its key yet/.test(String(err.stderr)));
  assert.equal(readdirSync(fresh).length, 0, "the tool wrote nothing, not even the check");
  const state = (extra) => execFileSync(process.execPath, ["--input-type=module", "-e",
    `const { backupsCheck } = await import(${JSON.stringify(path.resolve("src/backups/store.js"))}); process.stdout.write(JSON.stringify(backupsCheck()));`], {
    env: { ...process.env, ...env, COOK_BACKUPS_DIR: fresh, ...extra }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  assert.ok(JSON.parse(state({})).root, "the server's first look sets the check");
  assert.deepEqual(JSON.parse(state({ COOK_SECRET_KEY: Buffer.alloc(32, 7).toString("base64") })), { root: null, reason: "key-mismatch" });
  assert.match(run({}), /imported: units 17/);
});
