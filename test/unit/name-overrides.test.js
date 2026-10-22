import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Names the admin gives games and retro games, over titledb's and the file's.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-names-"));
const gameDescriptions = await import("../../src/meta/game-descriptions.js");
const { ownDisplayName, rebuildFileItem } = await import("../../src/create-index-content.js");
const titledbStore = await import("../../src/meta/titledb-store.js");
const retroNames = await import("../../src/retro/names.js");

const TID = "0100000000010000";

test("a game name is one line, both languages empty forget it", () => {
  assert.equal(gameDescriptions.set(TID, "name", { ko: "  깨진\n 이름 고침 ", en: "Fixed Name" }), true);
  assert.deepEqual(gameDescriptions.names(TID), { en: "Fixed Name", ko: "깨진 이름 고침" });
  assert.deepEqual(titledbStore.namesOf(TID), { en: "Fixed Name", ko: "깨진 이름 고침" });
  gameDescriptions.set(TID, "name", { ko: "", en: "" });
  assert.equal(gameDescriptions.names(TID), null);
});

test("the shown name follows the display language and carries the English one", () => {
  assert.equal(ownDisplayName({ ko: "별의 노래", en: "Star Song" }, ["ko", "en"]), "별의 노래 (Star Song)");
  assert.equal(ownDisplayName({ ko: "별의 노래", en: "Star Song" }, ["en", "ko"]), "Star Song");
  assert.equal(ownDisplayName({ ko: "별의 노래" }, ["en"]), "별의 노래");
  assert.equal(ownDisplayName({ ko: "Star Song 한글판", en: "Star Song" }, ["ko"]), "Star Song 한글판");
});

test("a retro game name is kept by its id; empty goes back to the file's", () => {
  assert.equal(retroNames.set("snes-0123456789", { ko: "한글 이름", en: "" }), true);
  assert.deepEqual(retroNames.get("snes-0123456789"), { ko: "한글 이름" });
  retroNames.set("snes-0123456789", {});
  assert.equal(retroNames.get("snes-0123456789"), null);
  assert.equal(retroNames.set("../x", { ko: "a" }), false);
});

test("a description saved by an older version, languages at the top, still reads as the description", () => {
  const read = gameDescriptions.normalize({ "0100B00B51230000": { en: "A port.", ko: "포팅판입니다." }, "0100000000020000": { notes: { ko: "메모" } } });
  assert.deepEqual(read["0100B00B51230000"], { description: { en: "A port.", ko: "포팅판입니다." } });
  assert.deepEqual(read["0100000000020000"], { notes: { ko: "메모" } });
});

test("a file item built again from the one held picks up a new name and keeps its size and date", () => {
  const rel = `Some Game [${TID}][v0].nsp`;
  const held = rebuildFileItem(rel, { size: 1234, mtime: 1700000000 });
  gameDescriptions.set(TID, "name", { ko: "새 이름", en: "" });
  const again = rebuildFileItem(rel, held);
  gameDescriptions.set(TID, "name", { ko: "", en: "" });
  assert.equal(again.name, "새 이름");
  assert.notEqual(again.name, held.name);
  assert.equal(again.version, 0);
  assert.equal(again.size, 1234);
  assert.equal(again.mtime, 1700000000);
});

test("the shown name comes from any language the admin named it in, the server's order first", () => {
  assert.equal(ownDisplayName({ ja: "日本語の名前" }, ["ko", "en"]), "日本語の名前");
  assert.equal(ownDisplayName({ "zh-Hant": "繁體名稱", en: "Name" }, ["zh-TW", "en"]), "繁體名稱 (Name)");
});
