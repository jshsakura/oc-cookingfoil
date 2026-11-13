import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

// What a Switch console reads from the server, recorded before platforms (Switch, Vita) came in, so no stage of
// that work changes a byte a Switch client gets. Each answer keeps its status, ETag, Content-Type and body.
// Values a run makes up (access keys, the port, the time) are replaced by names before comparing.
// GOLDEN_UPDATE=1 rewrites test/golden/switch-responses.json, only for a change meant to alter an answer.

const GOLDEN = path.join(import.meta.dirname, "..", "golden", "switch-responses.json");
const STAMP = 1728000000;
const root = mkdtempSync(path.join(tmpdir(), "cf-switch-golden-"));
const dir = (name) => { const p = path.join(root, name); mkdirSync(p, { recursive: true }); return p; };
const games = dir("games");
const retro = dir("retro");
dir("retro/roms/snes");
const files = {
  [path.join(games, "Test Game [0100000000010000][v0].nsp")]: "nsp",
  [path.join(games, "Test Game [0100000000010800][v65536].nsp")]: "update",
  [path.join(retro, "roms/snes/Sample Quest (Korea).sfc")]: "rom",
};
files[path.join(dir("data/client"), "cookingfoil.nro")] = "NRO0 not a real build";
files[path.join(dir("data"), "server-id")] = "00000000-0000-4000-8000-000000000000\n";
for (const [file, body] of Object.entries(files)) {
  writeFileSync(file, body);
  utimesSync(file, STAMP, STAMP);
}

Object.assign(process.env, {
  COOK_PORT: "0", COOK_DATA_DIR: dir("data"), COOK_GAMES_DIR: games, COOK_RETRO_DIR: retro,
  COOK_HOMEBREW_DIR: dir("homebrew"), COOK_PATCHES_DIR: dir("patches"), COOK_SAVES_DIR: dir("saves"),
  COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "true",
  COOK_TITLEDB_AUTO_FETCH: "false", COOK_PUBLIC_BASE_URL: "", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
});

const enroll = await import("../../src/security/enroll-tokens.js");
const store = await import("../../src/security/store.js");
const { default: server } = await import("../../src/index.js");
if (!server.listening) await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");
const KEY = "A1".repeat(32);
const ENROLLED = "B2".repeat(32);
const made = new Map();

function scrub(text) {
  let out = text.replaceAll(base, "http://SERVER");
  for (const [value, name] of made) out = out.replaceAll(value, name);
  out = out.replace(/\/pair\/[0-9a-f]{32}/g, "/pair/<link>").replace(/"expiresAt":\d{13}/g, '"expiresAt":"TIME"');
  return out.replace(/"(createdAt|updatedAt|requestedAt|at|time|checkedAt|generatedAt)":\s*\d{10,13}/g, '"$1":"TIME"');
}

async function record(name, url, init = {}) {
  const res = await fetch(base + url, init);
  const body = await res.text();
  try {
    const parsed = JSON.parse(body);
    for (const field of ["accessKey", "token", "sessionToken"]) {
      if (typeof parsed?.[field] === "string" && !made.has(parsed[field])) made.set(parsed[field], `<${field}:${made.size}>`);
    }
  } catch { /* not JSON */ }
  return { name, status: res.status, etag: etagOf(res.headers.get("etag"), body), type: res.headers.get("content-type"), body: scrub(body) };
}

// An ETag that is a hash of the body it came with (Express's weak one, the catalog's sha1) is kept as the name
// of that formula, since the body carries the run's port; any other ETag is kept whole.
const sha1 = (body, enc) => createHash("sha1").update(body).digest(enc);
function etagOf(tag, body) {
  if (!tag) return null;
  if (tag === `W/"${Buffer.byteLength(body).toString(16)}-${sha1(body, "base64").slice(0, 27)}"`) return "<express weak of body>";
  if (tag === `"${sha1(body, "base64url")}"`) return "<sha1 of body>";
  // A long hex ETag is stored as a short digest of itself: as exact a check, without a hash-like string in the file.
  if (/[0-9a-f]{32}/.test(tag)) return `<digest ${createHash("sha256").update(tag).digest("base64url").slice(0, 16)}>`;
  return tag;
}

const json = (headers, body) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("a Switch console reads the same answers, byte for byte, as before platforms", async () => {
  const out = [];
  out.push(await record("pair/request", "/api/pair/request", json({ "X-Device-Key": KEY }, { message: "hello" })));
  out.push(await record("pair/status pending", `/api/pair/status?deviceKey=${KEY}`));
  out.push(await record("pair/status approved", `/api/pair/status?deviceKey=${KEY}`, { headers: { Authorization: ALICE } }));
  const accessKey = [...made.keys()].find((v) => made.get(v).startsWith("<accessKey"));
  assert.ok(accessKey, "the console got its access key");
  out.push(await record("pair/enroll", "/api/pair/enroll", json({ "X-Device-Key": ENROLLED }, { token: enroll.issue("alice").token })));
  const device = { "X-Device-Key": KEY, "X-Access-Key": accessKey };
  const reads = [
    "/api/library/sections", "/api/library/info", "/api/title/0100000000010000", "/api/homebrew", "/api/patches",
    "/api/saves", "/api/saves?view=games", "/api/retro/systems", "/api/retro/home", "/api/retro/games?system=snes",
    "/api/retro/themes", "/api/retro/requirements", "/api/client/latest", "/api/client/strings?lang=ko", "/api/device/sends",
    "/api/firmware", "/api/backups",
  ];
  for (const url of reads) out.push(await record(url, url, { headers: device }));
  out.push(await record("/api/library/variants", "/api/library/variants", json(device, { files: ["Test Game [0100000000010000][v0].nsp"] })));
  for (const key of [KEY, ENROLLED]) assert.equal(store.getDevicePlatform?.(key) ?? "switch", "switch");

  const text = JSON.stringify(out, null, 1) + "\n";
  if (process.env.GOLDEN_UPDATE === "1") writeFileSync(GOLDEN, text);
  assert.equal(text, readFileSync(GOLDEN, "utf8"));
});
