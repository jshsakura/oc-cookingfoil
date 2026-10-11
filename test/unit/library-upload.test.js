import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { baseTitleId, patchLayout, retroLayout, safeName, safeRelPath, saveLayout } from "../../src/meta/library-upload.js";

const PORT = 16400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const MK = "0100152000022000";
const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");

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
    const login = await fetch(`${BASE}/admin/verify`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE },
      body: JSON.stringify({ password: "admin-password-123" }),
    });
    const admin = { Authorization: ALICE, Cookie: login.headers.get("set-cookie").split(";")[0] };
    const send = (kind, fields, files, paths) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      if (paths) fd.append("paths", JSON.stringify(paths));
      for (const [name, data] of files) fd.append("files", new Blob([data]), name);
      return fetch(`${BASE}/admin/api/upload/${kind}`, { method: "POST", headers: admin, body: fd });
    };

    assert.equal((await fetch(`${BASE}/admin/api/upload/save`, { method: "POST", headers: { Authorization: ALICE } })).status, 401, "admin session only");
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
    assert.equal(fs.readFileSync(path.join(dirs.retro, "roms", "Nintendo - Super Nintendo Entertainment System", "슈퍼 마리오 월드 (Super Mario World).sfc"), "utf8"), "SMW");

    r = await send("patch", { titleId: MK, name: "한글패치", descriptionKo: "한국어로 바꿉니다" }, [["patch.zip", fs.readFileSync(zip)]]);
    assert.equal(r.status, 201, await r.clone().text());
    const patchDir = path.join(dirs.patches, MK, "한글패치");
    assert.equal(fs.readFileSync(path.join(patchDir, "atmosphere", "contents", MK, "romfs", "text.bin"), "utf8"), "KO");
    assert.equal(JSON.parse(fs.readFileSync(path.join(patchDir, "patch.json"), "utf8")).description, "한국어로 바꿉니다");

    r = await send("save", { titleId: MK, name: "All karts", description: "Everything unlocked.", descriptionKo: "전부 엽니다." },
      [["userdata.dat", "SAVE"], ["x.bin", "X"]], ["MK8D/userdata.dat", "MK8D/sub/x.bin"]);
    assert.equal(r.status, 201, await r.clone().text());
    const saveDir = path.join(dirs.saves, MK, "All karts");
    assert.equal(fs.readFileSync(path.join(saveDir, "userdata.dat"), "utf8"), "SAVE");
    assert.equal(fs.readFileSync(path.join(saveDir, "sub", "x.bin"), "utf8"), "X");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(saveDir, "meta.json"), "utf8")),
      { name: "All karts", description: "Everything unlocked.", ko: { description: "전부 엽니다." } });

    assert.equal((await send("save", { titleId: MK, name: "../x" }, [["a", "b"]])).status, 400);
    assert.equal((await send("patch", { titleId: MK, name: "Wrong" }, [["a.txt", "x"]])).status, 400, "outside the game's paths");
    assert.deepEqual(fs.readdirSync(path.join(dirs.patches, ".upload-staging")), [], "staging is cleaned up");
  } finally {
    server.kill("SIGKILL");
  }
});
