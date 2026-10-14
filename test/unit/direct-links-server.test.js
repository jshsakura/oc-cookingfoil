import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// The whole server: signed-in lists carry direct_url beside every download's
// url, and those links are answered without sign-in when they come through
// the direct address's proxy (from loopback, Host fixed, X-Forwarded-For set).
const PORT = 15900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DL_HOST = "dl.test:38443";
const AUTH = "Basic " + Buffer.from("alice:alice-password").toString("base64");
const KEY_A = "A1".repeat(32);
const KEY_B = "B2".repeat(32);
const TID = "0100F2C0115B6000";
const MK = "0100152000022000";

function put(root, rel, body = "x") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), "direct-server-"));
const games = path.join(data, "games");
const retro = path.join(data, "retro");
const saves = path.join(data, "saves");
const patches = path.join(data, "patches");
put(games, "Game/file [0100000000010000][v0].nsp", "NSPDATA");
put(games, "Game/readme.txt", "README");
put(retro, "roms/snes/Super Mario World (USA).sfc", "SMW");
put(saves, `${MK}/All Unlocked/meta.json`, JSON.stringify({ name: "All karts" }));
put(saves, `${MK}/All Unlocked/save.dat`, "SAVE");
put(patches, `${TID}/60fps/atmosphere/contents/${TID}/cheats/ABCDEF0123456789.txt`, "CHEAT");

let child;
before(async () => {
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_RETRO_DIR: retro,
      COOK_SAVES_DIR: saves, COOK_PATCHES_DIR: patches, COOK_HOMEBREW_DIR: path.join(data, "homebrew"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false",
      COOK_PUBLIC_DIRECT_BASE_URL: `https://${DL_HOST}`,
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
after(() => child?.kill("SIGKILL"));

const SIGNED_IN = { Authorization: AUTH, "X-Device-Key": KEY_A };
const settle = () => new Promise((r) => setTimeout(r, 100));

/** GET a direct link the way the proxy forwards it: to this server, Host fixed, the client in X-Forwarded-For. */
function viaProxy(link, extra = {}) {
  const u = new URL(link);
  assert.equal(u.host, DL_HOST);
  return new Promise((resolve, reject) => {
    const req = http.request({ port: PORT, host: "127.0.0.1", path: u.pathname + u.search, headers: { host: DL_HOST, "x-forwarded-for": "198.51.100.9", ...extra } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function json(url, headers) {
  const res = await fetch(BASE + url, { headers });
  assert.equal(res.status, 200, url);
  return res.json();
}

/** A list, waiting out the first scan. */
async function ready(url, headers, has) {
  for (let i = 0; i < 40; i++) {
    const body = await json(url, headers);
    if (has(body)) return body;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} never filled`);
}

test("the shop list carries direct_url beside url for a signed-in console", async () => {
  const listed = await ready("/shop.json", SIGNED_IN, (b) => b.files?.length);
  const file = listed.files.find((f) => f.url.endsWith(".nsp"));
  assert.ok(file.url.startsWith(BASE), "url stays on the shop's own address");
  assert.ok(file.direct_url.startsWith(`https://${DL_HOST}/`));
  const sections = await (await fetch(`${BASE}/api/shop/sections`, { headers: SIGNED_IN })).text();
  assert.ok(sections.includes('"direct_url"'));
});

test("a direct link opens through the proxy without sign-in, once; never through the tunnel", async () => {
  const pick = (b) => b.files.find((f) => f.url.endsWith(".nsp")).direct_url;
  const mine = pick(await json("/shop.json", SIGNED_IN));
  const theirs = pick(await json("/shop.json", { Authorization: AUTH, "X-Device-Key": KEY_B }));
  assert.notEqual(mine, theirs, "each console has its own link");
  // The same request through the tunnel goes to the normal stack: no sign-in, no file.
  assert.equal((await viaProxy(mine, { "cf-connecting-ip": "198.51.100.9" })).status, 401);
  const res = await viaProxy(mine);
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), "NSPDATA");
  await settle();
  const again = await viaProxy(mine);
  assert.equal(again.status, 403);
  assert.equal(again.headers["x-cookingfoil-link"], "used");
  assert.equal((await viaProxy(theirs)).status, 200, "the same account's other console is not affected");
  const fresh = pick(await json("/shop.json", SIGNED_IN));
  assert.notEqual(fresh, mine);
  assert.equal((await viaProxy(fresh)).status, 200);
});

test("retro, saves, patches and extras get direct twins; artwork does not", async () => {
  const games = await ready("/api/retro/games", SIGNED_IN, (b) => b.games?.length);
  const g = games.games[0];
  assert.ok(g.romDirectUrl && g.bundleDirectUrl);
  assert.equal(g.iconDirectUrl, undefined, "artwork stays on the shop address");
  assert.equal(g.romUrl, `/api/retro/games/${g.id}/rom`);
  assert.equal((await viaProxy(g.romDirectUrl)).body.toString(), "SMW");

  const save = (await ready("/api/saves", SIGNED_IN, (b) => b.saves?.length)).saves[0];
  assert.equal(save.url, `/api/saves/${save.id}/download`);
  assert.equal((await viaProxy(save.direct_url)).status, 200);

  const patch = (await ready("/api/patches", SIGNED_IN, (b) => b.patches?.length && !b.scanning)).patches[0];
  const tar = await viaProxy(patch.direct_url);
  assert.equal(tar.status, 200);
  assert.ok(tar.body.includes(Buffer.from("CHEAT")));

  const extra = (await json("/api/title/0100000000010000/extras", SIGNED_IN)).extras.find((x) => x.name === "readme.txt");
  assert.equal((await viaProxy(extra.direct_url)).body.toString(), "README");
});

test("a signature opens nothing but downloads, and the shop's own pages keep their sign-in", async () => {
  const link = new URL((await json("/shop.json", SIGNED_IN)).files[0].direct_url);
  for (const p of ["/api/admin/users", "/api/retro/games", "/api/shop/sections", "/admin", "/api/inbox"]) {
    assert.equal((await viaProxy(`https://${DL_HOST}${p}${link.search}`)).status, 404, p);
  }
  // A signed request straight to the server (not from the proxy) goes through the sign-in.
  assert.equal((await fetch(`${BASE}${link.pathname}${link.search}`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/shop/info`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/shop/info`, { headers: { Authorization: AUTH } })).status, 200);
  const forged = await viaProxy(`https://${DL_HOST}${link.pathname}${link.search.replace(/sig=[^&]+/, `sig=${"Q".repeat(22)}`)}`);
  assert.equal(forged.status, 403);
  assert.equal(forged.headers["x-cookingfoil-link"], "invalid");
});
