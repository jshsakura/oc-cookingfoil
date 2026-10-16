import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Forgetting an app takes its hand-made description, kind, hidden mark and pictures with it.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-hb-forget-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
const descriptions = await import("../../src/meta/homebrew-descriptions.js");
const kinds = await import("../../src/meta/homebrew-kinds.js");
const disabled = await import("../../src/meta/homebrew-disabled.js");
const media = await import("../../src/meta/homebrew-media.js");
const { forgetExtras } = await import("../../src/meta/homebrew-forget.js");
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("an app's description, kind, hidden mark and pictures are forgotten, another app's stay", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  for (const id of ["gh-aaaaaaaaaaaa", "m-bbbbbbbbbbbb"]) {
    descriptions.set(id, { en: "A tool", ko: "도구" });
    kinds.set(id, "port");
    disabled.setEnabled(id, false);
    await media.saveIcon(id, png);
  }
  assert.ok(fs.existsSync(media.iconPath("gh-aaaaaaaaaaaa")), "the icon was saved");
  await forgetExtras("gh-aaaaaaaaaaaa");
  assert.equal(descriptions.get("gh-aaaaaaaaaaaa"), null);
  assert.equal(kinds.kindOf("gh-aaaaaaaaaaaa"), "tool");
  assert.equal(disabled.isDisabled("gh-aaaaaaaaaaaa"), false);
  assert.equal(fs.existsSync(media.iconPath("gh-aaaaaaaaaaaa")), false);
  assert.ok(fs.existsSync(media.iconPath("m-bbbbbbbbbbbb")));
  assert.deepEqual(media.record("gh-aaaaaaaaaaaa"), {}, "no removed-by-hand mark stays");
  assert.ok(descriptions.get("m-bbbbbbbbbbbb"));
  assert.equal(kinds.kindOf("m-bbbbbbbbbbbb"), "port");
  assert.equal(disabled.isDisabled("m-bbbbbbbbbbbb"), true);
});

test("an empty id does nothing", async () => {
  await assert.doesNotReject(forgetExtras(""));
  await assert.doesNotReject(forgetExtras(null));
});
