import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metaErrorText } from "../../src/meta/meta-messages.js";

// A patch's information lives in the server's store; patch.json is only imported, once.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "patch-info-"));
process.env.COOK_DATA_DIR = DATA;
const patchInfo = await import("../../src/meta/patch-info.js");
const { scan, list, forTitle, reset, hashed, loadCache, locate, infoOf } = await import("../../src/meta/user-patches.js");
const { editedInfo } = await import("../../src/routes/admin/patches-api.js");

const TID = "0100000000010000";
const OTHER = "0100000000020000";
const STORE = path.join(DATA, "patches", "info.json");
const cheat = (tid) => `atmosphere/contents/${tid}/cheats/0123456789ABCDEF.txt`;

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patch-info-root-"));
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  return { root, put };
}
const stored = () => JSON.parse(fs.readFileSync(STORE, "utf8")).patches;

beforeEach(async () => {
  await hashed();
  reset();
});

test("keys name the game (in capitals) or the homebrew app, and the folder in NFC", () => {
  assert.equal(patchInfo.keyOf(TID.toLowerCase(), "한글패치".normalize("NFD")), `${TID}/한글패치`);
  assert.equal(patchInfo.keyOf("homebrew/my-app", "60fps"), "homebrew/my-app/60fps");
  for (const [dir, folder] of [["nope", "a"], [TID, ""], [TID, "a/b"], ["homebrew/../x", "a"]]) assert.equal(patchInfo.keyOf(dir, folder), null, `${dir} ${folder}`);
});

test("an edit is checked against the limits and keeps what it leaves out", () => {
  assert.deepEqual(patchInfo.validate({ name: " 60 FPS ", version: "", ko: { description: "초당 60프레임" } }), { name: "60 FPS", ko: { description: "초당 60프레임" } });
  for (const [bad, why] of [[{}, /이름/], [{ name: "a".repeat(121) }, /이름은 120자/], [{ name: "a", author: "b".repeat(121) }, /만든 사람은 120자/],
    [{ name: "a", game_version: "1".repeat(41) }, /게임 버전은 40자/], [{ name: "a", description: "d".repeat(2001) }, /설명은 2000자/],
    [{ name: "a", ko: { name: "가".repeat(121) } }, /한국어 이름/], [{ name: "a", ko: [] }, /ko/], [{ name: "a", version: 2 }, /글자/],
    [{ name: "a", required: 1 }, /required/], [{ name: "a", update_version: "1.5" }, /업데이트/], ["text", /JSON/]]) {
    // The admin page reads it in its language by the code; the message itself is English.
    assert.throws(() => patchInfo.validate(bad), (err) => err instanceof patchInfo.InfoError && why.test(metaErrorText("ko", err)) && !/[가-힣]/.test(err.message), JSON.stringify(bad));
  }
  assert.throws(() => patchInfo.validate({ name: "a", author: "b".repeat(121) }), { message: "The author may be at most 120 characters", code: "info.tooLong" });
  const old = { name: "old", required: true, update_version: 2097152, game_version: "1.0.32.0", author: "x" };
  assert.deepEqual(editedInfo(old, { name: "new" }), { name: "new", required: true, update_version: 2097152, game_version: "1.0.32.0" },
    "the author is a text field and goes; required and the versions stay");
  assert.deepEqual(editedInfo(old, { name: "new", required: false, update_version: "", game_version: "" }), { name: "new" });
});

test("a patch.json is imported once; after that the store wins even when the file changes", async () => {
  const { root, put } = makeRoot();
  put(`${TID}/Korean/${cheat(TID)}`, "[x]");
  put(`${TID}/Korean/patch.json`, JSON.stringify({ name: "Korean patch", version: "1.0", ko: { name: "한글패치" }, source: "dropped" }));
  await scan({ root });
  assert.deepEqual(stored()[`${TID}/Korean`], { info: { name: "Korean patch", version: "1.0", ko: { name: "한글패치" } }, missing_since: null });
  assert.equal(forTitle(TID)[0].name, "Korean patch");

  // The operator edits patch.json by hand later: ignored.
  put(`${TID}/Korean/patch.json`, JSON.stringify({ name: "Changed by hand" }));
  await scan({ root });
  assert.equal(forTitle(TID)[0].name, "Korean patch");

  // An edit from the admin page shows at once, without a rescan.
  const id = forTitle(TID)[0].id;
  patchInfo.set(locate(id).key, editedInfo(infoOf(id), { name: "Edited", description: "From the admin page" }));
  const [shown] = await list({ root });
  assert.deepEqual([shown.name, shown.description, shown.version], ["Edited", "From the admin page", null]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, TID, "Korean", "patch.json"), "utf8")).name, "Changed by hand", "the server never writes patch.json");
});

test("a folder with no patch.json shows the defaults, and one dropped in later is imported", async () => {
  const { root, put } = makeRoot();
  put(`${TID}/Plain/${cheat(TID)}`, "[x]");
  await scan({ root });
  const [p] = forTitle(TID);
  assert.deepEqual([p.name, p.version, p.author, p.description, p.required, p.update_version, "ko" in p], ["Plain", null, null, null, false, null, false]);
  assert.equal(fs.existsSync(STORE), false, "nothing stored for a patch that shows the defaults");

  put(`${TID}/Plain/patch.json`, "{ not json");
  await scan({ root });
  assert.equal(fs.existsSync(STORE), false, "an unreadable patch.json is not taken in, and is tried again");
  put(`${TID}/Plain/patch.json`, JSON.stringify({ name: "Plain cheats", required: true }));
  await scan({ root });
  assert.deepEqual([forTitle(TID)[0].name, forTitle(TID)[0].required], ["Plain cheats", true]);
});

test("a missing folder's entry is kept for 30 days, so a rename back or a remount loses nothing", async () => {
  const { root, put } = makeRoot();
  put(`${TID}/Mod/${cheat(TID)}`, "[x]");
  put(`${TID}/Mod/patch.json`, JSON.stringify({ name: "From file" }));
  put(`homebrew/my-app/Mod/data.bin`, "x");
  await scan({ root });
  patchInfo.set(`${TID}/Mod`, { name: "Edited" });

  fs.renameSync(path.join(root, TID, "Mod"), path.join(root, TID, "Mod (old)"));
  const before = Date.now();
  await scan({ root });
  const kept = stored()[`${TID}/Mod`];
  assert.equal(kept.info.name, "Edited");
  assert.ok(kept.missing_since >= before, "marked missing, not dropped");
  assert.equal(forTitle(TID)[0].name, "From file", "the renamed folder is a new patch and imports its patch.json");

  fs.rmSync(path.join(root, TID, "Mod (old)"), { recursive: true });
  put(`${TID}/Mod/${cheat(TID)}`, "[x]");
  put(`${TID}/Mod/patch.json`, JSON.stringify({ name: "From file" }));
  await scan({ root });
  assert.equal(forTitle(TID)[0].name, "Edited", "back under its name: the edit is there, the patch.json not imported over it");
  assert.equal(stored()[`${TID}/Mod`].missing_since, null);

  // Gone for good: dropped once missing for longer than 30 days.
  fs.rmSync(path.join(root, TID), { recursive: true });
  await scan({ root });
  assert.ok(stored()[`${TID}/Mod`].missing_since);
  assert.equal(patchInfo.sweep(["homebrew/my-app/Mod"], Date.now() + patchInfo.RETAIN_MS - 60_000), false, "29 days and change: still kept");
  assert.equal(patchInfo.sweep(["homebrew/my-app/Mod"], Date.now() + patchInfo.RETAIN_MS + 60_000), true);
  assert.equal(stored()[`${TID}/Mod`], undefined);
  assert.equal(patchInfo.get(`${TID}/Mod (old)`), null);
});

test("moving a patch to another game moves its entry; removing drops it", () => {
  patchInfo.set(`${TID}/Mod`, { name: "Edited", required: true });
  assert.equal(patchInfo.move(`${TID}/Mod`, `${OTHER}/Mod`), true);
  assert.equal(patchInfo.get(`${TID}/Mod`), null);
  assert.deepEqual(patchInfo.get(`${OTHER}/Mod`), { name: "Edited", required: true });
  assert.equal(patchInfo.move(`${TID}/Mod`, `${OTHER}/Mod`), false, "nothing left to move");
  assert.equal(patchInfo.remove(`${OTHER}/Mod`), true);
  assert.deepEqual(stored(), {});
});

test("a listing saved by an older version keeps its names until the first scan imports them", async () => {
  const { root, put } = makeRoot();
  put(`${TID}/Mod/${cheat(TID)}`, "[x]");
  put(`${TID}/Mod/patch.json`, JSON.stringify({ name: "From file", author: "someone" }));
  // What an older version saved: the patch.json fields baked into the listing.
  const cacheFile = path.join(root, "..", `${path.basename(root)}.json`);
  fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, hashes: {}, patches: [{
    id: `${TID}-000000000000`, title_id: TID, name: "From file", author: "someone", version: null, game_version: null, update_version: null,
    description: null, required: false, kinds: ["cheats"], files: 1, size: 3, updated_at: 1, hash: null, dir: TID, folder: "Mod",
  }] }));
  assert.equal(loadCache(cacheFile), true);
  assert.equal(forTitle(TID)[0].name, "From file", "not the folder name while the store is still empty");
  await scan({ root, cacheFile });
  assert.deepEqual(stored()[`${TID}/Mod`].info, { name: "From file", author: "someone" });
  assert.equal(forTitle(TID)[0].author, "someone");
});
