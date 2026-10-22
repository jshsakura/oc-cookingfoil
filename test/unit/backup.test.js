import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Each case runs the backup in its own process: the data folder is read once per process.
const ROOT = path.join(import.meta.dirname, "../..");

function dataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-backup-"));
  const put = (rel, body = "{}") => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  put("metadata/games/Game [0100000000010000]/game.json", '{"id":"0100000000010000"}');
  put("transfers.json", "[]");
  put("patches-cache.json", '{"cache":true}');
  put("security/alerts-history.json", "[]");
  put("homebrew/sources.json", "[]");
  put("homebrew/gh-1/state.json", "{}");
  put("extracted-meta/0100000000010000.json", '{"name":"Fixed"}');
  put("custom-art/0100000000010000.icon.jpg", "JPG");
  // A game's picture is kept; the small copies drawn from it are made again on demand.
  put("metadata/games/Game [0100000000010000]/icon.webp", "WEBP");
  put("thumbs/games/0100000000010000/icon.abc-1.thumb.q75.webp", "THUMB");
  put("titledb/KR.ko.json", "{}");
  put("cookingfoil.db", "index");
  return dir;
}

function run(dir, code, env = {}) {
  const script = `const users = await import(${JSON.stringify(path.join(ROOT, "src/security/users.js"))});
const backup = await import(${JSON.stringify(path.join(ROOT, "src/db/backup.js"))});
const out = await (async () => { ${code} })();
process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], { env: { ...process.env, COOK_AUTH_USERS: "", ...env, COOK_DATA_DIR: dir }, encoding: "utf8" }));
}

const walk = (dir, rel = "") => fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(dir, path.join(rel, e.name)) : [path.join(rel, e.name)])).sort();

test("a day's backup holds the security database and the hand-kept files, not the caches", () => {
  const dir = dataDir();
  const made = run(dir, `users.add("boss", "boss-password-1", "admin"); return backup.backupNow(Date.UTC(2026, 9, 16, 12));`);
  const day = path.join(dir, "backups", made.day);
  assert.deepEqual(walk(day), [
    "custom-art/0100000000010000.icon.jpg",
    "extracted-meta/0100000000010000.json",
    "homebrew/sources.json",
    "metadata/games/Game [0100000000010000]/game.json",
    "metadata/games/Game [0100000000010000]/icon.webp",
    "security/alerts-history.json",
    "security/security.db",
    "transfers.json",
  ]);
  const db = new DatabaseSync(path.join(day, "security", "security.db"), { readOnly: true });
  assert.deepEqual(db.prepare("SELECT id FROM records WHERE kind = 'user'").all().map((r) => r.id), ["boss"], "a whole copy of the database");
  db.close();
  assert.equal(fs.statSync(path.join(dir, "backups")).mode & 0o777, 0o700);
  assert.equal(fs.statSync(day).mode & 0o777, 0o700);
  for (const f of walk(day)) assert.equal(fs.statSync(path.join(day, f)).mode & 0o777, 0o600, f);
});

test("backups past the kept days are removed; one made again the same day replaces it", () => {
  const dir = dataDir();
  const days = run(dir, `
    for (const d of [10, 11, 12, 13]) backup.backupNow(new Date(2026, 9, d, 12).getTime());
    backup.backupNow(new Date(2026, 9, 13, 18).getTime());
    return backup.list().map((b) => b.day);`, { COOK_BACKUP_DAYS: "2" });
  assert.deepEqual(days, ["2026-10-13", "2026-10-12"]);
  assert.deepEqual(fs.readdirSync(path.join(dir, "backups")).sort(), ["2026-10-12", "2026-10-13"], "no half-made folder is left");
});

test("start() makes today's backup once when it is missing, and none when backups are off", () => {
  const on = dataDir();
  assert.equal(run(on, `backup.start(); backup.start(); return backup.list().length;`), 1);
  const off = dataDir();
  assert.equal(run(off, `backup.start(); return backup.list().length;`, { COOK_BACKUP_DAYS: "0" }), 0);
});

test("the status names the setting, the last run and what is kept", () => {
  const dir = dataDir();
  const st = run(dir, `backup.backupNow(); return backup.status();`);
  assert.equal(st.days, 14);
  assert.equal(st.kept.length, 1);
  assert.ok(st.last.bytes > 0 && st.last.files >= 7);
});
