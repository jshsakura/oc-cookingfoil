import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseManifest } from "../../src/plugins/manifest.js";
import { scanPluginDir } from "../../src/plugins/loader.js";
import { BODIES, makeDataDir, manifestOf, writePlugin } from "../support/plugin-fixtures.js";

const scanned = async (dataDir) => Object.fromEntries((await scanPluginDir(path.join(dataDir, "plugins"))).map((e) => [e.id, e]));

test("a good manifest parses; every field has a default", () => {
  const r = parseManifest(manifestOf("good"), "good");
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest.hosts, []);
  assert.equal(r.manifest.needsKeys, false);
});

test("a manifest with a bad id, version, name, provides or host lists why", () => {
  for (const [patch, code] of [
    [{ id: "Bad_ID" }, "bad-id"], [{ version: "one" }, "bad-version"], [{ name: { ko: "x" } }, "bad-name"],
    [{ provides: [] }, "bad-provides"], [{ provides: ["root"] }, "bad-provides"], [{ hosts: ["203.0.113.5"] }, "bad-hosts"],
    [{ hosts: ["*.example.com"] }, "bad-hosts"], [{ needsKeys: "yes" }, "bad-needs-keys"],
    [{ variantKeys: ["rewrap"] }, "variant-keys-without-variant"],
  ]) {
    const r = parseManifest({ ...manifestOf("p"), ...patch }, undefined);
    assert.equal(r.ok, false, code);
    assert.ok(r.problems.includes(code), `${code} in ${r.problems}`);
  }
  assert.deepEqual(parseManifest("{nope", "p"), { ok: false, problems: ["bad-json"] });
  assert.deepEqual(parseManifest("[]", "p"), { ok: false, problems: ["not-an-object"] });
});

test("the scan tells ok, broken (with why) and incompatible apart, and imports nothing", async () => {
  const d = makeDataDir();
  writePlugin(d, "fine");
  writePlugin(d, "badjson", { rawManifest: "{" });
  writePlugin(d, "wrongid", { manifest: manifestOf("other") });
  writePlugin(d, "noindex", { body: null });
  writePlugin(d, "future", { manifest: { ...manifestOf("future"), apiVersion: 2, provides: "anything" } });
  fs.mkdirSync(path.join(d, "plugins", "nomanifest"));
  fs.mkdirSync(path.join(d, "plugins", ".hidden"));
  fs.writeFileSync(path.join(d, "plugins", "readme.txt"), "x");
  const s = await scanned(d);
  assert.equal(s.fine.status, "ok");
  assert.deepEqual(s.badjson.problems, ["bad-json"]);
  assert.deepEqual(s.wrongid.problems, ["id-folder-mismatch"]);
  assert.deepEqual(s.noindex.problems, ["no-index"]);
  assert.deepEqual(s.nomanifest.problems, ["no-manifest"]);
  assert.equal(s.future.status, "incompatible");
  assert.equal(s.future.needs, 2);
  assert.equal(s[".hidden"], undefined);
  assert.equal(s["readme.txt"], undefined);
});

test("a missing plugins folder is an empty list", async () => {
  assert.deepEqual(await scanPluginDir(path.join(os.tmpdir(), "cf-no-such-plugins-dir")), []);
});

test("links that leave the folder are refused: folder, manifest and index.js", async () => {
  const d = makeDataDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cf-outside-"));
  writePlugin(outside, "evil");
  fs.symlinkSync(path.join(outside, "plugins", "evil"), path.join(d, "plugins", "evil"));
  writePlugin(d, "linkedindex", { body: null });
  fs.writeFileSync(path.join(outside, "x.js"), BODIES.ok);
  fs.symlinkSync(path.join(outside, "x.js"), path.join(d, "plugins", "linkedindex", "index.js"));
  writePlugin(d, "linkedmanifest", { body: BODIES.ok });
  fs.rmSync(path.join(d, "plugins", "linkedmanifest", "plugin.json"));
  fs.symlinkSync(path.join(outside, "plugins", "evil", "plugin.json"), path.join(d, "plugins", "linkedmanifest", "plugin.json"));
  const s = await scanned(d);
  assert.deepEqual(s.evil.problems, ["symlink"]);
  assert.deepEqual(s.linkedindex.problems, ["index-symlink"]);
  assert.deepEqual(s.linkedmanifest.problems, ["manifest-symlink"]);
  assert.ok(Object.values(s).every((e) => e.status === "broken"));
});
