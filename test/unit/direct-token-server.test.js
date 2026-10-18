import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { seedRecords } from "../support/security-db.js";
import { hashAccessKey } from "../../src/security/pairing.js";

// The whole server: a signed-in client that declares direct-token gets a
// download token header and its download URLs on the direct address; the
// direct address's proxy (from loopback, Host fixed, X-Forwarded-For set)
// forwards downloads with that token as a Bearer header.
const PORT = 15900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DL_HOST = "dl.example.org:38443";
const AUTH = "Basic " + Buffer.from("alice:alice-password").toString("base64");
const EDGE = "edge-secret-for-tests";
const KEY_A = "A1".repeat(32);
const KEY_B = "B2".repeat(32);
const ACCESS_A = "access-key-of-console-a";
const ACCESS_B = "access-key-of-console-b";
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
  // Two consoles alice approved.
  await seedRecords(data, "device", {
    [KEY_A]: { label: "a", addedAt: 1, addedBy: "alice", accessKeyHash: hashAccessKey(ACCESS_A) },
    [KEY_B]: { label: "b", addedAt: 1, addedBy: "alice", accessKeyHash: hashAccessKey(ACCESS_B) },
  });
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_RETRO_DIR: retro,
      COOK_SAVES_DIR: saves, COOK_PATCHES_DIR: patches, COOK_HOMEBREW_DIR: path.join(data, "homebrew"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false",
      COOK_PUBLIC_DIRECT_BASE_URL: `https://${DL_HOST}`, COOK_DIRECT_EDGE_SECRET: EDGE, COOK_TRUST_PROXY: "loopback",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      const h = await fetch(`${BASE}/healthz`);
      if (h.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});
after(() => {
  child?.kill("SIGKILL");
});

const SIGNED_IN = { "X-Device-Key": KEY_A, "X-Access-Key": ACCESS_A };
// As through the tunnel: the trusted proxy in front says the request came over https.
const DIRECT = { ...SIGNED_IN, "X-CookingFoil-Features": "direct-token", "X-Forwarded-Proto": "https" };
const DL = `https://${DL_HOST}`;

/** GET a direct URL the way the proxy forwards it: to this server, Host fixed, the client in X-Forwarded-For. */
function viaProxy(link, token, extra = {}) {
  const u = new URL(link);
  assert.equal(u.host, DL_HOST);
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  return new Promise((resolve, reject) => {
    const req = http.request({ port: PORT, host: "127.0.0.1", path: u.pathname + u.search, headers: { host: DL_HOST, "x-forwarded-for": "198.51.100.9", "x-cookingfoil-edge": EDGE, ...auth, ...extra } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchOk(url, headers) {
  const res = await fetch(BASE + url, { headers });
  assert.equal(res.status, 200, url);
  return res;
}
const json = async (url, headers) => (await fetchOk(url, headers)).json();
const tokenOf = (res) => res.headers.get("x-cookingfoil-download-token");
const itemsOf = (body) => body.sections?.flatMap((s) => s.items) ?? [];

/** A list, waiting out the first scan. */
async function ready(url, headers, has) {
  for (let i = 0; i < 40; i++) {
    const body = await json(url, headers);
    if (has(body)) return body;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} never filled`);
}

test("the shop list: fixed direct URLs and a token for direct-token clients, today's list for everyone else", async () => {
  const plain = await ready("/api/shop/sections", SIGNED_IN, (b) => itemsOf(b).length);
  const plainFile = itemsOf(plain).find((f) => f.url.endsWith(".nsp"));
  assert.ok(plainFile.url.startsWith(BASE), "url stays on the shop's own address");
  assert.equal(JSON.stringify(plain).includes(DL_HOST), false);
  const plainRes = await fetchOk("/api/shop/sections", SIGNED_IN);
  assert.equal(tokenOf(plainRes), null, "no token without the feature");

  const res = await fetchOk("/api/shop/sections", DIRECT);
  const token = tokenOf(res);
  assert.ok(token);
  assert.match(res.headers.get("cache-control"), /^private\b/);
  assert.match(res.headers.get("vary"), /X-CookingFoil-Features/i);
  assert.match(plainRes.headers.get("vary"), /X-CookingFoil-Features/i);
  const listed = await res.json();
  const file = itemsOf(listed).find((f) => f.url.endsWith(".nsp"));
  assert.equal(file.url, `${DL}${new URL(plainFile.url).pathname}`);
  assert.equal(JSON.stringify(listed).includes("direct_url"), false);
  assert.equal(JSON.stringify(itemsOf(await json("/api/shop/sections", DIRECT))), JSON.stringify(itemsOf(listed)), "the same on every refresh");
  // fetch() would add Cache-Control: no-cache to a conditional request, so this one goes by hand.
  const cached = await new Promise((resolve, reject) => {
    http.get({ port: PORT, host: "127.0.0.1", path: "/api/shop/sections", headers: { ...DIRECT, "If-None-Match": res.headers.get("etag") } }, (r) => resolve(r.resume())).on("error", reject);
  });
  assert.equal(cached.statusCode, 304);
  assert.equal(cached.headers["x-cookingfoil-download-token"], token, "the token comes with a 304 too");
  assert.notEqual(res.headers.get("etag"), plainRes.headers.get("etag"));

  const sections = await fetchOk("/api/shop/sections", DIRECT);
  assert.ok(tokenOf(sections));
  const text = await sections.text();
  assert.ok(text.includes(`"${DL}/`));
  assert.equal(text.includes("direct_url"), false);
  const info = await fetchOk("/api/shop/info", DIRECT);
  assert.equal(tokenOf(info), token);
  assert.equal(tokenOf(await fetchOk("/api/shop/info", SIGNED_IN)), null);
  // A console at home talking plain http to the server: same-origin URLs and no token, feature or not.
  const lanRes = await fetchOk("/api/shop/sections", { ...SIGNED_IN, "X-CookingFoil-Features": "direct-token" });
  assert.equal(tokenOf(lanRes), null);
  assert.ok(itemsOf(await lanRes.json()).find((f) => f.url.endsWith(".nsp")).url.startsWith(BASE), "http stays http on the same origin");
  // Artwork never carries the token, whatever the client declares.
  const icon = await fetch(`${BASE}/api/shop/icon/0100000000010000`, { headers: DIRECT });
  assert.equal(tokenOf(icon), null);
  const download = await fetch(`${BASE}${new URL(plainFile.url).pathname}`, { headers: DIRECT });
  assert.equal(download.status, 200);
  assert.equal(tokenOf(download), null);
});

test("a direct URL opens through the proxy with the token, never without it, never through the tunnel", async () => {
  const res = await fetchOk("/api/shop/sections", DIRECT);
  const token = tokenOf(res);
  const url = itemsOf(await res.json()).find((f) => f.url.endsWith(".nsp")).url;
  const ok = await viaProxy(url, token);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), "NSPDATA");
  assert.equal((await viaProxy(url, token)).status, 200, "again: nothing is used up");
  assert.equal((await viaProxy(url, token, { range: "bytes=0-0" })).status, 206);
  const none = await viaProxy(url);
  assert.equal(none.status, 401);
  assert.equal(none.headers["x-cookingfoil-token"], "invalid");
  const basic = await viaProxy(url, null, { authorization: AUTH, "x-device-key": KEY_A });
  assert.equal(basic.status, 401, "basic auth is no good on the direct address");
  assert.equal((await viaProxy(url, token, { "x-cookingfoil-edge": "guess" })).status, 404, "nor without the edge secret");
  // Through the tunnel the same request goes to the normal stack and its sign-in.
  assert.equal((await viaProxy(url, token, { "cf-connecting-ip": "198.51.100.9" })).status, 401);
  // The shop's own address serves the file as always.
  const tunnel = await fetch(`${BASE}${new URL(url).pathname}`, { headers: { ...SIGNED_IN, "CF-Connecting-IP": "198.51.100.9" }, redirect: "manual" });
  assert.equal(tunnel.status, 200);
  assert.equal(await tunnel.text(), "NSPDATA");
  // Two consoles get the same list and their own tokens; both open.
  const otherRes = await fetchOk("/api/shop/sections", { ...DIRECT, "X-Device-Key": KEY_B, "X-Access-Key": ACCESS_B });
  const other = tokenOf(otherRes);
  assert.notEqual(other, token);
  assert.equal(itemsOf(await otherRes.json()).find((f) => f.url.endsWith(".nsp")).url, url);
  assert.equal((await viaProxy(url, other)).status, 200);
});

test("retro, saves, patches and extras are on the direct address; artwork is not", async () => {
  const res = await fetchOk("/api/shop/info", DIRECT);
  const token = tokenOf(res);
  const games = await ready("/api/retro/games", DIRECT, (b) => b.games?.length);
  const g = games.games[0];
  assert.equal(g.romUrl, `${DL}/api/retro/games/${g.id}/rom`);
  assert.equal(g.bundleUrl, `${DL}/api/retro/games/${g.id}/bundle`);
  assert.equal(g.romDirectUrl, undefined, "no twins");
  for (const u of JSON.stringify(g).match(/"http:\/\/[^"]+"/g) ?? []) assert.match(u, /\/(rom|bundle|bezel\.png|overlay\.cfg|game\.cfg|forwarder\.nsp)"$/, "only downloads; artwork stays on the shop address");
  assert.equal((await viaProxy(g.romUrl, token)).body.toString(), "SMW");
  const plainGame = (await json("/api/retro/games", SIGNED_IN)).games[0];
  assert.equal(plainGame.romUrl, `/api/retro/games/${g.id}/rom`);

  const save = (await ready("/api/saves", DIRECT, (b) => b.saves?.length)).saves[0];
  assert.equal(save.url, `${DL}/api/saves/${save.id}/download`);
  assert.equal((await viaProxy(save.url, token)).status, 200);
  assert.equal((await json("/api/saves", SIGNED_IN)).saves[0].url, `/api/saves/${save.id}/download`);

  const patch = (await ready("/api/patches", DIRECT, (b) => b.patches?.length && !b.scanning)).patches[0];
  const tar = await viaProxy(patch.url, token);
  assert.equal(tar.status, 200);
  assert.ok(tar.body.includes(Buffer.from("CHEAT")));
  assert.equal((await json("/api/patches", SIGNED_IN)).patches[0].url, undefined, "the list without the feature is as before");

  const extra = (await json("/api/title/0100000000010000/extras", DIRECT)).extras.find((x) => x.name === "readme.txt");
  assert.ok(extra.url.startsWith(`${DL}/`));
  assert.equal((await viaProxy(extra.url, token)).body.toString(), "README");
});

test("the direct address opens nothing but downloads, and the shop's own pages keep their sign-in", async () => {
  const token = tokenOf(await fetchOk("/api/shop/info", DIRECT));
  for (const p of ["/healthz", "/api/admin/users", "/api/retro/games", "/api/shop/sections", "/api/shop/info", "/admin", "/api/inbox"]) {
    assert.equal((await viaProxy(`${DL}${p}`, token)).status, 404, p);
  }
  // Without a token too: the health page is mounted ahead of the lane and still stays shut.
  assert.equal((await viaProxy(`${DL}/healthz`, null)).status, 404);
  assert.equal((await fetch(`${BASE}/healthz`)).status, 200, "the server's own health check still works");
  // A token straight to the server (not from the proxy) signs nothing in.
  assert.equal((await fetch(`${BASE}/api/shop/info`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await fetch(`${BASE}/api/shop/info`)).status, 401);
  // A MAC that fails on a token of our shape reads as a replaced key: fetch the lists again.
  const forged = await viaProxy(`${DL}/${encodeURIComponent("Game/readme.txt")}`, `${token.split(".")[0]}.${"Q".repeat(43)}`);
  assert.equal(forged.status, 401);
  assert.equal(forged.headers["x-cookingfoil-token"], "expired");
  const junk = await viaProxy(`${DL}/${encodeURIComponent("Game/readme.txt")}`, "forged.token");
  assert.equal(junk.headers["x-cookingfoil-token"], "invalid");
});

test("nothing inside a dot-folder is served or listed, on the shop or the direct address, encoded or not", async () => {
  // The NSZ conversion's work folder sits inside the games folder (made while a conversion runs).
  put(games, ".cookingfoil-nsz-work/x/Game.nsz", "WORKDATA");
  const token = tokenOf(await fetchOk("/api/shop/info", DIRECT));
  const paths = ["/.cookingfoil-nsz-work/x/Game.nsz", "/%2ecookingfoil-nsz-work/x/Game.nsz", "/%2Ecookingfoil-nsz-work/x/Game.nsz", "/Game/..%2f.cookingfoil-nsz-work/x/Game.nsz", "/.cookingfoil-nsz-work/x/", "/.cookingfoil-nsz-work/"];
  for (const p of paths) {
    const shop = await fetch(`${BASE}${p}`, { headers: SIGNED_IN, redirect: "manual" });
    assert.equal(shop.status, 404, `shop ${p}`);
    assert.ok(!(await shop.text()).includes("WORKDATA"));
    const direct = await viaProxy(`${DL}${p}`, token);
    assert.equal(direct.status, 404, `direct ${p}`);
    assert.ok(!direct.body.includes(Buffer.from("WORKDATA")));
  }
  // The listing of the games folder leaves it out, and real files still open.
  assert.ok(!(await (await fetch(`${BASE}/Game/`, { headers: SIGNED_IN })).text()).includes("cookingfoil-nsz-work"));
  assert.equal(await (await fetchOk(`/${encodeURIComponent("Game/readme.txt")}`, SIGNED_IN)).text(), "README");
});

test("/healthz tells callers from outside only whether it is up; the home network and the admin see the detail", async () => {
  const home = await (await fetch(`${BASE}/healthz`)).json();
  assert.equal(home.ok, true);
  assert.ok("files" in home && "directDownload" in home && "nameHealth" in home, "full detail on loopback");
  for (const headers of [{ "X-Forwarded-For": "203.0.113.9" }, { "CF-Connecting-IP": "203.0.113.9" }, { "X-Forwarded-For": "10.0.0.1, 203.0.113.9" }]) {
    const r = await fetch(`${BASE}/healthz`, { headers });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true }, JSON.stringify(headers));
  }
});
