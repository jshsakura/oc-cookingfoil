import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// /api/patches names the game of a patch the shop does not list, so the client
// can label it: the name, the name in each shop language, and the icon.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "patch-game-block-"));
const patches = path.join(root, "patches");
process.env.COOK_DATA_DIR = root;
process.env.COOK_PATCHES_DIR = patches;
const TID = "0100ABCD00000000";
fs.mkdirSync(path.join(root, "titledb"), { recursive: true });
for (const [file, name] of [["KR.ko.json", "한국어 이름"], ["US.en.json", "English Name"], ["JP.ja.json", "日本語の名前"], ["HK.zh.json", "中文名稱"]]) {
  fs.writeFileSync(path.join(root, "titledb", file), JSON.stringify({ x: { id: TID, name, iconUrl: "https://cdn.example.com/icon.jpg" } }));
}
// Its icon, read from the game file before the server starts.
fs.mkdirSync(path.join(root, "icons"), { recursive: true });
fs.writeFileSync(path.join(root, "icons", `${TID}.jpg`), "icon");
fs.mkdirSync(path.join(patches, TID, "Cheats", `atmosphere/contents/${TID}/cheats`), { recursive: true });
fs.writeFileSync(path.join(patches, TID, "Cheats", `atmosphere/contents/${TID}/cheats/ABCDEF0123456789.txt`), "[x]");

const titledb = await import("../../src/meta/titledb-store.js");
const userPatches = await import("../../src/meta/user-patches.js");
const { default: patchesRouter } = await import("../../src/routes/patches.js");
await titledb.load();

const app = express();
app.use("/api/patches", patchesRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await userPatches.hashed();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a patch for a game the shop does not list carries its name, names in each language titledb has and icon", async () => {
  let patch;
  for (let i = 0; i < 40 && !patch; i++) {
    const body = await (await fetch(`${BASE}/api/patches?lang=ko`)).json();
    patch = body.patches.find((p) => p.title_id === TID && !body.scanning);
    if (!patch) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(patch, "the patch is listed");
  assert.equal(typeof patch.game.name, "string");
  assert.ok(patch.game.name.length > 0);
  assert.deepEqual(patch.game.names, { ko: "한국어 이름", en: "English Name", ja: "日本語の名前", "zh-Hant": "中文名稱" }, "Hong Kong's Chinese is traditional");
  assert.match(patch.game.icon, new RegExp(`^${BASE}/api/library/icon/${TID}`), "an absolute icon the shop serves");
});
