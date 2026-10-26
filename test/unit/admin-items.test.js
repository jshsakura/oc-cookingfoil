import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminSession } from "../support/web-session.js";

// An admin device changes item settings from the console; any other caller only reads.
const PORT = 19400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "CD".repeat(32);

/** A minimal NRO whose NACP carries a name and a version. */
function fakeNro(name, version) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(name, 0);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

async function boot() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-admin-items-"));
  fs.mkdirSync(path.join(data, "games"));
  fs.mkdirSync(path.join(data, "hb", "tool"), { recursive: true });
  fs.writeFileSync(path.join(data, "hb", "tool", "tool.nro"), fakeNro("Tool", "1.0"));
  fs.writeFileSync(path.join(data, "games", "Test Game [0100000000010000][v0].nsp"), "");
  fs.mkdirSync(path.join(data, "retro", "roms", "md"), { recursive: true });
  fs.writeFileSync(path.join(data, "retro", "roms", "md", "Sonic (World).zip"), "x");
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_HOMEBREW_DIR: path.join(data, "hb"), COOK_HOMEBREW_REPOS: "", COOK_RETRO_DIR: path.join(data, "retro"), COOK_RETRO_META: "false",
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_DEVICE_PAIRING: "true",
      COOK_TITLEDB_AUTO_FETCH: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return { child, data };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("only a console the admin flagged reads and changes item settings, and each change is kept", async () => {
  const { child, data } = await boot();
  try {
    const A = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")), "Content-Type": "application/json" };
    const admin = (method, p, body) => fetch(`${BASE}${p}`, { method, headers: A, body: body === undefined ? undefined : JSON.stringify(body) });
    const pending = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    assert.equal((await admin("POST", "/admin/api/devices/approve", { code: pending.pairCode, label: "거실" })).status, 200);
    const { accessKey } = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    const D = { "X-Device-Key": KEY, "X-Access-Key": accessKey };
    const fromConsole = (method, p, body) => fetch(`${BASE}${p}`, { method, headers: { ...D, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const features = async () => (await (await fromConsole("GET", "/api/library/info")).json()).features;
    const apps = async () => (await (await fromConsole("GET", "/api/homebrew")).json()).homebrew;

    let app;
    for (let i = 0; i < 40 && !app; i++) {
      app = (await apps()).find((a) => a.name === "Tool");
      if (!app) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(app, "the hand-placed app is listed");
    const fieldsUrl = `/api/admin/items/homebrew/${app.id}/fields`;

    // Not flagged yet: reads only.
    assert.ok(!(await features()).includes("admin-edit"));
    assert.equal((await fromConsole("GET", fieldsUrl)).status, 403);
    const refused = await fromConsole("PATCH", fieldsUrl, { key: "verified", value: true });
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: "admin device only" });
    assert.equal((await admin("GET", fieldsUrl)).status, 403, "the admin's browser is no admin device");

    // The devices tab's switch.
    assert.equal((await admin("POST", "/admin/api/devices/admin", { deviceKey: KEY, admin: "yes" })).status, 400);
    assert.equal((await admin("POST", "/admin/api/devices/admin", { deviceKey: "EF".repeat(32), admin: true })).status, 404);
    assert.equal((await admin("POST", "/admin/api/devices/admin", { deviceKey: KEY, admin: true })).status, 200);
    assert.equal((await (await admin("GET", "/admin/api/devices")).json()).approved[0].admin, true);
    assert.ok((await features()).includes("admin-edit"));

    const listed = await (await fromConsole("GET", fieldsUrl)).json();
    assert.deepEqual(listed.fields.map((f) => [f.key, f.type, f.value]), [["verified", "toggle", false], ["enabled", "toggle", true], ["kind", "choice", "tool"], ["cores", "choice", "3"]]);
    assert.deepEqual(listed.fields[0].label, { ko: "검수됨", en: "Verified", ja: "動作確認済み", zh: "已驗證" });
    assert.deepEqual(listed.fields[3].options.map((o) => [o.value, o.label.ko]), [["3", "3 (기본)"], ["4", "4"]]);

    const changed = await fromConsole("PATCH", fieldsUrl, { key: "verified", value: true });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).fields.find((f) => f.key === "verified").value, true);
    assert.equal((await apps()).find((a) => a.id === app.id).verified, true, "the library's list says so too");

    for (const [body, status] of [[{ key: "nope", value: true }, 400], [{ key: "kind", value: "x" }, 400], [{ key: "cores", value: "9" }, 400],
      [{ key: "cores", value: 4 }, 400], [{ key: "verified", value: "yes" }, 400]]) {
      const r = await fromConsole("PATCH", fieldsUrl, body);
      assert.equal(r.status, status, JSON.stringify(body));
      assert.ok((await r.json()).error);
    }
    assert.equal((await fromConsole("PATCH", "/api/admin/items/homebrew/m-000000000000/fields", { key: "verified", value: true })).status, 404);
    assert.equal((await fromConsole("GET", "/api/admin/items/nothing/x/fields")).status, 404);
    assert.equal((await fromConsole("GET", "/api/admin/items/game/0100000000020000/fields")).status, 404, "not in the library");

    // A library game and a retro game have a verified switch, shown on their details.
    const game = await fromConsole("PATCH", "/api/admin/items/game/0100000000010000/fields", { key: "verified", value: true });
    assert.equal(game.status, 200);
    assert.deepEqual((await game.json()).fields.map((f) => [f.key, f.value]), [["verified", true]]);
    let retro;
    for (let i = 0; i < 40 && !retro; i++) {
      retro = (await (await fromConsole("GET", "/api/retro/games")).json()).games?.[0];
      if (!retro) await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(retro.verified, false);
    assert.equal((await fromConsole("PATCH", `/api/admin/items/retro/${retro.id}/fields`, { key: "verified", value: true })).status, 200);
    const shown = await (await fromConsole("GET", `/api/retro/games/${retro.id}`)).json();
    assert.equal(shown.verified, true);
    assert.match(shown.verified_at, /^\d{4}-\d\d-\d\dT/);
    assert.equal((await fromConsole("GET", "/api/admin/items/retro/md-0000000000/fields")).status, 404);

    // The dashboard's switches write the same history.
    assert.equal((await admin("POST", "/admin/api/homebrew/kind", { id: app.id, kind: "port" })).status, 200);
    assert.equal((await (await fromConsole("GET", fieldsUrl)).json()).fields.find((f) => f.key === "kind").value, "port");
    const { edits } = await (await admin("GET", "/admin/api/admin-edits?limit=10")).json();
    assert.equal(edits.length, 4);
    assert.deepEqual({ ...edits[0], at: null }, { at: null, via: "dashboard", device: null, deviceName: null, kind: "homebrew", id: app.id, key: "kind", before: "tool", after: "port" });
    assert.deepEqual([edits[1].kind, edits[2].kind], ["retro", "game"]);
    assert.deepEqual({ ...edits[3], at: null }, { at: null, via: "device", device: KEY, deviceName: "거실", kind: "homebrew", id: app.id, key: "verified", before: false, after: true });
    assert.equal(fs.readFileSync(path.join(data, "admin-edits.jsonl"), "utf8").trim().split("\n").length, 4);

    // Off again: reads only.
    assert.equal((await admin("POST", "/admin/api/devices/admin", { deviceKey: KEY, admin: false })).status, 200);
    assert.equal((await fromConsole("GET", fieldsUrl)).status, 403);
    assert.ok(!(await features()).includes("admin-edit"));
  } finally {
    child.kill("SIGKILL");
  }
});
