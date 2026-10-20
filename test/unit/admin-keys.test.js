import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminSession } from "../support/web-session.js";

// prod.keys from the admin: a flagged console seals them to the server, the dashboard uploads them; nobody else learns of them.
const PORT = 24100 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "EF".repeat(32);
const HEADER = "a".repeat(64);
const FAKE = `header_key = ${HEADER}\nkey_area_key_application_00 = ${"b".repeat(32)}\nmaster_key_00 = ${"c".repeat(32)}\n`;

async function boot() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-admin-keys-"));
  fs.mkdirSync(path.join(data, "games"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_KEYS_DIR: path.join(data, "no-keys"), COOK_PROD_KEYS_PATH: "", COOK_HOMEBREW_REPOS: "", COOK_RETRO_META: "false",
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

/** The console's half of the envelope, as the route header documents it. */
function sealFor({ publicKey, nonce }, text) {
  const eph = crypto.createECDH("prime256v1");
  eph.generateKeys();
  const x = eph.computeSecret(Buffer.from(publicKey, "base64url"));
  const key = Buffer.from(crypto.hkdfSync("sha256", x, Buffer.alloc(0), "cookingfoil-prod-keys", 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(nonce, "utf8"));
  const ct = Buffer.concat([c.update(text, "utf8"), c.final(), c.getAuthTag()]);
  return { nonce, epk: eph.getPublicKey().toString("base64url"), iv: iv.toString("base64url"), ct: ct.toString("base64url") };
}

test("only an admin console and the admin dashboard hand the server prod.keys", async () => {
  const { child, data } = await boot();
  try {
    const A = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")), "Content-Type": "application/json" };
    const admin = (method, p, body) => fetch(`${BASE}${p}`, { method, headers: A, body: body === undefined ? undefined : JSON.stringify(body) });
    const pending = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    assert.equal((await admin("POST", "/admin/api/devices/approve", { code: pending.pairCode, label: "거실" })).status, 200);
    const { accessKey } = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    const D = { "X-Device-Key": KEY, "X-Access-Key": accessKey, "Content-Type": "application/json" };
    const fromConsole = (method, p, body) => fetch(`${BASE}${p}`, { method, headers: D, body: body === undefined ? undefined : JSON.stringify(body) });
    const info = async () => (await fromConsole("GET", "/api/shop/info")).json();

    // An ordinary console: nothing to see.
    let shown = await info();
    assert.ok(!shown.features.includes("keys-upload"));
    assert.equal(shown.keys, undefined, "whether the server has keys is not told");
    assert.equal((await fromConsole("GET", "/api/admin/keys")).status, 403);
    assert.equal((await fromConsole("POST", "/api/admin/keys/seal", {})).status, 403);
    assert.equal((await admin("GET", "/api/admin/keys")).status, 403, "the admin's browser is no admin device");

    assert.equal((await admin("POST", "/admin/api/devices/admin", { deviceKey: KEY, admin: true })).status, 200);
    shown = await info();
    assert.ok(shown.features.includes("keys-upload"));
    assert.deepEqual(shown.keys, { present: false });
    assert.equal((await (await fromConsole("GET", "/api/admin/keys")).json()).present, false);

    const box = await (await fromConsole("POST", "/api/admin/keys/seal", {})).json();
    assert.equal(Buffer.from(box.publicKey, "base64url").length, 65);
    assert.ok(box.expiresAt > Date.now());
    const env = sealFor(box, FAKE);
    const put = await fromConsole("PUT", "/api/admin/keys", env);
    assert.equal(put.status, 200);
    const st = await put.json();
    assert.deepEqual([st.present, st.source, st.keyCount, st.hasHeaderKey], [true, "upload", 3, true]);
    assert.ok(!JSON.stringify(st).includes(HEADER));
    assert.equal(fs.statSync(path.join(data, "keys", "prod.keys")).mode & 0o777, 0o600);
    assert.deepEqual((await info()).keys, { present: true });
    assert.equal((await fromConsole("PUT", "/api/admin/keys", env)).status, 410, "a nonce is spent once");

    const junkBox = await (await fromConsole("POST", "/api/admin/keys/seal", {})).json();
    const junk = await fromConsole("PUT", "/api/admin/keys", sealFor(junkBox, "<html>not keys</html>"));
    assert.equal(junk.status, 400);
    assert.equal((await junk.json()).reason, "format");
    const torn = await (await fromConsole("POST", "/api/admin/keys/seal", {})).json();
    const tornRes = await fromConsole("PUT", "/api/admin/keys", { ...sealFor(torn, FAKE), iv: crypto.randomBytes(12).toString("base64url") });
    assert.equal(tornRes.status, 400);
    assert.equal((await tornRes.json()).reason, "sealed");
    assert.equal((await fromConsole("PUT", "/api/admin/keys", { nonce: "never-issued", epk: env.epk, iv: env.iv, ct: env.ct })).status, 410);

    const history = await (await admin("GET", "/admin/api/admin-edits?limit=5")).json();
    assert.deepEqual([history.edits[0].via, history.edits[0].device, history.edits[0].id], ["device", KEY, "prod.keys"]);

    // The dashboard: status, remove, upload.
    assert.equal((await (await admin("GET", "/admin/api/server-settings")).json()).keys.source, "upload");
    assert.equal((await admin("DELETE", "/admin/api/keys")).status, 200);
    assert.equal((await (await admin("GET", "/admin/api/server-settings")).json()).keys.present, false);
    const bad = await admin("PUT", "/admin/api/keys", { text: "header_key = 12" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).reason, "no-header-key");
    const up = await admin("PUT", "/admin/api/keys", { text: FAKE });
    assert.equal(up.status, 200);
    assert.equal((await up.json()).keys.present, true);

    // Unflagged again: the console loses the lane.
    assert.equal((await admin("POST", "/admin/api/devices/admin", { deviceKey: KEY, admin: false })).status, 200);
    assert.equal((await fromConsole("GET", "/api/admin/keys")).status, 403);
    assert.equal((await info()).keys, undefined);
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(data, { recursive: true, force: true });
  }
});
