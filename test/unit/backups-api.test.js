import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FAKE_WORK } from "./fixtures/vita-card.js";

// /api/backups as a Vita uses it: begin names only what the account lacks, a cut PUT goes on from where the
// server is, finish makes a version only when every file arrived whole, and a unit keeps its last versions.
// A secret file goes back to the account's own Vita and nobody else, is stored sealed only, and does not open
// once moved to another version.
const root = mkdtempSync(path.join(tmpdir(), "cf-backups-api-"));
const backups = path.join(root, "backups");
mkdirSync(backups, { recursive: true });
Object.assign(process.env, {
  COOK_PORT: "0", COOK_DATA_DIR: path.join(root, "data"), COOK_GAMES_DIR: path.join(root, "games"), COOK_BACKUPS_DIR: backups,
  COOK_AUTH_USERS: "alice:alice-password,bob:bob-password", COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "true",
  COOK_TITLEDB_AUTO_FETCH: "false", COOK_PUBLIC_BASE_URL: "", COOK_LOCKOUT_TRUST_LOOPBACK: "false", COOK_BACKUP_KEEP: "2",
});
mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
const settings = await import("../../src/security/server-settings.js");
const { default: server } = await import("../../src/index.js");
if (!server.listening) await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
  setTimeout(() => process.exit(), 100);
});

const basic = (name) => "Basic " + Buffer.from(`${name}:${name}-password`).toString("base64");
async function pair(deviceKey, owner, platform) {
  await fetch(`${base}/api/pair/request`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": deviceKey, Authorization: basic(owner) },
    body: JSON.stringify(platform ? { platform } : {}),
  });
  const status = await (await fetch(`${base}/api/pair/status?deviceKey=${deviceKey}`, { headers: { Authorization: basic(owner) } })).json();
  assert.equal(status.status, "approved");
  return { "X-Device-Key": deviceKey, "X-Access-Key": status.accessKey };
}
// Alice signed in on the web page: the cookies a browser holds after the sign-in form.
async function webSession(name) {
  const page = await fetch(`${base}/login`, { headers: { Accept: "text/html" } });
  const csrf = page.headers.getSetCookie().find((c) => c.startsWith("cf_csrf=")).split(";")[0];
  const login = await fetch(`${base}/login`, {
    method: "POST", redirect: "manual", headers: { Cookie: csrf, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: name, password: `${name}-password`, csrf: csrf.split("=")[1], next: "/" }),
  });
  const cookies = login.headers.getSetCookie().map((c) => c.split(";")[0]);
  assert.ok(cookies.length, "signed in");
  return { Cookie: [csrf, ...cookies].join("; ") };
}
const ALICE_VITA = await pair("A1".repeat(32), "alice", "vita");
const ALICE_SWITCH = await pair("A2".repeat(32), "alice");
const BOB_VITA = await pair("B1".repeat(32), "bob", "vita");

const sha = (text) => createHash("sha256").update(text).digest("hex");
const file = (p, body) => ({ path: p, size: Buffer.byteLength(body), mtime: 1700000000, sha256: sha(body) });
function manifest(files, secrets = []) {
  return {
    format: 1, platform: "vita", kind: "app", unit: "PCSE00001", root: "app/PCSE00001", title: "Example", version: "01.00",
    category: "gd", files, secrets: secrets.map((s) => ({ path: s.path, size: Buffer.byteLength(s.body), mtime: 1700000000 })),
  };
}
const KEY = "app:PCSE00001";
const WORK = { path: "sce_sys/package/work.bin", body: FAKE_WORK };
const call = (device, method, url, body, headers = {}) => fetch(base + url, {
  method, headers: { ...device, ...(body !== undefined && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}), ...headers },
  body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
});
const put = (device, id, p, offset, bytes) => call(device, "PUT", `/api/backups/upload/${id}?path=${encodeURIComponent(p)}&offset=${offset}`, Buffer.from(bytes));
const versions = async (device, key = KEY) => {
  const r = await call(device, "GET", `/api/backups/unit?key=${encodeURIComponent(key)}`);
  return r.status === 200 ? (await r.json()).versions.map((v) => v.version) : [];
};

// One whole upload of `files` and `secrets`; returns the version.
async function backup(device, files, secrets = [], bodies = {}) {
  const begun = await (await call(device, "POST", "/api/backups/begin", { key: KEY, manifest: manifest(files, secrets) })).json();
  for (const n of begun.need) assert.equal((await put(device, begun.upload, n.path, 0, bodies[n.path])).status, 200);
  for (const s of secrets) assert.equal((await put(device, begun.upload, s.path, 0, s.body)).status, 200);
  const done = await call(device, "POST", "/api/backups/finish", { upload: begun.upload });
  assert.equal(done.status, 200);
  return (await done.json()).version;
}

test("begin asks for what the account lacks, a cut upload goes on, and finish makes the version", async () => {
  const bodies = { "eboot.bin": "eboot-body", "sce_sys/param.sfo": "sfo-body" };
  const files = Object.entries(bodies).map(([p, b]) => file(p, b));
  const r = await call(ALICE_VITA, "POST", "/api/backups/begin", { key: KEY, manifest: manifest(files, [WORK]) });
  assert.equal(r.status, 200);
  const begun = await r.json();
  assert.deepEqual(begun.need.map((n) => n.path).sort(), ["eboot.bin", "sce_sys/param.sfo"]);
  assert.deepEqual(begun.needSecrets, [{ path: WORK.path, size: FAKE_WORK.length }]);
  assert.equal((await call(ALICE_VITA, "POST", "/api/backups/begin", { key: KEY, manifest: manifest(files) })).status, 409, "busy");

  assert.equal((await put(ALICE_VITA, begun.upload, "eboot.bin", 0, "eboot")).status, 200);
  const wrong = await put(ALICE_VITA, begun.upload, "eboot.bin", 0, "-body");
  assert.equal(wrong.status, 409);
  assert.deepEqual(await wrong.json(), { error: "the offset is not where the server is", code: "offset", received: 5 });
  const head = await call(ALICE_VITA, "HEAD", `/api/backups/upload/${begun.upload}?path=eboot.bin`);
  assert.equal(head.headers.get("x-received"), "5");
  assert.equal((await (await put(ALICE_VITA, begun.upload, "eboot.bin", 5, "-body")).json()).received, 10);
  assert.equal((await put(ALICE_VITA, begun.upload, "eboot.bin", 10, "x")).status, 413, "past the declared size");
  assert.equal((await put(ALICE_VITA, begun.upload, "elsewhere.bin", 0, "x")).status, 400);

  const early = await call(ALICE_VITA, "POST", "/api/backups/finish", { upload: begun.upload });
  assert.equal(early.status, 422);
  assert.deepEqual((await early.json()).paths.sort(), ["sce_sys/package/work.bin", "sce_sys/param.sfo"]);
  assert.equal((await put(ALICE_VITA, begun.upload, "sce_sys/param.sfo", 0, "sfo-body")).status, 200);
  assert.equal((await put(ALICE_VITA, begun.upload, WORK.path, 0, WORK.body)).status, 200);
  const done = await call(ALICE_VITA, "POST", "/api/backups/finish", { upload: begun.upload });
  assert.deepEqual(await done.json(), { key: KEY, version: 1 });
  assert.equal((await call(ALICE_VITA, "POST", "/api/backups/finish", { upload: begun.upload })).status, 410);

  const list = await (await call(ALICE_VITA, "GET", "/api/backups")).json();
  assert.equal(list.units.length, 1);
  assert.deepEqual({ ...list.units[0], updatedAt: 0 }, {
    key: KEY, kind: "app", unit: "PCSE00001", title: "Example", version: "01.00", category: "gd", latest: 1, versions: 1,
    bytes: 18 + FAKE_WORK.length, files: 2, secrets: 1, updatedAt: 0,
  });
  const again = await (await call(ALICE_VITA, "POST", "/api/backups/begin", { key: KEY, manifest: manifest(files, [WORK]) })).json();
  assert.deepEqual(again.need, [], "the bodies are the account's already");
  assert.equal(again.needSecrets.length, 1, "a secret is always sent");
  await put(ALICE_VITA, again.upload, WORK.path, 0, WORK.body);
  assert.deepEqual(await (await call(ALICE_VITA, "POST", "/api/backups/finish", { upload: again.upload })).json(), { key: KEY, version: 2 });
});

test("a file that arrives other than its manifest says makes no version", async () => {
  const before = await versions(ALICE_VITA);
  const begun = await (await call(ALICE_VITA, "POST", "/api/backups/begin", { key: KEY, manifest: manifest([file("odd.bin", "right")]) })).json();
  await put(ALICE_VITA, begun.upload, "odd.bin", 0, "wrong");
  const r = await call(ALICE_VITA, "POST", "/api/backups/finish", { upload: begun.upload });
  assert.equal(r.status, 422);
  assert.deepEqual((await r.json()).paths, ["odd.bin"]);
  assert.deepEqual(await versions(ALICE_VITA), before);
  await put(ALICE_VITA, begun.upload, "odd.bin", 0, "right");
  assert.equal((await call(ALICE_VITA, "POST", "/api/backups/finish", { upload: begun.upload })).status, 200, "sent again, it goes through");
});

test("a manifest with a path out of its unit, or another platform's, is refused", async () => {
  for (const bad of [manifest([file("../escape.bin", "x")]), manifest([file("a/./b", "x")]), { ...manifest([]), platform: "switch" },
    manifest([file("sce_sys/package/work.bin", "x")])]) {
    const r = await call(ALICE_VITA, "POST", "/api/backups/begin", { key: KEY, manifest: bad });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "manifest");
  }
  assert.equal((await call(ALICE_VITA, "POST", "/api/backups/begin", { key: "app:../../x", manifest: manifest([]) })).status, 400);
});

test("a unit keeps its last versions, and remove takes one or all", async () => {
  const bodies = { "eboot.bin": "eboot-body" };
  await backup(ALICE_VITA, [file("eboot.bin", "eboot-body")], [], bodies);
  const kept = await versions(ALICE_VITA);
  assert.equal(kept.length, 2, "COOK_BACKUP_KEEP=2");
  assert.ok(kept[0] > kept[1], "newest first");
  assert.equal((await call(ALICE_VITA, "POST", "/api/backups/remove", { key: KEY, version: kept[1] })).status, 200);
  assert.deepEqual(await versions(ALICE_VITA), [kept[0]]);
});

test("a file comes back with its sha256 as the ETag, from any byte", async () => {
  const [latest] = await versions(ALICE_VITA);
  const r = await call(ALICE_VITA, "GET", `/api/backups/file?key=${KEY}&version=${latest}&path=eboot.bin`, undefined, { Range: "bytes=6-" });
  assert.equal(r.status, 206);
  assert.equal(await r.text(), "body");
  assert.equal(r.headers.get("etag"), `"${sha("eboot-body")}"`);
});

test("a secret goes back to the account's own Vita only; everyone else hears there is no such unit", async () => {
  const version = await backup(ALICE_VITA, [file("eboot.bin", "eboot-body")], [WORK]);
  const url = `/api/backups/secret?key=${KEY}&version=${version}&path=${encodeURIComponent(WORK.path)}`;
  const mine = await call(ALICE_VITA, "GET", url);
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get("cache-control"), "no-store");
  assert.equal(await mine.text(), FAKE_WORK);
  for (const [who, headers] of [["another account's Vita", BOB_VITA], ["the account's Switch", ALICE_SWITCH], ["alice on the web", await webSession("alice")]]) {
    const r = await call(headers, "GET", url);
    assert.equal(r.status, 404, who);
    assert.deepEqual(await r.json(), { error: "no such backup", code: "unit" }, who);
  }
  assert.equal((await call({}, "GET", url)).status, 401, "no one signed in stops at the sign-in, as everywhere");
  const plain = await call(ALICE_VITA, "GET", `/api/backups/file?key=${KEY}&version=${version}&path=${encodeURIComponent(WORK.path)}`);
  assert.equal(plain.status, 404, "never as a plain file");
});

test("a secret moved to another version does not open there", async () => {
  const first = await backup(ALICE_VITA, [file("eboot.bin", "eboot-body")], [WORK]);
  const second = await backup(ALICE_VITA, [file("eboot.bin", "eboot-body")], [WORK]);
  const dirs = readdirSync(backups, { recursive: true }).filter((p) => /secrets\/[0-9a-f]{32}\/\d+$/.test(p));
  const of = (v) => path.join(backups, dirs.find((d) => d.endsWith(`/${v}`)));
  rmSync(of(second), { recursive: true });
  cpSync(of(first), of(second), { recursive: true });
  const r = await call(ALICE_VITA, "GET", `/api/backups/secret?key=${KEY}&version=${second}&path=${encodeURIComponent(WORK.path)}`);
  assert.equal(r.status, 410);
  assert.equal((await r.json()).code, "secret-lost");
  assert.equal((await call(ALICE_VITA, "GET", `/api/backups/secret?key=${KEY}&version=${first}&path=${encodeURIComponent(WORK.path)}`)).status, 200);
});

test("a secret on the way up is on the disk sealed only", async () => {
  const begun = await (await call(ALICE_VITA, "POST", "/api/backups/begin", { key: KEY, manifest: manifest([], [WORK]) })).json();
  await put(ALICE_VITA, begun.upload, WORK.path, 0, WORK.body);
  const all = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => readFileSync(path.join(e.parentPath, e.name)));
  for (const bytes of all(root)) {
    assert.equal(bytes.includes(FAKE_WORK), false);
    assert.equal(bytes.includes(sha(FAKE_WORK)), false);
  }
  // The manifest names its secret files (the console needs the paths back); the server's own records do not.
  for (const bytes of all(process.env.COOK_DATA_DIR)) assert.equal(bytes.includes("work.bin"), false);
  await call(ALICE_VITA, "POST", "/api/backups/finish", { upload: begun.upload });
});

test("another account's sign-in with a victim Vita's device key reaches none of the victim's backups", async () => {
  const version = await backup(ALICE_VITA, [file("eboot.bin", "eboot-body")], [WORK], { "eboot.bin": "eboot-body" });
  const victimKey = ALICE_VITA["X-Device-Key"];
  // The device key is no secret: it travels in a plain header. Bob signs in with his own password and names it.
  const tries = [];
  for (const how of [{ Authorization: basic("bob") }, await webSession("bob")]) {
    const r = await fetch(`${base}/api/session`, { headers: { ...how, "X-Device-Key": victimKey } });
    if (r.status === 200) tries.push({ "X-Device-Key": victimKey, Authorization: `Bearer ${(await r.json()).token}` });
    tries.push({ ...how, "X-Device-Key": victimKey });
  }
  const q = `key=${KEY}&version=${version}`;
  for (const headers of tries) {
    for (const [method, url, body] of [["GET", "/api/backups"], ["GET", `/api/backups/unit?key=${KEY}`], ["GET", `/api/backups/file?${q}&path=eboot.bin`],
      ["GET", `/api/backups/secret?${q}&path=${encodeURIComponent(WORK.path)}`], ["POST", "/api/backups/remove", { key: KEY }]]) {
      const r = await call(headers, method, url, body);
      const text = await r.text();
      assert.notEqual(r.status, 200, `${method} ${url} with ${Object.keys(headers).join("+")}`);
      assert.equal(text.includes(FAKE_WORK) || text.includes("eboot"), false, url);
    }
  }
  assert.ok((await versions(ALICE_VITA)).includes(version), "nothing was removed");
  const mine = await call(ALICE_VITA, "GET", `/api/backups/secret?${q}&path=${encodeURIComponent(WORK.path)}`);
  assert.equal(await mine.text(), FAKE_WORK, "the owner's own Vita still gets it");
});

test("a Switch has no backups of its own and cannot send a secret", async () => {
  assert.deepEqual(await (await call(ALICE_SWITCH, "GET", "/api/backups")).json(), { units: [] });
  const r = await call(ALICE_SWITCH, "POST", "/api/backups/begin", { key: KEY, manifest: manifest([], [WORK]) });
  assert.equal(r.status, 400);
});

test("an account past its backup quota is refused at begin", async () => {
  settings.save({ consoleBackupQuotaBytes: 64 });
  try {
    const r = await call(BOB_VITA, "POST", "/api/backups/begin", { key: KEY, manifest: manifest([file("big.bin", "x".repeat(100))]) });
    assert.equal(r.status, 507);
    assert.equal((await r.json()).code, "quota");
  } finally {
    settings.save({ consoleBackupQuotaBytes: null });
  }
});

test("with the backups folder gone, every address says backups are off", async () => {
  renameSync(backups, `${backups}-away`);
  try {
    const r = await call(ALICE_VITA, "GET", "/api/backups");
    assert.equal(r.status, 404);
    assert.equal((await r.json()).code, "backups-off");
  } finally {
    renameSync(`${backups}-away`, backups);
  }
});

test("the admin sees each account's backups as counts only, and each console's platform", async () => {
  const { backupStats } = await import("../../src/backups/stats.js");
  const stats = await backupStats();
  assert.equal(stats.on, true);
  const alice = stats.accounts.find((a) => a.name === "alice");
  assert.equal(alice.platforms.length, 1);
  const [vita] = alice.platforms;
  assert.equal(vita.platform, "vita");
  assert.equal(vita.units, 1);
  assert.ok(vita.versions >= 1 && vita.secrets === 1 && vita.bytes > 0 && alice.bytes > 0);
  const text = JSON.stringify(stats);
  for (const word of ["work.bin", "eboot", "PCSE00001", "Example", FAKE_WORK]) assert.equal(text.includes(word), false, word);

  const devices = await import("../../src/security/store.js");
  const platformOf = (key) => devices.devicesSnapshot().approved.find((d) => d.deviceKey === key).platform;
  assert.equal(platformOf(ALICE_VITA["X-Device-Key"]), "vita");
  assert.equal(platformOf(ALICE_SWITCH["X-Device-Key"]), "switch");
});

test("an upload notes each body's CRC-32 beside it and seals a secret's inside its seal", async () => {
  const zlib = await import("node:zlib");
  const { accountNamed } = await import("../../src/backups/account.js");
  const store = await import("../../src/backups/store.js");
  const { secretCrc } = await import("../../src/backups/secrets.js");
  const body = "a body to check its crc";
  const version = await backup(ALICE_VITA, [file("crc-check.bin", body)], [WORK], { "crc-check.bin": body });
  const alice = accountNamed("alice").id;
  const noted = readFileSync(`${store.blobPath(alice, sha(body))}.crc32`, "utf8");
  assert.equal(parseInt(noted, 16), zlib.crc32(body));
  assert.equal(await store.blobCrc(alice, sha(body)), zlib.crc32(body));
  assert.equal(await secretCrc(alice, "vita", KEY, version, WORK.path), zlib.crc32(FAKE_WORK));
  const workCrc = zlib.crc32(FAKE_WORK).toString(16).padStart(8, "0");
  for (const f of readdirSync(backups, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())) {
    assert.equal(readFileSync(path.join(f.parentPath, f.name), "latin1").includes(workCrc), false, "a secret's CRC is in no file outside its seal");
  }
});
