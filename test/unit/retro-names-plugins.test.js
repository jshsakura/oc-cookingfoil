import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { koreanName, koreanNameByTitle, koreanNameSystem, layered, setNameSources, useKoreanNames } from "../../src/retro/ko-names.js";
import { parseManifest } from "../../src/plugins/manifest.js";
import { makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";

// The Korean names come only from plugins that provide "names", while they are on.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-retro-names-"));
const SHA = "a".repeat(32);
const file = (name, raw) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, typeof raw === "string" ? raw : JSON.stringify(raw));
  return p;
};
const DICT = { folders: { zz: "Test - Console" }, systems: { zz: { [SHA]: ["시험 게임", "Test Game", "0badf00d", "b".repeat(32)] } }, titles: { zz: { "other game": "다른 게임" } } };

test("a plugin's names are found by hash and by title while it is on, and gone once it is off", () => {
  useKoreanNames(null);
  const names = file("names.json", DICT);
  setNameSources(() => [{ id: "retro-db", version: "1.0.0", file: names }]);
  assert.deepEqual(koreanName("zz", { sha256: SHA + "ffff" }), { ko: "시험 게임", en: "Test Game", by: "sha256" });
  assert.deepEqual(koreanName("zz", { crc32: "0BADF00D" }), { ko: "시험 게임", en: "Test Game", by: "crc32" });
  assert.equal(koreanNameByTitle("zz", "Other Game (USA)").ko, "다른 게임");
  assert.equal(koreanNameSystem("zz"), true);

  setNameSources(() => []);
  assert.equal(koreanName("zz", { sha256: SHA }), null);
  assert.equal(koreanNameSystem("zz"), false);
});

test("a new version of the plugin is read again; a broken names.json is skipped, not fatal", () => {
  useKoreanNames(null);
  const names = file("names-v.json", DICT);
  let version = "1.0.0";
  setNameSources(() => [{ id: "retro-db", version, file: names }]);
  assert.equal(koreanName("zz", { sha256: SHA }).ko, "시험 게임");
  fs.writeFileSync(names, JSON.stringify({ systems: { zz: { [SHA]: ["고친 이름", "Test Game", "", ""] } } }));
  version = "1.0.1";
  assert.equal(koreanName("zz", { sha256: SHA }).ko, "고친 이름");

  const broken = file("broken.json", "{ not json");
  setNameSources(() => [{ id: "bad", version: "1.0.0", file: broken }, { id: "retro-db", version, file: names }]);
  assert.equal(koreanName("zz", { sha256: SHA }).ko, "고친 이름");
  setNameSources(() => []);
});

test("layered: a later plugin's row wins for the same hash, and the rows it does not name stay", () => {
  const first = { systems: { nes: { [SHA]: ["옛 이름", "Old", "", ""], ["c".repeat(32)]: ["그대로", "Kept", "", ""] } }, titles: {} };
  const out = layered({ systems: {}, titles: {} }, [first, { systems: { nes: { [SHA]: ["새 이름", "New", "", ""] } } }]);
  assert.equal(out.systems.nes[SHA][0], "새 이름");
  assert.equal(out.systems.nes["c".repeat(32)][0], "그대로");
  assert.equal(first.systems.nes[SHA][0], "옛 이름", "a plugin's dictionary is not changed");
});

test("a manifest may say it provides names", () => {
  const m = parseManifest({ id: "retro-db", apiVersion: 1, version: "1.0.0", name: { en: "OC Retro Database" }, provides: ["names"], libraries: ["retro"] }, "retro-db");
  assert.equal(m.ok, true);
  assert.deepEqual(m.manifest.provides, ["names"]);
});

test("a names plugin with an empty default export switches on in the registry and its names follow its state", async () => {
  useKoreanNames(null);
  const d = makeDataDir();
  const pdir = writePlugin(d, "retro-db", { body: "export default {};", manifest: manifestOf("retro-db", { provides: ["names"], libraries: ["retro"] }) });
  fs.writeFileSync(path.join(pdir, "names.json"), JSON.stringify(DICT));
  const { registry } = newRegistry(d);
  await registry.init();
  setNameSources(() => registry.activeProviding("names").map((id) => ({ id, version: registry.versionOf(id), file: path.join(registry.paths.root, id, "names.json") })));

  assert.equal(koreanName("zz", { sha256: SHA }), null, "installed plugins arrive switched off");
  await registry.setEnabled("retro-db", true);
  assert.equal(registry.stateOf("retro-db"), "on");
  assert.equal(koreanName("zz", { sha256: SHA }).ko, "시험 게임");
  await registry.setEnabled("retro-db", false);
  assert.equal(koreanName("zz", { sha256: SHA }), null);
  setNameSources(() => []);
});
