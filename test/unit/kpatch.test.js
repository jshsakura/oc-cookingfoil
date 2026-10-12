import { test } from "node:test";
import assert from "node:assert/strict";
import { baseIdsIn } from "../../scripts/kpatch/lib/ids.mjs";
import { sourcesIn, pickGithubAsset } from "../../scripts/kpatch/lib/sources.mjs";
import { packageKind, toSdRoot } from "../../scripts/kpatch/lib/layout.mjs";
import { resolveTitleId } from "../../scripts/kpatch/lib/resolve.mjs";
import { latestPerTitle, decide } from "../../scripts/kpatch/lib/plan.mjs";
import { newestUpload } from "../../scripts/kpatch/lib/fetchers.mjs";
import { gameVersionNote, patchMeta } from "../../scripts/kpatch/lib/install.mjs";
import { baseIdsInNames } from "../../scripts/kpatch/lib/library.mjs";

const TID = "010078400F7B0000";

test("only base title ids are picked out of a page, upper-cased and once each", () => {
  const html = "게임은 010099a00bc1e000 + 업데이트 010099A00BC1E800, DLC 01005F201D535001, 다시 010099A00BC1E000";
  assert.deepEqual(baseIdsIn(html), ["010099A00BC1E000"]);
  assert.deepEqual(baseIdsIn("no ids here 12345"), []);
});

test("distribution links are sorted by what can fetch them", () => {
  const html = `
    <a href="https://pixeldrain.com/u/FwYe4Xoj">x</a>
    https://github.com/lf-idonotknow/FTC-Part2-NSW-Korean-Patch/releases/tag/v0.9.1
    https://drive.google.com/file/d/1oBNpYgfchbxlH9b1ZqtLQx_3fzh94w2o/view?usp&#x3D;sharing
    https://gofile.io/d/uWlkbkm2  https://m.dcinside.com/mini/nintendo_sw_cfw/43998
    https://store.steampowered.com/app/1/`;
  const got = sourcesIn(html);
  assert.deepEqual(got.find((s) => s.type === "pixeldrain"), { type: "pixeldrain", id: "FwYe4Xoj", url: "https://pixeldrain.com/u/FwYe4Xoj" });
  assert.deepEqual(got.find((s) => s.type === "github"), { type: "github", repo: "lf-idonotknow/FTC-Part2-NSW-Korean-Patch", url: "https://github.com/lf-idonotknow/FTC-Part2-NSW-Korean-Patch" });
  assert.equal(got.find((s) => s.type === "gdrive").id, "1oBNpYgfchbxlH9b1ZqtLQx_3fzh94w2o");
  assert.ok(got.some((s) => s.type === "gofile"));
  assert.ok(got.some((s) => s.type === "dcinside"));
  assert.ok(!got.some((s) => /steam/.test(s.url)), "store pages are not sources");
});

test("a release asset is picked for the Switch, never a PC tool or another console", () => {
  const moon = ["0100E1800EFCE000.zip", "moon-korean-eden-v2.0.zip", "moon-windows-korean-final.zip", "Moon_PS1_Korean_Patch_v2.0.zip", "SHA256SUMS.txt"];
  assert.equal(pickGithubAsset(moon.map((name) => ({ name })), "0100E1800EFCE000").name, "0100E1800EFCE000.zip");
  const nobu = ["NobunagaShinsei_KR_for_1.1.4_vanilla.zip", "NobunagaShinsei_KR_for_1.1.7_PUK.zip", "NobunagaShinsei_KR_for_1.1.5_PUK.zip"];
  assert.equal(pickGithubAsset(nobu.map((name) => ({ name }))).name, "NobunagaShinsei_KR_for_1.1.7_PUK.zip", "newest game version wins");
  assert.equal(pickGithubAsset([{ name: "OnePiece_UWR_Switch_KR_PatchTool_V1.exe" }]), null);
  assert.equal(pickGithubAsset([{ name: "Pawa2024KR_v2.0_main.xdelta" }, { name: "Pawa2024KR_tools.zip" }]), null);
});

test("a package is LayeredFS only when it carries romfs/exefs for the game", () => {
  assert.equal(packageKind([`atmosphere/contents/${TID.toLowerCase()}/romfs/a.bin`, "licenses/OFL.txt"]), "layeredfs");
  assert.equal(packageKind(["romfs/Data/a.assets"]), "layeredfs");
  assert.equal(packageKind([`${TID}/romfs/Data/a`, `${TID}/manifest.json`]), "layeredfs");
  assert.equal(packageKind(["1패치 방법.txt", "1patch_all.bat", "xdelta/a.xdelta"]), "xdelta");
  assert.equal(packageKind(["romfs/rhapsody.vfs.xdelta", "exefs/main.xdelta"]), "xdelta", "romfs folders full of deltas still need the game");
  assert.equal(packageKind(["Patcher.exe", "data.bin"]), "patcher");
  assert.equal(packageKind(["Patcher.exe", "romfs/a.bin"]), "patcher", "a tool beside bare romfs builds its output");
  assert.equal(packageKind(["install.bat", `atmosphere/contents/${TID}/romfs/a`]), "layeredfs", "an SD-ready tree wins over a helper script");
  assert.equal(packageKind(["readme.txt"]), "unknown");
});

test("packages are laid out from the SD root under the game's id", () => {
  const { files, dropped } = toSdRoot([
    "romfs/Data/a.assets",
    "exefs/main",
    "README.md",
  ], TID);
  assert.deepEqual(files.map((f) => f.to), [`atmosphere/contents/${TID}/romfs/Data/a.assets`, `atmosphere/contents/${TID}/exefs/main`]);
  assert.deepEqual(dropped, ["README.md"]);

  const toki = toSdRoot([
    `patch/atmosphere/contents/${TID}/romfs/x`,
    "patch/atmosphere/contents/01005F201D535001/romfs/dlc",
    "patch/atmosphere/exefs_patches/Kbd/AB.ips",
    `patch/emulator_mod/${TID}/Mod/romfs/x`,
  ], TID);
  assert.deepEqual(toki.files.map((f) => f.to), [`atmosphere/contents/${TID}/romfs/x`, "atmosphere/exefs_patches/Kbd/AB.ips"]);
  assert.equal(toki.dropped.length, 2, "DLC and emulator copies are left out");

  const metro = toSdRoot([`${TID}/romfs/Data/level0`, `${TID}/manifest.json`], TID);
  assert.deepEqual(metro.files.map((f) => f.to), [`atmosphere/contents/${TID}/romfs/Data/level0`]);

  const lower = toSdRoot([`atmosphere/contents/${TID.toLowerCase()}/romfs/s`], TID);
  assert.equal(lower.files[0].to, `atmosphere/contents/${TID}/romfs/s`);
});

test("a title id is only settled when the evidence points at one game", () => {
  const index = new Map([
    ["010078400F7B0000", { JP: "ファミコン探偵倶楽部 うしろに立つ少女" }],
    ["0100D670126F6000", { US: "Famicom Detective Club: The Girl Who Stands Behind" }],
    ["0100BC501355A000", { JP: "電車でＧＯ！！ はしろう山手線" }],
  ]);
  assert.deepEqual(resolveTitleId({ ids: ["010078400F7B0000"] }, index), { tid: "010078400F7B0000", by: "page" });
  assert.deepEqual(resolveTitleId({ ids: [], fileIds: ["0100BC501355A000"] }, index), { tid: "0100BC501355A000", by: "file" });
  const two = resolveTitleId({ ids: ["010078400F7B0000", "0100D670126F6000"] }, index);
  assert.equal(two.tid, null);
  assert.deepEqual(two.candidates, ["010078400F7B0000", "0100D670126F6000"]);
  assert.equal(resolveTitleId({ ids: ["0100000000010000"] }, index).tid, null, "an id that isn't in titledb is not trusted");
  assert.equal(resolveTitleId({ ids: [] }, index).tid, null);
});

test("each game keeps only its newest post", () => {
  const items = [
    { tid: TID, date: "2026-07-31", key: "a" },
    { tid: TID, date: "2026-08-08", key: "b" },
    { tid: null, date: "2026-09-01", key: "c" },
    { tid: "0100BC501355A000", date: "2026-10-06", key: "d" },
  ];
  assert.deepEqual(latestPerTitle(items).map((i) => i.key).sort(), ["b", "c", "d"]);
  const unread = [{ tid: TID, date: null, key: "members-only" }, { tid: TID, date: "2026-08-06", key: "readable" }];
  assert.equal(latestPerTitle(unread)[0].key, "readable", "a post with no date never beats a dated one");
  assert.equal(latestPerTitle([...unread].reverse())[0].key, "readable");
});

test("installed patches are replaced only when this tool put them there", () => {
  const item = { tid: TID, version: "0.9.1", sourceUrl: "u" };
  assert.equal(decide(item, { exists: false }), "install");
  assert.equal(decide(item, { exists: true, tracked: { version: "0.9.1", sourceUrl: "u" } }), "skip");
  assert.equal(decide(item, { exists: true, tracked: { version: null, sourceUrl: "u" } }), "skip", "same upload, the post just states a version now");
  assert.equal(decide(item, { exists: true, tracked: { version: "0.9.0", sourceUrl: "old" } }), "replace");
  assert.equal(decide(item, { exists: true, tracked: null }), "exists-manual");
  assert.equal(decide(item, { exists: true, tracked: null }, { force: true }), "replace");
});

test("of several uploads in one post, the newest patch is fetched, not an add-on", () => {
  const aipri = [
    { name: "010038C020AEE000.zip", uploaded: "2026-07-27T10:00:00Z", size: 90 },
    { name: "010038C020AEE000.zip", uploaded: "2026-07-28T10:00:00Z", size: 100 },
  ];
  assert.equal(newestUpload(aipri).uploaded, "2026-07-28T10:00:00Z");
  const nurse = [
    { name: "01009F1023506000.zip", uploaded: "2026-08-03T01:00:00Z", size: 73230301 },
    { name: "01009F1023506000_name_input_bypass.zip", uploaded: "2026-08-03T01:00:00Z", size: 1542 },
  ];
  assert.equal(newestUpload(nurse).name, "01009F1023506000.zip");
});

test("the library's games are read from its file names, updates and DLC aside", () => {
  const owned = baseIdsInNames([
    "Kero Blaster [0100DA200A09A000][v0].nsp",
    "Kero Blaster [0100DA200A09A800][v65536].nsp",
    "Past Opening Movies [0100D1C01C195004][v0].nsp",
    "0100C4E013E5E000.zip",
  ]);
  assert.deepEqual([...owned], ["0100DA200A09A000"]);
});

test("patch.json says which game version a build is for, and where it came from", () => {
  assert.equal(gameVersionNote("NobunagaShinsei_KR_for_1.1.7_PUK.zip"), "게임 1.1.7 (파워업키트) 대응입니다.");
  assert.equal(gameVersionNote("0100E1800EFCE000.zip"), null);
  assert.deepEqual(patchMeta({ version: "4.5", articleUrl: "https://cafe.naver.com/beeshass/44989", note: "게임 1.1.7 대응입니다." }), {
    name: "한글패치", version: "4.5", description: "게임 1.1.7 대응입니다. 원본: https://cafe.naver.com/beeshass/44989",
  });
});
