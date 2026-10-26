import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";
import { createAgentCache } from "../../src/plugins/agent-cache.js";
import { createAgentRunner } from "../../src/plugins/agent-runner.js";
import { AGENT_FIELDS, ART_FIELDS, MAX_SHOTS, parseMetadata } from "../../src/plugins/agent-answer.js";

// A metadata plugin may also name pictures: icon, banner (one https address each) and screenshots (a list).
// They are validated like the text fields: a wrong one is dropped alone and the rest of the answer stays.

test("icon, banner and screenshots are kept as https addresses", () => {
  const a = parseMetadata({
    fields: {
      name: "Game",
      icon: "https://img.example.com/icon.png",
      banner: "https://img.example.com/banner.png",
      screenshots: ["https://img.example.com/1.png", "https://img.example.com/2.png"],
    },
    credit: { text: "Example DB" },
  });
  assert.equal(a.fields.name, "Game");
  assert.equal(a.fields.icon, "https://img.example.com/icon.png");
  assert.equal(a.fields.banner, "https://img.example.com/banner.png");
  assert.deepEqual(a.fields.screenshots, ["https://img.example.com/1.png", "https://img.example.com/2.png"]);
  assert.deepEqual(a.credit, { text: "Example DB" });
});

test("a wrong picture field is dropped alone", () => {
  const a = parseMetadata({
    fields: {
      name: "Game",
      icon: "http://img.example.com/icon.png",
      banner: 42,
      screenshots: "https://img.example.com/1.png",
    },
  });
  assert.deepEqual(a.fields, { name: "Game" });
});

test("addresses that are not plain https are refused: other schemes, spaces, credentials, script and local files", () => {
  for (const bad of ["ftp://img.example.com/a.png", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@img.example.com/a.png", "https://img.example.com/a b.png", "//img.example.com/a.png", "", "https://", `https://img.example.com/${"a".repeat(600)}`]) {
    assert.deepEqual(parseMetadata({ fields: { icon: bad } }).fields, {}, JSON.stringify(bad).slice(0, 50));
  }
});

test("a screenshots list keeps the good addresses, once each, up to the limit", () => {
  const many = Array.from({ length: 20 }, (_, i) => `https://img.example.com/${i}.png`);
  const a = parseMetadata({ fields: { screenshots: ["https://img.example.com/ok.png", "nope", 7, null, "https://img.example.com/ok.png", ...many] } });
  assert.equal(a.fields.screenshots.length, MAX_SHOTS);
  assert.equal(a.fields.screenshots[0], "https://img.example.com/ok.png");
  assert.equal(new Set(a.fields.screenshots).size, MAX_SHOTS);
  assert.deepEqual(parseMetadata({ fields: { screenshots: ["nope", 7] } }).fields, {}, "a list with nothing usable is dropped");
  assert.deepEqual(parseMetadata({ fields: { screenshots: [] } }).fields, {});
});

test("an answer with only pictures is an answer, and earns its credit", () => {
  const a = parseMetadata({ fields: { icon: "https://img.example.com/icon.png" }, credit: { text: "Example DB", url: "https://example.com/db" } });
  assert.deepEqual(a.credit, { text: "Example DB", url: "https://example.com/db" });
});

test("pictures take no part in the text fields' order", () => {
  assert.deepEqual(ART_FIELDS, ["icon", "banner", "screenshots"]);
  for (const f of ART_FIELDS) assert.ok(!AGENT_FIELDS.includes(f), f);
});

// ---- through a real plugin, the runner and the cache ----
const GAME = "0100000000030000";

test("a plugin's pictures are stored with its answer; a bad address is dropped, the rest stay", async () => {
  const d = makeDataDir();
  const answer = { fields: { name: "Moon", icon: "https://img.example.com/i.png", banner: "javascript:alert(1)", screenshots: ["https://img.example.com/s.png", "ftp://x/y"] }, credit: { text: "Example DB" } };
  writePlugin(d, "gamedb", { body: `export default { async metadata() { return ${JSON.stringify(answer)}; } };`, manifest: manifestOf("gamedb") });
  const { registry, clock } = newRegistry(d, { limits: { hookMs: { metadata: 2000 }, hookMsDefault: 2000 } });
  await registry.init();
  await registry.setEnabled("gamedb", true);
  const store = createAgentCache({ cacheDirOf: (id) => path.join(d, "plugin-cache", id), now: () => clock.t });
  const runner = createAgentRunner({ registry, store, now: () => clock.t });
  runner.want(GAME, { hasFile: true });
  for (let i = 0; i < 50 && runner.pending() > 0; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 50));
  const kept = store.get("gamedb", GAME);
  assert.deepEqual(kept.fields, { name: "Moon", icon: "https://img.example.com/i.png", screenshots: ["https://img.example.com/s.png"] });
  assert.deepEqual(kept.credit, { text: "Example DB" });
  const onDisk = JSON.parse(fs.readFileSync(path.join(d, "plugin-cache", "gamedb", "agent", `${GAME}.json`), "utf8"));
  assert.equal(onDisk.fields.icon, "https://img.example.com/i.png");
  runner.stop();
});
