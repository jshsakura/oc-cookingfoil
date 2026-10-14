import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { buildGroups, compareVersions, englishTitle, groupKey, localTitle, representative, tagDate } from "../../src/retro/variants.js";

// Versions of one game on one system are one card; names that differ in any word stay apart.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-variants-"));
process.env.COOK_DATA_DIR = root;
process.env.COOK_RETRO_DIR = path.join(root, "retro");
process.env.COOK_RATING_SYNC = "false";
const retro = process.env.COOK_RETRO_DIR;

let n = 0;
const game = (system, name, extra = {}) => ({ id: `${system}-${String(++n).padStart(10, "0")}`, system, name, file: `${name}.zip`, rel: `${name}.zip`, addedAt: n, ...extra });
const groupsOf = (games) => [...buildGroups(games).values()].map((g) => g.members.map((m) => m.name));

test("the English title is the part in parentheses, or the whole name without tags", () => {
  assert.equal(englishTitle("더 슈퍼 시노비 2 (Super Shinobi II, The) [J-K v20130609]"), "Super Shinobi II, The");
  assert.equal(englishTitle("Super Mario World (USA)"), "Super Mario World");
  assert.equal(englishTitle("Chrono Trigger"), "Chrono Trigger");
  assert.equal(localTitle("더 슈퍼 시노비 2 (Super Shinobi II, The) [Japan, Korea]"), "더 슈퍼 시노비 2");
  assert.equal(localTitle("Chrono Trigger (USA)"), "");
});

test("a patch and an official release of one game are one group, the official release first", () => {
  const groups = groupsOf([
    game("md", "더 슈퍼 시노비 2 (Super Shinobi II, The) [J-K v20130609]"),
    game("md", "더 슈퍼 시노비 2 (Super Shinobi II, The) [Japan, Korea]"),
  ]);
  assert.deepEqual(groups, [["더 슈퍼 시노비 2 (Super Shinobi II, The) [Japan, Korea]", "더 슈퍼 시노비 2 (Super Shinobi II, The) [J-K v20130609]"]]);
});

test("different games with similar names are not merged", () => {
  // Two titles that share words, a hack of one game, and a patch split in halves.
  const pairs = [
    ["강철의 연금술사 - 미상의 론도 (Full Metal Alchemist - Meisou no Rondo) [J-K v20260529 v0.1]", "강철의 연금술사 - 미주의 윤무곡 (Hagane no Renkinjutsushi - Meisou no Rondo) [J-K v20260611]"],
    ["강철의 연금술사 (Hagane no Renkinjutsushi) [K]", "강철의 연금술사 - 미주의 윤무곡 (Hagane no Renkinjutsushi - Meisou no Rondo) [J-K v20260611]"],
    ["포켓몬스터 - 금 (Pocket Monsters Geum) [Korea]", "포켓몬스터 - 금 moe (Pocket Monsters Geum) [Korea]"],
    ["스타 오션 (Star Ocean) [J-K v20201103 Part.A]", "스타 오션 (Star Ocean) [J-K v20201103 Part.B]"],
    ["어드밴스 워즈 (Advance Wars) [K]", "어드밴스 워즈 2 (Advance Wars 2 - Black Hole Rising) [K]"],
  ];
  for (const [a, b] of pairs) assert.equal(groupsOf([game("gba", a), game("gba", b)]).length, 2, `${a} / ${b}`);
  assert.equal(groupsOf([game("gba", "Tetris (World)"), game("gb", "Tetris (World)")]).length, 2, "one system at a time");
});

test("punctuation and case do not split a game", () => {
  const groups = groupsOf([game("nds", "아자! 싸워라! 응원단! (Osu! Tatakae! Ouendan) [J-K v20260216]"), game("nds", "아자! 싸워라! 응원단 (Osu! Tatakae! Ouendan) [K]")]);
  assert.equal(groups.length, 1);
});

test("the newest Korean patch leads: its version, then the date in its tags", () => {
  assert.ok(compareVersions("v0.99b", "v0.99") > 0);
  assert.ok(compareVersions("v1.10", "v1.9") > 0);
  assert.equal(tagDate("J-K v20250419"), 20250419);
  const order = (names) => groupsOf(names.map((x) => game("gba", x)))[0];
  assert.deepEqual(order(["굿보이 갤럭시 (Goodboy Galaxy) [W-K v20250413 Rumble-patch]", "굿보이 갤럭시 (Goodboy Galaxy) [J-K v20250419]"])[0], "굿보이 갤럭시 (Goodboy Galaxy) [J-K v20250419]");
  assert.deepEqual(order(["슈퍼로봇대전 J (Super Robot Taisen J) [K]", "슈퍼로봇대전 J (Super Robot Taisen J) [J-K v20260805 v2.1.1]"])[0], "슈퍼로봇대전 J (Super Robot Taisen J) [J-K v20260805 v2.1.1]");
  assert.deepEqual(order(["요시의 쿠키 (Yoshi no Cookie) [J-K v20080101]", "요시의 쿠키 (Yoshi no Cookie) [J-K v20231030 v1.0]"])[0], "요시의 쿠키 (Yoshi no Cookie) [J-K v20231030 v1.0]");
  assert.deepEqual(order(["카이 (Kai) [J-K v20200101 v0.99b]", "카이 (Kai) [J-K v20210101 v0.99]"])[0], "카이 (Kai) [J-K v20200101 v0.99b]", "the version before the date");
  // Without Korean: World, then USA, then Japan.
  assert.deepEqual(order(["Gley Lancer (Japan)", "Gley Lancer (USA)", "Gley Lancer (World)"])[0], "Gley Lancer (World)");
});

test("an admin's pick wins while it is in the group", () => {
  const a = game("nes", "젤다 2 (Zelda II) [U-K v20250222 v2 font.pkmn]");
  const b = game("nes", "젤다 2 (Zelda II) [U-K v20250222 v2 font.galmuri]");
  const [group] = buildGroups([a, b]).values();
  assert.equal(representative(group, b.id), b);
  assert.equal(representative(group, "nes-9999999999"), group.members[0]);
  assert.equal(a.group, b.group);
  assert.match(a.group, /^nes~[0-9a-f]{10}$/);
});

test("arcade groups follow the DAT, never the title", () => {
  assert.equal(groupKey({ system: "arcade", set: "gunbirdj", cloneOf: "gunbird" }), "set:gunbird");
  assert.equal(groupKey({ system: "arcade", set: "gunbird", cloneOf: null }), "set:gunbird");
  assert.equal(groupKey({ system: "arcade", core: "fbneo", keepFileName: true, file: "homemade.zip", name: "homemade" }), "file:homemade.zip");
});

function put(rel, body = "x") {
  fs.mkdirSync(path.dirname(path.join(retro, rel)), { recursive: true });
  fs.writeFileSync(path.join(retro, rel), body);
}

put("roms/arcade/gunbird.zip");
put("roms/arcade/gunbirdj.zip");
put("roms/arcade/knightsj.zip"); // its parent knights.zip is missing
put("roms/arcade/kod.zip");
put("roms/arcade/kodj.zip");
put("roms/md/더 슈퍼 시노비 2 (Super Shinobi II, The) [J-K v20130609].zip");
put("roms/md/더 슈퍼 시노비 2 (Super Shinobi II, The) [Japan, Korea].zip");
put("roms/md/Comix Zone (USA).zip");
// Only the Japanese set has art: the World parent borrows it; kod's art comes from a set not in the folder.
put("thumbnails/arcade/Named_Boxarts/Gunbird (Japan).png", "PNG");
put("thumbnails/arcade/Named_Boxarts/The King of Dragons (USA 910910).png", "PNG");

const catalog = await import("../../src/retro/catalog.js");
const { default: retroRouter } = await import("../../src/routes/retro.js");
const picks = await import("../../src/retro/variant-picks.js");

test("an arcade set without art shows its game's art: another set in the folder, then any set in the DAT", async () => {
  const { games } = await catalog.scanDir(retro);
  const bySet = new Map(games.filter((g) => g.set).map((g) => [g.set, g]));
  assert.ok(bySet.get("gunbirdj").icon.endsWith("Gunbird (Japan).png"));
  assert.equal(bySet.get("gunbird").icon, bySet.get("gunbirdj").icon);
  assert.equal(bySet.get("gunbird").iconFrom, "gunbirdj");
  assert.ok(bySet.get("kod").icon.endsWith("The King of Dragons (USA 910910).png"));
  assert.equal(bySet.get("kodj").iconFrom, "kodu");
  assert.equal(bySet.get("knightsj").icon, null, "nothing of its game has art");
});

test("lists show one card per game, every file stays reachable", async () => {
  await catalog.scan(retro);
  const app = express();
  app.use("/api/retro", retroRouter());
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const get = async (url) => (await fetch(`http://127.0.0.1:${server.address().port}${url}`)).json();
  try {
    const listed = await get("/api/retro/games?pageSize=50&sort=name");
    const files = listed.games.map((g) => g.file).sort();
    // knightsj can't run without knights.zip; the Korean release represents Super Shinobi II.
    assert.deepEqual(files, ["Comix Zone (USA).zip", "gunbird.zip", "kod.zip", "더 슈퍼 시노비 2 (Super Shinobi II, The) [Japan, Korea].zip"]);
    assert.equal(listed.total, 4);
    const shinobi = listed.games.find((g) => g.system === "md" && g.variants === 2);
    assert.match(shinobi.group, /^md~[0-9a-f]{10}$/);
    assert.equal(listed.games.find((g) => g.file === "Comix Zone (USA).zip").variants, 1);

    const all = await get("/api/retro/games?pageSize=50&variants=all");
    assert.equal(all.total, 8, "every file, the one that can't run too");

    const { systems } = await get("/api/retro/systems");
    assert.equal(systems.find((s) => s.id === "arcade").romCount, 2, "romCount counts the cards");

    // A search for a version that is not listed finds its game.
    const found = await get(`/api/retro/games?q=${encodeURIComponent("J-K v2013")}`);
    assert.deepEqual(found.games.map((g) => g.id), [shinobi.id], "the patch is found through its game's card");
    const byFile = await get("/api/retro/games?q=gunbirdj");
    assert.deepEqual(byFile.games.map((g) => g.file), ["gunbird.zip"]);

    const detail = await get(`/api/retro/games/${shinobi.id}`);
    assert.equal(detail.representative, shinobi.id);
    assert.deepEqual(detail.variants.map((v) => [v.variant, v.edition.source, v.representative]), [["Japan, Korea", "official", true], ["J-K v20130609", "patch", false]]);
    assert.ok(detail.variants.every((v) => v.id && v.size > 0 && v.name));
    const other = detail.variants[1];
    const otherDetail = await get(`/api/retro/games/${other.id}`);
    assert.equal(otherDetail.id, other.id, "a version that is not listed still resolves");
    assert.equal(otherDetail.representative, shinobi.id);

    // The admin's pick shows at once, without a rescan.
    assert.equal(picks.set(shinobi.group, other.id), true);
    const after = await get("/api/retro/games?system=md");
    assert.ok(after.games.some((g) => g.id === other.id));
    assert.ok(!after.games.some((g) => g.id === shinobi.id));
    picks.set(shinobi.group, null);

    const knightsj = all.games.find((g) => g.file === "knightsj.zip");
    const k = await get(`/api/retro/games/${knightsj.id}`);
    assert.deepEqual(k.variants[0].missing, ["knights"]);
  } finally {
    server.close();
  }
});
