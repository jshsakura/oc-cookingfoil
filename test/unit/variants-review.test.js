// Pins from the review of the variant path: a reserved key never turns into the original file, a failing
// listing never cools the download path, and what a plugin is handed or caches stays out of its reach.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "variants-review-data-"));
const { largeFiles, GAME_FILE_RE } = await import("../../src/helpers/file-send.js");
const { createVariants } = await import("../../src/plugins/variants.js");
const { default: libraryVariants } = await import("../../src/routes/library-variants.js");
const { withPlugins } = await import("../../src/routes/shop-info.js");
const { parseManifest } = await import("../../src/plugins/manifest.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "variants-review-games-"));
fs.writeFileSync(path.join(root, "g.nsp"), "ABCDEFGHIJ");
const servers = [];
after(() => { for (const s of servers) s.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function serve(variants) {
  const app = express();
  app.post("/api/library/variants", ...libraryVariants({ root, variants: () => variants }));
  app.use(largeFiles(root, GAME_FILE_RE, { variants: variants.resolve }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

const PLUGIN = `
export default {
  variants() { if (globalThis.__listingBroken) throw new Error("listing broke"); return []; },
  async plan(a) {
    let frozen = "no";
    try { a.keys.set("x", "y"); } catch { frozen = "yes"; }
    return { patches: [{ offset: 0, bytes: Buffer.from(frozen === "yes" ? "R" : "W") }] };
  },
  shopInfo() { if (globalThis.__infoHangs) return new Promise(() => {}); return { features: ["from-plugin", "retro"], info: { level: 1 } }; },
};`;

async function withTweaker(extra = {}) {
  const d = makeDataDir();
  writePlugin(d, "tweaker", { manifest: manifestOf("tweaker", { provides: ["variant"], variantKeys: ["tweak"], needsKeys: true, ...extra }), body: PLUGIN });
  const keys = new Map([["header_key", "x"]]);
  const held = { keys };
  const env = newRegistry(d, { keysProvider: () => held.keys });
  await env.registry.init();
  await env.registry.setEnabled("tweaker", true, { confirmKeys: true });
  return { ...env, keys, held, dataDir: d };
}

test("rewrap is a reserved key: with no plugin behind it the answer is 409, never the original file", async () => {
  const env = newRegistry(makeDataDir());
  await env.registry.init();
  const base = await serve(createVariants(env.registry));
  const r = await fetch(`${base}/g.nsp?rewrap=1`);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "variant.unavailable");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${base}/g.nsp?other=1`)).status, 200, "a key nobody reserved is just a query");
});

test("rewrap stays refused after its plugin and its settings are removed, and with its plugin off; on, the plugin plans", async () => {
  const d = makeDataDir();
  writePlugin(d, "rewrap", { manifest: manifestOf("rewrap", { provides: ["variant"], variantKeys: ["rewrap"] }), body: PLUGIN });
  const env = newRegistry(d, { keysProvider: () => new Map() });
  await env.registry.init();
  await env.registry.setEnabled("rewrap", true);
  const base = await serve(createVariants(env.registry));
  assert.equal((await fetch(`${base}/g.nsp?rewrap=1`)).status, 200);
  await env.registry.setEnabled("rewrap", false);
  assert.equal((await fetch(`${base}/g.nsp?rewrap=1`)).status, 409);
  await env.registry.trash("rewrap", { dropSettings: true });
  assert.equal(env.registry.variantKeyStatus("rewrap"), null, "nothing remembers the key now");
  assert.equal((await fetch(`${base}/g.nsp?rewrap=1`)).status, 409);
});

test("a listing that keeps failing never starts the pause that would refuse the next Range of a download", async () => {
  const env = await withTweaker({ console: ["firmware"] });
  const variants = createVariants(env.registry);
  const base = await serve(variants);
  globalThis.__listingBroken = true;
  const post = () => fetch(`${base}/api/library/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: ["/g.nsp"] }) });
  for (let i = 0; i < 12; i++) assert.equal((await post()).status, 200);
  globalThis.__listingBroken = false;
  assert.equal(env.registry.view("tweaker").state, "on");
  const r = await fetch(`${base}/g.nsp?tweak=1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("vary"), "X-CookingFoil-Console", "the manifest asks for console facts, so every answer varies on them");
  assert.equal(r.headers.get("cache-control"), "private, max-age=0");
});

test("the keys a plugin is handed are its own read-only copy", async () => {
  const env = await withTweaker();
  const base = await serve(createVariants(env.registry));
  assert.equal(await (await fetch(`${base}/g.nsp?tweak=1`)).text(), "RBCDEFGHIJ", "set() threw inside the plugin");
  assert.deepEqual([...env.keys], [["header_key", "x"]], "the server's Map is untouched");
});

test("a shop info answer that did not come is not kept; a new plugin version or key file asks again", async () => {
  const env = await withTweaker();
  let t = 0;
  const variants = createVariants(env.registry, { now: () => t });
  globalThis.__infoHangs = true;
  assert.deepEqual(await variants.shopInfoExtras("en"), { features: [], info: {} });
  globalThis.__infoHangs = false;
  t += 1000;
  assert.deepEqual((await variants.shopInfoExtras("en")).info, { level: 1 }, "the timeout was not remembered as an empty answer");
  const stamp = env.registry.keysStamp();
  assert.equal(env.registry.keysStamp(), stamp, "the same keys, the same stamp");
  env.held.keys = new Map([["header_key", "z"]]);
  assert.notEqual(env.registry.keysStamp(), stamp, "a key file read afresh is a new stamp");
});

test("a plugin cannot announce a feature name the core owns", async () => {
  const env = await withTweaker();
  const info = { features: [] };
  await withPlugins(info, "en", async () => createVariants(env.registry));
  assert.ok(info.features.includes("from-plugin"));
  assert.equal(info.features.includes("retro"), false);
});

test("a plugin cannot claim a query key the core's own routes read; rewrap is the one legacy key allowed", () => {
  const raw = (keys) => ({ id: "p", apiVersion: 1, version: "1.0.0", name: { en: "p" }, provides: ["variant"], variantKeys: keys });
  for (const key of ["lang", "v", "size"]) assert.equal(parseManifest(raw([key]), "p").ok, false, key);
  assert.equal(parseManifest(raw(["rewrap"]), "p").ok, true);
});

test("a trashed plugin's remembered keys are cleaned up", async () => {
  const env = await withTweaker();
  assert.ok(env.registry.variantKeyStatus("tweak"));
  await env.registry.trash("tweaker");
  assert.equal(env.registry.variantKeyStatus("tweak"), null);
});
