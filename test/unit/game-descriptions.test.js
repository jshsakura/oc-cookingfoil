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
const MERGE = "0100000000A10000";
const PICS = "0100000000A20000";
const LOWER = "0100000000a30000";
const BROKEN = "0100000000A40000";
const games = path.join(root, "metadata", "games");
const put = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(games, rel)), { recursive: true });
  fs.writeFileSync(path.join(games, rel), body);
};
put(`Merge [${MERGE}]/game.json`, JSON.stringify({ id: MERGE, description: { ko: "폴더 글", en: null } }));
put(`Pics [${PICS}]/icon.webp`, "WEBP");
put(`Broken [${BROKEN}]/game.json`, "{ not json");
fs.writeFileSync(path.join(root, "game-descriptions.json"), JSON.stringify({
  [OLD]: { name: { ko: "괴혼 앙코르" }, en: "Roll it up.", ko: null },
  [MERGE]: { description: { ko: "옛 글", en: "Old English" }, notes: { ko: "옛 메모" } },
  [PICS]: { notes: { en: "Has pictures" } },
  [LOWER]: { notes: { en: "Lower case id" } },
  [BROKEN]: { notes: { ko: "고장 난 폴더" } },
}));
const { get, set, reset, describe, notes, edited, names, locked, checkInput, GAMES_DIR, folderName } = await import("../../src/meta/game-descriptions.js");
// A change made by hand shows after the server's next look at the folders (every minute, or from the admin page).
const { scan } = await import("../../src/meta/game-meta.js");
const ID = "0100B00B51230000";
const folderOf = (id) => fs.readdirSync(GAMES_DIR).find((d) => d.endsWith(`[${id}]`));

test("game-descriptions.json moves into one folder per game, named after the game, and is then gone", () => {
  assert.deepEqual(get(OLD), { name: { en: null, ko: "괴혼 앙코르" }, description: { en: "Roll it up.", ko: null }, notes: null });
  assert.equal(folderOf(OLD), "괴혼 앙코르 [0100D7000C2C6000]");
  assert.equal(get(MERGE).description.ko, "폴더 글", "a game.json already there wins");
  assert.equal(get(MERGE).notes.ko, "옛 메모", "and gets the fields it lacked");
  assert.equal(get(MERGE).description.en, "Old English", "language by language");
  assert.equal(get(PICS).notes.en, "Has pictures");
  assert.ok(fs.existsSync(path.join(GAMES_DIR, `Pics [${PICS}]`, "game.json")), "written beside the pictures");
  assert.equal(get(LOWER.toUpperCase()).notes.en, "Lower case id");

  const legacy = JSON.parse(fs.readFileSync(path.join(root, "game-descriptions.json"), "utf8"));
  assert.deepEqual(Object.keys(legacy), [BROKEN], "what could not be moved stays in the old file, and only that");
  assert.equal(fs.readFileSync(path.join(GAMES_DIR, `Broken [${BROKEN}]`, "game.json"), "utf8"), "{ not json", "a broken game.json is never written over");
  assert.equal(get(BROKEN).notes.ko, "고장 난 폴더", "while it is broken, the old text still shows");
  fs.chmodSync(root, 0o555);
  try {
    assert.throws(() => reset(BROKEN, "notes"));
    assert.equal(get(BROKEN).notes.ko, "고장 난 폴더", "a forget the disk refused is not taken back only in memory");
  } finally {
    fs.chmodSync(root, 0o755);
  }
  fs.writeFileSync(path.join(GAMES_DIR, `Broken [${BROKEN}]`, "game.json"), JSON.stringify({ id: BROKEN, name: { en: "Fixed" } }));
  assert.equal(get(BROKEN).notes.ko, "고장 난 폴더", "once fixed by hand, the old text still shows");
  assert.equal(set(BROKEN, "description", { en: "Saved" }), true);
  assert.deepEqual(get(BROKEN), { name: { en: "Fixed", ko: null }, description: { en: "Saved", ko: null }, notes: { en: null, ko: "고장 난 폴더" } }, "saving moves the old text in");
  assert.ok(!fs.existsSync(path.join(root, "game-descriptions.json")), "nothing left: the old file is gone");
  for (const id of [MERGE, PICS, LOWER.toUpperCase(), BROKEN]) reset(id);
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

test("a game.json changed by hand shows after the next look, a renamed folder still counts, and a broken one is never written over", async () => {
  set(ID, "name", { ko: "그랜드 테프트 오토 V" });
  const first = folderOf(ID);
  assert.equal(first, "그랜드 테프트 오토 V [0100B00B51230000]");
  const file = path.join(GAMES_DIR, first, "game.json");
  fs.writeFileSync(file, JSON.stringify({ id: ID, name: { en: "GTA V", ko: "GTA 5" } }));
  await scan();
  assert.deepEqual(names(ID), { en: "GTA V", ko: "GTA 5" }, "read again without a restart");

  fs.renameSync(path.join(GAMES_DIR, first), path.join(GAMES_DIR, "My own name [0100B00B51230000]"));
  await scan();
  assert.deepEqual(names(ID), { en: "GTA V", ko: "GTA 5" }, "the id in brackets finds it");
  set(ID, "notes", { ko: "메모" });
  assert.deepEqual(fs.readdirSync(GAMES_DIR).filter((d) => d.endsWith(`[${ID}]`)), ["My own name [0100B00B51230000]"], "written where it is now");

  const renamed = path.join(GAMES_DIR, "My own name [0100B00B51230000]", "game.json");
  fs.writeFileSync(renamed, "{ not json");
  await scan();
  assert.equal(get(ID), null);
  assert.throws(() => set(ID, "notes", { ko: "덮어쓰기" }), /cannot be read/);
  assert.equal(fs.readFileSync(renamed, "utf8"), "{ not json", "the hand edit is kept for the admin to fix");
  fs.rmSync(path.join(GAMES_DIR, "My own name [0100B00B51230000]"), { recursive: true });
});

test("a folder name keeps only what every disk accepts", () => {
  assert.equal(folderName("0100000000010000", 'A/B: "C"?  *D*.'), "A B C D [0100000000010000]");
  assert.equal(folderName("0100000000010000", "   "), "Game [0100000000010000]");
  assert.equal(folderName("0100000000010000", "x".repeat(300)).length, 180 + " [0100000000010000]".length);
  const korean = folderName("0100000000010000", "가".repeat(120));
  assert.ok(Buffer.byteLength(korean) <= 255, "a long Korean name still fits a disk's 255 bytes");
  assert.equal(set("0100000000B10000", "name", { ko: "가".repeat(120) }), true);
  assert.equal(get("0100000000B10000").name.ko, "가".repeat(120), "the name itself is kept whole");
  reset("0100000000B10000");
});

test("a game.json put back with its old time and size still shows the new text", async () => {
  set(ID, "notes", { en: "AAAA" });
  const file = path.join(GAMES_DIR, folderOf(ID), "game.json");
  const { atime, mtime } = fs.statSync(file);
  assert.equal(notes(ID, "en"), "AAAA");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("AAAA", "BBBB"));
  fs.utimesSync(file, atime, mtime);
  await scan();
  assert.equal(notes(ID, "en"), "BBBB");
  reset(ID);
});

test("saving keeps what else a game.json holds, and lists the fields set by hand as locked", async () => {
  const KEEP = "0100000000C10000";
  const dir = path.join(GAMES_DIR, `Keep [${KEEP}]`);
  fs.mkdirSync(dir, { recursive: true });
  const match = { source: "titledb", id: KEEP, region: "KR" };
  fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify({ id: KEEP, match, mine: 1, locked: ["icon"] }));
  await scan();

  assert.deepEqual(locked(KEEP), ["icon"]);
  set(KEEP, "notes", { ko: "메모" });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "game.json"), "utf8"));
  assert.deepEqual(saved.match, match, "a key the server does not write here is kept");
  assert.equal(saved.mine, 1);
  assert.equal(saved.version, 1);
  assert.deepEqual(locked(KEEP), ["notes", "icon"]);

  reset(KEEP, "notes");
  assert.deepEqual(locked(KEEP), ["icon"], "forgetting a field unlocks it");
  assert.ok(fs.existsSync(path.join(dir, "game.json")), "the file stays while it holds anything else");
  assert.equal(get(KEEP), null);
  assert.deepEqual(locked("not-an-id"), []);
  fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify({ id: KEEP, name: { ko: "옛 서버" }, notes: { en: "old" } }));
  await scan();
  assert.deepEqual(locked(KEEP), ["name", "notes"], "a file written before the list: everything in it is the admin's");
  fs.rmSync(dir, { recursive: true });
});

test("a field written by hand as plain text, a later version and a file that is not an object survive a save", async () => {
  const HAND = "0100000000C20000";
  const dir = path.join(GAMES_DIR, `Hand [${HAND}]`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "game.json");
  fs.writeFileSync(file, JSON.stringify({ id: HAND, version: 2, description: "손으로 쓴 글", name: "Hand Name", locked: ["icon", "icon"] }));
  await scan();

  assert.equal(describe(HAND, "ko"), "손으로 쓴 글", "plain text with Hangul is Korean");
  assert.deepEqual(names(HAND), { en: "Hand Name" });
  set(HAND, "notes", { ko: "메모" });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.description, "손으로 쓴 글", "kept as written");
  assert.equal(saved.version, 2, "a later version is not taken back");
  assert.deepEqual(saved.locked, ["name", "description", "notes", "icon"], "no entry twice");

  fs.writeFileSync(file, "[1, 2]");
  assert.throws(() => set(HAND, "notes", { ko: "덮어쓰기" }), /cannot be read/);
  assert.equal(fs.readFileSync(file, "utf8"), "[1, 2]");
  fs.rmSync(dir, { recursive: true });
});

test("a name is kept per client language; one written as plain text is English without Hangul, Korean with it", async () => {
  const id = "0100000000C10000";
  assert.equal(set(id, "name", { ja: "日本語の名前", "zh-Hant": "繁體名稱", ko: "한국어 이름" }), true);
  assert.deepEqual(names(id), { ja: "日本語の名前", "zh-Hant": "繁體名稱", ko: "한국어 이름" });
  set(id, "name", { ja: "", de: "Deutscher Name" });
  assert.deepEqual(names(id), { "zh-Hant": "繁體名稱", ko: "한국어 이름", de: "Deutscher Name" }, "a language sent empty is forgotten, the ones not sent are kept");
  const file = path.join(GAMES_DIR, folderOf(id), "game.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).name, { ko: "한국어 이름", "zh-Hant": "繁體名稱", de: "Deutscher Name" });

  fs.writeFileSync(file, JSON.stringify({ id, name: "Hand Written", description: { fr: "Texte", xx: "ignored" } }));
  await scan();
  assert.deepEqual(names(id), { en: "Hand Written" }, "other languages reach it through the English fallback");
  assert.equal(describe(id, "fr"), "Texte");
  assert.equal(describe(id, "de"), null, "a German reader is not handed French: English, then Korean, else nothing");
  set(id, "notes", { en: "A note" });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).name, "Hand Written", "a plain name stays plain when another field is saved");
  set(id, "name", { ko: "한국어만" });
  assert.equal(names(id).ko, "한국어만");
  assert.deepEqual(names(id), { en: "Hand Written", ko: "한국어만" }, "a language set over a plain name keeps the plain one in its language");

  fs.writeFileSync(file, JSON.stringify({ id, description: "한국어로 쓴 소개" }));
  await scan();
  assert.deepEqual(get(id).description, { en: null, ko: "한국어로 쓴 소개" }, "plain text with Hangul is Korean only");
  set(id, "description", { ko: "한국어로 쓴 소개", de: "" });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).description, { ko: "한국어로 쓴 소개" }, "saved back as Korean, not as every language");
  const all = Object.fromEntries(["en", "ko", "ja", "zh", "zh-Hant", "es", "fr", "de", "it", "pt", "ru", "nl"].map((l) => [l, "Same"]));
  set(id, "name", all);
  assert.deepEqual(names(id), all, "the same text sent for every language still reads in every language");
  reset(id);
});

test("a name or text sent with an unknown language or too long is refused, saying why", () => {
  assert.equal(checkInput("name", { ko: "이름", "en-US": "Name" }), "알 수 없는 언어 키입니다: en-US. 쓸 수 있는 키는 en, ko, ja, zh, zh-Hant, es, fr, de, it, pt, ru, nl 입니다");
  assert.match(checkInput("name", { ko: "가".repeat(121) }), /이름\(ko\)은 120자를 넘을 수 없습니다/);
  assert.match(checkInput("description", { en: "x".repeat(2001) }), /2000자/);
  assert.match(checkInput("name", { ko: 3 }), /글자로/);
  assert.match(checkInput("name", ["x"]), /글자나 언어별 글자/);
  assert.equal(checkInput("name", { ko: "이름", en: "", ja: null }), null);
  assert.equal(checkInput("name", "Plain Name"), null);
});
