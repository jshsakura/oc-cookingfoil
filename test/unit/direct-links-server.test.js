import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The whole server: lists asked for at home carry direct_url beside every
// download's url, and those links are answered on the LAN without sign-in.
const PORT = 15900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const HOME_IP = "203.0.113.7";
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
      COOK_DIRECT_BASE_URL: BASE, COOK_HOME_PUBLIC_IP: HOME_IP,
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

const AT_HOME = { Authorization: AUTH, "X-Device-Key": KEY_A };
const AWAY = { Authorization: AUTH, "X-Device-Key": KEY_A, "CF-Connecting-IP": "198.51.100.9" };
const TUNNEL_HOME = { Authorization: AUTH, "X-Device-Key": KEY_A, "CF-Connecting-IP": HOME_IP };
const settle = () => new Promise((r) => setTimeout(r, 100));

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

function stripDirect(value) {
  if (Array.isArray(value)) return value.map(stripDirect);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !/direct_?url$/i.test(k)).map(([k, v]) => [k, stripDirect(v)]));
}

test("the shop list carries direct_url only at home; url stays what it was", async () => {
  const home = await ready("/shop.json", AT_HOME, (b) => b.files?.length);
  const tunnelHome = await json("/shop.json", TUNNEL_HOME);
  const awayText = await (await fetch(`${BASE}/shop.json`, { headers: AWAY })).text();
  assert.ok(!awayText.includes("direct_url"), "away from home: no direct links at all");
  const away = JSON.parse(awayText);
  const file = home.files.find((f) => f.url.endsWith(".nsp"));
  assert.ok(file.direct_url.startsWith(`${BASE}/`));
  assert.ok(tunnelHome.files.every((f) => f.direct_url));
  assert.deepEqual(stripDirect(home), away, "the rest of the list is the same");
  const sections = await (await fetch(`${BASE}/api/shop/sections`, { headers: AT_HOME })).text();
  assert.ok(sections.includes('"direct_url"'));
  assert.ok(!(await (await fetch(`${BASE}/api/shop/sections`, { headers: AWAY })).text()).includes("direct_url"));
});

test("a direct link opens on the LAN without sign-in, once, and not through the tunnel", async () => {
  const mine = (await json("/shop.json", AT_HOME)).files.find((f) => f.url.endsWith(".nsp")).direct_url;
  const theirs = (await json("/shop.json", { Authorization: AUTH, "X-Device-Key": KEY_B })).files.find((f) => f.url.endsWith(".nsp")).direct_url;
  assert.notEqual(mine, theirs, "each console has its own link");
  // Through the tunnel the signed lane steps aside: no sign-in, no file.
  assert.equal((await fetch(mine, { headers: { "CF-Connecting-IP": HOME_IP } })).status, 401);
  const res = await fetch(mine);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "NSPDATA");
  await settle();
  const again = await fetch(mine);
  assert.equal(again.status, 403);
  assert.equal(again.headers.get("x-cookingfoil-link"), "used");
  assert.equal((await fetch(theirs)).status, 200, "the same account's other console is not affected");
  const fresh = (await json("/shop.json", AT_HOME)).files.find((f) => f.url.endsWith(".nsp")).direct_url;
  assert.notEqual(fresh, mine);
  assert.equal((await fetch(fresh)).status, 200);
});

test("retro, saves, patches and extras get direct twins at home and none away", async () => {
  const games = await ready("/api/retro/games", AT_HOME, (b) => b.games?.length);
  const g = games.games[0];
  assert.ok(g.romDirectUrl && g.bundleDirectUrl);
  assert.equal(g.iconDirectUrl, undefined, "artwork stays on the shop address");
  assert.equal(g.romUrl, `/api/retro/games/${g.id}/rom`);
  assert.equal(await (await fetch(g.romDirectUrl)).text(), "SMW");
  assert.ok(!(await (await fetch(`${BASE}/api/retro/games`, { headers: AWAY })).text()).includes("DirectUrl"));

  const save = (await ready("/api/saves", AT_HOME, (b) => b.saves?.length)).saves[0];
  assert.equal(save.url, `/api/saves/${save.id}/download`);
  assert.equal((await fetch(save.direct_url)).status, 200);
  assert.equal((await json("/api/saves", AWAY)).saves[0].direct_url, undefined);

  const patch = (await ready("/api/patches", AT_HOME, (b) => b.patches?.length && !b.scanning)).patches[0];
  const tar = await fetch(patch.direct_url);
  assert.equal(tar.status, 200);
  assert.ok(Buffer.from(await tar.arrayBuffer()).includes(Buffer.from("CHEAT")));
  assert.equal((await json("/api/patches", AWAY)).patches[0].direct_url, undefined);

  const extra = (await json("/api/title/0100000000010000/extras", AT_HOME)).extras.find((x) => x.name === "readme.txt");
  assert.equal(await (await fetch(extra.direct_url)).text(), "README");
  assert.equal((await json("/api/title/0100000000010000/extras", AWAY)).extras[0].direct_url, undefined);
});

test("a signature opens nothing but downloads, and the LAN pages keep their sign-in", async () => {
  const link = new URL((await json("/shop.json", AT_HOME)).files[0].direct_url);
  for (const p of ["/api/admin/users", "/api/retro/games", "/api/shop/sections", "/admin", "/api/inbox"]) {
    assert.equal((await fetch(`${BASE}${p}${link.search}`)).status === 200, false, p);
  }
  assert.equal((await fetch(`${BASE}/api/shop/info`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/shop/info`, { headers: { Authorization: AUTH } })).status, 200);
  const forged = await fetch(`${link.origin}${link.pathname}${link.search.replace(/sig=[^&]+/, `sig=${"Q".repeat(22)}`)}`);
  assert.equal(forged.status, 403);
  assert.equal(forged.headers.get("x-cookingfoil-link"), "invalid");
});
