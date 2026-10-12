import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: dirs.data, COOK_GAMES_DIR: dirs.games, COOK_HOMEBREW_DIR: dirs.homebrew,
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
  const dirs = Object.fromEntries(["data", "games", "homebrew"].map((d) => [d, path.join(root, d)]));
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
    inside(e);
    const a = await fetch(BASE + e.files[0].url, { headers: { Authorization: ALICE } });
    assert.equal(await a.text(), "A");
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
    assert.deepEqual([e.install_dir, e.install_path, e.files], [null, "switch/solo/solo.nro", null]);

    // 5. The .nro is checked: not an NRO, or cut short, is refused and nothing is placed.
    r = await send([["bad.zip", makeZip(root, { "switch/bad/bad.nro": "this is not an nro".repeat(20), "switch/bad/x": "x" })]]);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /NRO/);
    r = await send([["cut.nro", nro.subarray(0, nro.length - 10)]]);
    assert.equal(r.status, 400);
    assert.ok(!fs.existsSync(path.join(dirs.homebrew, "bad")) && !fs.existsSync(path.join(dirs.homebrew, "cut")));
  } finally {
    server.kill();
  }
});
