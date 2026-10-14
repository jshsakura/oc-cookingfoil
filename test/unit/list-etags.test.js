import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Every list a client polls answers If-None-Match with 304, and its ETag moves
// when what it lists does, so a client can ask often and pay almost nothing.
const PORT = 17500 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = { Authorization: "Basic " + Buffer.from("alice:alice-password").toString("base64") };
const TID = "0100000000ABC000";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-lists-"));
const put = (rel, body = "x") => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
put(`games/Test Game [${TID}][v0].nsp`, "NSP");
put(`saves/${TID}/All Unlocked/save.dat`, "SAVE");
put(`patches/${TID}/Big/atmosphere/contents/${TID}/romfs/a.bin`, "aaaa");
put("retro/roms/snes/Super Mario World (USA).sfc", "SMW");
put("data/titledb/US.en.json", JSON.stringify({ "70010000000001": { id: TID, name: "Test Game", publisher: "OpenCourse", description: "A game." } }));

let child;
before(async () => {
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: path.join(root, "data"), COOK_GAMES_DIR: path.join(root, "games"),
      COOK_SAVES_DIR: path.join(root, "saves"), COOK_PATCHES_DIR: path.join(root, "patches"), COOK_RETRO_DIR: path.join(root, "retro"),
      COOK_HOMEBREW_DIR: path.join(root, "homebrew"), COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_EXTRACT_ICONS: "off", COOK_ESHOP_PRICES: "false", COOK_RATING_SYNC: "false", COOK_FIRST_RUN_SETUP: "false" },
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
  fs.rmSync(root, { recursive: true, force: true });
});

// fetch adds "Cache-Control: no-cache" to a conditional request unless one is given; a console's curl does not.
const get = (url, headers = {}) => fetch(BASE + url, { headers: { ...AUTH, "Cache-Control": "max-age=0", ...headers } });

const LISTS = ["/", "/api/shop/sections", `/api/title/${TID}`, "/api/patches", "/api/saves", "/api/retro/games", "/api/retro/systems", "/api/homebrew"];

for (const url of LISTS) {
  test(`${url} has an ETag and answers If-None-Match with 304`, async () => {
    let first;
    // Patches are hashed in the background; a partial list is no-store until then.
    for (let i = 0; i < 40; i++) {
      first = await get(url);
      if (first.headers.get("cache-control") !== "no-store") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(first.status, 200, url);
    const etag = first.headers.get("etag");
    assert.ok(etag, `${url} ETag`);
    assert.match(first.headers.get("cache-control"), /max-age=/);
    assert.equal((await get(url, { "If-None-Match": etag })).status, 304, url);
    assert.equal((await get(url, { "If-None-Match": '"something-else"' })).status, 200, url);
  });
}

test("lists and downloads advertise the per-console connection count; images don't", async () => {
  for (const url of LISTS) assert.equal((await get(url)).headers.get("x-cookingfoil-max-connections"), "4", url);
  const shop = await (await get("/shop.json")).json();
  const download = await get(new URL(shop.files[0].url, `${BASE}/`).pathname, { Range: "bytes=0-1" });
  assert.equal(download.status, 206);
  assert.equal(download.headers.get("x-cookingfoil-max-connections"), "4");
  assert.equal((await get(`/api/shop/icon/${TID}`)).headers.get("x-cookingfoil-max-connections"), null);
  const info = await (await get("/api/shop/info")).json();
  assert.deepEqual(info.download, { maxConnections: 4 });
  assert.ok(info.features.includes("download-connections"));
});

// A password (Basic) is checked after the bucket, so those callers count too; a
// console with its device key, a browser session and the admin skip both.
test("callers that went through the rate limiter see RateLimit headers", async () => {
  for (const r of [await fetch(`${BASE}/robots.txt`), await get("/api/shop/sections")]) {
    assert.equal(r.headers.get("ratelimit-limit"), "300");
    const left = Number(r.headers.get("ratelimit-remaining"));
    assert.ok(left >= 0 && left < 300, `remaining ${left}`);
    assert.ok(Number(r.headers.get("ratelimit-reset")) >= 1);
  }
});

test("the shop and its sections get a new ETag when a game is added", async () => {
  const before = await Promise.all(["/", "/api/shop/sections"].map(async (u) => (await get(u)).headers.get("etag")));
  put(`games/Other Game [0100000000DEF000][v0].nsp`, "NSP2");
  let after = before;
  for (let i = 0; i < 60 && after.some((e, n) => e === before[n]); i++) {
    await new Promise((r) => setTimeout(r, 250));
    after = await Promise.all(["/", "/api/shop/sections"].map(async (u) => (await get(u)).headers.get("etag")));
  }
  assert.notEqual(after[0], before[0], "shop");
  assert.notEqual(after[1], before[1], "sections");
});
