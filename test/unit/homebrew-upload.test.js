import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../../src/db/database.js";
import { hashStore } from "../../src/db/stores.js";

// 6. An admin's homebrew upload goes through the same normalization as a GitHub
// release, and what /api/homebrew then lists is pinned down exactly.
const PORT = 15600 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");

/** A minimal NRO whose NACP names the app. */
function fakeNro(name) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(name, 0);
  nacp.write("1.0.0", 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

function makeZip(root, files) {
  const src = fs.mkdtempSync(path.join(root, "zipsrc-"));
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.writeFileSync(path.join(src, rel), data);
  }
  const zip = path.join(root, `${crypto.randomBytes(4).toString("hex")}.zip`);
  execFileSync("zip", ["-qr", zip, "."], { cwd: src });
  return fs.readFileSync(zip);
}

async function boot(dirs) {
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: dirs.data, COOK_GAMES_DIR: dirs.games, COOK_HOMEBREW_DIR: dirs.homebrew, COOK_PATCHES_DIR: dirs.patches, COOK_SAVES_DIR: dirs.saves,
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("6. an uploaded zip, folder or .nro lands in switch/<app>/ exactly as a release would", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-upload-"));
  const dirs = Object.fromEntries(["data", "games", "homebrew", "patches", "saves"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const server = await boot(dirs);
  try {
    const login = await fetch(`${BASE}/admin/verify`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE }, body: JSON.stringify({ password: "admin-password-123" }) });
    const admin = { Authorization: ALICE, Cookie: login.headers.get("set-cookie").split(";")[0] };
    const send = (files, paths) => {
      const fd = new FormData();
      if (paths) fd.append("paths", JSON.stringify(paths));
      for (const [name, data] of files) fd.append("files", new Blob([data]), name);
      return fetch(`${BASE}/admin/api/upload/homebrew`, { method: "POST", headers: admin, body: fd });
    };
    const listed = async (dir) => (await (await fetch(`${BASE}/api/homebrew`, { headers: { Authorization: ALICE } })).json()).homebrew.find((e) => e.install_path.startsWith(`switch/${dir}/`));
    const inside = (e) => {
      for (const f of e.files ?? []) assert.ok(f.path.startsWith(`${e.install_dir}/`) && !f.path.includes(".."), f.path);
      assert.match(e.install_path, /^switch\/[^/]+\/[^/]+\.nro$/);
    };

    // A wrapped release zip with files outside switch/ and a README.
    const nro = fakeNro("My App");
    let r = await send([["MyApp-v1.2.zip", makeZip(root, {
      "MyApp-v1.2/switch/myapp/myapp.nro": nro, "MyApp-v1.2/switch/myapp/data/a.bin": "A", "MyApp-v1.2/atmosphere/contents/x.bin": "X", "MyApp-v1.2/README.md": "read me",
    })]]);
    assert.equal(r.status, 201);
    let body = await r.json();
    assert.equal(body.where, "switch/myapp");
    assert.deepEqual(body.install.excluded.map((x) => x.rule).sort(), ["junk", "outside-switch"]);
    assert.ok(body.install.rules.includes("wrapper: peeled off MyApp-v1.2/"));
    let e = await listed("myapp");
    assert.equal(e.install_dir, "switch/myapp");
    assert.equal(e.install_path, "switch/myapp/myapp.nro");
    assert.deepEqual(e.files.map((f) => [f.path, f.size]), [["switch/myapp/data/a.bin", 1], ["switch/myapp/myapp.nro", nro.length]]);
    assert.equal(e.size, 1 + nro.length, "size is everything a folder install puts on the card");
    assert.equal(e.nro_size, nro.length);
    inside(e);
    const a = await fetch(BASE + e.files[0].url, { headers: { Authorization: ALICE } });
    assert.equal(await a.text(), "A");
    // The same files in one tar: the data file's body sits right after its header.
    const tar = Buffer.from(await (await fetch(BASE + e.bundle_url, { headers: { Authorization: ALICE } })).arrayBuffer());
    const at = tar.indexOf("switch/myapp/data/a.bin\0");
    assert.ok(at >= 0);
    assert.equal(tar.subarray(at + 512, at + 513).toString(), "A");
    // A file changed since the listing: the bundle is refused until the folder is read again.
    fs.appendFileSync(path.join(dirs.homebrew, "myapp", "data", "a.bin"), "B");
    assert.equal((await fetch(BASE + e.bundle_url, { headers: { Authorization: ALICE } })).status, 503);
    for (let i = 0; i < 40 && (await listed("myapp")).files.find((f) => f.path.endsWith("a.bin")).size !== 2; i++) await new Promise((r) => setTimeout(r, 250));
    assert.equal((await fetch(BASE + e.bundle_url, { headers: { Authorization: ALICE } })).status, 200);
    e = await listed("myapp");
    assert.ok(!fs.existsSync(path.join(dirs.homebrew, "myapp", "atmosphere")), "nothing outside switch/<app>/ is kept");
    assert.deepEqual(fs.readdirSync(dirs.homebrew).filter((n) => !n.startsWith(".")), ["myapp"]);

    // A folder without switch/: its own folder becomes switch/<it>/.
    r = await send([["tool.nro", nro], ["tool.cfg", "c"]], ["Tool/tool.nro", "Tool/tool.cfg"]);
    assert.equal(r.status, 201);
    e = await listed("Tool");
    assert.deepEqual([e.install_dir, e.install_path, e.files.map((f) => f.path)], ["switch/Tool", "switch/Tool/tool.nro", ["switch/Tool/tool.cfg", "switch/Tool/tool.nro"]]);
    inside(e);

    // A lone .nro is served alone, in its own folder.
    r = await send([["solo.nro", nro]]);
    assert.equal(r.status, 201);
    e = await listed("solo");
    assert.deepEqual([e.install_dir, e.install_path, e.files, e.size, e.nro_size], [null, "switch/solo/solo.nro", null, nro.length, undefined]);

    // Picked as a port on upload: marked a port at once, and a later plain upload keeps it one.
    const asPort = new FormData();
    asPort.append("port", "true");
    asPort.append("files", new Blob([fakeNro("Port Game")]), "portgame.nro");
    r = await fetch(`${BASE}/admin/api/upload/homebrew`, { method: "POST", headers: admin, body: asPort });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).kind, "port");
    assert.equal((await listed("portgame")).kind, "port");
    r = await send([["portgame.nro", fakeNro("Port Game")]]);
    assert.equal((await r.json()).kind, "port", "a plain re-upload does not turn a port back into a tool");

    // 5. The .nro is checked: not an NRO, or cut short, is refused and nothing is placed.
    r = await send([["bad.zip", makeZip(root, { "switch/bad/bad.nro": "this is not an nro".repeat(20), "switch/bad/x": "x" })]]);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /NRO/);
    r = await send([["cut.nro", nro.subarray(0, nro.length - 10)]]);
    assert.equal(r.status, 400);
    assert.ok(!fs.existsSync(path.join(dirs.homebrew, "bad")) && !fs.existsSync(path.join(dirs.homebrew, "cut")));

    // A port: its kind is listed, and patches and saves can be aimed at it.
    const myapp = await listed("myapp");
    assert.equal(myapp.kind, "tool");
    assert.equal(myapp.app, "myapp");
    const post = (url, body) => fetch(`${BASE}${url}`, { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post("/admin/api/homebrew/kind", { id: myapp.id, kind: "port" })).status, 200);
    assert.equal((await listed("myapp")).kind, "port");
    const targets = await (await fetch(`${BASE}/admin/api/upload/targets`, { headers: admin })).json();
    assert.deepEqual(targets.homebrew[0], { app: "myapp", name: "My App", kind: "port" }, "ports first");

    const sendTo = (kind, fields, files, paths) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      if (paths) fd.append("paths", JSON.stringify(paths));
      for (const [name, data] of files) fd.append("files", new Blob([data]), name);
      return fetch(`${BASE}/admin/api/upload/${kind}`, { method: "POST", headers: admin, body: fd });
    };
    r = await sendTo("patch", { homebrew: "myapp", name: "HD Textures" }, [["a.txt", "MOD"]], ["pack/switch/myapp/mods/a.txt"]);
    assert.equal(r.status, 201);
    assert.equal((await r.json()).where, "homebrew/myapp/HD Textures");
    assert.equal((await sendTo("patch", { homebrew: "myapp", name: "Bad" }, [["x", "X"]], ["atmosphere/contents/0100000000010000/romfs/x"])).status, 400, "nothing outside switch/<app>/");
    let patch = null;
    for (let i = 0; i < 40 && !patch; i++) {
      const pr = await fetch(`${BASE}/api/patches`, { headers: { Authorization: ALICE } });
      if (pr.ok) patch = (await pr.json()).patches.find((p) => p.homebrew === "myapp");
      if (!patch) await new Promise((res) => setTimeout(res, 250));
    }
    assert.ok(patch, "the homebrew patch is listed");
    assert.deepEqual([patch.title_id, patch.homebrew, patch.name, patch.kinds, patch.files], [null, "myapp", "HD Textures", ["homebrew"], 1]);
    const tarText = Buffer.from(await (await fetch(`${BASE}/api/patches/${patch.id}/download`, { headers: { Authorization: ALICE } })).arrayBuffer()).toString("latin1");
    assert.ok(tarText.includes("switch/myapp/mods/a.txt") && tarText.includes("MOD"), "its files go under switch/<app>/");

    r = await sendTo("save", { homebrew: "myapp", name: "100%" }, [["slot1.sav", "SAVE"]], ["MySave/save/slot1.sav"]);
    assert.equal(r.status, 201);
    const save = (await (await fetch(`${BASE}/api/saves`, { headers: { Authorization: ALICE } })).json()).saves.find((x) => x.homebrew === "myapp");
    assert.deepEqual([save.titleId, save.homebrew, save.installRoot, save.name, save.files], [null, "myapp", "switch/myapp", "100%", 1]);
    const saveTar = Buffer.from(await (await fetch(BASE + save.url, { headers: { Authorization: ALICE } })).arrayBuffer()).toString("latin1");
    assert.ok(saveTar.includes("save/slot1.sav") && !saveTar.includes("MySave"), "paths are relative to installRoot");
  } finally {
    server.kill();
  }
});

test("a hand-placed app's file hashes are remembered in the index, so a restart doesn't read them again", async () => {
  const { scanManual, useManualHashes } = await import("../../src/meta/homebrew.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-hash-"));
  const app = path.join(root, "apps", "big");
  fs.mkdirSync(path.join(app, "data"), { recursive: true });
  fs.writeFileSync(path.join(app, "big.nro"), fakeNro("Big"));
  fs.writeFileSync(path.join(app, "data", "x.bin"), "X");
  fs.writeFileSync(path.join(app, ".cookingfoil.json"), JSON.stringify({ nro: "big.nro", mode: "folder" }));
  const dbFile = path.join(root, "index.db");
  const rows = (db) => db.prepare("SELECT path FROM file_hashes WHERE scope = 'homebrew'").all();
  const db = openDatabase(dbFile);
  useManualHashes(hashStore(db, "homebrew"), root);
  const [first] = await scanManual(path.join(root, "apps"));
  assert.deepEqual([first.install_dir, first.files.map((f) => f.path)], ["switch/big", ["switch/big/big.nro", "switch/big/data/x.bin"]]);
  assert.equal(rows(db).length, 2);
  // A fresh process: the hash comes from the index, not from reading x.bin (planted to prove it).
  const xbin = path.join(app, "data", "x.bin");
  db.prepare("UPDATE file_hashes SET hash = 'remembered' WHERE path = ?").run(xbin);
  const reopened = openDatabase(dbFile);
  useManualHashes(hashStore(reopened, "homebrew"), root);
  const [again] = await scanManual(path.join(root, "apps"));
  assert.equal(again.files.find((f) => f.path === "switch/big/data/x.bin").sha256, "remembered");
  // A file gone is forgotten.
  fs.rmSync(xbin);
  await scanManual(path.join(root, "apps"));
  assert.equal(rows(reopened).length, 1);
});

test("a hand-placed app's install guides stay on the server; its own text data goes to the console", async () => {
  const { scanManual, useManualHashes } = await import("../../src/meta/homebrew.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-docs-"));
  const app = path.join(root, "apps", "game");
  const put = (rel, body = "x") => {
    fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
    fs.writeFileSync(path.join(app, rel), body);
  };
  put("game.nro", fakeNro("Game"));
  for (const rel of ["설치-스위치.md", "README.txt", "guide.pdf", "Thumbs.db", "Plugins/CJK/README_CJK.md",
    "Data/ServerUrl.txt", "Plugins/HotFixes/meta.txt", "Plugins/notes.md"]) put(rel);
  fs.writeFileSync(path.join(app, ".cookingfoil.json"), JSON.stringify({ nro: "game.nro", mode: "folder" }));
  useManualHashes(hashStore(openDatabase(":memory:"), "homebrew"), path.dirname(path.join(root, "hashes.json")));
  const [entry] = await scanManual(path.join(root, "apps"));
  assert.deepEqual(entry.files.map((f) => f.path), [
    "switch/game/Data/ServerUrl.txt", "switch/game/Plugins/HotFixes/meta.txt", "switch/game/Plugins/notes.md", "switch/game/game.nro",
  ]);
});

test("a hand-placed app with a file the console can't create is kept off the list and shown to the admin", async () => {
  const { scanManual, useManualHashes, heldManual } = await import("../../src/meta/homebrew.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-ascii-"));
  const app = path.join(root, "apps", "game");
  fs.mkdirSync(path.join(app, "Audio"), { recursive: true });
  fs.writeFileSync(path.join(app, "game.nro"), fakeNro("Game"));
  fs.writeFileSync(path.join(app, "Audio", "전투.ogg"), "x");
  fs.writeFileSync(path.join(app, ".cookingfoil.json"), JSON.stringify({ nro: "game.nro", mode: "folder" }));
  useManualHashes(hashStore(openDatabase(":memory:"), "homebrew"), path.dirname(path.join(root, "hashes.json")));
  assert.deepEqual(await scanManual(path.join(root, "apps")), []);
  const [held] = heldManual();
  assert.equal(held.folder, "game");
  assert.match(held.reason, /Audio\/전투\.ogg/);
  // Renamed, it comes back.
  fs.renameSync(path.join(app, "Audio", "전투.ogg"), path.join(app, "Audio", "battle.ogg"));
  assert.equal((await scanManual(path.join(root, "apps"))).length, 1);
  assert.deepEqual(heldManual(), []);
});

test("an upload with a file the console can't create is refused, naming the path and why", async () => {
  const { placeHomebrew, HomebrewUploadError } = await import("../../src/routes/admin/homebrew-upload.js");
  const items = ["game/game.nro", "game/Audio/전투.ogg", "game/설치.md"].map((rel) => ({ rel, abs: `/nonexistent/${rel}` }));
  await assert.rejects(placeHomebrew(items, "/nonexistent"), (err) => err instanceof HomebrewUploadError && /Audio\/전투\.ogg/.test(err.message) && !/설치\.md/.test(err.message));
});

test("an app kept as a zip is listed from inside it and sent whole, never unpacked on the server", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-zip-"));
  const dirs = Object.fromEntries(["data", "games", "homebrew", "patches", "saves"].map((k) => [k, path.join(root, k)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  // A wrapped release zip, put by hand in its own folder, with a README outside the app.
  fs.mkdirSync(path.join(dirs.homebrew, "zipped"));
  const zipBytes = makeZip(root, {
    "Zipped-v2/switch/zipped/zipped.nro": fakeNro("Zipped App"),
    "Zipped-v2/switch/zipped/data/level 1+2.dat": "LEVEL",
    "Zipped-v2/README.md": "read me",
  });
  fs.writeFileSync(path.join(dirs.homebrew, "zipped", "Zipped-v2.zip"), zipBytes);
  const server = await boot(dirs);
  try {
    let e = null;
    for (let i = 0; i < 40 && !e; i++) {
      const res = await fetch(`${BASE}/api/homebrew`, { headers: { Authorization: ALICE } });
      if (res.ok) e = (await res.json()).homebrew.find((x) => x.name === "Zipped App");
      if (!e) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(e, "the zipped app is listed");
    assert.deepEqual([e.install_dir, e.install_path, e.files, e.bundle_url], ["switch/zipped", "switch/zipped/zipped.nro", null, null]);
    assert.equal(e.archive.format, "zip");
    assert.equal(e.archive.url, `/api/homebrew/${e.id}/archive`);
    assert.equal(e.archive.size, zipBytes.length);
    assert.deepEqual(e.archive.entries.map((x) => [x.entry, x.path]).sort(), [
      ["Zipped-v2/switch/zipped/data/level 1+2.dat", "switch/zipped/data/level 1+2.dat"],
      ["Zipped-v2/switch/zipped/zipped.nro", "switch/zipped/zipped.nro"],
    ], "only what goes in the app folder, each with where it goes");
    assert.equal(e.size, e.archive.entries.reduce((n, x) => n + x.size, 0), "size is what lands on the card");
    assert.equal(e.hash, e.archive.sha256);

    // The zip comes whole, resumable; the .nro and icon come from inside it.
    const whole = await fetch(BASE + e.archive.url, { headers: { Authorization: ALICE } });
    assert.equal(whole.status, 200);
    assert.ok(Buffer.from(await whole.arrayBuffer()).equals(zipBytes));
    assert.equal(whole.headers.get("etag"), `"${e.archive.sha256}"`);
    const part = await fetch(BASE + e.archive.url, { headers: { Authorization: ALICE, Range: "bytes=10-" } });
    assert.equal(part.status, 206);
    const nro = Buffer.from(await (await fetch(BASE + e.download_url, { headers: { Authorization: ALICE } })).arrayBuffer());
    assert.ok(nro.equals(fakeNro("Zipped App")));
    assert.deepEqual(fs.readdirSync(path.join(dirs.homebrew, "zipped")), ["Zipped-v2.zip"], "nothing unpacked beside it");

    // Swapped for another zip, even one with an older file time (cp -p, rsync): a send under the
    // old ETag is refused rather than mixing versions, and the listing follows the new zip.
    const zipPath = path.join(dirs.homebrew, "zipped", "Zipped-v2.zip");
    const older = makeZip(root, {
      "Zipped-v2/switch/zipped/zipped.nro": fakeNro("Zipped Older"),
      "Zipped-v2/switch/zipped/data/level 1+2.dat": "OLD LEVEL",
    });
    fs.writeFileSync(zipPath, older);
    fs.utimesSync(zipPath, new Date("2020-01-01"), new Date("2020-01-01"));
    const stale = await fetch(BASE + e.archive.url, { headers: { Authorization: ALICE, Range: "bytes=10-", "If-Range": `"${e.archive.sha256}"` } });
    assert.equal(stale.status, 503);
    assert.equal(stale.headers.get("retry-after"), "5");
    let swapped = null;
    for (let i = 0; i < 40 && !swapped; i++) {
      await new Promise((r) => setTimeout(r, 250));
      swapped = (await (await fetch(`${BASE}/api/homebrew`, { headers: { Authorization: ALICE } })).json()).homebrew.find((x) => x.id === e.id && x.name === "Zipped Older");
    }
    assert.ok(swapped, "name and icon come from the new zip, not the earlier copy");
    assert.equal(swapped.archive.size, older.length);
    const fresh = await fetch(BASE + swapped.archive.url, { headers: { Authorization: ALICE } });
    assert.ok(Buffer.from(await fresh.arrayBuffer()).equals(older));
    e = swapped;

    // Removing it from the admin page takes its folder.
    const verify = await fetch(`${BASE}/admin/verify`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE }, body: JSON.stringify({ password: "admin-password-123" }) });
    const admin = { Authorization: ALICE, Cookie: verify.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
    const rm = await fetch(`${BASE}/admin/api/homebrew/manual/remove`, { method: "POST", headers: admin, body: JSON.stringify({ id: e.id }) });
    assert.equal(rm.status, 200);
    assert.ok(!fs.existsSync(path.join(dirs.homebrew, "zipped")));
  } finally {
    server.kill();
  }
});

test("a zip that can't go on the card as it is stays out of the list, and the scan goes on", async () => {
  const { scanManual, useManualHashes, extractNro } = await import("../../src/meta/homebrew.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-badzip-"));
  const apps = path.join(root, "apps");
  const put = (folder, name, bytes) => { fs.mkdirSync(path.join(apps, folder), { recursive: true }); fs.writeFileSync(path.join(apps, folder, name), bytes); };
  useManualHashes(hashStore(openDatabase(":memory:"), "homebrew"), path.dirname(path.join(root, "data", "hashes.json")));
  // A space in the app folder would install only the .nro, under a name the card may refuse.
  put("spaced", "a.zip", makeZip(root, { "switch/My App/My App.nro": fakeNro("Spaced"), "switch/My App/data.bin": "D" }));
  // Not a zip at all.
  put("broken", "b.zip", "this is not a zip");
  // A zip with no app in it.
  put("empty", "c.zip", makeZip(root, { "readme.txt": "hi" }));
  put("good", "d.zip", makeZip(root, { "switch/good/good.nro": fakeNro("Good"), "switch/good/x.bin": "X" }));
  const list = await scanManual(apps);
  assert.deepEqual(list.map((x) => x.name), ["Good"]);
  assert.deepEqual(list[0].archive.entries.map((x) => x.path), ["switch/good/good.nro", "switch/good/x.bin"]);

  // Copying out to a place that can't be written fails the copy, not the process.
  const zip = path.join(apps, "good", "d.zip");
  await assert.rejects(extractNro(zip, "x/good", path.join(root, "missing", "dir", "good.nro")));
});

test("a folder app whose launcher names its own SD folder is installed into that folder", async () => {
  const { scanManual, useManualHashes } = await import("../../src/meta/homebrew.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-dir-"));
  const app = path.join(root, "apps", "my-game");
  fs.mkdirSync(path.join(app, ".engine"), { recursive: true });
  const launcher = Buffer.concat([fakeNro("My Game"), Buffer.from('\0"sdmc:/switch/MyGame/.engine/core.nro"\0sdmc:/switch/MyGame/game/data.pak\0', "latin1")]);
  fs.writeFileSync(path.join(app, "mygame.nro"), launcher);
  fs.writeFileSync(path.join(app, ".engine", "core.nro"), "x");
  fs.writeFileSync(path.join(app, "launch.cfg"), 'system_directory = "sdmc:/switch/MyGame/system"\n');
  fs.writeFileSync(path.join(app, ".cookingfoil.json"), JSON.stringify({ nro: "mygame.nro", mode: "folder" }));
  useManualHashes(hashStore(openDatabase(":memory:"), "homebrew"), path.dirname(path.join(root, "hashes.json")));
  let [entry] = await scanManual(path.join(root, "apps"));
  assert.equal(entry.install_dir, "switch/MyGame");
  assert.equal(entry.install_path, "switch/MyGame/mygame.nro");
  assert.deepEqual(entry.files.map((f) => f.path), ["switch/MyGame/.engine/core.nro", "switch/MyGame/launch.cfg", "switch/MyGame/mygame.nro"]);

  // The admin's own choice in the manifest wins.
  fs.writeFileSync(path.join(app, ".cookingfoil.json"), JSON.stringify({ nro: "mygame.nro", mode: "folder", dir: "Chosen" }));
  [entry] = await scanManual(path.join(root, "apps"));
  assert.equal(entry.install_dir, "switch/Chosen");
});
