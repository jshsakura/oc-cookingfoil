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
      forwarder_url: null, forwarder_title_id: null, forwarder_size: null,
    }, "no prod.keys here, so no shortcut");
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

    // A file that fails the checks is never offered; the last good build stays, and is what downloads.
    const offered = await (await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).json();
    const bump = () => fs.utimesSync(nro, new Date(), new Date(Date.now() + 5000 + Math.random() * 1000));
    for (const [label, bytes] of [
      ["an empty file", Buffer.alloc(0)],
      ["a truncated file", second.subarray(0, second.length - 100)],
      ["a file that isn't an NRO", Buffer.from("not an nro".repeat(50))],
      ["an older version", fakeNro("0.1.99")],
    ]) {
      fs.writeFileSync(nro, bytes);
      bump();
      assert.deepEqual(await (await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).json(), offered, label);
      const got = Buffer.from(await (await fetch(BASE + latest.url, { headers: AUTH })).arrayBuffer());
      assert.ok(got.equals(second), `${label}: the download is still the last good build`);
    }
    fs.writeFileSync(path.join(data, "client", ".cookingfoil.nro.tmp"), fakeNro("9.9.9"));
    assert.equal((await (await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).json()).version, "0.1.124", "a file still being written is not looked at");
  } finally {
    server.kill("SIGKILL");
  }
});

test("a console's error log is kept per console, newest 50, with a header line", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-clientlog-"));
  const server = await boot(data);
  const KEY = "AB12CD34" + "0".repeat(56);
  const send = (body, headers = {}) => fetch(`${BASE}/api/client/log`, {
    method: "POST", body,
    headers: { ...AUTH, "Content-Type": "text/plain", "X-Device-Key": KEY, Version: "0.1.10", ...headers },
  });
  try {
    assert.equal((await fetch(`${BASE}/api/client/log`, { method: "POST", body: "x", headers: { "Content-Type": "text/plain" } })).status, 401);
    assert.equal((await send("x", { "X-Device-Key": "" })).status, 400, "a device key is needed to file it");
    const r = await send("line 1\nline 2\n", { "X-Log-Reason": encodeURIComponent("alert: 게임을 받지 못했습니다") });
    assert.equal(r.status, 204);
    const dir = path.join(data, "client", "logs", "ab12cd34");
    const latest = fs.readFileSync(path.join(dir, "latest.txt"), "utf8");
    assert.match(latest, /^# received \S+Z · version 0\.1\.10 · reason alert: 게임을 받지 못했습니다\nline 1\nline 2\n$/);
    assert.equal(fs.readdirSync(dir).filter((f) => /^\d{8}-\d{6}/.test(f)).length, 1);
    assert.equal((await send("y".repeat(64 * 1024 + 1))).status, 413);
    for (let i = 0; i < 4; i++) await send("again");
    const limited = await send("one too many");
    assert.equal(limited.status, 429, "five a minute per console");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);

    // Old ones go once there are more than 50; latest.txt stays.
    for (let i = 0; i < 55; i++) fs.writeFileSync(path.join(dir, `20200101-0000${String(i).padStart(2, "0")}.txt`), "old");
    const { keepNewest } = await import("../../src/routes/client-log.js");
    await keepNewest(dir);
    const kept = fs.readdirSync(dir).filter((f) => /^\d{8}-\d{6}/.test(f)).sort();
    assert.equal(kept.length, 50);
    assert.ok(!kept.includes("20200101-000000.txt"), "the oldest went first");
    assert.ok(fs.existsSync(path.join(dir, "latest.txt")));
  } finally {
    server.kill("SIGKILL");
  }
});

test("a build's signature rides on /latest only while it matches the build offered", async () => {
  const { signatureFor } = await import("../../src/routes/client-update.js");
  const build = { version: "0.3.60", size: 17646240, sha256: "a".repeat(64) };
  const sig = { ...build, signature: "B".repeat(128) };
  assert.equal(signatureFor(build, sig), "b".repeat(128));
  assert.equal(signatureFor(build, { ...sig, sha256: "A".repeat(64) }), "b".repeat(128), "hex case does not matter");
  assert.equal(signatureFor(build, { ...sig, version: "0.3.59" }), null);
  assert.equal(signatureFor(build, { ...sig, size: 1 }), null);
  assert.equal(signatureFor(build, { ...sig, sha256: "c".repeat(64) }), null);
  assert.equal(signatureFor(build, { ...sig, signature: "zz" }), null);
  assert.equal(signatureFor(build, null), null);
  assert.equal(signatureFor(null, sig), null);
});

test("/latest carries the signature file's signature for the build being offered", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-client-sig-"));
  const server = await boot(data);
  try {
    const nro = path.join(data, "client", "cookingfoil.nro");
    fs.mkdirSync(path.dirname(nro));
    const buf = fakeNro("0.3.60");
    fs.writeFileSync(nro, buf);
    const latest = async () => (await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).json();
    assert.equal((await latest()).signature, undefined, "no file, no signature");
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const signature = "e".repeat(128);
    fs.writeFileSync(`${nro}.sig.json`, JSON.stringify({ version: "0.3.60", size: buf.length, sha256, signature }));
    assert.equal((await latest()).signature, signature);
    fs.writeFileSync(`${nro}.sig.json`, JSON.stringify({ version: "0.3.60", size: buf.length + 1, sha256, signature }));
    assert.equal((await latest()).signature, undefined, "a signature for other bytes is dropped");
  } finally {
    server.kill("SIGKILL");
  }
});
