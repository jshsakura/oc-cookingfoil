// An installed plugin downloads as a zip that the install upload takes back as it is.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { PLUGIN_JSON, INDEX_JS } from "../support/zip-builder.js";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "download-data-"));
const { makeDataDir, newRegistry } = await import("../support/plugin-fixtures.js");
const { mountPluginsApi } = await import("../../src/routes/admin/plugins-api.js");
const { createInstaller } = await import("../../src/plugins/installer.js");
const { unpackPlugin } = await import("../../src/plugins/unpack.js");
const { tokenBlocked } = await import("../../src/routes/admin-page.js");

let env, server, base, dataDir;

const listing = (dir, rel = "") => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
  const next = path.posix.join(rel, e.name);
  return e.isDirectory() ? listing(dir, next) : [next];
}).sort();

before(async () => {
  dataDir = makeDataDir();
  const dir = path.join(dataDir, "plugins/demo");
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules/dep"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin.json"), PLUGIN_JSON);
  fs.writeFileSync(path.join(dir, "index.js"), INDEX_JS);
  fs.writeFileSync(path.join(dir, "lib/util.js"), "export const x = 1;\n");
  fs.writeFileSync(path.join(dir, "node_modules/dep/index.js"), "nope");
  fs.writeFileSync(path.join(dir, "data/cache.bin"), "cache");
  fs.symlinkSync("/etc/hostname", path.join(dir, "link.txt"));
  env = newRegistry(dataDir, { limits: { startMs: 2000 } });
  await env.registry.init();
  const installer = createInstaller({ registry: env.registry, dataDir });
  const app = express();
  const router = express.Router();
  router.use(express.json());
  mountPluginsApi(router, () => true, env.registry, installer);
  app.use(router);
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); delete process.env.COOK_PLUGIN_INSTALL; });

test("the zip is named id-version, works with the install switch off, and holds only the plugin's own files", async () => {
  delete process.env.COOK_PLUGIN_INSTALL;
  const r = await fetch(`${base}/api/plugins/demo/download`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/zip");
  assert.match(r.headers.get("content-disposition"), /filename="demo-1\.2\.0\.zip"/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "download-out-"));
  try {
    const dest = path.join(out, "x");
    await unpackPlugin(Buffer.from(await r.arrayBuffer()), dest);
    assert.deepEqual(listing(dest), ["index.js", "lib/util.js", "plugin.json"], "no symlink, node_modules or data/ cache");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("the download goes back through the install upload and arrives off with the same files", async () => {
  process.env.COOK_PLUGIN_INSTALL = "1";
  const bytes = Buffer.from(await (await fetch(`${base}/api/plugins/demo/download`)).arrayBuffer());
  const staged = await (await fetch(`${base}/api/plugins/install`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: bytes })).json();
  assert.equal(staged.manifest.id, "demo");
  assert.equal(staged.existing.version, "1.2.0");
  const staging = path.join(dataDir, "plugins-incoming", fs.readdirSync(path.join(dataDir, "plugins-incoming"))[0]);
  assert.deepEqual(listing(staging), ["index.js", "lib/util.js", "plugin.json"]);
  assert.equal(fs.readFileSync(path.join(staging, "lib/util.js"), "utf8"), "export const x = 1;\n");
});

test("an unknown or malformed id is refused, and automation tokens may not download", async () => {
  assert.equal((await fetch(`${base}/api/plugins/nope/download`)).status, 404);
  assert.equal((await fetch(`${base}/api/plugins/..%2Fx/download`)).status, 400);
  assert.equal(tokenBlocked("GET", "/api/plugins/demo/download"), true);
  assert.equal(tokenBlocked("GET", "/api/plugins"), false);
});
