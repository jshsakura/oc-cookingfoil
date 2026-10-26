import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminSession } from "../support/web-session.js";

// The 검수됨 mark on patches and saves: set from an admin console, the dashboard
// or the library's edit panel, shown in /api/patches and /api/saves, and forgotten
// when the item moves to another game or is deleted.
const PORT = 22100 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "AB".repeat(32);
const TID = "0100000000010000";
const OTHER = "0100000000020000";

async function boot() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-verified-ps-"));
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(data, rel)), { recursive: true });
    fs.writeFileSync(path.join(data, rel), body);
  };
  put(`games/Test Game [${TID}][v0].nsp`, "");
  put(`games/Other Game [${OTHER}][v0].nsp`, "");
  put(`patches/${TID}/Korean/atmosphere/contents/${TID}/romfs/a.bin`, "aaaa");
  put(`patches/${TID}/Fps/atmosphere/contents/${TID}/romfs/b.bin`, "bbbb");
  put(`saves/${TID}/All Unlocked/save.dat`, "SAVE");
  put(`saves/${TID}/Start/save.dat`, "SAVE2");
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_PATCHES_DIR: path.join(data, "patches"), COOK_SAVES_DIR: path.join(data, "saves"), COOK_HOMEBREW_DIR: path.join(data, "hb"),
      COOK_HOMEBREW_REPOS: "", COOK_RETRO_DIR: path.join(data, "retro"), COOK_RETRO_META: "false",
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_DEVICE_PAIRING: "true",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_UPLOADS_ENABLED: "true" },
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

test("patches and saves carry a 검수됨 mark that admins set and moves or deletes forget", async () => {
  const { child, data } = await boot();
  try {
    const A = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")), "Content-Type": "application/json" };
    const admin = async (method, p, body) => fetch(`${BASE}${p}`, { method, headers: A, body: body === undefined ? undefined : JSON.stringify(body) });
    const pending = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    assert.equal((await admin("POST", "/admin/api/devices/approve", { code: pending.pairCode, label: "거실" })).status, 200);
    const { accessKey } = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    assert.equal((await admin("POST", "/admin/api/devices/admin", { deviceKey: KEY, admin: true })).status, 200);
    const D = { "X-Device-Key": KEY, "X-Access-Key": accessKey, "Content-Type": "application/json" };
    const fromConsole = (method, p, body) => fetch(`${BASE}${p}`, { method, headers: D, body: body === undefined ? undefined : JSON.stringify(body) });
    const patches = async () => (await (await fromConsole("GET", "/api/patches")).json()).patches;
    const saves = async () => (await (await fromConsole("GET", "/api/saves")).json()).saves;

    let listed = [];
    for (let i = 0; i < 40 && listed.length < 2; i++) {
      listed = await patches();
      if (listed.length < 2) await new Promise((r) => setTimeout(r, 250));
    }
    const korean = listed.find((p) => p.name === "Korean");
    const fps = listed.find((p) => p.name === "Fps");
    assert.ok(korean && fps, "both patches are listed");
    const { features } = await (await fromConsole("GET", "/api/library/info")).json();
    assert.ok(features.includes("user-patches") && features.includes("shop-saves") && features.includes("library-saves"), "a patch and a save to hand out turn both on");
    assert.deepEqual([korean.verified, korean.verified_at], [false, null]);
    const saveList = await saves();
    const save = saveList.find((s) => s.name === "All Unlocked");
    const other = saveList.find((s) => s.name === "Start");
    assert.deepEqual([save.verified, save.verified_at], [false, null]);

    // From an admin console.
    const p = await fromConsole("PATCH", `/api/admin/items/patch/${korean.id}/fields`, { key: "verified", value: true });
    assert.equal(p.status, 200);
    assert.deepEqual((await p.json()).fields.map((f) => [f.key, f.type, f.value]), [["verified", "toggle", true]]);
    const shown = (await patches()).find((x) => x.id === korean.id);
    assert.equal(shown.verified, true);
    assert.match(shown.verified_at, /^\d{4}-\d\d-\d\dT/);
    const s = await fromConsole("PATCH", `/api/admin/items/save/${save.id}/fields`, { key: "verified", value: true });
    assert.equal(s.status, 200);
    assert.equal((await saves()).find((x) => x.id === save.id).verified, true);
    assert.equal((await fromConsole("GET", `/api/admin/items/patch/${TID}-000000000000/fields`)).status, 404);
    assert.equal((await fromConsole("GET", `/api/admin/items/save/${TID}-000000000000/fields`)).status, 404);
    assert.equal((await fromConsole("GET", "/api/admin/items/patch/nope/fields")).status, 404);

    // The dashboard's pill, through the same history.
    assert.equal((await admin("POST", "/admin/api/content/patch/verified", { id: fps.id, verified: "yes" })).status, 400);
    assert.equal((await admin("POST", "/admin/api/content/patch/verified", { id: `${TID}-000000000000`, verified: true })).status, 404);
    assert.equal((await admin("POST", "/admin/api/content/nope/verified", { id: fps.id, verified: true })).status, 404);
    assert.equal((await admin("POST", "/admin/api/content/patch/verified", { id: fps.id, verified: true })).status, 200);
    assert.equal((await admin("POST", "/admin/api/content/save/verified", { id: other.id, verified: true })).status, 200);
    assert.equal((await (await admin("GET", "/admin/api/patches")).json()).patches.find((x) => x.id === fps.id).verified, true);
    assert.equal((await (await admin("GET", "/admin/api/saves")).json()).saves.find((x) => x.id === other.id).verified, true);
    const { edits } = await (await admin("GET", "/admin/api/admin-edits?limit=10")).json();
    assert.deepEqual(edits.map((e) => [e.via, e.kind, e.key, e.after]),
      [["dashboard", "save", "verified", true], ["dashboard", "patch", "verified", true], ["device", "save", "verified", true], ["device", "patch", "verified", true]]);

    // The library's edit panel for a patch.
    const meta = `/api/art/patch/${fps.id}/meta`;
    assert.equal((await (await admin("GET", meta)).json()).verified, true);
    assert.equal((await admin("POST", meta, { name: "Fps", verified: "no" })).status, 400);
    const off = await admin("POST", meta, { name: "Fps", verified: false });
    assert.equal(off.status, 200);
    assert.equal((await off.json()).verified, false);
    assert.equal((await patches()).find((x) => x.id === fps.id).verified, false);

    // Moved to another game: the id changes and the mark does not follow.
    assert.equal((await admin("POST", "/admin/api/content/patch/move", { id: korean.id, titleId: OTHER })).status, 200);
    const moved = (await patches()).find((x) => x.name === "Korean");
    assert.notEqual(moved.id, korean.id);
    assert.equal(moved.verified, false);
    // Deleted: put back under the same id, it comes back unmarked.
    assert.equal((await admin("POST", "/admin/api/content/save/remove", { id: save.id })).status, 200);
    fs.mkdirSync(path.join(data, "saves", TID, "All Unlocked"), { recursive: true });
    fs.writeFileSync(path.join(data, "saves", TID, "All Unlocked", "save.dat"), "SAVE");
    let back;
    for (let i = 0; i < 40 && !back; i++) {
      back = (await saves()).find((x) => x.id === save.id);
      if (!back) await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(back?.verified, false);
    const kept = JSON.parse(fs.readFileSync(path.join(data, "verified-items.json"), "utf8"));
    assert.deepEqual(Object.keys(kept), [`save:${other.id}`]);
  } finally {
    child.kill("SIGKILL");
  }
});
