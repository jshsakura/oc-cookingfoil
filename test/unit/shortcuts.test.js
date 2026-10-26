import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { CONSOLE, seedConsole } from "../support/console.js";
import { adminSession } from "../support/web-session.js";

// HOME-menu shortcuts for homebrew apps and for the CookingFoil client itself: the console builds
// them, the server only names their title ID and a key that moves when the shortcut should change.
const PORT = 19300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
// The library is read by an approved console; changes go through the admin page.
const ALICE = CONSOLE;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-shortcuts-"));

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
  nacp.write("Maker", 0x200);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

async function boot() {
  const data = path.join(root, "data");
  fs.mkdirSync(path.join(data, "client"), { recursive: true });
  fs.writeFileSync(path.join(data, "client", "cookingfoil.nro"), fakeNro("CookingFoil", "0.2.0"));
  const hb = path.join(root, "homebrew", "mytool");
  fs.mkdirSync(hb, { recursive: true });
  fs.writeFileSync(path.join(hb, "mytool.nro"), fakeNro("My Tool", "1.0"));
  fs.mkdirSync(path.join(root, "games"));
  await seedConsole(data);
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(root, "games"),
      COOK_HOMEBREW_DIR: path.join(root, "homebrew"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false", COOK_UPLOADS_ENABLED: "true" },
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

const get = (p, headers = {}) => fetch(BASE + p, { headers: { ...ALICE, ...headers } });
test("the client and each homebrew app name their HOME-menu shortcut, and apps carry the admin's description", async () => {
  const server = await boot();
  try {
    const latest = await (await get("/api/client/latest")).json();
    assert.equal(latest.forwarder_title_id, "0512BCE4CF34D000", "a fixed title ID, so it is installed once");
    assert.ok(!("forwarder_url" in latest) && !("forwarder_size" in latest), "no shortcut package is offered");
    assert.equal((await get("/api/client/forwarder")).status, 404, "the server packs nothing");

    const [app] = (await (await get("/api/homebrew")).json()).homebrew;
    assert.equal(app.name, "My Tool");
    assert.match(app.forwarder_title_id, /^05[0-9A-F]{11}000$/);
    assert.ok(!("forwarder_url" in app) && !("forwarder_size" in app));
    assert.equal(app.description, null);
    assert.equal((await get(`/api/homebrew/${app.id}/forwarder`)).status, 404);

    // The admin writes a description: English for everyone, Korean for Korean readers.
    const A = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")), "Content-Type": "application/json" };
    const post = (p, body) => fetch(BASE + p, { method: "POST", headers: A, body: JSON.stringify(body) });
    assert.equal((await post("/admin/api/homebrew/description", { id: app.id, en: "Handy tool.", ko: "쓸모 있는 도구입니다." })).status, 200);
    assert.equal((await post("/admin/api/homebrew/description", { id: "m-000000000000", en: "x" })).status, 404);
    assert.equal((await (await get("/api/homebrew?lang=ko")).json()).homebrew[0].description, "쓸모 있는 도구입니다.");
    assert.equal((await (await get("/api/homebrew", { "Accept-Language": "ja" })).json()).homebrew[0].description, "Handy tool.");
    const admin = await (await fetch(`${BASE}/admin/api/homebrew`, { headers: A })).json();
    assert.deepEqual(admin.manual[0].description, { custom: { en: "Handy tool.", ko: "쓸모 있는 도구입니다." }, github: null });
    await post("/admin/api/homebrew/description/reset", { id: app.id });
    assert.equal((await (await get("/api/homebrew")).json()).homebrew[0].description, null);

    // A new icon from the admin page goes into the .nro at once; the shortcut keeps its title ID and its key moves.
    const form = new FormData();
    form.append("file", new Blob([await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).png().toBuffer()], { type: "image/png" }), "icon.png");
    const up = await fetch(`${BASE}/api/art/homebrew/${app.id}/icon`, { method: "POST", headers: { Cookie: A.Cookie, Origin: A.Origin, "X-CSRF-Token": A["X-CSRF-Token"] }, body: form });
    assert.equal(up.status, 201);
    const rebuilt = (await (await get("/api/homebrew")).json()).homebrew[0];
    assert.equal(rebuilt.forwarder_title_id, app.forwarder_title_id, "the same title ID, so HOME keeps one shortcut");
    assert.notEqual(rebuilt.forwarder_key, app.forwarder_key, "a new icon moves the key");

    // The .nro itself carries the same icon: the list's size and hash are the copy's, and that copy is what is sent.
    assert.notEqual(rebuilt.hash, app.hash);
    const sent = Buffer.from(await (await get(rebuilt.download_url)).arrayBuffer());
    assert.equal(sent.length, rebuilt.size);
    assert.equal(crypto.createHash("sha256").update(sent).digest("hex"), rebuilt.hash);
    const nroSize = sent.readUInt32LE(0x18);
    const iconOff = Number(sent.readBigUInt64LE(nroSize + 0x08));
    assert.deepEqual([...sent.subarray(nroSize + iconOff, nroSize + iconOff + 3)], [0xff, 0xd8, 0xff], "a JPEG icon");
    assert.equal(sent.subarray(nroSize + Number(sent.readBigUInt64LE(nroSize + 0x18))).toString("latin1", 0, 7), "My Tool", "the NACP kept");

    // CPU cores are the server's per-app setting, sent with the app: 4 moves the shortcut's key.
    assert.equal(rebuilt.forwarder_cores, 3);
    assert.match(rebuilt.forwarder_key, /^[0-9a-f]{12}$/);
    assert.equal((await post("/admin/api/homebrew/cores", { id: app.id, cores: 5 })).status, 400);
    assert.equal((await post("/admin/api/homebrew/cores", { id: app.id, cores: 4 })).status, 200);
    const quad = (await (await get("/api/homebrew")).json()).homebrew[0];
    assert.equal(quad.forwarder_cores, 4);
    assert.notEqual(quad.forwarder_key, rebuilt.forwarder_key);
    assert.equal(quad.forwarder_title_id, app.forwarder_title_id);
    const apps = await (await fetch(`${BASE}/admin/api/homebrew/apps`, { headers: A })).json();
    assert.equal(apps.apps.find((a) => a.id === app.id).cores, 4);
  } finally {
    server.kill("SIGKILL");
  }
});
