// The plugins page shows how much each plugin's cache holds against its cap, and can empty it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cache-api-data-"));
const { makeDataDir, manifestOf, newRegistry, writePlugin } = await import("../support/plugin-fixtures.js");
const { mountPluginsApi } = await import("../../src/routes/admin/plugins-api.js");
const { createPluginCache } = await import("../../src/plugins/cache.js");
const { TOKEN_BLOCKED_RE } = await import("../../src/routes/admin-page.js");

let server, base, dataDir, cache;
before(async () => {
  dataDir = makeDataDir();
  writePlugin(dataDir, "holder", { manifest: manifestOf("holder") });
  const env = newRegistry(dataDir);
  await env.registry.init();
  cache = createPluginCache({ dataDir, capBytes: 1000 });
  const app = express();
  const router = express.Router();
  router.use(express.json());
  mountPluginsApi(router, () => true, env.registry, cache);
  app.use(router);
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test("each plugin row carries its cache bytes, files and cap, and clearing empties only that plugin's folder", async () => {
  fs.mkdirSync(cache.dirOf("holder"), { recursive: true });
  fs.writeFileSync(path.join(cache.dirOf("holder"), "a.bin"), Buffer.alloc(300));
  fs.mkdirSync(cache.dirOf("other"), { recursive: true });
  fs.writeFileSync(path.join(cache.dirOf("other"), "b.bin"), Buffer.alloc(10));
  let list = await (await fetch(`${base}/api/plugins`)).json();
  assert.deepEqual(list.plugins.find((p) => p.id === "holder").cache, { bytes: 300, files: 1, capBytes: 1000 });
  const cleared = await (await fetch(`${base}/api/plugins/holder/cache/clear`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  assert.equal(cleared.plugins.find((p) => p.id === "holder").cache.bytes, 0);
  assert.equal(fs.existsSync(path.join(cache.dirOf("other"), "b.bin")), true);
  assert.equal((await fetch(`${base}/api/plugins/BAD!/cache/clear`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
});

test("an automation token cannot empty a cache", () => {
  assert.ok(TOKEN_BLOCKED_RE.test("/api/plugins/holder/cache/clear"));
});
