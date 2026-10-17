import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

// HOME-menu shortcuts for homebrew apps and for the CookingFoil client itself,
// built with a stand-in hacBrewPack that writes <nspdir>/<titleid>.nsp naming the title ID.
const PORT = 19300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");
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
  const bin = path.join(root, "hacbrewpack");
  fs.writeFileSync(bin, `#!/bin/sh
tid=""; nsp=""
while [ $# -gt 0 ]; do
  case "$1" in --titleid) tid="$2"; shift ;; --nspdir) nsp="$2"; shift ;; esac
  shift
done
mkdir -p "$nsp" && echo "NSP $tid" > "$nsp/$tid.nsp"
`, { mode: 0o755 });
  const keys = path.join(root, "keys");
  fs.mkdirSync(keys);
  fs.writeFileSync(path.join(keys, "prod.keys"), `header_key = ${"ab".repeat(32)}\nkey_area_key_application_00 = ${"cd".repeat(16)}\n`);
  const data = path.join(root, "data");
  fs.mkdirSync(path.join(data, "client"), { recursive: true });
  fs.writeFileSync(path.join(data, "client", "cookingfoil.nro"), fakeNro("CookingFoil", "0.2.0"));
  const hb = path.join(root, "homebrew", "mytool");
  fs.mkdirSync(hb, { recursive: true });
  fs.writeFileSync(path.join(hb, "mytool.nro"), fakeNro("My Tool", "1.0"));
  fs.mkdirSync(path.join(root, "games"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(root, "games"),
      COOK_HOMEBREW_DIR: path.join(root, "homebrew"), COOK_KEYS_DIR: keys, COOK_HACBREWPACK_BIN: bin,
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

const get = (p, headers = {}) => fetch(BASE + p, { headers: { Authorization: ALICE, ...headers } });
/** Asks again until `ok(body)` holds (the NSP is built in the background). */
async function until(p, ok) {
  for (let i = 0; i < 40; i++) {
    const body = await (await get(p)).json();
    if (ok(body)) return body;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${p} never got there`);
}

test("the client and each homebrew app come with a HOME-menu shortcut built on its first download, and apps carry the admin's description", async () => {
  const server = await boot();
  try {
    const latest = await until("/api/client/latest", (b) => b.forwarder_url);
    assert.equal(latest.forwarder_size, null, "nothing is built ahead of time");
    assert.equal(latest.forwarder_url, "/api/client/forwarder");
    assert.equal(latest.forwarder_title_id, "0512BCE4CF34D000", "a fixed title ID, so it is installed once");
    const nsp = await get(latest.forwarder_url);
    assert.equal(nsp.status, 200);
    assert.equal((await nsp.text()).trim(), "NSP 0512bce4cf34d000");
    assert.equal(nsp.headers.get("x-forwarder-title-id"), "0512BCE4CF34D000");
    assert.ok((await (await get("/api/client/latest")).json()).forwarder_size > 0, "its size once built");

    const list = await until("/api/homebrew", (b) => b.homebrew[0]?.forwarder_url);
    const [app] = list.homebrew;
    assert.equal(app.forwarder_size, null);
    assert.equal(app.name, "My Tool");
    assert.match(app.forwarder_title_id, /^05[0-9A-F]{11}000$/);
    assert.equal(app.forwarder_url, `/api/homebrew/${app.id}/forwarder`);
    assert.equal(app.description, null);
    assert.equal((await (await get(app.forwarder_url)).text()).trim(), `NSP ${app.forwarder_title_id.toLowerCase()}`);
    assert.ok((await (await get("/api/homebrew")).json()).homebrew[0].forwarder_size > 0);
    assert.equal((await get("/api/homebrew/m-000000000000/forwarder")).status, 404);

    // The admin writes a description: English for everyone, Korean for Korean readers.
    const verify = await fetch(`${BASE}/admin/verify`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE }, body: JSON.stringify({ password: "admin-password-123" }) });
    const A = { Authorization: ALICE, Cookie: verify.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
    const post = (p, body) => fetch(BASE + p, { method: "POST", headers: A, body: JSON.stringify(body) });
    assert.equal((await post("/admin/api/homebrew/description", { id: app.id, en: "Handy tool.", ko: "쓸모 있는 도구입니다." })).status, 200);
    assert.equal((await post("/admin/api/homebrew/description", { id: "m-000000000000", en: "x" })).status, 404);
    assert.equal((await (await get("/api/homebrew?lang=ko")).json()).homebrew[0].description, "쓸모 있는 도구입니다.");
    assert.equal((await (await get("/api/homebrew", { "Accept-Language": "ja" })).json()).homebrew[0].description, "Handy tool.");
    const admin = await (await fetch(`${BASE}/admin/api/homebrew`, { headers: A })).json();
    assert.deepEqual(admin.manual[0].description, { custom: { en: "Handy tool.", ko: "쓸모 있는 도구입니다." }, github: null });
    await post("/admin/api/homebrew/description/reset", { id: app.id });
    assert.equal((await (await get("/api/homebrew")).json()).homebrew[0].description, null);

    // A new icon from the admin page builds the shortcut again at once (same title ID), and the old build goes.
    const fwdDir = path.join(root, "data", "homebrew-forwarders");
    const before = fs.readdirSync(fwdDir).filter((f) => f.startsWith(`homebrew-${app.id}-`));
    assert.equal(before.length, 1);
    const form = new FormData();
    form.append("file", new Blob([await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).png().toBuffer()], { type: "image/png" }), "icon.png");
    const up = await fetch(`${BASE}/api/art/homebrew/${app.id}/icon`, { method: "POST", headers: { Authorization: ALICE, Cookie: A.Cookie }, body: form });
    assert.equal(up.status, 201);
    let after = [];
    for (let i = 0; i < 40; i++) {
      after = fs.readdirSync(fwdDir).filter((f) => f.startsWith(`homebrew-${app.id}-`) && f.endsWith(".nsp"));
      if (after.length === 1 && after[0] !== before[0]) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(after.length, 1);
    assert.notEqual(after[0], before[0], "built again without a download");
    const rebuilt = (await (await get("/api/homebrew")).json()).homebrew[0];
    assert.equal(rebuilt.forwarder_title_id, app.forwarder_title_id, "the same title ID, so HOME keeps one shortcut");
    assert.ok(rebuilt.forwarder_size > 0);
  } finally {
    server.kill("SIGKILL");
  }
});
