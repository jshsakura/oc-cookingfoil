import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLES, resolveLayout, ensureLayout, oldIncoming, moveOldIncoming } from "../../src/helpers/storage-layout.js";

const fakeFs = (dirs = [], full = []) => ({ isDir: (p) => dirs.includes(p) || full.includes(p), hasEntries: (p) => full.includes(p) });

test("one storage folder holds every role, the drop box beside games and not inside it", () => {
  const l = resolveLayout({ COOK_STORAGE_DIR: "/storage" }, fakeFs(["/storage"]));
  assert.equal(l.storage, true);
  for (const role of ROLES) assert.equal(l.dirs[role], `/storage/${role}`, role);
  assert.equal(path.dirname(l.dirs.incoming), path.dirname(l.dirs.games));
});

test("a named folder wins over the storage folder", () => {
  const l = resolveLayout({ COOK_STORAGE_DIR: "/storage", COOK_RETRO_DIR: "/mnt/retro", COOK_INCOMING_DIR: "/mnt/drop" }, fakeFs(["/storage"]));
  assert.equal(l.dirs.retro, "/mnt/retro");
  assert.equal(l.from.retro, "env");
  assert.equal(l.dirs.incoming, "/mnt/drop");
  assert.equal(l.dirs.games, "/storage/games");
});

test("an empty value is no setting, as compose writes it", () => {
  const l = resolveLayout({ COOK_STORAGE_DIR: "/storage", COOK_DATA_DIR: "" }, fakeFs(["/storage"]));
  assert.equal(l.dirs.data, "/storage/data");
});

test("without a mounted storage folder, the old separate mounts stay as they were", () => {
  const l = resolveLayout({ COOK_STORAGE_DIR: "/storage" }, fakeFs(["/games", "/data", "/keys"]));
  assert.equal(l.storage, false);
  assert.equal(l.dirs.games, "/games");
  assert.equal(l.dirs.data, "/data");
  assert.equal(l.dirs.keys, "/keys");
  assert.equal(l.dirs.retro, "/data/retro");
  assert.equal(l.dirs.incoming, "/games/incoming", "the drop box stays where those servers had it");
});

test("a role whose old mount still holds files keeps it, so nothing goes out of sight", () => {
  const l = resolveLayout({ COOK_STORAGE_DIR: "/storage" }, fakeFs(["/storage", "/storage/games"], ["/data"]));
  assert.equal(l.dirs.data, "/data");
  assert.equal(l.from.data, "kept");
  assert.equal(l.dirs.games, "/storage/games", "a storage folder already made wins over an old mount");
  assert.equal(l.dirs.incoming, "/storage/incoming");
});

test("start makes the storage folder's role folders and moves the old drop box out of games without overwriting", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-storage-"));
  try {
    // Only this test's folder counts as holding files, not the clone's own ./games and ./data.
    const inRoot = { isDir: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(), hasEntries: (p) => p.startsWith(root) && fs.existsSync(p) && fs.readdirSync(p).length > 0 };
    const l = resolveLayout({ COOK_STORAGE_DIR: root }, inRoot);
    const made = ensureLayout(l);
    assert.deepEqual(made.sort(), ROLES.map((r) => path.join(root, r)).sort());
    assert.deepEqual(ensureLayout(l), [], "a second start makes nothing");

    const old = path.join(root, "games", "incoming");
    fs.mkdirSync(path.join(old, "snes"), { recursive: true });
    fs.writeFileSync(path.join(old, "a.nsp"), "old a");
    fs.writeFileSync(path.join(old, "snes", "b.sfc"), "b");
    fs.writeFileSync(path.join(old, "same.nsp"), "old same");
    fs.writeFileSync(path.join(l.dirs.incoming, "same.nsp"), "new same");
    assert.equal(oldIncoming(l), old);

    const { moved, left } = moveOldIncoming(old, l.dirs.incoming);
    assert.equal(moved, 2);
    assert.deepEqual(left, ["same.nsp"]);
    assert.equal(fs.readFileSync(path.join(l.dirs.incoming, "a.nsp"), "utf8"), "old a");
    assert.equal(fs.readFileSync(path.join(l.dirs.incoming, "snes", "b.sfc"), "utf8"), "b");
    assert.equal(fs.readFileSync(path.join(l.dirs.incoming, "same.nsp"), "utf8"), "new same", "never overwritten");
    assert.equal(fs.readFileSync(path.join(old, "same.nsp"), "utf8"), "old same", "the one that could not move stays");

    fs.renameSync(path.join(old, "same.nsp"), path.join(l.dirs.incoming, "same-2.nsp"));
    assert.deepEqual(moveOldIncoming(old, l.dirs.incoming), { moved: 0, left: [] });
    assert.equal(fs.existsSync(old), false, "an emptied old drop box is gone");
    assert.equal(oldIncoming(l), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the script prints every role for the entrypoint", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-storage-"));
  try {
    const { execFileSync } = await import("node:child_process");
    const env = { PATH: process.env.PATH, COOK_STORAGE_DIR: root, COOK_DATA_DIR: path.join(root, "data") };
    const out = execFileSync(process.execPath, [path.resolve("src/helpers/storage-layout.js")], { env, cwd: root, encoding: "utf8" });
    const lines = Object.fromEntries(out.trim().split("\n").map((l) => [l.slice(0, l.indexOf(" ")), l.slice(l.indexOf(" ") + 1)]));
    for (const role of ROLES) {
      assert.equal(lines[role], path.join(root, role));
      if (role !== "data") assert.ok(fs.statSync(lines[role]).isDirectory(), role);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the overview names folders still read from an old mount and an old drop box left behind", async () => {
  const { storageWarnings } = await import("../../src/security/config-health.js");
  const layout = { root: "/storage", dirs: { data: "/data", incoming: "/storage/incoming" }, from: { data: "kept" } };
  const codes = storageWarnings(layout, "/storage/games/incoming").map((w) => w.code);
  assert.deepEqual(codes, ["storage-kept", "old-incoming"]);
  const [kept] = storageWarnings(layout, null);
  assert.deepEqual(kept.paths, [{ role: "data", now: "/data", want: "/storage/data" }]);
  assert.deepEqual(storageWarnings({ root: null, dirs: {}, from: {} }, null), []);
});
