import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 16900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = { Authorization: "Basic " + Buffer.from("alice:alice-password").toString("base64") };

/** A minimal NRO: header, then an ASET block whose NACP carries `version`. */
function fakeNro(version) {
  const nroSize = 0x100;
  const head = Buffer.alloc(nroSize);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(nroSize, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18); // nacp offset, from the ASET start
  aset.writeBigUInt64LE(0x4000n, 0x20); // nacp size
  const nacp = Buffer.alloc(0x4000);
  nacp.write("CookingFoil", 0);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

async function boot(data) {
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false" },
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

test("the client finds its newest build, downloads it and sees a replaced one", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-client-"));
  const server = await boot(data);
  try {
    assert.equal((await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).status, 404, "nothing published yet");
    assert.equal((await fetch(`${BASE}/api/client/latest`)).status, 401, "same sign-in as everything else");

    const nro = path.join(data, "client", "cookingfoil.nro");
    fs.mkdirSync(path.dirname(nro));
    const first = fakeNro("0.1.123");
    fs.writeFileSync(nro, first);
    const latest = await (await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).json();
    assert.deepEqual(latest, {
      version: "0.1.123", size: first.length, sha256: crypto.createHash("sha256").update(first).digest("hex"), url: "/api/client/cookingfoil.nro",
    });
    const info = await (await fetch(`${BASE}/api/shop/info`, { headers: AUTH })).json();
    assert.ok(info.features.includes("client-update"));

    const dl = await fetch(BASE + latest.url, { headers: AUTH });
    assert.equal(dl.status, 200);
    assert.equal(Number(dl.headers.get("content-length")), first.length);
    assert.ok(Buffer.from(await dl.arrayBuffer()).equals(first));

    const second = fakeNro("0.1.124");
    fs.writeFileSync(nro, second);
    fs.utimesSync(nro, new Date(), new Date(Date.now() + 5000));
    assert.equal((await (await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).json()).version, "0.1.124", "a replaced file is read again");

    fs.writeFileSync(nro, "not an nro");
    assert.equal((await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).status, 404, "a broken file is never offered");
  } finally {
    server.kill("SIGKILL");
  }
});
