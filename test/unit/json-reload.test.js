import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The files under data/homebrew are the truth: one changed by hand or by another tool shows on the next
// read, with no restart. kinds.json was edited at 14:28 on 2026-10-27 and the server kept the old kind
// until it restarted.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "json-reload-"));
const dir = path.join(process.env.COOK_DATA_DIR, "homebrew");
fs.mkdirSync(dir, { recursive: true });
const edit = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

const kinds = await import("../../src/meta/homebrew-kinds.js");
const disabled = await import("../../src/meta/homebrew-disabled.js");
const verified = await import("../../src/meta/homebrew-verified.js");
const descriptions = await import("../../src/meta/homebrew-descriptions.js");
const media = await import("../../src/meta/homebrew-media.js");

const ID = "gh-0123456789ab";
const OTHER = "m-ba9876543210";

test("kinds.json edited outside the server is read again", () => {
  assert.equal(kinds.kindOf(ID), "tool");
  edit("kinds.json", { [ID]: "port" });
  assert.equal(kinds.kindOf(ID), "port");
  // After the server's own write, a later hand edit still shows.
  kinds.set(OTHER, "port");
  assert.equal(kinds.kindOf(OTHER), "port");
  edit("kinds.json", { [OTHER]: "port" });
  assert.equal(kinds.kindOf(ID), "tool");
});

test("disabled, verified and descriptions follow the file too", () => {
  assert.equal(disabled.isDisabled(ID), false);
  edit("disabled.json", { [ID]: true });
  assert.equal(disabled.isDisabled(ID), true);

  assert.equal(verified.verifiedAt(ID), null);
  edit("verified.json", { [ID]: 1_700_000_000_000 });
  assert.equal(verified.verifiedAt(ID), 1_700_000_000_000);

  assert.equal(descriptions.get(ID), null);
  edit("descriptions.json", { [ID]: { en: "Hand written", ko: null } });
  assert.deepEqual(descriptions.get(ID), { en: "Hand written", ko: null });
});

test("media.json follows the file too", () => {
  assert.equal(media.record(ID)?.banner ?? null, null);
  edit("media.json", { [ID]: { banner: "off" } });
  assert.equal(media.record(ID)?.banner, "off");
});

test("a file mid-edit that does not parse keeps the last good values", () => {
  edit("kinds.json", { [ID]: "port" });
  assert.equal(kinds.kindOf(ID), "port");
  fs.writeFileSync(path.join(dir, "kinds.json"), "{ broken");
  assert.equal(kinds.kindOf(ID), "port");
  edit("kinds.json", {});
  assert.equal(kinds.kindOf(ID), "tool");
});
