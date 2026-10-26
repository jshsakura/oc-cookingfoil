import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The shared trash must not be a way into the plugins folder: plugins are code that runs in this process.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-trash-"));
const dataDir = path.join(tmp, "data");
fs.mkdirSync(dataDir, { recursive: true });
process.env.COOK_DATA_DIR = dataDir;
const trashStore = await import("../../src/library/trash.js");
const trashService = await import("../../src/library/trash-service.js");
const { BODIES, manifestOf, newRegistry, writePlugin } = await import("../support/plugin-fixtures.js");

const HOME = ".cookingfoil-trash";
const stateOf = (r, id) => r.list().find((p) => p.id === id)?.state;

test("deleting a plugin moves the folder to the plugins' own trash and it comes back as it was", async () => {
  const d = fs.mkdtempSync(path.join(tmp, "a-"));
  writePlugin(d, "gone", { body: BODIES.ok });
  const { registry } = newRegistry(d);
  await registry.init();
  await registry.setEnabled("gone", true);
  const { name } = await registry.trash("gone", {});
  assert.equal(fs.existsSync(path.join(d, "plugins", "gone")), false);
  assert.equal(registry.list().some((p) => p.id === "gone"), false, "not listed once trashed");
  assert.equal(registry._instance("gone"), null, "stopped first");
  assert.equal((await registry.listTrashed()).length, 1);

  const back = await registry.restore(name);
  assert.equal(back.state, "off", "restored plugins come back switched off");
  assert.equal(fs.readFileSync(path.join(d, "plugins", "gone", "index.js"), "utf8"), BODIES.ok);
  assert.deepEqual(await registry.listTrashed(), []);
});

test("deleting keeps the cache and settings unless asked, and drops them when asked", async () => {
  const d = fs.mkdtempSync(path.join(tmp, "b-"));
  for (const id of ["keep", "drop"]) {
    writePlugin(d, id);
    fs.mkdirSync(path.join(d, "plugin-cache", id), { recursive: true });
    fs.writeFileSync(path.join(d, "plugin-cache", id, "x"), "1");
  }
  const cleared = [];
  const { registry, db } = newRegistry(d);
  // newRegistry has no clearSettings; build the dependency by hand for this one assertion.
  const { createRegistry } = await import("../../src/plugins/registry.js");
  const r = createRegistry({ db, dataDir: d, clearSettings: (id) => cleared.push(id), notify() {} });
  await r.init();
  await r.trash("keep", {});
  await r.trash("drop", { dropCache: true, dropSettings: true });
  assert.equal(fs.existsSync(path.join(d, "plugin-cache", "keep", "x")), true);
  assert.equal(fs.existsSync(path.join(d, "plugin-cache", "drop")), false);
  assert.deepEqual(cleared, ["drop"]);
  assert.ok(registry);
});

test("only entries the registry made can be restored: a planted folder, a forged note, a bad name", async () => {
  const d = fs.mkdtempSync(path.join(tmp, "c-"));
  const { registry } = newRegistry(d);
  await registry.init();
  const trashRoot = path.join(d, "plugins-trash");
  fs.mkdirSync(path.join(trashRoot, "planted.1700000000000"), { recursive: true });
  fs.writeFileSync(path.join(trashRoot, "planted.1700000000000", "index.js"), "process.exit(0)");
  fs.mkdirSync(path.join(trashRoot, "forged.1700000000001"), { recursive: true });
  fs.writeFileSync(`${path.join(trashRoot, "forged.1700000000001")}.json`, JSON.stringify({ by: "someone", id: "forged" }));
  fs.mkdirSync(path.join(trashRoot, "mismatch.1700000000002"), { recursive: true });
  fs.writeFileSync(`${path.join(trashRoot, "mismatch.1700000000002")}.json`, JSON.stringify({ by: "plugin-registry", id: "other" }));
  for (const name of ["planted.1700000000000", "forged.1700000000001", "mismatch.1700000000002", "../escape", "x/y", "", "gone.1700000000009"]) {
    await assert.rejects(registry.restore(name), { code: "not-found" }, name);
  }
  assert.deepEqual(await registry.listTrashed(), []);
  assert.equal(fs.existsSync(path.join(d, "plugins", "planted")), false);
});

test("a restore never overwrites a plugin that is there now", async () => {
  const d = fs.mkdtempSync(path.join(tmp, "e-"));
  writePlugin(d, "twice");
  const { registry } = newRegistry(d);
  await registry.init();
  const { name } = await registry.trash("twice", {});
  writePlugin(d, "twice", { manifest: manifestOf("twice", { version: "2.0.0" }) });
  await assert.rejects(registry.restore(name), { code: "exists" });
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, "plugins", "twice", "plugin.json"), "utf8")).version, "2.0.0");
  assert.equal((await registry.listTrashed()).length, 1, "the trashed copy stays");
});

test("the shared trash cannot restore anything into data/plugins", async () => {
  const root = { key: "data", dir: dataDir };
  fs.mkdirSync(path.join(dataDir, "plugins", "x"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "plugins", "x", "index.js"), "export default {}");
  const entry = await trashStore.trashItems(root, [{ rel: "plugins/x" }], { kind: "other" });
  await assert.rejects(trashStore.restoreEntry(root, HOME, entry.entry), /bad-path|맞지 않|not valid/i);
  assert.equal(fs.existsSync(path.join(dataDir, "plugins", "x", "index.js")), false, "nothing came back");
  // an ordinary entry of the same root still restores
  fs.writeFileSync(path.join(dataDir, "note.txt"), "n");
  const ok = await trashStore.trashItems(root, [{ rel: "note.txt" }], { kind: "other" });
  assert.equal((await trashStore.restoreEntry(root, HOME, ok.entry)).items[0].to, "note.txt");
});

test("the shared trash will not take files out of data/plugins or data/plugins-trash either", async () => {
  fs.mkdirSync(path.join(dataDir, "plugins", "y"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "plugins", "y", "index.js"), "x");
  await assert.rejects(trashService.trash("data", [{ rel: "plugins/y/index.js" }], {}), /경로가 맞지 않/);
  await assert.rejects(trashService.trash("data", [{ rel: "plugins-trash/anything" }], {}), /경로가 맞지 않/);
  assert.equal(fs.existsSync(path.join(dataDir, "plugins", "y", "index.js")), true);
  assert.equal(trashStore.isProtectedRel("games", "plugins/x"), false, "other roots are untouched");
  assert.equal(trashStore.isProtectedRel("data", "plugins-notes.txt"), false, "a name that only starts alike is not protected");
});

test("a trashed plugin that is switched on again is a new decision: nothing resumes by itself", async () => {
  const d = fs.mkdtempSync(path.join(tmp, "f-"));
  writePlugin(d, "once");
  const a = newRegistry(d);
  await a.registry.init();
  await a.registry.setEnabled("once", true);
  const { name } = await a.registry.trash("once", {});
  await a.registry.restore(name);
  const b = newRegistry(d, { db: a.db });
  await b.registry.init();
  assert.equal(stateOf(b.registry, "once"), "off");
});
