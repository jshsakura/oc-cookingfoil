import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// The retro trash moves a ROM and what follows its name, never deletes, and
// puts it all back. Everything here runs on a temp dir.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-trash-"));
process.env.COOK_DATA_DIR = root;
process.env.COOK_RETRO_DIR = path.join(root, "retro");
process.env.COOK_RATING_SYNC = "false";
const retro = process.env.COOK_RETRO_DIR;
const put = (rel, body = "x") => {
  fs.mkdirSync(path.dirname(path.join(retro, rel)), { recursive: true });
  fs.writeFileSync(path.join(retro, rel), body);
};
const has = (rel) => fs.existsSync(path.join(retro, rel));

const OLD = "몬스터 월드 4 (Monster World IV) [U-K v20260701 v0.6]";
const NEW = "몬스터 월드 4 (Monster World IV) [Korea]";
put(`roms/md/${OLD}.zip`, "OLD");
put(`roms/md/${NEW}.zip`, "NEW");
put(`thumbnails/md/Named_Boxarts/${OLD}.png`, "ART");
put(`bezels/md/${OLD}.png`, "BEZEL");
put(`bezels/md/${OLD}.cfg`, "CFG");
put(`bezels/md/${OLD}_override.cfg`, "OVR");
put("art-map/md.json", JSON.stringify({ [OLD]: "Monster World IV (Japan)", [NEW]: "Monster World IV (Korea)" }));
// Two copies of one game in two folders share their art; the copy left keeps it.
put("roms/gba/a/코믹스 존 (Comix Zone) [K].zip");
put("roms/gba/b/코믹스 존 (Comix Zone) [K].zip");
put("thumbnails/gba/Named_Boxarts/코믹스 존 (Comix Zone) [K].png", "SHARED");
// An arcade parent its clone needs.
put("roms/arcade/gunbird.zip");
put("roms/arcade/gunbirdj.zip");
put("thumbnails/arcade/Named_Boxarts/Gunbird (Japan).png", "GJ");

const catalog = await import("../../src/retro/catalog.js");
const { listTrash, restoreEntry, trashFiles, trashGame } = await import("../../src/retro/trash.js");
const { mountRetroVariantsApi } = await import("../../src/routes/admin/retro-variants-api.js");
const { mountRetroArtApi } = await import("../../src/routes/admin/retro-art-api.js");

test("a trashed game takes its ROM, box art, bezel files and art-map key, and comes back", async () => {
  const cat = await catalog.scan(retro);
  const old = cat.games.find((g) => g.name === OLD);
  const { entry, files } = await trashGame(retro, old, cat.systems.md, { now: new Date(2026, 9, 14) });
  assert.match(entry, /^2026-10-14\/md-[0-9a-f]{10}$/);
  assert.deepEqual(files.sort(), [`bezels/md/${OLD}.cfg`, `bezels/md/${OLD}.png`, `bezels/md/${OLD}_override.cfg`, `roms/md/${OLD}.zip`, `thumbnails/md/Named_Boxarts/${OLD}.png`].sort());
  for (const rel of files) {
    assert.ok(!has(rel), `${rel} left its place`);
    assert.ok(has(path.join(".cookingfoil-trash", entry, rel)), `${rel} is in the trash`);
  }
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(retro, "art-map/md.json"), "utf8"))), [NEW]);
  assert.ok(has(`roms/md/${NEW}.zip`), "the other version stays");
  // The scanner skips the trash.
  assert.ok(!(await catalog.scan(retro)).games.some((g) => g.id === old.id));
  const [item] = await listTrash(retro);
  assert.equal(item.entry, entry);
  assert.equal(item.id, old.id);

  await restoreEntry(retro, entry);
  for (const rel of files) assert.ok(has(rel), `${rel} is back`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(retro, "art-map/md.json"), "utf8"))[OLD], "Monster World IV (Japan)");
  assert.ok(!has(path.join(".cookingfoil-trash", entry)));
  const back = (await catalog.scan(retro)).games.find((g) => g.name === OLD);
  assert.equal(back.id, old.id, "the same id as before");
});

test("a move that fails half way puts back what it had moved", { skip: process.getuid?.() === 0 && "root ignores folder permissions" }, async () => {
  const cat = await catalog.scan(retro);
  const old = cat.games.find((g) => g.name === OLD);
  const boxarts = path.join(retro, "thumbnails/md/Named_Boxarts");
  fs.chmodSync(boxarts, 0o555);
  try {
    await assert.rejects(trashGame(retro, old, cat.systems.md));
  } finally {
    fs.chmodSync(boxarts, 0o755);
  }
  for (const rel of [`roms/md/${OLD}.zip`, `thumbnails/md/Named_Boxarts/${OLD}.png`, `bezels/md/${OLD}.png`, `bezels/md/${OLD}.cfg`]) assert.ok(has(rel), `${rel} is back`);
  assert.ok(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(retro, "art-map/md.json"), "utf8")), OLD), "the art-map key stays");
  assert.deepEqual(await listTrash(retro), [], "no half entry is left in the trash");
});

test("a restore only checks and moves the files the trash still holds", async () => {
  const cat = await catalog.scan(retro);
  const old = cat.games.find((g) => g.name === OLD);
  const { entry } = await trashGame(retro, old, cat.systems.md);
  // The cfg went missing from the trash, and a new one was made in its place meanwhile.
  fs.rmSync(path.join(retro, ".cookingfoil-trash", entry, `bezels/md/${OLD}.cfg`));
  put(`bezels/md/${OLD}.cfg`, "NEW CFG");
  const { files } = await restoreEntry(retro, entry);
  assert.ok(!files.includes(`bezels/md/${OLD}.cfg`));
  assert.ok(has(`roms/md/${OLD}.zip`));
  assert.equal(fs.readFileSync(path.join(retro, `bezels/md/${OLD}.cfg`), "utf8"), "NEW CFG");
  put(`bezels/md/${OLD}.cfg`, "CFG");
});

test("a restore never overwrites a file that took the trashed one's place: the game waits in the trash", async () => {
  const cat = await catalog.scan(retro);
  const old = cat.games.find((g) => g.name === OLD);
  const { entry } = await trashGame(retro, old, cat.systems.md);
  put(`roms/md/${OLD}.zip`, "SOMETHING ELSE");
  // A ROM under another name would part from its art and art-map key, so a taken name refuses the game.
  await assert.rejects(restoreEntry(retro, entry), /자리에 다른 파일/);
  assert.equal(fs.readFileSync(path.join(retro, `roms/md/${OLD}.zip`), "utf8"), "SOMETHING ELSE");
  assert.ok((await listTrash(retro)).some((e) => e.entry === entry), "still in the trash");
  await assert.rejects(restoreEntry(retro, "../../etc"), /맞지 않습니다/);
  fs.rmSync(path.join(retro, `roms/md/${OLD}.zip`));
  const { renamed } = await restoreEntry(retro, entry);
  assert.deepEqual(renamed, []);
  assert.equal(fs.readFileSync(path.join(retro, `roms/md/${OLD}.zip`), "utf8"), "OLD");
});

test("the admin API lists groups and sets, picks, trashes with a confirmation for needed parents, and restores", async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountRetroVariantsApi(router, () => true);
  mountRetroArtApi(router, () => true);
  app.use("/admin", router);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/admin/api/retro-variants`;
  const post = async (url, body) => {
    const r = await fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try {
    await catalog.scan(retro);
    // The art overview: games with art of their own or borrowed are not missing.
    const overview = await (await fetch(base.replace("retro-variants", "retro-art"))).json();
    // (The patch's art came back with it in the test before; only the Korean version has none.)
    assert.deepEqual(overview.missing.map((m) => m.system), ["md"], "the arcade sets and the Comix Zone copy have art");
    const arcade = overview.systems.find((x) => x.id === "arcade");
    assert.deepEqual([arcade.boxart, arcade.borrowed], [2, 1]);
    const { groups } = await (await fetch(base, { headers: { "Accept-Language": "ko" } })).json();
    const mw = groups.find((g) => g.system === "md");
    assert.deepEqual(mw.members.map((m) => [m.variant, m.representative]), [["Korea", true], ["U-K v20260701 v0.6", false]]);
    assert.equal(mw.reason, "공식 한국어판입니다");
    assert.equal(mw.reasonCode, "variant.official");

    const sets = await (await fetch(`${base}/sets`)).json();
    assert.deepEqual(sets.summary, { groups: 1, sets: 2, listed: 1, broken: 0, hidden: {} });
    assert.deepEqual(sets.groups[0].members.map((m) => [m.file, m.class.region]), [["gunbird.zip", "world"], ["gunbirdj.zip", "jp"]]);

    const patch = mw.members[1];
    const picked = await post("/pick", { group: mw.id, game: patch.id });
    // No Accept-Language (a script or token): English, with the code to branch on.
    assert.equal(picked.body.group.reason, "Chosen by the admin");
    assert.equal(picked.body.group.reasonCode, "variant.picked");
    assert.equal(picked.body.group.members.find((m) => m.representative).id, patch.id);
    assert.equal((await post("/pick", { group: mw.id, game: "md-0000000000" })).status, 400);
    await post("/pick", { group: mw.id, game: null });

    const gunbird = sets.groups[0].members[0];
    const refused = await post("/trash", { game: gunbird.id });
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body.dependents, ["gunbirdj.zip"]);
    // The page asks for a confirmation on the code, not on the words, which follow its language.
    assert.equal(refused.body.code, "in-use");
    assert.equal(refused.body.error, "Another set uses this file");
    const inKorean = await fetch(base + "/trash", { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "ko" }, body: JSON.stringify({ game: gunbird.id }) });
    assert.deepEqual([inKorean.status, (await inKorean.json()).error], [409, "다른 세트가 이 파일을 씁니다"]);
    assert.ok(has("roms/arcade/gunbird.zip"));

    const moved = await post("/trash", { game: patch.id });
    assert.equal(moved.status, 200);
    const gone = (await (await fetch(base)).json()).groups.find((g) => g.system === "md");
    assert.equal(gone, undefined, "the trashed file leaves the lists at once");
    const { items } = await (await fetch(`${base}/trash`)).json();
    assert.ok(items.some((i) => i.entry === moved.body.entry));
    assert.equal((await post("/restore", { entry: moved.body.entry })).status, 200);
    assert.ok(has(`roms/md/${OLD}.zip`));
  } finally {
    server.close();
  }
});

test("a retro core whose name is taken is refused with or without exactName, and waits in the trash", async () => {
  const shared = await import("../../src/library/trash.js");
  const r = { key: "retro", dir: retro };
  put("cores/exact_libretro_libnx.a", "OLD CORE");
  await shared.trashItems(r, [{ rel: "cores/exact_libretro_libnx.a" }], { kind: "retro-core", action: "retro-core-replace" });
  put("cores/exact_libretro_libnx.a", "NEW CORE");
  const entry = (await shared.listRoot(r)).find((e) => e.items.some((i) => i.rel === "cores/exact_libretro_libnx.a"));
  await assert.rejects(restoreEntry(retro, entry.entry, { home: entry.home, exactName: true }), (err) => err.status === 409);
  assert.ok((await shared.listRoot(r)).some((e) => e.entry === entry.entry), "still in the trash");
  assert.equal(fs.readFileSync(path.join(retro, "cores/exact_libretro_libnx.a"), "utf8"), "NEW CORE");
  // A core never comes back numbered, asked or not: "x (2).nro" in cores/ would ship in the pack as no core at all.
  await assert.rejects(restoreEntry(retro, entry.entry, entry.home), (err) => err.status === 409 && /코어/.test(err.message));
  assert.deepEqual(fs.readdirSync(path.join(retro, "cores")).filter((f) => f.startsWith("exact")), ["exact_libretro_libnx.a"]);
  assert.equal(fs.readFileSync(path.join(retro, "cores/exact_libretro_libnx.a"), "utf8"), "NEW CORE");
});

test("restoreEntry(dir, entry, { exactName: true }), the shape the core swap calls, leaves a user core in the trash when its name is taken", async () => {
  const shared = await import("../../src/library/trash.js");
  put("cores/swap_libretro_libnx.nro", "USER CORE");
  const t = await trashFiles(retro, { id: "core-abcdef0123", system: "core", name: "swap_libretro_libnx.nro" }, ["cores/swap_libretro_libnx.nro"]);
  put("cores/swap_libretro_libnx.nro", "OFFICIAL");
  await assert.rejects(restoreEntry(retro, t.entry, { exactName: true }), (err) => err.status === 409);
  assert.deepEqual(fs.readdirSync(path.join(retro, "cores")).filter((f) => f.startsWith("swap")), ["swap_libretro_libnx.nro"], "no numbered core is left in the cores folder");
  assert.ok((await shared.listRoot({ key: "retro", dir: retro })).some((e) => e.entry === t.entry), "the user core waits in the trash");
  fs.rmSync(path.join(retro, "cores/swap_libretro_libnx.nro"));
  const back = await restoreEntry(retro, t.entry, { exactName: true });
  assert.deepEqual([back.files, back.renamed], [["cores/swap_libretro_libnx.nro"], []]);
  assert.equal(fs.readFileSync(path.join(retro, "cores/swap_libretro_libnx.nro"), "utf8"), "USER CORE");
});
