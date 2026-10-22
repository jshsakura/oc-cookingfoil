import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The store reads COOK_DATA_DIR at import; point it at a scratch folder first.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "game-desc-"));
process.env.COOK_DATA_DIR = root;
// What an older server kept in one file; it moves into the folders on the first read.
const OLD = "0100D7000C2C6000";
fs.writeFileSync(path.join(root, "game-descriptions.json"), JSON.stringify({ [OLD]: { name: { ko: "괴혼 앙코르" }, en: "Roll it up.", ko: null } }));
const { get, set, reset, describe, notes, edited, names, GAMES_DIR, folderName } = await import("../../src/meta/game-descriptions.js");
const ID = "0100B00B51230000";
const folderOf = (id) => fs.readdirSync(GAMES_DIR).find((d) => d.endsWith(`[${id}]`));

test("game-descriptions.json moves into one folder per game, named after the game, and is then gone", () => {
  assert.deepEqual(get(OLD), { name: { en: null, ko: "괴혼 앙코르" }, description: { en: "Roll it up.", ko: null }, notes: null });
  assert.equal(folderOf(OLD), "괴혼 앙코르 [0100D7000C2C6000]");
  assert.ok(!fs.existsSync(path.join(root, "game-descriptions.json")), "nothing is kept twice");
  const json = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, folderOf(OLD), "game.json"), "utf8"));
  assert.equal(json.id, OLD);
  assert.equal(reset(OLD), true);
  assert.equal(folderOf(OLD), undefined, "an emptied folder goes too");
});

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

test("a game.json changed by hand shows at once, a renamed folder still counts, and a broken one is never written over", () => {
  set(ID, "name", { ko: "그랜드 테프트 오토 V" });
  const first = folderOf(ID);
  assert.equal(first, "그랜드 테프트 오토 V [0100B00B51230000]");
  const file = path.join(GAMES_DIR, first, "game.json");
  fs.writeFileSync(file, JSON.stringify({ id: ID, name: { en: "GTA V", ko: "GTA 5" } }));
  assert.deepEqual(names(ID), { en: "GTA V", ko: "GTA 5" }, "read again without a restart");

  fs.renameSync(path.join(GAMES_DIR, first), path.join(GAMES_DIR, "My own name [0100B00B51230000]"));
  assert.deepEqual(names(ID), { en: "GTA V", ko: "GTA 5" }, "the id in brackets finds it");
  set(ID, "notes", { ko: "메모" });
  assert.deepEqual(fs.readdirSync(GAMES_DIR).filter((d) => d.endsWith(`[${ID}]`)), ["My own name [0100B00B51230000]"], "written where it is now");

  const renamed = path.join(GAMES_DIR, "My own name [0100B00B51230000]", "game.json");
  fs.writeFileSync(renamed, "{ not json");
  assert.equal(get(ID), null);
  assert.throws(() => set(ID, "notes", { ko: "덮어쓰기" }), /cannot be read/);
  assert.equal(fs.readFileSync(renamed, "utf8"), "{ not json", "the hand edit is kept for the admin to fix");
  fs.rmSync(path.join(GAMES_DIR, "My own name [0100B00B51230000]"), { recursive: true });
});

test("a folder name keeps only what every disk accepts", () => {
  assert.equal(folderName("0100000000010000", 'A/B: "C"?  *D*.'), "A B C D [0100000000010000]");
  assert.equal(folderName("0100000000010000", "   "), "Game [0100000000010000]");
  assert.equal(folderName("0100000000010000", "x".repeat(200)).length, 80 + " [0100000000010000]".length);
});
