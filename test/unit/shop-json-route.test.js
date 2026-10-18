import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedRecords } from "../support/security-db.js";
import { seedConsole } from "../support/console.js";

// /shop.json is the automation catalog: only an API token made on the admin
// page reads it. A console, a browser and a password get nothing there, and
// the old Tinfoil-era addresses are gone.
const PORT = 18500 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_ID = "0a1b2c3d";
const TOKEN_SECRET = "s".repeat(40);
const TOKEN = { Authorization: `Bearer cft_${TOKEN_ID}_${TOKEN_SECRET}` };
const BASIC = { Authorization: "Basic " + Buffer.from("alice:alice-password").toString("base64") };

const data = fs.mkdtempSync(path.join(os.tmpdir(), "shop-json-route-"));
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
  });
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_HOMEBREW_DIR: path.join(data, "homebrew"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true", COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_EXTRACT_ICONS: "off", COOK_ESHOP_PRICES: "false", COOK_RATING_SYNC: "false", COOK_FIRST_RUN_SETUP: "false",
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

test("an API token reads /shop.json: files with the stamped names, nothing else", async () => {
  let body;
  for (let i = 0; i < 40; i++) {
    const r = await get("/shop.json", TOKEN);
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

test("a console, a password and nobody at all get no /shop.json", async () => {
  for (const [who, headers] of [["console keys", consoleHeaders], ["Basic", BASIC], ["no credentials", {}]]) {
    const r = await get("/shop.json", headers);
    assert.ok([401, 404].includes(r.status), `${who}: ${r.status}`);
    assert.doesNotMatch(await r.text(), /"files"/, who);
  }
  assert.equal((await get("/shop.json", { Authorization: `Bearer cft_${TOKEN_ID}_${"x".repeat(40)}` })).status, 401, "a wrong token");
});

test("the Tinfoil-era addresses are gone", async () => {
  for (const url of ["/shop.tfl", "/api/remote/sections", "/api/remote/icon/0100000000010000", "/api/connect-url"]) {
    assert.equal((await get(url, consoleHeaders)).status, 404, url);
  }
  const root = await get("/", { ...consoleHeaders, Accept: "application/json" });
  assert.match(root.headers.get("content-type") ?? "", /text\/html/, "/ is the web page, never a shop index");
});
