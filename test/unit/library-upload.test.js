import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupSaveType, baseTitleId, patchLayout, retroLayout, safeName, safeRelPath, saveLayout } from "../../src/meta/library-upload.js";
import { CONSOLE, seedConsole } from "../support/console.js";
import { adminSession } from "../support/web-session.js";

const PORT = 16400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const MK = "0100152000022000";
// The shop is read by an approved console; changes go through the admin page.
const ALICE = CONSOLE;

test("upload names and paths can't leave their folder", () => {
  assert.equal(safeName(" 100% 세이브 "), "100% 세이브");
  for (const bad of ["", "a/b", "..", ".hidden", "x\u0000y", "a".repeat(101)]) assert.equal(safeName(bad), null, bad);
  assert.equal(safeRelPath("save/./data.bin"), null);
  assert.equal(safeRelPath("../etc/passwd"), null);
  assert.equal(safeRelPath("dir\\sub/file"), "dir/sub/file");
  assert.equal(baseTitleId("0100152000022000"), MK);
  assert.equal(baseTitleId("0100152000022800"), null, "an update id isn't a game");
});

test("patches are laid out from the SD root, wrapper folders peeled off", () => {
  const files = [`My Patch/atmosphere/contents/${MK}/romfs/a.bin`, `My Patch/atmosphere/contents/${MK}/cheats/x.txt`];
  assert.deepEqual(patchLayout(files, MK), files.map((f) => f.slice("My Patch/".length)));
  assert.throws(() => patchLayout(["atmosphere/contents/0100000000010000/romfs/a"], MK), /패치 경로가 아닙니다/);
});

test("saves keep their folder's contents; retro ROMs must be the console's", () => {
  assert.deepEqual(saveLayout(["MK8/userdata.dat", "MK8/sub/x"], true), ["userdata.dat", "sub/x"]);
  assert.deepEqual(saveLayout(["userdata.dat"], false), ["userdata.dat"]);
  const snes = { name: "SNES", extensions: [".sfc", ".smc", ".zip"] };
  assert.deepEqual(retroLayout(["Game.sfc"], snes), ["Game.sfc"]);
  assert.throws(() => retroLayout(["Game.gba"], snes), /롬이 없습니다/);
  const ps1 = { name: "PS1", extensions: [".cue", ".chd"] };
  assert.deepEqual(retroLayout(["a.cue", "a.bin"], ps1), ["a.cue", "a.bin"], "a cue travels with its bin");
});

async function boot(dirs) {
  await seedConsole(dirs.data);
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: dirs.data, COOK_GAMES_DIR: dirs.games,
      COOK_PATCHES_DIR: dirs.patches, COOK_SAVES_DIR: dirs.saves, COOK_RETRO_DIR: dirs.retro,
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("the admin uploads a game, a retro ROM, a patch zip and a save folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-upload-"));
  const dirs = Object.fromEntries(["data", "games", "patches", "saves", "retro"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(dirs.retro, "roms"));
  // A patch zipped with its folder, the way people share them.
  const src = path.join(root, "zipsrc", "Korean", "atmosphere", "contents", MK, "romfs");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "text.bin"), "KO");
  const zip = path.join(root, "patch.zip");
  execFileSync("zip", ["-qr", zip, "Korean"], { cwd: path.join(root, "zipsrc") });

  const server = await boot(dirs);
  try {
    const admin = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")) };
    const send = (kind, fields, files, paths) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      if (paths) fd.append("paths", JSON.stringify(paths));
      for (const [name, data] of files) fd.append("files", new Blob([data]), name);
      return fetch(`${BASE}/admin/api/upload/${kind}`, { method: "POST", headers: admin, body: fd });
    };

    assert.equal((await fetch(`${BASE}/admin/api/upload/save`, { method: "POST", headers: ALICE })).status, 403, "a console never reaches the admin upload");
    const targets = await (await fetch(`${BASE}/admin/api/upload/targets`, { headers: admin })).json();
    assert.equal(targets.targets.patch.writable, true);
    assert.ok(targets.systems.some((s) => s.id === "snes"));

    let r = await send("game", {}, [["Game [0100000000010000][v0].nsp", "NSP"]]);
    assert.equal(r.status, 201);
    assert.equal(fs.readFileSync(path.join(dirs.games, "Game [0100000000010000][v0].nsp"), "utf8"), "NSP");
    assert.equal((await send("game", {}, [["Game [0100000000010000][v0].nsp", "NSP"]])).status, 409, "never overwritten");
    assert.equal((await send("game", {}, [["evil.exe", "x"]])).status, 400);

    r = await send("retro", { system: "snes" }, [["슈퍼 마리오 월드 (Super Mario World).sfc", "SMW"]]);
    assert.equal(r.status, 201, await r.clone().text());
    assert.equal(fs.readFileSync(path.join(dirs.retro, "roms", "snes", "슈퍼 마리오 월드 (Super Mario World).sfc"), "utf8"), "SMW");

    r = await send("patch", { titleId: MK, name: "한글패치", descriptionKo: "한국어로 변경합니다" }, [["patch.zip", fs.readFileSync(zip)]]);
    assert.equal(r.status, 201, await r.clone().text());
    const patchDir = path.join(dirs.patches, MK, "한글패치");
    assert.equal(fs.readFileSync(path.join(patchDir, "atmosphere", "contents", MK, "romfs", "text.bin"), "utf8"), "KO");
    // The information goes into the server's patch store; no patch.json is written.
    assert.equal(fs.existsSync(path.join(patchDir, "patch.json")), false);
    const store = () => JSON.parse(fs.readFileSync(path.join(dirs.data, "patches", "info.json"), "utf8")).patches;
    assert.deepEqual(store()[`${MK}/한글패치`].info, { name: "한글패치", description: "한국어로 변경합니다" });

    // A patch the game can't start without: marked on upload, changed later from the admin page.
    r = await send("patch", { titleId: MK, name: "게임 데이터", required: "true" }, [["patch.zip", fs.readFileSync(zip)]]);
    assert.equal(r.status, 201, await r.clone().text());
    assert.equal(store()[`${MK}/게임 데이터`].info.required, true);
    assert.equal(fs.existsSync(path.join(dirs.patches, MK, "게임 데이터", "patch.json")), false);
    const adminPatches = async () => (await (await fetch(`${BASE}/admin/api/patches`, { headers: admin })).json()).patches;
    let listed = [];
    for (let i = 0; i < 40 && listed.length < 2; i++) {
      listed = await adminPatches();
      if (listed.length < 2) await new Promise((res) => setTimeout(res, 100));
    }
    const data = listed.find((p) => p.name === "게임 데이터");
    assert.equal(data.required, true);
    assert.equal(listed.find((p) => p.name === "한글패치").required, false, "not marked: not required");
    const setRequired = (id, required) => fetch(`${BASE}/admin/api/patches/required`, {
      method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ id, required }) });
    assert.equal((await setRequired(data.id, "yes")).status, 400);
    assert.equal((await setRequired("0100152000022000-000000000000", true)).status, 404);
    assert.equal((await setRequired(data.id, false)).status, 200);
    assert.deepEqual(store()[`${MK}/게임 데이터`].info, { name: "게임 데이터" }, "the other fields stay");
    const pub = (await (await fetch(`${BASE}/api/patches`, { headers: ALICE })).json()).patches;
    assert.equal(pub.find((p) => p.id === data.id).required, false, "the shop listing carries the same value");
    assert.equal((await setRequired(data.id, true)).status, 200);
    assert.equal((await (await fetch(`${BASE}/api/patches`, { headers: ALICE })).json()).patches.find((p) => p.id === data.id).required, true);

    // Editing a patch's information: checked, saved in the store, and served at once with a new ETag.
    const editInfo = (id, body) => fetch(`${BASE}/admin/api/patches/${id}/info`, {
      method: "PUT", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const publicList = (lang) => fetch(`${BASE}/api/patches?lang=${lang}`, { headers: ALICE });
    const etagBefore = (await publicList("en")).headers.get("etag");
    assert.equal((await fetch(`${BASE}/admin/api/patches/${data.id}/info`, {
      method: "PUT", headers: { ...ALICE, "Content-Type": "application/json" }, body: "{}" })).status, 403, "a console never reaches the admin API");
    for (const [bad, why] of [[{ name: "" }, /이름/], [{ name: "a".repeat(121) }, /120자/], [{ name: "a", version: 1 }, /글자/],
      [{ name: "a", ko: "x" }, /ko/], [{ name: "a", ko: { description: "가".repeat(2001) } }, /한국어 설명/], [{ name: "a", update_version: "v1" }, /업데이트/],
      [{ name: "a", required: "yes" }, /required/]]) {
      const res = await editInfo(data.id, bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.match((await res.json()).error, why);
    }
    assert.equal((await editInfo("0100152000022000-000000000000", { name: "a" })).status, 404);
    const edited = await editInfo(data.id, { name: "Game data", version: "2.0", author: "someone", description: "Needed to start.",
      ko: { name: "게임 데이터", description: "이게 있어야 실행됩니다." } });
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.equal((await edited.json()).info.required, true, "required stays when left out");
    const enRes = await publicList("en");
    assert.notEqual(enRes.headers.get("etag"), etagBefore, "the listing's ETag changes with the edit");
    const en = (await enRes.json()).patches.find((p) => p.id === data.id);
    assert.deepEqual([en.name, en.version, en.author, en.description, en.required], ["Game data", "2.0", "someone", "Needed to start.", true]);
    const koP = (await (await publicList("ko")).json()).patches.find((p) => p.id === data.id);
    assert.deepEqual([koP.name, koP.description], ["게임 데이터", "이게 있어야 실행됩니다."]);
    const infoList = await (await fetch(`${BASE}/admin/api/patches/info`, { headers: admin })).json();
    assert.deepEqual(infoList.patches.find((p) => p.id === data.id).key, `${MK}/게임 데이터`);
    assert.equal(infoList.patches.find((p) => p.id === data.id).stored, true);
    assert.equal(fs.existsSync(path.join(dirs.patches, MK, "게임 데이터", "patch.json")), false, "the server never writes a patch.json");

    // A patch.json put in the folder later is offered to the edit dialog, never taken in on its own.
    const fromFile = () => fetch(`${BASE}/admin/api/patches/${data.id}/patch-json`, { headers: admin }).then((x) => x.json());
    assert.deepEqual(await fromFile(), { found: false });
    const jsonPath = path.join(dirs.patches, MK, "게임 데이터", "patch.json");
    fs.writeFileSync(jsonPath, "{ not json");
    assert.match((await fromFile()).error, /JSON/);
    fs.writeFileSync(jsonPath, JSON.stringify({ name: "Game data", version: "2.1", author: "someone", description: "Needed to start.", required: true,
      ko: { name: "게임 데이터", description: "이게 있어야 실행됩니다." } }));
    const offered = await fromFile();
    assert.deepEqual([offered.found, offered.differs, offered.info.version], [true, true, "2.1"]);
    assert.equal((await (await fetch(`${BASE}/admin/api/patches/info`, { headers: admin })).json()).patches.find((p) => p.id === data.id).info.version, "2.0", "the store keeps its own until saved");
    fs.writeFileSync(jsonPath, JSON.stringify({ name: "Game data", version: "2.0", author: "someone", description: "Needed to start.", required: true,
      ko: { name: "게임 데이터", description: "이게 있어야 실행됩니다." } }));
    assert.equal((await fromFile()).differs, false, "the same information is not offered");
    assert.equal((await fetch(`${BASE}/admin/api/patches/0100152000022000-000000000000/patch-json`, { headers: admin })).status, 404);
    fs.rmSync(jsonPath);

    r = await send("save", { titleId: MK, name: "All karts", description: "Everything unlocked.", descriptionKo: "전부 엽니다." },
      [["userdata.dat", "SAVE"], ["x.bin", "X"]], ["MK8D/userdata.dat", "MK8D/sub/x.bin"]);
    assert.equal(r.status, 201, await r.clone().text());
    const saveDir = path.join(dirs.saves, MK, "All karts");
    assert.equal(fs.readFileSync(path.join(saveDir, "userdata.dat"), "utf8"), "SAVE");
    assert.equal(fs.readFileSync(path.join(saveDir, "sub", "x.bin"), "utf8"), "X");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(saveDir, "meta.json"), "utf8")),
      { name: "All karts", description: "Everything unlocked.", ko: { description: "전부 엽니다." } });

    r = await send("save", { titleId: MK, name: "Shared" },
      [["20261013_120000.meta", "title_id=0100152000022000\nuser_id=device\n"], ["a.dat", "A"]], ["20261013_120000.meta", "20261013_120000/a.dat"]);
    assert.equal(r.status, 201, await r.clone().text());
    const sharedDir = path.join(dirs.saves, MK, "Shared");
    assert.deepEqual(fs.readdirSync(sharedDir).sort(), ["a.dat", "meta.json"], "the backup's .meta is read, not shipped");
    assert.equal(JSON.parse(fs.readFileSync(path.join(sharedDir, "meta.json"), "utf8")).saveType, "device");
    r = await send("save", { titleId: MK, name: "Mine", saveType: "account" }, [["b.dat", "B"]]);
    assert.equal(r.status, 201, await r.clone().text());
    assert.equal(JSON.parse(fs.readFileSync(path.join(dirs.saves, MK, "Mine", "meta.json"), "utf8")).saveType, "account");
    assert.equal(JSON.parse(fs.readFileSync(saveDir + "/meta.json", "utf8")).saveType, undefined, "unknown stays unset");

    // The admin's own description wins in the title detail and is kept apart from titledb.
    const desc = (p, body) => fetch(`${BASE}/admin/api/descriptions/${p}`, {
      method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await desc(MK, { description: { ko: "필수 패치와 함께 설치합니다.\n약 49GB 가 필요합니다.", en: "Install with its data." }, notes: { ko: "게임 데이터를 함께 설치합니다." } })).status, 200);
    const title = async (lang) => (await fetch(`${BASE}/api/title/${MK}?lang=${lang}`, { headers: ALICE })).json();
    const ko = await title("ko");
    assert.equal(ko.description, "필수 패치와 함께 설치합니다.\n약 49GB 가 필요합니다.");
    assert.equal(ko.descriptionCustom, true);
    assert.equal(ko.notes, "게임 데이터를 함께 설치합니다.", "notes come apart from the description");
    assert.equal((await title("en")).description, "Install with its data.");
    const own = await (await fetch(`${BASE}/admin/api/descriptions/${MK}`, { headers: admin })).json();
    assert.deepEqual(own.own, { name: null, description: { ko: "필수 패치와 함께 설치합니다.\n약 49GB 가 필요합니다.", en: "Install with its data." }, notes: { ko: "게임 데이터를 함께 설치합니다.", en: null } });
    assert.equal((await fetch(`${BASE}/admin/api/descriptions/${MK}`, { headers: ALICE })).status, 403, "a console never reaches the admin API");
    assert.equal((await desc("nope", { ko: "x" })).status, 400);
    assert.equal((await desc(`${MK}/reset`, { field: "description" })).status, 200);
    const after = await title("ko");
    assert.equal(after.descriptionCustom, false, "the description goes back to titledb's");
    assert.equal(after.notes, "게임 데이터를 함께 설치합니다.", "the notes stay");
    assert.equal((await desc(`${MK}/reset`, {})).status, 200);
    assert.equal((await fetch(`${BASE}/api/title/${MK}`, { headers: ALICE })).status, 404, "back to what titledb has: nothing here");

    assert.equal((await send("save", { titleId: MK, name: "../x" }, [["a", "b"]])).status, 400);
    assert.equal((await send("patch", { titleId: MK, name: "Wrong" }, [["a.txt", "x"]])).status, 400, "outside the game's paths");
    assert.deepEqual(fs.readdirSync(path.join(dirs.patches, ".upload-staging")), [], "staging is cleaned up");
  } finally {
    server.kill("SIGKILL");
  }
});

test("a save-keeper backup's .meta names the save's kind by its user_id", () => {
  assert.equal(backupSaveType("x.meta", "title_id=0100152000022000\r\nuser_id=device\r\n"), "device");
  assert.equal(backupSaveType(".dropkeep.meta", "user_id=user-1\n"), "account");
  assert.equal(backupSaveType("x.meta", "title_id=0100152000022000\n"), null, "older backups without user_id");
  assert.equal(backupSaveType("game.meta", "binary stuff"), null, "a game's own .meta file is not a backup's");
  assert.equal(backupSaveType("x.dat", "user_id=device"), null);
});

/** A minimal NRO: header, then an ASET block whose NACP carries `version` (as client-update.test.js builds it). */
function fakeNro(version) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write("CookingFoil", 0);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

test("the admin uploads the client build and consoles are offered it at once, with no signature", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-upload-client-"));
  const dirs = Object.fromEntries(["data", "games", "patches", "saves", "retro"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const server = await boot(dirs);
  try {
    const admin = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")) };
    const send = (name, data) => {
      const fd = new FormData();
      fd.append("files", new Blob([data]), name);
      return fetch(`${BASE}/admin/api/upload/client`, { method: "POST", headers: admin, body: fd });
    };
    const latest = async () => (await fetch(`${BASE}/api/client/latest`, { headers: ALICE })).json();

    let r = await send("cookingfoil.nro", fakeNro("0.3.61"));
    assert.equal(r.status, 201, await r.clone().text());
    assert.equal((await r.json()).version, "0.3.61");
    let offered = await latest();
    assert.equal(offered.version, "0.3.61");
    assert.equal(offered.signature, undefined, "no signature, offered all the same");

    r = await send("cookingfoil.nro", fakeNro("0.3.62"));
    assert.equal(r.status, 201, "the build is the one file that is replaced");
    assert.equal((await latest()).version, "0.3.62");
    assert.equal((await send("cookingfoil.nro", fakeNro("0.3.1"))).status, 400, "never a lower version");
    assert.equal((await send("cookingfoil.nro", Buffer.from("not an nro"))).status, 400);
    assert.equal((await send("other.zip", Buffer.from("PK"))).status, 400);
    offered = await latest();
    assert.equal(offered.version, "0.3.62", "a refused upload leaves the build offered as it was");
    const overview = await (await fetch(`${BASE}/admin/api/stats`, { headers: admin })).json().catch(() => ({}));
    assert.ok(!JSON.stringify(overview).includes("client-build-unsigned"), "no warning about a missing signature");
  } finally {
    server.kill("SIGKILL");
  }
});

test("the admin adds a RetroArch core, replaces it only when asked, and removes it to the trash", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-upload-core-"));
  const dirs = Object.fromEntries(["data", "games", "patches", "saves", "retro"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const server = await boot(dirs);
  try {
    const admin = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")) };
    const send = (name, data, replace) => {
      const fd = new FormData();
      fd.append("files", new Blob([data]), name);
      if (replace) fd.append("replace", "true");
      return fetch(`${BASE}/admin/api/upload/core`, { method: "POST", headers: admin, body: fd });
    };
    const core = path.join(dirs.retro, "retroarch/cores/mgba_libretro_libnx.nro");

    let r = await send("mgba_libretro_libnx.nro", fakeNro("1.0.0"));
    assert.equal(r.status, 201, await r.clone().text());
    assert.equal((await r.json()).where, "retroarch/cores/mgba_libretro_libnx.nro");
    assert.ok(fs.existsSync(core), "the pack folder is made on a fresh server");
    assert.equal((await send("mgba.nro", fakeNro("1.0.0"))).status, 400, "the name must say it is a Switch core");
    assert.equal((await send("snes9x_libretro_libnx.nro", Buffer.alloc(64))).status, 400, "and the file must be an NRO");

    r = await send("mgba_libretro_libnx.nro", fakeNro("2.0.0"));
    assert.equal(r.status, 409, "a core of that name is never replaced unasked");
    r = await send("mgba_libretro_libnx.nro", fakeNro("2.0.0"), true);
    assert.equal(r.status, 201);
    assert.match((await r.json()).trashed, /^\d{4}-\d{2}-\d{2}\/core-[0-9a-f]{10}$/, "the old one went to the trash");

    const list = await (await fetch(`${BASE}/admin/api/retro-cores`, { headers: admin })).json();
    assert.deepEqual(list.cores.map((c) => [c.core, c.origin]), [["mgba", "modified"]]);

    // The fill-in-one-go plan names what would be installed and needs a confirmation to start.
    const plan = await (await fetch(`${BASE}/admin/api/retro-pack`, { headers: admin })).json();
    assert.equal(plan.items[0].kind, "body");
    assert.ok(plan.bundle.size > 1e8);
    assert.ok(plan.credit.url.startsWith("https://github.com/"));
    r = await fetch(`${BASE}/admin/api/retro-pack/fill`, { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(r.status, 400, "no confirmation, no download");

    r = await fetch(`${BASE}/admin/api/retro-cores/remove`, { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ core: "mgba" }) });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok(!fs.existsSync(core));
    const trash = await (await fetch(`${BASE}/admin/api/retro-variants/trash`, { headers: admin })).json();
    assert.deepEqual(trash.items.map((i) => [i.system, i.name]).sort(), [["core", "mgba_libretro_libnx.nro"], ["core", "mgba_libretro_libnx.nro"]]);
    r = await fetch(`${BASE}/admin/api/retro-variants/restore`, { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ entry: trash.items[0].entry }) });
    assert.equal(r.status, 200, "a removed core comes back from the trash tab");
    assert.ok(fs.existsSync(core));
  } finally {
    server.kill("SIGKILL");
  }
});

test("the admin picks the core a console's games start with, kept out of systems.json", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-system-core-"));
  const dirs = Object.fromEntries(["data", "games", "patches", "saves", "retro"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(dirs.retro, "roms/gba"), { recursive: true });
  fs.writeFileSync(path.join(dirs.retro, "roms/gba/Game.gba"), "rom");
  fs.mkdirSync(path.join(dirs.retro, "retroarch/cores"), { recursive: true });
  fs.mkdirSync(path.join(dirs.retro, "retroarch/info"), { recursive: true });
  for (const core of ["mgba", "vba_next"]) fs.writeFileSync(path.join(dirs.retro, `retroarch/cores/${core}_libretro_libnx.nro`), fakeNro("1.0.0"));
  fs.writeFileSync(path.join(dirs.retro, "retroarch/info/vba_next_libretro.info"), 'supported_extensions = "gba"\n');
  const server = await boot(dirs);
  try {
    const admin = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")), "Content-Type": "application/json" };
    const pick = (body) => fetch(`${BASE}/admin/api/retro-cores/system`, { method: "POST", headers: admin, body: JSON.stringify(body) });
    const gba = async () => (await (await fetch(`${BASE}/admin/api/retro-cores`, { headers: admin })).json()).systems.find((s) => s.id === "gba");

    assert.deepEqual(await gba(), { id: "gba", name: "게임보이 어드밴스", games: 1, core: "mgba", tableCore: "mgba", installed: true, fits: ["vba_next"], others: ["mgba"] });
    assert.equal((await pick({ system: "gba", core: "snes9x" })).status, 400, "a core that is not installed");
    assert.equal((await pick({ system: "nope", core: "mgba" })).status, 404);

    const r = await pick({ system: "gba", core: "vba_next" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await gba()).core, "vba_next");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirs.data, "retro-system-cores.json"), "utf8")), { gba: "vba_next" });
    assert.ok(!fs.existsSync(path.join(dirs.retro, "systems.json")), "the operator's system table is not written");

    assert.equal((await pick({ system: "gba", core: null })).status, 200);
    assert.equal((await gba()).core, "mgba", "null goes back to the table's core");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirs.data, "retro-system-cores.json"), "utf8")), {});
  } finally {
    server.kill("SIGKILL");
  }
});
