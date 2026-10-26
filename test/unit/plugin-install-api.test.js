// Installing a plugin from a zip on the admin page: off unless the server allows it, two steps, always
// switched off on arrival, and switching on asks for the admin password again.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { zip, good, INDEX_JS } from "../support/zip-builder.js";

// The environment is read when the server's modules load, so it is set before any of them is imported.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "install-api-data-"));
process.env.COOK_ADMIN_PASSWORD = "correct horse battery";
const { makeDataDir, newRegistry } = await import("../support/plugin-fixtures.js");
const { mountPluginsApi } = await import("../../src/routes/admin/plugins-api.js");
const { createInstaller, STAGE_TTL_MS } = await import("../../src/plugins/installer.js");
const { resetReconfirm } = await import("../../src/security/admin-reconfirm.js");
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
  assert.equal(snap.reconfirm, "password", "the page is told it will be asked for the admin password");
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

test("switching a plugin on asks for the admin password again; off and delete do not", async () => {
  resetReconfirm();
  assert.equal((await post("/api/plugins/demo/enabled", { on: true })).status, 403);
  const wrong = await post("/api/plugins/demo/enabled", { on: true, password: "nope" });
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).code, "password-wrong");
  assert.equal(env.registry.view("demo").state, "off");
  const ok = await post("/api/plugins/demo/enabled", { on: true, password: "correct horse battery" });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).plugin.state, "on");
  assert.equal((await post("/api/plugins/demo/enabled", { on: false })).status, 200);
  assert.equal((await post("/api/plugins/demo/trash", {})).status, 200);
});

test("five wrong passwords lock asking for a while, even for the right one", async () => {
  resetReconfirm();
  await post("/api/plugins/install/confirm", { stagedId: "x" });
  const staged = await json(await upload(zip(good())));
  await post("/api/plugins/install/confirm", { stagedId: staged.stagedId });
  for (let i = 0; i < 5; i++) assert.equal((await post("/api/plugins/demo/enabled", { on: true, password: "bad" + i })).status, 403);
  const locked = await post("/api/plugins/demo/enabled", { on: true, password: "correct horse battery" });
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).code, "password-locked");
  resetReconfirm();
});

test("automation tokens are refused the install routes", () => {
  for (const p of ["/api/plugins/install", "/api/plugins/install/confirm", "/api/plugins/demo/enabled", "/api/plugins/demo/trash"]) assert.ok(TOKEN_BLOCKED_RE.test(p), p);
});

test("a stopped server's leftover uploads are cleared at start", async () => {
  fs.mkdirSync(path.join(dataDir, "plugins-incoming/left-over"), { recursive: true });
  await installer.sweep();
  assert.equal(fs.existsSync(path.join(dataDir, "plugins-incoming")), false);
});
