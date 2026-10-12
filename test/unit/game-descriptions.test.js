import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The store reads COOK_DATA_DIR at import; point it at a scratch folder first.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "game-desc-"));
process.env.COOK_DATA_DIR = root;
const { get, set, reset, describe, notes, edited } = await import("../../src/meta/game-descriptions.js");
const ID = "0100B00B51230000";

test("the admin's description wins per language, with line breaks kept as written", () => {
  assert.equal(describe(ID, "ko", "titledb"), "titledb", "never edited: the source's own text");
  assert.equal(set(ID, "description", { ko: "네이티브 포팅판입니다.\n오버클럭이 필요할 수 있습니다.", en: "A native port.\r\nOverclocking may be needed." }), true);
  assert.deepEqual(get(ID).description, { ko: "네이티브 포팅판입니다.\n오버클럭이 필요할 수 있습니다.", en: "A native port.\nOverclocking may be needed." });
  assert.equal(describe(ID, "ko"), "네이티브 포팅판입니다.\n오버클럭이 필요할 수 있습니다.");
  assert.equal(describe(ID, "ja"), "A native port.\nOverclocking may be needed.", "other languages read the English text");
  set(ID, "description", { ko: "한국어만", en: null });
  assert.equal(describe(ID, "en", "titledb"), "한국어만", "what the admin wrote beats a missing language");
  set(ID, "description", { ko: null, en: "" });
  assert.equal(get(ID), null, "both empty forgets the edit");
  assert.equal(describe(ID, "ko", "titledb"), "titledb", "nothing left: the source's own text again");
});

test("notes stand apart from the description: clearing one keeps the other", () => {
  set(ID, "notes", { ko: "게임 데이터 패치(약 49GB)를 함께 설치합니다.", en: "Install the game data mod (about 49 GB) with it." });
  set(ID, "description", { en: "A native port." });
  assert.equal(notes(ID, "ko"), "게임 데이터 패치(약 49GB)를 함께 설치합니다.");
  assert.equal(notes(ID, "ja"), "Install the game data mod (about 49 GB) with it.");
  assert.equal(notes("0100000000010000", "ko"), null, "no notes: none, never titledb's");
  assert.deepEqual(edited(), [ID]);
  assert.equal(reset(ID, "description"), true);
  assert.equal(describe(ID, "en", "titledb"), "titledb");
  assert.equal(notes(ID, "en"), "Install the game data mod (about 49 GB) with it.", "the notes stay");
  assert.equal(reset(ID, "description"), false, "nothing to forget anymore");
  assert.equal(reset(ID), true);
  assert.equal(get(ID), null);
});

test("only a base title id and a known field are accepted", () => {
  assert.equal(set("not-a-title-id", "notes", { en: "x" }), false);
  assert.equal(set("0100b00b51230000", "notes", { en: "x" }), false, "lower case is not a title id as written in files");
  assert.equal(set(ID, "rating", { en: "x" }), false);
});
