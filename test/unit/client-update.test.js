import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSOLE, CONSOLE_KEY, seedConsole } from "../support/console.js";

const PORT = 16900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
// An approved console: the library takes its keys, never a password.
const AUTH = CONSOLE;

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

/** Kills a booted server and waits until it is gone, so the next test's server never meets it on the same port. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise((r) => child.once("exit", r));
  child.kill("SIGKILL");
  await gone;
}

async function boot(data, extraEnv = {}) {
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  await seedConsole(data);
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false", ...extraEnv },
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
      forwarder_title_id: "0512BCE4CF34D000",
    }, "the shortcut is the console's to build: the server only names its title ID");
    const info = await (await fetch(`${BASE}/api/library/info`, { headers: AUTH })).json();
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
    await stop(server);
  }
});

test("a console's error log is kept per console, newest 50, with a header line", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-clientlog-"));
  const server = await boot(data);
  const send = (body, headers = {}) => fetch(`${BASE}/api/client/log`, {
    method: "POST", body,
    headers: { ...AUTH, "Content-Type": "text/plain", Version: "0.1.10", ...headers },
  });
  try {
    assert.equal((await fetch(`${BASE}/api/client/log`, { method: "POST", body: "x", headers: { "Content-Type": "text/plain" } })).status, 401);
    assert.equal((await send("x", { "X-Device-Key": "" })).status, 401, "a device key is needed to file it");
    const r = await send("line 1\nline 2\n", { "X-Log-Reason": encodeURIComponent("alert: 게임을 받지 못했습니다") });
    assert.equal(r.status, 204);
    const dir = path.join(data, "client", "logs", CONSOLE_KEY.slice(0, 8).toLowerCase());
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
    await stop(server);
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
    await stop(server);
  }
});

const latestOf = async () => (await fetch(`${BASE}/api/client/latest`, { headers: AUTH })).json();
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

test("in GitHub mode the newer of the manual and fetched builds is offered, the manual one on a tie", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-client-"));
  const manual = path.join(data, "client", "cookingfoil.nro");
  const github = path.join(data, "client", "github", "cookingfoil.nro");
  fs.mkdirSync(path.dirname(github), { recursive: true });
  fs.writeFileSync(manual, fakeNro("0.1.5"));
  const fetched = fakeNro("0.1.7");
  fs.writeFileSync(github, fetched);
  // A repository name the follower refuses before asking anyone: no network in tests.
  const server = await boot(data, { COOK_CLIENT_SOURCE: "github", COOK_CLIENT_RELEASE_REPO: "not-a-repo" });
  try {
    let latest = await latestOf();
    assert.equal(latest.version, "0.1.7");
    assert.equal(latest.sha256, sha(fetched), "the fetched build, as fetched");
    // The same version, other bytes (a name inside the NACP).
    const tie = fakeNro("0.1.7");
    tie.write("Manual", 0x100 + 0x38 + 0x100);
    fs.writeFileSync(manual, tie);
    latest = await latestOf();
    assert.equal(latest.sha256, sha(tie), "a manual build of the same version wins");
    assert.deepEqual(fs.readFileSync(github), fetched, "the fetched file is never touched by the manual one");
  } finally {
    await stop(server);
  }
});

test("in manual mode a fetched build is not looked at", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-client-"));
  const github = path.join(data, "client", "github", "cookingfoil.nro");
  fs.mkdirSync(path.dirname(github), { recursive: true });
  const manual = fakeNro("0.1.5");
  fs.writeFileSync(path.join(data, "client", "cookingfoil.nro"), manual);
  fs.writeFileSync(github, fakeNro("0.9.0"));
  const server = await boot(data, { COOK_CLIENT_SOURCE: "manual" });
  try {
    const latest = await latestOf();
    assert.equal(latest.version, "0.1.5");
    assert.equal(latest.sha256, sha(manual));
  } finally {
    await stop(server);
  }
});

test("a failing GitHub release leaves the server serving what it has, or no build, and everything else", async () => {
  // No build at all, and a release follower that fails on every check.
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-client-"));
  const server = await boot(data, { COOK_CLIENT_SOURCE: "github", COOK_CLIENT_RELEASE_REPO: "not-a-repo" });
  try {
    const r = await fetch(`${BASE}/api/client/latest`, { headers: AUTH });
    assert.equal(r.status, 404);
    assert.equal((await fetch(`${BASE}/api/library/sections`, { headers: AUTH })).status, 200, "the library is unaffected");
    assert.equal((await fetch(`${BASE}/healthz`)).status, 200);
    // A build dropped in afterwards is offered at once.
    fs.mkdirSync(path.join(data, "client"), { recursive: true });
    fs.writeFileSync(path.join(data, "client", "cookingfoil.nro"), fakeNro("0.1.5"));
    const latest = await latestOf();
    assert.equal(latest.version, "0.1.5");
  } finally {
    await stop(server);
  }
});

test("a console reads one language's strings, never a locked key, and asks again with its ETag", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-client-"));
  const server = await boot(data);
  try {
    const dir = path.join(import.meta.dirname, "../../i18n/client");
    const locked = JSON.parse(fs.readFileSync(path.join(dir, "locked.json"), "utf8"));
    const table = JSON.parse(fs.readFileSync(path.join(dir, "ko.json"), "utf8"));
    assert.equal((await fetch(`${BASE}/api/client/strings?lang=ko`)).status, 401, "same sign-in as everything else");

    const res = await fetch(`${BASE}/api/client/strings?lang=ko`, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.ok(Number(res.headers.get("content-length")) > 0, "a client can show how much is left");
    const body = await res.json();
    assert.equal(body.lang, "ko");
    assert.equal(body.base, null);
    const lockedInTable = locked.filter((k) => k in table);
    assert.ok(lockedInTable.length > 0, "the table translates some locked keys");
    assert.ok(lockedInTable.every((k) => !(k in body.strings)), "locked keys are never sent");
    assert.equal(Object.keys(body.strings).length, Object.keys(table).length - lockedInTable.length);

    const again = await fetch(`${BASE}/api/client/strings?lang=ko`, { headers: { ...AUTH, "If-None-Match": res.headers.get("etag"), "Cache-Control": "max-age=0" } });
    assert.equal(again.status, 304);
    assert.deepEqual(await (await fetch(`${BASE}/api/client/strings?lang=en`, { headers: AUTH })).json(), { lang: "en", base: null, strings: {} });
    const hant = await (await fetch(`${BASE}/api/client/strings?lang=zh-Hant`, { headers: AUTH })).json();
    assert.equal(hant.base, "zh");
    assert.equal((await fetch(`${BASE}/api/client/strings?lang=xx`, { headers: AUTH })).status, 404);

    const info = await (await fetch(`${BASE}/api/library/info`, { headers: AUTH })).json();
    assert.ok(info.features.includes("client-strings"));
    assert.deepEqual(info.client_strings.languages.find((l) => l.code === "ko"), { code: "ko", name: "한국어", base: null });
  } finally {
    await stop(server);
  }
});
