import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedRecords } from "../support/security-db.js";
import { seedConsole } from "../support/console.js";

// /games.json is the automation catalog: only an API token made on the admin
// page reads it. A console, a browser and a password get nothing there, and
// the retired addresses are gone.
const PORT = 18500 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_ID = "0a1b2c3d";
const TOKEN_SECRET = "s".repeat(40);
const TOKEN = { Authorization: `Bearer cft_${TOKEN_ID}_${TOKEN_SECRET}` };
const CAT_ID = "4e5f6a7b";
const CAT_SECRET = "c".repeat(40);
const CATALOG = { Authorization: `Bearer cft_${CAT_ID}_${CAT_SECRET}` };
const BASIC = { Authorization: "Basic " + Buffer.from("alice:alice-password").toString("base64") };

const data = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-json-route-"));
const games = path.join(data, "games");
fs.mkdirSync(games, { recursive: true });
fs.writeFileSync(path.join(games, "Game [0100000000010000][v0].nsp"), "NSP");
fs.writeFileSync(path.join(games, "Game [0100000000010800][v65536].nsp"), "UPD");

let child;
let consoleHeaders;
before(async () => {
  consoleHeaders = await seedConsole(data);
  await seedRecords(data, "api-token", {
    [TOKEN_ID]: { id: TOKEN_ID, owner: "alice", label: "scraper", hash: crypto.createHash("sha256").update(TOKEN_SECRET).digest("hex"), createdAt: 1, lastUsedAt: null },
    [CAT_ID]: { id: CAT_ID, owner: "alice", label: "catalog", scope: "catalog", hash: crypto.createHash("sha256").update(CAT_SECRET).digest("hex"), createdAt: 2, lastUsedAt: null },
  });
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_HOMEBREW_DIR: path.join(data, "homebrew"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true", COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_EXTRACT_ICONS: "off", COOK_RATING_SYNC: "false", COOK_FIRST_RUN_SETUP: "false",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});
after(() => {
  child?.kill("SIGKILL");
  fs.rmSync(data, { recursive: true, force: true });
});

const get = (url, headers = {}) => fetch(BASE + url, { headers });

test("an API token reads /games.json: files with the stamped names, nothing else", async () => {
  let body;
  for (let i = 0; i < 40; i++) {
    const r = await get("/games.json", TOKEN);
    assert.equal(r.status, 200);
    body = await r.json();
    if (body.files.length === 2) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.deepEqual(Object.keys(body), ["files"], "no success, no titledb");
  const base = body.files.find((f) => f.titleId === "0100000000010000");
  for (const key of ["url", "name", "titleId", "baseTitleId", "kind", "size", "mtime"]) assert.ok(key in base, key);
  assert.equal(base.name, "Game [0100000000010000][v0]");
  assert.equal(base.baseTitleId, "0100000000010000");
  assert.equal(base.iconUrl, undefined, "one icon field per item");
  const update = body.files.find((f) => f.titleId === "0100000000010800");
  assert.equal(update.name, "Game [0100000000010800][v65536]");
});

test("a console, a password and nobody at all get no /games.json", async () => {
  for (const [who, headers] of [["console keys", consoleHeaders], ["Basic", BASIC], ["no credentials", {}]]) {
    const r = await get("/games.json", headers);
    assert.ok([401, 404].includes(r.status), `${who}: ${r.status}`);
    assert.doesNotMatch(await r.text(), /"files"/, who);
  }
  assert.equal((await get("/games.json", { Authorization: `Bearer cft_${TOKEN_ID}_${"x".repeat(40)}` })).status, 401, "a wrong token");
});

test("games.json keeps its ETag and compression, and the old /shop.json and /api/shop addresses are gone", async () => {
  const headers = { ...TOKEN, 'Accept-Encoding': 'gzip' };
  const canonical = await get('/games.json', headers);
  assert.equal(canonical.status, 200);
  assert.ok((await canonical.json()).files.every((f) => f.url.startsWith(BASE + '/')));
  assert.equal(canonical.headers.get('content-encoding'), 'gzip');
  assert.equal((await get('/games.json', { ...headers, 'If-None-Match': canonical.headers.get('etag'), 'Cache-Control': 'max-age=0' })).status, 304);
  for (const credentials of [consoleHeaders, BASIC, {}]) {
    const denied = await get('/games.json', credentials);
    assert.ok([401, 404].includes(denied.status));
    assert.doesNotMatch(await denied.text(), /"files"/);
  }
  assert.notEqual((await get('/shop.json', TOKEN)).status, 200);
  for (const suffix of ['info', 'sections', 'icon/0100000000010000']) {
    assert.notEqual((await get('/api/shop/' + suffix, consoleHeaders)).status, 200, suffix);
  }
});

test("the library client paths answer a console and refuse an automation token", async () => {
  for (const suffix of ['info', 'sections']) {
    assert.equal((await get('/api/library/' + suffix, consoleHeaders)).status, 200, suffix);
    assert.notEqual((await get('/api/library/' + suffix, TOKEN)).status, 200, suffix);
  }
  const sections = await get('/api/library/sections', consoleHeaders);
  const body = await sections.json();
  const items = body.sections.flatMap((s) => s.items);
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.icon_url?.startsWith(BASE + '/api/library/icon/')));
  assert.equal((await get('/api/library/sections', { ...consoleHeaders, 'If-None-Match': sections.headers.get('etag'), 'Cache-Control': 'max-age=0' })).status, 304);
  for (const suffix of ['icon/0100000000010000', 'banner/0100000000010000', 'screenshot/0100000000010000/0']) {
    assert.notEqual((await get('/api/library/' + suffix, TOKEN)).status, 200, suffix);
  }
});

test("a catalog token reads the list and downloads the files it names, and reaches nothing else", async () => {
  const r = await get("/games.json", CATALOG);
  assert.equal(r.status, 200);
  const file = (await r.json()).files.find((f) => f.titleId === "0100000000010000");
  const url = new URL(file.url);
  const got = await get(url.pathname, CATALOG);
  assert.equal(got.status, 200);
  assert.equal(await got.text(), "NSP");
  assert.equal((await fetch(BASE + url.pathname, { method: "HEAD", headers: CATALOG })).status, 200);
  for (const where of ["/admin/api/devices", "/admin/guide.md", "/api/library/sections", "/mcp", "/pair/api/mine"]) {
    assert.equal((await get(where, CATALOG)).status, 401, where);
  }
  assert.equal((await fetch(BASE + url.pathname, { method: "POST", headers: CATALOG })).status, 401, "reads only");
});

test("an admin token still does not download game files: that is the catalog token's", async () => {
  const r = await get("/games.json", TOKEN);
  const file = (await r.json()).files[0];
  assert.equal((await get(new URL(file.url).pathname, TOKEN)).status, 401);
});
