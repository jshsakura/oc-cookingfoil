// Installing a plugin from a zip on the admin page: off unless the server allows it, two steps, always
// switched off on arrival, and switching on takes no password.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { zip, good, INDEX_JS } from "../support/zip-builder.js";

// The environment is read when the server's modules load, so it is set before any of them is imported.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "install-api-data-"));

const { makeDataDir, newRegistry } = await import("../support/plugin-fixtures.js");
const { mountPluginsApi } = await import("../../src/routes/admin/plugins-api.js");
const { createInstaller, STAGE_TTL_MS } = await import("../../src/plugins/installer.js");
const { TOKEN_BLOCKED_RE } = await import("../../src/routes/admin-page.js");

let env, installer, server, base, dataDir;
const clock = { t: 1_700_000_000_000 };
const json = (r) => r.json();
const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const upload = (buffer) => fetch(`${base}/api/plugins/install`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: buffer });

before(async () => {
  dataDir = makeDataDir();
  env = newRegistry(dataDir, { limits: { startMs: 2000 } });
  await env.registry.init();
  installer = createInstaller({ registry: env.registry, dataDir, now: () => clock.t });
  const app = express();
  const router = express.Router();
  router.use(express.json());
  mountPluginsApi(router, () => true, env.registry, installer);
  app.use(router);
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); delete process.env.COOK_PLUGIN_INSTALL; });

test("without COOK_PLUGIN_INSTALL=1 nothing can be uploaded or confirmed, and the page is told", async () => {
  delete process.env.COOK_PLUGIN_INSTALL;
  const snap = await json(await fetch(`${base}/api/plugins`));
  assert.equal(snap.installAllowed, false);
  const r = await upload(zip(good()));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "install-off");
  assert.equal((await post("/api/plugins/install/confirm", { stagedId: "a".repeat(24) })).status, 403);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "plugins")), []);
});

test("an upload is checked and shown first; confirming installs it switched off", async () => {
  process.env.COOK_PLUGIN_INSTALL = "1";
  assert.equal((await json(await fetch(`${base}/api/plugins`))).installAllowed, true);
  const staged = await json(await upload(zip(good())));
  assert.equal(staged.manifest.id, "demo");
  assert.equal(staged.existing, null);
  assert.match(staged.sha256, /^[0-9a-f]{16}$/);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "plugins")), [], "nothing is installed by the first step");

  const done = await json(await post("/api/plugins/install/confirm", { stagedId: staged.stagedId }));
  assert.equal(done.plugin.id, "demo");
  assert.equal(done.plugin.state, "off");
  assert.equal(done.plugin.enabled, false);
  assert.equal(done.plugin.origin.source, "upload");
  assert.equal(done.plugin.origin.sha256, staged.sha256);
  assert.ok(fs.existsSync(path.join(dataDir, "plugins/demo/index.js")));
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "plugins-incoming")), [], "the staging folder is gone");
});

test("a package that is refused says why and leaves nothing", async () => {
  const r = await upload(zip(good([{ name: "../evil.js", data: "x" }])));
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.code, "bad-package");
  assert.equal(body.reason, "bad-zip");
  assert.equal((await upload(Buffer.from("nope"))).status, 400);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "plugins-incoming")), []);
});

test("an id that is already installed is asked about; overwriting keeps the old one in the plugins' trash and arrives off", async () => {
  const newer = zip([{ name: "plugin.json", data: JSON.stringify({ id: "demo", apiVersion: 1, version: "1.3.0", name: { en: "Demo" }, provides: ["metadata"] }) }, { name: "index.js", data: INDEX_JS }]);
  const staged = await json(await upload(newer));
  assert.deepEqual(staged.existing, { version: "1.2.0", state: "off" });
  const asked = await post("/api/plugins/install/confirm", { stagedId: staged.stagedId });
  assert.equal(asked.status, 409);
  assert.deepEqual((await asked.json()).existing, { version: "1.2.0", state: "off" });
  const done = await json(await post("/api/plugins/install/confirm", { stagedId: staged.stagedId, overwrite: true }));
  assert.equal(done.plugin.version, "1.3.0");
  assert.equal(done.plugin.state, "off");
  assert.ok(done.trashed.some((t) => t.id === "demo" && t.version === "1.2.0"), "the old one can be restored");
});

test("a waiting upload expires, and one that was replaced cannot be confirmed", async () => {
  const first = await json(await upload(zip(good())));
  clock.t += STAGE_TTL_MS + 1;
  const late = await post("/api/plugins/install/confirm", { stagedId: first.stagedId, overwrite: true });
  assert.equal(late.status, 404);
  assert.equal((await late.json()).code, "stage-gone");
  const a = await json(await upload(zip(good())));
  const b = await json(await upload(zip(good())));
  assert.equal((await post("/api/plugins/install/confirm", { stagedId: a.stagedId, overwrite: true })).status, 404);
  assert.equal((await post("/api/plugins/install/confirm", { stagedId: b.stagedId, overwrite: true })).status, 200);
  assert.equal((await post("/api/plugins/install/confirm", { stagedId: "nope" })).status, 400);
});

test("switching a plugin on, off and deleting it take no password", async () => {
  assert.equal(env.registry.view("demo").state, "off");
  const ok = await post("/api/plugins/demo/enabled", { on: true });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).plugin.state, "on");
  assert.equal((await post("/api/plugins/demo/enabled", { on: false })).status, 200);
  assert.equal((await post("/api/plugins/demo/trash", {})).status, 200);
});

test("automation tokens are refused the install routes", () => {
  for (const p of ["/api/plugins/install", "/api/plugins/install/confirm", "/api/plugins/demo/enabled", "/api/plugins/demo/trash"]) assert.ok(TOKEN_BLOCKED_RE.test(p), p);
});

test("a stopped server's leftover uploads are cleared at start", async () => {
  fs.mkdirSync(path.join(dataDir, "plugins-incoming/left-over"), { recursive: true });
  await installer.sweep();
  assert.equal(fs.existsSync(path.join(dataDir, "plugins-incoming")), false);
});

test("pressing install twice installs once; a second upload or the timer cannot take the waiting one away mid-install", async () => {
  process.env.COOK_PLUGIN_INSTALL = "1";
  const slow = { ...env.registry, list: env.registry.list, installFrom: async (...args) => { await new Promise((r) => setTimeout(r, 150)); return env.registry.installFrom(...args); } };
  const own = createInstaller({ registry: slow, dataDir, now: () => clock.t });
  const staged = await own.stage(zip([{ name: "plugin.json", data: JSON.stringify({ id: "twice", apiVersion: 1, version: "1.0.0", name: { en: "Twice" }, provides: ["metadata"] }) }, { name: "index.js", data: INDEX_JS }]));
  const first = own.confirm(staged.stagedId, { overwrite: true });
  const second = own.confirm(staged.stagedId, { overwrite: true });
  await assert.rejects(second, (e) => e.code === "busy");
  await assert.rejects(own.stage(zip(good())), (e) => e.code === "busy", "a new upload waits for the install");
  await own.discard();
  assert.ok(fs.existsSync(path.join(dataDir, "plugins-incoming", staged.stagedId)), "the folder being installed is not thrown away");
  assert.equal((await first).id, "twice");
  assert.ok(fs.existsSync(path.join(dataDir, "plugins/twice/index.js")), "installed once and still there");
  assert.equal(env.registry.view("twice").state, "off");
});

test("two uploads at once leave exactly one waiting, and its timer is the new one's", async () => {
  process.env.COOK_PLUGIN_INSTALL = "1";
  const own = createInstaller({ registry: env.registry, dataDir, now: () => clock.t });
  const [a, b] = await Promise.all([own.stage(zip(good())), own.stage(zip(good()))]);
  assert.notEqual(a.stagedId, b.stagedId);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "plugins-incoming")), [b.stagedId], "only the later upload is kept");
  await own.sweep();
});

test("what is on disk is checked again at install: a folder changed since the look is not installed", async () => {
  process.env.COOK_PLUGIN_INSTALL = "1";
  const own = createInstaller({ registry: env.registry, dataDir, now: () => clock.t });
  const staged = await own.stage(zip(good()));
  fs.rmSync(path.join(dataDir, "plugins-incoming", staged.stagedId, "index.js"));
  await assert.rejects(own.confirm(staged.stagedId, { overwrite: true }), (e) => e.code === "stage-gone");
  await own.sweep();
});

const freshZip = () => zip([{ name: "plugin.json", data: JSON.stringify({ id: "fresh", apiVersion: 1, version: "1.0.0", name: { en: "Fresh" }, provides: ["metadata"] }) }, { name: "index.js", data: INDEX_JS }]);

test("a plugin that was loaded and is replaced waits for a restart; the upload note follows the folder", async () => {
  const staged = await json(await upload(freshZip()));
  await post("/api/plugins/install/confirm", { stagedId: staged.stagedId, overwrite: true });
  assert.equal((await post("/api/plugins/fresh/enabled", { on: true })).status, 200, "first time in this process");
  const again = await json(await upload(freshZip()));
  const done = await json(await post("/api/plugins/install/confirm", { stagedId: again.stagedId, overwrite: true }));
  assert.equal(done.plugin.restartNeeded, true);
  const refused = await post("/api/plugins/fresh/enabled", { on: true });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, "restart-needed");
  assert.equal(env.registry.view("fresh").origin.source, "upload");
  fs.writeFileSync(path.join(dataDir, "plugins/fresh/plugin.json"), JSON.stringify({ id: "fresh", apiVersion: 1, version: "9.9.9", name: { en: "Demo" }, provides: ["metadata"] }));
  await env.registry.rescan();
  assert.equal(env.registry.view("fresh").origin, null, "replaced by hand: the note is for another version");
  await post("/api/plugins/fresh/trash", {});
  assert.equal(fs.existsSync(path.join(dataDir, "plugin-origin/fresh.json")), false, "deleting forgets where it came from");
});
