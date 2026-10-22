import { test } from "node:test";
import assert from "node:assert/strict";
import { versionLabel, versionLabels } from "../../src/retro/shortcut-name.js";
import { shortcutName } from "../../src/retro/forwarder.js";

test("a version is told by its Korean edition, else its region, else its tag", () => {
  assert.equal(versionLabel({ edition: { korean: true, source: "patch", version: "v2" } }), "한글 v2");
  assert.equal(versionLabel({ edition: { korean: true, source: "official" }, region: "kr" }), "정발");
  assert.equal(versionLabel({ region: "jp", variant: "[Rev 1]" }), "일본");
  assert.equal(versionLabel({ variant: "[Rev 1]" }), "Rev 1");
  assert.equal(versionLabel({}), null);
});

test("labels two versions share fall back to their tags; a lone version gets none", () => {
  assert.equal(versionLabels([{ id: "a", parts: { region: "us" } }]).size, 0);
  const out = versionLabels([
    { id: "a", parts: { region: "us", variant: "[Rev 1]" } },
    { id: "b", parts: { region: "us", variant: "[Rev 2]" } },
    { id: "c", parts: { region: "jp" } },
    { id: "d", parts: {} },
  ]);
  assert.deepEqual([...out], [["a", "북미 Rev 1"], ["b", "북미 Rev 2"], ["c", "일본"]]);
});

test("the shortcut name is the display name, then the version label", () => {
  assert.equal(shortcutName({ name: "슈퍼 마리오 월드 (Super Mario World) [K]" }), "슈퍼 마리오 월드");
  assert.equal(shortcutName({ name: "슈퍼 마리오 월드 (Super Mario World) [K v2]", versionLabel: "한글 v2" }), "슈퍼 마리오 월드 · 한글 v2");
});
