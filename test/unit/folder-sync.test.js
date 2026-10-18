import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "../..");

test("a sync reads every folder in turn, and one asked for while it runs joins it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-sync-"));
  for (const d of ["games", "homebrew", "saves", "patches", "retro"]) fs.mkdirSync(path.join(dir, d));
  fs.mkdirSync(path.join(dir, "saves", "0100000000010000", "slot1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "saves", "0100000000010000", "slot1", "save.bin"), "x");
  const script = `const sync = await import(${JSON.stringify(path.join(ROOT, "src/meta/folder-sync.js"))});
const { savesCatalog } = await import(${JSON.stringify(path.join(ROOT, "src/routes/saves.js"))});
const a = sync.syncNow("test"); const b = sync.syncNow("again");
const during = sync.status().running;
const [ra, rb] = await Promise.all([a, b]);
process.stdout.write(JSON.stringify({ same: ra === rb, during, after: sync.status(), saves: (await savesCatalog().list()).length }));
process.exit(0);`;
  const out = JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
    env: { ...process.env, COOK_DATA_DIR: dir, COOK_GAMES_DIR: path.join(dir, "games"), COOK_HOMEBREW_DIR: path.join(dir, "homebrew"), COOK_SAVES_DIR: path.join(dir, "saves"), COOK_PATCHES_DIR: path.join(dir, "patches"), COOK_RETRO_DIR: path.join(dir, "retro"), COOK_TITLEDB_AUTO_FETCH: "false" },
    encoding: "utf8",
  }));
  assert.equal(out.same, true, "the second call joined the first");
  assert.equal(out.during, true);
  assert.equal(out.after.running, false);
  assert.deepEqual(out.after.last.parts.map((p) => p.name), ["games", "homebrew", "saves", "patches", "retro"]);
  assert.deepEqual(out.after.last.parts.filter((p) => p.error), []);
  assert.equal(out.saves, 1, "the saves folder was read");
  assert.equal(out.after.hours, 6);
  assert.ok(out.after.next > out.after.last.at);
});
