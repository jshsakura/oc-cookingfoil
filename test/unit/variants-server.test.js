// The generic download-option path with a made-up plugin: what core does with whatever a variant plugin
// answers. No real plugin is involved, so nothing here knows what an option does to the bytes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "variants-data-"));
const { largeFiles, GAME_FILE_RE } = await import("../../src/helpers/file-send.js");
const { createVariants, parseConsoleHeader, checkPatches, refusalBody } = await import("../../src/plugins/variants.js");
const { default: libraryVariants } = await import("../../src/routes/library-variants.js");
const { withPlugins } = await import("../../src/routes/shop-info.js");
const { LANGS } = await import("../../src/meta/langs.js");

const BODY = `
export default {
  variants(item, o) {
    if (!o.console.firmware) return [];
    return [{ id: "tweak", label: { en: "Tweak for " + o.console.firmware, ko: "조정 " + o.console.firmware }, note: { en: "note" }, confirm: { en: "sure?" }, query: { tweak: o.console.firmware } }];
  },
  async plan(a, o) {
    const q = a.query.tweak;
    if (q === "bad") return { refuse: { code: "tweak.nope", text: { en: "No", ko: "아니오" } } };
    if (q === "boom") throw new Error("boom");
    if (q === "slow") return new Promise(() => {});
    if (q === "overlap") return { patches: [{ offset: 0, bytes: Buffer.from("ab") }, { offset: 1, bytes: Buffer.from("c") }] };
    if (q === "outside") return { patches: [{ offset: 9, bytes: Buffer.from("zz") }] };
    if (q === "keys") return { patches: [{ offset: 0, bytes: Buffer.from(a.keys ? "K" : "-") }] };
    return { patches: [{ offset: 2, bytes: Buffer.from("XY") }] };
  },
  shopInfo() { return { features: ["tweak-demo", "file-variants"], info: { tweakLevel: 3, name: "taken" } }; },
};`;

let env, variants, server, base;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "variants-games-"));
const ORIGINAL = "ABCDEFGHIJ";
const get = (p, headers = {}, method = "GET") => fetch(`${base}${p}`, { method, headers });
const text = async (r) => Buffer.from(await r.arrayBuffer()).toString();
const status = (url, headers) => new Promise((resolve, reject) => http.get(`${base}${url}`, { headers }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject));

before(async () => {
  fs.writeFileSync(path.join(root, "g.nsp"), ORIGINAL);
  const d = makeDataDir();
  writePlugin(d, "tweaker", { manifest: manifestOf("tweaker", { provides: ["variant"], variantKeys: ["tweak"], console: ["firmware"], needsKeys: true }), body: BODY });
  env = newRegistry(d, { keysProvider: () => new Map([["header_key", "x"]]) });
  await env.registry.init();
  await env.registry.setEnabled("tweaker", true, { confirmKeys: true });
  variants = createVariants(env.registry);
  const app = express();
  app.post("/api/library/variants", ...libraryVariants({ root, variants: () => variants }));
  app.use(largeFiles(root, GAME_FILE_RE, { variants: variants.resolve }));
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(root, { recursive: true, force: true }); });

test("a file asked for with a plugin's key goes out with its bytes laid over, in the same size, under an ETag of its own", async () => {
  const r = await get("/g.nsp?tweak=1");
  assert.equal(r.status, 200);
  assert.equal(await text(r), "ABXYEFGHIJ");
  assert.equal((await get("/g.nsp?tweak=1", {}, "HEAD")).headers.get("content-length"), String(ORIGINAL.length));
  const tags = [(await get("/g.nsp", {}, "HEAD")).headers.get("etag"), r.headers.get("etag"), (await get("/g.nsp?tweak=2", {}, "HEAD")).headers.get("etag")];
  assert.equal(new Set(tags).size, 3, "original, option and another option all differ");
  assert.equal((await get("/g.nsp?tweak=1", {}, "HEAD")).headers.get("etag"), tags[1], "stable per request");
  assert.equal(await status("/g.nsp?tweak=1", { "If-None-Match": tags[1] }), 304);
  assert.equal(await status("/g.nsp", { "If-None-Match": tags[1] }), 200, "an option's ETag does not validate the original");
  const part = await get("/g.nsp?tweak=1", { Range: "bytes=1-4" });
  assert.equal(part.status, 206);
  assert.equal(await text(part), "BXYE");
});

test("a plugin's refusal is a 409 with error, errors and code, never cached", async () => {
  const r = await get("/g.nsp?tweak=bad", { "Accept-Language": "ko" });
  assert.equal(r.status, 409);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { error: "아니오", errors: { en: "No", ko: "아니오" }, code: "tweak.nope" });
  assert.equal((await (await get("/g.nsp?tweak=bad")).json()).error, "No");
});

test("a hook that throws, hangs or answers nonsense is variant.failed in every language, and never the file as if nothing was asked", async () => {
  for (const q of ["boom", "slow", "overlap", "outside"]) {
    const r = await get(`/g.nsp?tweak=${q}`, { "Accept-Language": "de" });
    assert.equal(r.status, 409, q);
    const j = await r.json();
    assert.equal(j.code, "variant.failed", q);
    assert.deepEqual(Object.keys(j.errors), LANGS, "twelve languages");
    assert.equal(j.error, j.errors.de);
  }
});

test("console facts the manifest asked for are mixed into the ETag, and the answer says it varies by them", async () => {
  const a = await get("/g.nsp?tweak=1", { "X-CookingFoil-Console": "firmware=21.0.1; region=kor" }, "HEAD");
  const b = await get("/g.nsp?tweak=1", { "X-CookingFoil-Console": "firmware=20.0.0" }, "HEAD");
  const same = await get("/g.nsp?tweak=1", { "X-CookingFoil-Console": "firmware=21.0.1" }, "HEAD");
  const none = await get("/g.nsp?tweak=1", {}, "HEAD");
  assert.notEqual(a.headers.get("etag"), b.headers.get("etag"));
  assert.equal(a.headers.get("etag"), same.headers.get("etag"), "region was not asked for, so it changes nothing");
  assert.match(a.headers.get("vary"), /X-CookingFoil-Console/i);
  assert.equal(a.headers.get("cache-control"), "private, max-age=0");
  assert.equal(none.headers.get("vary"), null);
});

test("the plan hook of a plugin that needs keys gets them for that call", async () => {
  assert.equal(await text(await get("/g.nsp?tweak=keys")), "KBCDEFGHIJ");
});

test("POST /api/library/variants answers per file, in the reader's language, and only for what the console said", async () => {
  const post = (body, headers = {}) => fetch(`${base}/api/library/variants`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const withFw = await post({ files: ["/g.nsp", "/missing.nsp", "/../x.nsp"] }, { "X-CookingFoil-Console": "firmware=21.0.1", "Accept-Language": "ko" });
  assert.equal(withFw.status, 200);
  assert.deepEqual((await withFw.json()).variants, {
    "/g.nsp": [{ id: "tweak", label: "조정 21.0.1", note: "note", confirm: "sure?", query: { tweak: "21.0.1" } }],
    "/missing.nsp": [],
    "/../x.nsp": [],
  });
  assert.match(withFw.headers.get("vary"), /Accept-Language/i);
  assert.match(withFw.headers.get("vary"), /X-CookingFoil-Console/i);
  assert.equal(withFw.headers.get("cache-control"), "private, max-age=0");
  const tag = withFw.headers.get("etag");

  assert.deepEqual((await (await post({ files: ["/g.nsp"] })).json()).variants, { "/g.nsp": [] }, "no firmware, no option, no error");
  const again = await post({ files: ["/g.nsp", "/missing.nsp", "/../x.nsp"] }, { "X-CookingFoil-Console": "firmware=21.0.1", "Accept-Language": "ko", "If-None-Match": tag });
  assert.equal(again.status, 304);
  const other = await post({ files: ["/g.nsp", "/missing.nsp", "/../x.nsp"] }, { "X-CookingFoil-Console": "firmware=20.0.0", "Accept-Language": "ko" });
  assert.notEqual(other.headers.get("etag"), tag);

  assert.equal((await post({ files: Array.from({ length: 201 }, (_, i) => `/f${i}.nsp`) })).status, 400);
  const tooMany = await (await post({ files: Array.from({ length: 201 }, (_, i) => `/f${i}.nsp`) })).json();
  assert.equal(tooMany.code, "variants.tooMany");
  assert.equal(tooMany.errors.ko, "한 번에 최대 200개 파일까지만 물어볼 수 있습니다.");
  assert.equal((await (await post({ files: "nope" })).json()).code, "variants.badFiles");
});

test("a plugin that is off refuses its key instead of serving the original; a key nobody claimed is just a query", async () => {
  assert.equal((await get("/g.nsp?other=1")).status, 200);
  assert.equal(await text(await get("/g.nsp?other=1")), ORIGINAL);
  await env.registry.setEnabled("tweaker", false);
  const off = await get("/g.nsp?tweak=1");
  assert.equal(off.status, 409);
  assert.equal((await off.json()).code, "variant.unavailable");
  assert.deepEqual((await (await fetch(`${base}/api/library/variants`, { method: "POST", headers: { "Content-Type": "application/json", "X-CookingFoil-Console": "firmware=21.0.1" }, body: JSON.stringify({ files: ["/g.nsp"] }) })).json()).variants, { "/g.nsp": [] });
  await env.registry.setEnabled("tweaker", true, { confirmKeys: true });
  assert.equal(await text(await get("/g.nsp?tweak=1")), "ABXYEFGHIJ");
});

test("shop info carries the keys (on or off), what consoles are asked for, and what plugins add without overwriting core's names", async () => {
  const info = { features: ["x"], name: "CookingFoil" };
  await withPlugins(info, "en", async () => variants);
  assert.deepEqual(info.variants, { keys: ["tweak"] });
  assert.deepEqual(info.console, { wants: ["firmware"] });
  assert.deepEqual(info.features, ["x", "file-variants", "console-facts", "tweak-demo"]);
  assert.equal(info.tweakLevel, 3);
  assert.equal(info.name, "CookingFoil", "a plugin cannot take a name core already has");
  await env.registry.setEnabled("tweaker", false);
  const off = { features: [], name: "CookingFoil" };
  await withPlugins(off, "en", async () => variants);
  assert.deepEqual(off, { features: [], name: "CookingFoil", variants: { keys: ["tweak"] } }, "keys stay; nothing else");
  await env.registry.setEnabled("tweaker", true, { confirmKeys: true });
});

test("the console header keeps only the items core knows, in the right shape, and at most 256 bytes", () => {
  assert.deepEqual(parseConsoleHeader("firmware=21.0.1; region=kor"), { firmware: "21.0.1", region: "kor" });
  assert.deepEqual(parseConsoleHeader("firmware=21.0; region=mars; serial=XYZ; =; junk"), {});
  assert.deepEqual(parseConsoleHeader(`firmware=21.0.1; ${"x".repeat(300)}`), {});
  assert.deepEqual(parseConsoleHeader(undefined), {});
});

test("patches are checked against the file: sorted, inside it, not overlapping", () => {
  const b = (s) => Buffer.from(s);
  assert.deepEqual(checkPatches([{ offset: 4, bytes: b("cd") }, { offset: 0, bytes: b("ab") }], 10).map((p) => p.offset), [0, 4]);
  assert.equal(checkPatches([{ offset: 0, bytes: b("ab") }, { offset: 1, bytes: b("c") }], 10), null);
  assert.equal(checkPatches([{ offset: 9, bytes: b("zz") }], 10), null);
  assert.equal(checkPatches([{ offset: -1, bytes: b("z") }], 10), null);
  assert.equal(checkPatches([{ offset: 0, bytes: "text" }], 10), null);
  assert.deepEqual(checkPatches([], 10), []);
  assert.deepEqual(refusalBody({ en: "a", ko: "b" }, "c", "ko"), { error: "b", errors: { en: "a", ko: "b" }, code: "c" });
});
