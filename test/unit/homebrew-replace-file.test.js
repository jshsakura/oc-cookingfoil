import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A hand-placed app gets a new build in place: same folder (so the same id and everything added by
// hand), one file of the format it already has, and the old file in the homebrew trash.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-replace-"));
const dirs = Object.fromEntries(["data", "games", "homebrew", "patches", "saves", "incoming", "retro"].map((d) => [d, path.join(root, d)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
process.env.COOK_DATA_DIR = dirs.data;
process.env.COOK_GAMES_DIR = dirs.games;
process.env.COOK_HOMEBREW_DIR = dirs.homebrew;
process.env.COOK_PATCHES_DIR = dirs.patches;
process.env.COOK_SAVES_DIR = dirs.saves;
process.env.COOK_INCOMING_DIR = dirs.incoming;
process.env.COOK_RETRO_DIR = dirs.retro;
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { replaceHomebrewFile } = await import("../../src/routes/admin/homebrew-upload.js");
const { useNspReader } = await import("../../src/meta/homebrew.js");
const { manualApps, refreshManual } = await import("../../src/routes/homebrew.js");
const trash = await import("../../src/library/trash.js");
const { listFields, setField } = await import("../../src/meta/item-fields.js");

const TID = "0100AAAA00000000";
const OTHER = "0100BBBB00000000";

function fakeNro(name, version) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(name, 0);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}
// The reader is faked, so the body only needs the PFS0 magic and a version the fake reads back.
const fakeNsp = (version, titleId = TID) => Buffer.from(`PFS0|${titleId}|${version}`);
useNspReader(async (abs) => {
  const [magic, titleId, version] = fs.readFileSync(abs, "latin1").split("|");
  return magic === "PFS0" ? { titleId, metaType: 0x80, name: "Wiki", version } : null;
});

const put = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dirs.homebrew, rel)), { recursive: true });
  fs.writeFileSync(path.join(dirs.homebrew, rel), body);
};
function received(name, body) {
  const abs = path.join(fs.mkdtempSync(path.join(root, "work-")), "f0");
  fs.writeFileSync(abs, body);
  return [{ abs, rel: name }];
}
const appIn = async (folder) => {
  await refreshManual();
  return (await manualApps()).find((m) => path.basename(path.dirname(m.path)) === folder);
};
const trashedAs = async (action) => (await trash.listRoot({ key: "homebrew", dir: dirs.homebrew })).filter((e) => e.action === action);

test("an .nsp app takes a newer build of the same title under the uploaded name, and the old file goes to the trash", async () => {
  put("wiki/Wiki-v1.0.9.nsp", fakeNsp("1.0.9"));
  const before = await appIn("wiki");

  const out = await replaceHomebrewFile(received("Wiki-v1.0.10.nsp", fakeNsp("1.0.10")), before.id);

  assert.deepEqual(fs.readdirSync(path.join(dirs.homebrew, "wiki")), ["Wiki-v1.0.10.nsp"]);
  const now = await appIn("wiki");
  assert.equal(now.id, before.id, "same folder, same id: description, pictures and kind stay");
  assert.equal(now.version, "1.0.10");
  assert.equal(out.replaced, "Wiki-v1.0.9.nsp");
  const [entry] = await trashedAs("homebrew-file-replace");
  assert.ok(fs.existsSync(path.join(dirs.homebrew, ".cookingfoil-trash", entry.entry, "wiki", "Wiki-v1.0.9.nsp")), "the old build can be restored");
});

const values = async (id) => Object.fromEntries((await listFields("homebrew", id)).map((f) => [f.key, f.value]));
const ADMIN = { via: "dashboard", device: null, deviceName: null };

test("an .nro app keeps its file name, so the console overwrites the same switch/<app>/<name>.nro", async () => {
  put("tool/tool.nro", fakeNro("Tool", "1.0.0"));
  const before = await appIn("tool");
  assert.equal((await values(before.id)).cores, "3", "unset cores read as the default 3");
  for (const [key, value] of [["cores", "4"], ["kind", "port"], ["verified", true]]) await setField("homebrew", before.id, key, value, ADMIN);

  await replaceHomebrewFile(received("tool-v2.nro", fakeNro("Tool", "2.0.0")), before.id);

  assert.deepEqual(fs.readdirSync(path.join(dirs.homebrew, "tool")), ["tool.nro"]);
  const now = await appIn("tool");
  assert.equal(now.id, before.id);
  assert.equal(now.version, "2.0.0");
  assert.deepEqual(await values(now.id), { verified: true, enabled: true, kind: "port", cores: "4" }, "settings stay with the new build");
});

test("an installable .nsp app has no cores setting on either screen, an .nro app has it", async () => {
  put("title/Title.nsp", fakeNsp("1.0.0"));
  put("plain/plain.nro", fakeNro("Plain", "1.0.0"));
  assert.ok(!("cores" in (await values((await appIn("title")).id))));
  assert.equal((await values((await appIn("plain")).id)).cores, "3");
});

test("a file of another format, another title, or not an NSP at all is refused and the app stays as it was", async () => {
  put("keep/Keep.nsp", fakeNsp("1.0.0"));
  const { id } = await appIn("keep");

  await assert.rejects(replaceHomebrewFile(received("Keep.nro", fakeNro("Keep", "2.0.0")), id), /\.nsp/);
  await assert.rejects(replaceHomebrewFile(received("Keep.nsp", fakeNsp("2.0.0", OTHER)), id), /다른 타이틀/);
  await assert.rejects(replaceHomebrewFile(received("Keep.nsp", "<!doctype html><title>Sign in</title>"), id), /NSP/);
  await assert.rejects(replaceHomebrewFile(received("x.nsp", fakeNsp("2.0.0")), "manual:nothing-here"), /목록에 없/);

  assert.deepEqual(fs.readdirSync(path.join(dirs.homebrew, "keep")), ["Keep.nsp"]);
  assert.equal((await appIn("keep")).version, "1.0.0");
});

test("a build whose name another file in the folder already has is refused before the current file moves", async () => {
  put("taken/Taken-v1.nsp", fakeNsp("1.0.0"));
  const { id } = await appIn("taken");
  put("taken/Taken-v2.nsp", fakeNsp("2.0.0", OTHER));

  await assert.rejects(replaceHomebrewFile(received("Taken-v2.nsp", fakeNsp("2.0.0")), id), /이미 있어/);

  assert.deepEqual(fs.readdirSync(path.join(dirs.homebrew, "taken")).sort(), ["Taken-v1.nsp", "Taken-v2.nsp"]);
  assert.equal((await trashedAs("homebrew-file-replace")).filter((e) => e.name === "Wiki").length, 1, "only the first test's file went to the trash");
});

test("restoring a replaced build from the trash swaps it back: one file, the old version, and the swap can be undone too", async () => {
  const trashService = await import("../../src/library/trash-service.js");
  put("undo/Undo-v1.nsp", fakeNsp("1.0.0"));
  const { id } = await appIn("undo");
  await replaceHomebrewFile(received("Undo-v2.nsp", fakeNsp("2.0.0")), id);
  const replaced = (await trashedAs("homebrew-file-replace")).find((e) => e.items.some((it) => it.rel === "undo/Undo-v1.nsp"));

  const { failed } = await trashService.restore([replaced.id]);

  assert.deepEqual(failed, []);
  assert.deepEqual(fs.readdirSync(path.join(dirs.homebrew, "undo")), ["Undo-v1.nsp"]);
  assert.equal((await appIn("undo")).version, "1.0.0");
  const swapped = (await trashedAs("homebrew-file-replace")).find((e) => e.items.some((it) => it.rel === "undo/Undo-v2.nsp"));
  assert.ok(swapped, "the newer build waits in the trash");

  await trashService.restore([swapped.id]);
  assert.deepEqual(fs.readdirSync(path.join(dirs.homebrew, "undo")), ["Undo-v2.nsp"]);
  assert.equal((await appIn("undo")).version, "2.0.0");
});
