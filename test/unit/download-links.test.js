import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";

// Direct links on the home network: signed, bound to one console, closed once
// delivered. The signed lane answers them only on a direct LAN connection.
const dir = mkdtempSync(path.join(tmpdir(), "cook-direct-"));
const games = path.join(dir, "games");
mkdirSync(path.join(games, "Game"), { recursive: true });
const BIG = Buffer.alloc(4 * 1024 * 1024, 7);
writeFileSync(path.join(games, "Game", "file [0100000000010000][v0].nsp"), "NSPDATA");
writeFileSync(path.join(games, "Game", "big [0100000000020000][v0].nsp"), BIG);
const nro = path.join(dir, "app.nro");
writeFileSync(nro, "NROBYTES");
process.env.COOK_DATA_DIR = dir;
process.env.COOK_DIRECT_BASE_URL = "";
process.env.COOK_HOME_PUBLIC_IP = "";
process.env.COOK_RATING_SYNC = "false";
const express = (await import("express")).default;
const env = await import("../../src/helpers/envs.js");
const settings = await import("../../src/security/server-settings.js");
const links = await import("../../src/security/download-links.js");
const state = await import("../../src/security/download-state.js");
const home = await import("../../src/security/home-network.js");
const users = await import("../../src/security/users.js");
const store = await import("../../src/security/store.js");
const { addRange, covers, deliveredBytes, createCoverage } = await import("../../src/security/link-coverage.js");
const { createBan } = await import("../../src/security/download-ban.js");
const { default: directLane, LINK_HEADER, laneOf, arrivalOf } = await import("../../src/security/direct-lane.js");
const { homebrewRouter } = await import("../../src/routes/homebrew.js");

const KEY_A = "A".repeat(64);
const KEY_B = "B".repeat(64);
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

users.add("alice", "alice-password-1");
users.add("bob", "bob-password-12");
const fakeService = {
  list: async () => [{ id: "gh-0123456789ab", name: "App", file_name: "app.nro", files: [{ path: "switch/app/app.nro", size: 8, sha256: "x" }] }],
  download: async (id) => (id === "gh-0123456789ab" ? { path: nro, sha256: "f00d", file_name: "app.nro" } : null),
  file: async (id, p) => (id === "gh-0123456789ab" && p === "switch/app/app.nro" ? { path: nro, sha256: "f00d" } : null),
  icon: async () => null,
};

/** A fake request as a list route sees it after sign-in. */
function listReq({ user = "alice", dev = KEY_A, ip = "192.168.0.50", cf = null, paired = null, ua = "console" } = {}) {
  const headers = { ...(dev ? { "x-device-key": dev } : {}), ...(cf ? { "cf-connecting-ip": cf } : {}), "user-agent": ua };
  return { ip, auth: user ? { user } : undefined, pairedDevice: paired ?? undefined, get: (h) => headers[h.toLowerCase()] };
}

async function start({ ban } = {}) {
  const app = express();
  app.set("trust proxy", true);
  const hb = homebrewRouter({ service: fakeService });
  app.use(directLane(games, { routes: { "/api/homebrew": hb }, ...(ban ? { ban } : {}) }));
  // The normal stack: tagged, and serving the games folder as index.js does.
  app.use((req, res, next) => next(res.set("x-lane", "main") && undefined));
  app.use(express.static(games));
  app.use((req, res) => res.status(200).send("main"));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server.address().port;
}

function get(port, url, { method = "GET", headers = {}, abortAfter = 0 } = {}) {
  const u = new URL(url, "http://x");
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      let got = 0;
      res.on("data", (c) => {
        chunks.push(c);
        got += c.length;
        if (abortAfter && got >= abortAfter) {
          req.destroy();
          resolve({ status: res.statusCode, aborted: true });
        }
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", (err) => (abortAfter ? resolve({ aborted: true }) : reject(err)));
    req.end();
  });
}

const settle = () => new Promise((r) => setTimeout(r, 80));
const ENC = encodeURIComponent("Game/file [0100000000010000][v0].nsp");
const BIG_ENC = encodeURIComponent("Game/big [0100000000020000][v0].nsp");

test("with no direct address there are no direct links and the lane is off", async () => {
  settings.save({ directBaseUrl: null });
  assert.equal(links.current(), null);
  assert.equal(links.forRequest(listReq()), null);
  assert.equal(links.withShopDirect('{"url":"../a.nsp"}', null), '{"url":"../a.nsp"}');
  const port = await start();
  assert.equal((await get(port, `/${ENC}?u=x&g=0&exp=1&sig=${"a".repeat(22)}`)).headers["x-lane"], "main");
});

test("expiries are rounded to a quarter of the lifetime and never shorter than it", () => {
  const ttl = 43200;
  const now = 1_800_000_123;
  const exp = links.expiryFor(now, ttl);
  assert.ok(exp - now >= ttl);
  assert.ok(exp - now < ttl + ttl / 4);
  assert.equal(exp % (ttl / 4), 0);
  assert.equal(links.expiryFor(now + 5, ttl), exp);
});

test("the direct address takes scheme, host and port only, and the public address must be an IP", () => {
  assert.throws(() => settings.save({ directBaseUrl: "http://192.168.0.136:38000/files" }), /directBaseUrl/);
  assert.throws(() => settings.save({ homePublicIp: "my-house" }), /homePublicIp/);
  settings.save({ directBaseUrl: "http://192.168.0.136:38000/", downloadLinkTtl: "3600", homePublicIp: "203.0.113.7" });
  assert.equal(env.directBaseUrl, "http://192.168.0.136:38000");
  assert.equal(env.homePublicIp, "203.0.113.7");
});

test("home is a LAN address without the tunnel, or the house's public address through it", () => {
  assert.equal(home.isHome(listReq({ ip: "192.168.0.50" })), true);
  assert.equal(home.isHome(listReq({ ip: "127.0.0.1" })), true);
  assert.equal(home.isHome(listReq({ ip: "198.51.100.9" })), false);
  // Through the tunnel: the trusted address, or CF-Connecting-IP when the connector is local.
  assert.equal(home.isHome(listReq({ ip: "203.0.113.7", cf: "203.0.113.7" })), true);
  assert.equal(home.isHome(listReq({ ip: "127.0.0.1", cf: "203.0.113.7" })), true);
  assert.equal(home.isHome(listReq({ ip: "127.0.0.1", cf: "198.51.100.9" })), false);
  assert.equal(home.isHome(listReq({ ip: "198.51.100.9", cf: "203.0.113.7" })), false);
  assert.equal(home.parsePublicIp("fl=1\nh=1.1.1.1\nip=203.0.113.8\nts=1"), "203.0.113.8");
  assert.equal(home.parsePublicIp("2001:db8::1\n"), "2001:db8::1");
  assert.equal(home.parsePublicIp("<html>"), null);
});

test("the public address is learned from Cloudflare, else ipify, and kept on failure", async () => {
  const replies = { "https://1.1.1.1/cdn-cgi/trace": "ip=203.0.113.9\n", "https://api.ipify.org": "203.0.113.10" };
  const ok = async (url) => ({ ok: true, text: async () => replies[url] });
  assert.equal(await home.detectPublicIp(ok), "203.0.113.9");
  const traceDown = async (url) => (url.includes("1.1.1.1") ? { ok: false, status: 503 } : ok(url));
  assert.equal(await home.detectPublicIp(traceDown), "203.0.113.10");
  assert.equal(await home.detectPublicIp(async () => { throw new Error("offline"); }), "203.0.113.10");
  settings.save({ homePublicIp: null });
  assert.equal(home.homePublicIp(), "203.0.113.10");
  settings.save({ homePublicIp: "203.0.113.7" });
  assert.equal(home.homePublicIp(), "203.0.113.7");
});

test("only signed-in home requests get links, and each console gets its own", () => {
  assert.equal(links.forRequest(listReq({ ip: "198.51.100.9" })), null);
  assert.equal(links.forRequest(listReq({ user: null })), null, "not signed in");
  const a = links.forRequest(listReq({ dev: KEY_A }));
  const b = links.forRequest(listReq({ dev: KEY_B }));
  const bob = links.forRequest(listReq({ user: "bob", dev: KEY_A }));
  assert.ok(a && b && bob);
  assert.notEqual(a.u, b.u);
  assert.notEqual(a.u, bob.u);
  assert.equal(links.forRequest(listReq({ dev: KEY_A })).u, a.u, "stable");
  // A browser has no device id: its User-Agent tells it apart.
  assert.notEqual(links.forRequest(listReq({ dev: null, ua: "Firefox" })).u, links.forRequest(listReq({ dev: null, ua: "Chrome" })).u);
  assert.ok(!a.u.includes("alice") && !a.u.includes("AAAA"));
});

test("direct twins: names, the shop list form, and the signature over path and query", () => {
  assert.equal(links.directName("url"), "direct_url");
  assert.equal(links.directName("romUrl"), "romDirectUrl");
  assert.equal(links.directName("download_url"), "download_direct_url");
  const link = links.forRequest(listReq());
  const json = JSON.stringify({ files: [{ url: `../${ENC}`, size: 7 }], icon: "/api/shop/icon/x", ext: { url: "https://cdn.example/a.nsp" } });
  const out = JSON.parse(links.withShopDirect(json, link));
  assert.equal(out.files[0].url, `../${ENC}`);
  const d = new URL(out.files[0].direct_url);
  assert.equal(d.origin, "http://192.168.0.136:38000");
  assert.equal(d.pathname, `/${ENC}`);
  assert.equal(d.searchParams.get("u"), link.u);
  assert.equal(out.ext.url, "https://cdn.example/a.nsp");
  assert.equal(out.ext.direct_url, undefined);

  const signed = new URL(links.directUrl("/api/homebrew/gh-0123456789ab/file?path=switch%2Fapp%2Fapp.nro", link));
  const q = signed.search.slice(1);
  assert.equal(links.verifyRequest(signed.pathname, q).verdict, "ok");
  assert.equal(links.verifyRequest(signed.pathname, q.replace("app.nro", "evil.nro")).verdict, "bad");
  assert.equal(links.verifyRequest(signed.pathname, `${q}&extra=1`).verdict, "bad");
  assert.equal(links.verifyRequest(signed.pathname, q.replace(`u=${link.u}`, "u=iAAAAAAAAAAAA")).verdict, "bad");
  assert.equal(links.verifyRequest("/api/homebrew/gh-0123456789ab/download", q).verdict, "bad");
  assert.equal(links.verifyRequest(signed.pathname, `${q}&exp=1`).verdict, "bad", "two expiries");
  // Reordered pairs still verify: the order is fixed before signing.
  const params = [...new URLSearchParams(q)].reverse();
  assert.equal(links.verifyRequest(signed.pathname, new URLSearchParams(params).toString()).verdict, "ok");
  const stale = links.directUrl(`/${ENC}`, { ...link, exp: 1000 });
  assert.equal(links.verifyRequest(`/${ENC}`, new URL(stale).search.slice(1)).verdict, "expired");
});

test("the key is kept private and survives a reload", () => {
  const link = links.forRequest(listReq());
  const before = links.directUrl(`/${ENC}`, link);
  links.resetKeyForTests();
  assert.equal(links.directUrl(`/${ENC}`, link), before);
  assert.equal(statSync(path.join(dir, "security", "download-link.key")).mode & 0o777, 0o600);
});

test("byte ranges add up to the whole file only when every byte has landed", () => {
  assert.deepEqual(addRange([[0, 9], [20, 29]], [10, 19]), [[0, 29]]);
  assert.deepEqual(addRange([[20, 29]], [0, 4]), [[0, 4], [20, 29]]);
  assert.equal(covers([[0, 99]], 100), true);
  assert.equal(covers([[0, 49], [51, 99]], 100), false);
  assert.equal(deliveredBytes("HEAD", 200, null), null);
  assert.equal(deliveredBytes("GET", 200, null), "all");
  assert.deepEqual(deliveredBytes("GET", 206, "bytes 0-9/100"), { range: [0, 9], total: 100 });
  assert.equal(deliveredBytes("GET", 304, null), null);
  const c = createCoverage();
  assert.equal(c.add("s", 9e9, { range: [50, 99], total: 100 }), false);
  assert.equal(c.add("s", 9e9, { range: [0, 49], total: 100 }), true);
  assert.equal(c.size(), 0);
});

test("ten invalid links in ten minutes block an address for half an hour", () => {
  const bans = [];
  const ban = createBan({ onBan: (ip) => bans.push(ip) });
  const t0 = 1_000_000;
  for (let i = 0; i < 9; i++) assert.equal(ban.recordBad("10.0.0.9", t0 + i), false);
  assert.equal(ban.isBanned("10.0.0.9", t0 + 9), false);
  assert.equal(ban.recordBad("10.0.0.9", t0 + 10), true);
  assert.deepEqual(bans, ["10.0.0.9"]);
  assert.equal(ban.isBanned("10.0.0.9", t0 + 29 * 60_000), true);
  assert.equal(ban.isBanned("10.0.0.9", t0 + 31 * 60_000), false);
  assert.equal(ban.isBanned("10.0.0.8", t0), false);
  // Spread out over more than the window, they never add up.
  const slow = createBan();
  for (let i = 0; i < 20; i++) slow.recordBad("10.0.0.7", t0 + i * 70_000);
  assert.equal(slow.isBanned("10.0.0.7", t0 + 20 * 70_000), false);
  const small = createBan({ maxEntries: 3 });
  for (let i = 0; i < 10; i++) small.recordBad(`10.0.1.${i}`, t0);
  assert.ok(small.size() <= 3);
});

test("which paths the lane can reach", () => {
  assert.equal(laneOf(`/${ENC}`), "file");
  assert.equal(laneOf("/api/retro/games/snes-0123456789/rom"), "route");
  assert.equal(laneOf("/api/homebrew/gh-0123456789ab/file"), "route");
  for (const p of ["/", "/admin", "/api/admin/users", "/api/retro/games", "/api/shop/sections", "/shop.json", "/login", "/API/retro/games/x/rom", "/api/inbox/upload"]) {
    assert.equal(laneOf(p), null, p);
  }
});

test("the lane serves a console's link on the LAN and refuses everything else", async () => {
  const port = await start();
  const link = links.forRequest(listReq());
  const url = links.directUrl(`/${ENC}`, link);

  const head = await get(port, url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers["x-cookingfoil-max-connections"], String(env.downloadMaxConnections));
  // Through the tunnel the lane steps aside: the normal stack (and its sign-in) answers.
  assert.equal((await get(port, url, { headers: { "cf-connecting-ip": "203.0.113.7" } })).headers["x-lane"], "main");
  assert.equal((await get(port, url, { headers: { "x-forwarded-for": "198.51.100.9" } })).headers["x-lane"], "main");
  // No signature: the LAN web page and the rest of the server are untouched.
  assert.equal((await get(port, `/${ENC}`)).headers["x-lane"], "main");
  assert.equal((await get(port, "/admin")).body.toString(), "main");
  // A signature on something that is not a download does not open it either.
  assert.equal((await get(port, `/api/admin/users${new URL(url).search}`)).body.toString(), "main");

  const forged = await get(port, url.replace(/sig=[^&]+/, `sig=${"A".repeat(22)}`));
  assert.equal(forged.status, 403);
  assert.equal(forged.headers[LINK_HEADER.toLowerCase()], "invalid");
  const stale = await get(port, links.directUrl(`/${ENC}`, { ...link, exp: 1000 }));
  assert.equal(stale.headers[LINK_HEADER.toLowerCase()], "expired");
  const missing = await get(port, links.directUrl(`/${encodeURIComponent("Game/gone.nsp")}`, link));
  assert.equal(missing.status, 404);

  const ok = await get(port, url);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), "NSPDATA");
});

test("a whole download closes the link; the next list carries a working one", async () => {
  const port = await start();
  const link = links.forRequest(listReq({ dev: KEY_A }));
  const other = links.forRequest(listReq({ dev: KEY_B }));
  const url = links.directUrl(`/${ENC}`, link);
  const otherUrl = links.directUrl(`/${ENC}`, other);
  assert.equal((await get(port, url)).status, 200);
  await settle();
  const again = await get(port, url);
  assert.equal(again.status, 403);
  assert.equal(again.headers[LINK_HEADER.toLowerCase()], "used");
  // The same account's other console is not affected.
  assert.equal((await get(port, otherUrl)).status, 200);
  const next = links.forRequest(listReq({ dev: KEY_A }));
  assert.equal(next.g, link.g + 1);
  assert.equal(links.forRequest(listReq({ dev: KEY_B })).g, other.g + 1, "B finished too");
  assert.equal((await get(port, links.directUrl(`/${ENC}`, next))).status, 200);
});

test("split ranges close the link only after the last one lands; a cut-off response counts for nothing", async () => {
  const port = await start();
  const link = links.forRequest(listReq({ user: "bob", dev: KEY_B }));
  const url = links.directUrl(`/${BIG_ENC}`, link);
  const half = BIG.length / 2;
  const cut = await get(port, url, { abortAfter: 64 * 1024 });
  assert.ok(cut.aborted);
  await settle();
  const first = await get(port, url, { headers: { range: `bytes=0-${half - 1}` } });
  assert.equal(first.status, 206);
  await settle();
  assert.equal((await get(port, url, { method: "HEAD" })).status, 200, "still open");
  const second = await get(port, url, { headers: { range: `bytes=${half}-` } });
  assert.equal(second.status, 206);
  assert.equal(second.body.length, half);
  await settle();
  assert.equal((await get(port, url)).headers[LINK_HEADER.toLowerCase()], "used");
});

test("a link closes when its account or its approved console can no longer sign in", async () => {
  const port = await start();
  users.add("carol", "carol-password-1");
  const carol = links.directUrl(`/${ENC}`, links.forRequest(listReq({ user: "carol", dev: KEY_A })));
  users.setEnabled("carol", false);
  const revoked = await get(port, carol);
  assert.equal(revoked.status, 403);
  assert.equal(revoked.headers[LINK_HEADER.toLowerCase()], "revoked");

  const KEY_P = "C".repeat(64);
  store.approveDevice(KEY_P, { label: "living room", accessKeyHash: "h" });
  const paired = links.directUrl(`/${ENC}`, links.forRequest(listReq({ user: null, dev: null, paired: KEY_P })));
  assert.equal((await get(port, paired, { method: "HEAD" })).status, 200);
  store.revokeDevice(KEY_P);
  assert.equal((await get(port, paired)).headers[LINK_HEADER.toLowerCase()], "revoked");
});

test("homebrew downloads, query and all, go through the same lane", async () => {
  const port = await start();
  const link = links.forRequest(listReq());
  const nroUrl = links.directUrl("/api/homebrew/gh-0123456789ab/download", link);
  const fileUrl = links.directUrl("/api/homebrew/gh-0123456789ab/file?path=switch%2Fapp%2Fapp.nro", link);
  assert.equal((await get(port, nroUrl)).body.toString(), "NROBYTES");
  assert.equal((await get(port, fileUrl)).body.toString(), "NROBYTES");
  // The homebrew list itself is not a download: a signature does not open it.
  assert.equal((await get(port, `/api/homebrew${new URL(nroUrl).search}`)).headers["x-lane"], "main");
});

test("used links and generations survive a restart; expired ones are dropped", async () => {
  const port = await start();
  const link = links.forRequest(listReq({ dev: KEY_A }));
  const url = links.directUrl(`/${ENC}`, link);
  assert.equal((await get(port, url)).status, 200);
  await settle();
  const saved = JSON.parse(readFileSync(path.join(dir, "security", "download-links.json"), "utf8"));
  assert.equal(statSync(path.join(dir, "security", "download-links.json")).mode & 0o777, 0o600);
  assert.ok(Object.keys(saved.used).length >= 1);
  state.resetForTests();
  assert.equal((await get(port, url)).headers[LINK_HEADER.toLowerCase()], "used");
  assert.equal(links.forRequest(listReq({ dev: KEY_A })).g, link.g + 1);
  const pruned = state.pruned({ ids: { x: { seen: 0 } }, used: { s: 1 } }, Date.now(), 3600);
  assert.deepEqual(pruned, { ids: {}, used: {} });
});

test("a client that keeps sending forged links through the public proxy is blocked by its own address", async () => {
  settings.save({ publicDirectBaseUrl: "https://dl.example.org:38443" });
  const ban = createBan({ limit: 3 });
  const port = await start({ ban });
  const link = links.forRequest(listReq());
  const good = links.directUrl(`/${ENC}`, links.forRequest(listReq({ dev: KEY_B, user: "bob" })));
  const stale = links.directUrl(`/${ENC}`, { ...link, exp: 1000 });
  const ip = { host: "dl.example.org:38443", "x-forwarded-for": "198.51.100.77" };
  for (let i = 0; i < 5; i++) await get(port, stale, { headers: ip });
  assert.equal((await get(port, good, { headers: ip, method: "HEAD" })).status, 200);
  const forged = good.replace(/sig=[^&]+/, `sig=${"B".repeat(22)}`);
  for (let i = 0; i < 3; i++) await get(port, forged, { headers: ip });
  const blocked = await get(port, good, { headers: ip, method: "HEAD" });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers[LINK_HEADER.toLowerCase()], "blocked");
  assert.equal((await get(port, good, { method: "HEAD", headers: { host: "dl.example.org:38443", "x-forwarded-for": "198.51.100.78" } })).status, 200, "other clients are not");
  assert.equal((await get(port, good, { method: "HEAD" })).status, 200, "nor the LAN");
  settings.save({ publicDirectBaseUrl: null });
});

test("a file has the same ETag and Last-Modified on both lanes, so If-Range resumes across them", async () => {
  const port = await start();
  const url = links.directUrl(`/${BIG_ENC}`, links.forRequest(listReq({ dev: "D".repeat(64) })));
  const direct = await get(port, url, { method: "HEAD" });
  const plain = await get(port, `/${BIG_ENC}`, { method: "HEAD" });
  assert.equal(plain.headers["x-lane"], "main");
  assert.equal(direct.headers["x-lane"], undefined);
  assert.ok(direct.headers.etag);
  assert.equal(direct.headers.etag, plain.headers.etag);
  assert.equal(direct.headers["last-modified"], plain.headers["last-modified"]);
  const range = { range: "bytes=100-199", "if-range": plain.headers.etag };
  const a = await get(port, url, { headers: range });
  const b = await get(port, `/${BIG_ENC}`, { headers: range });
  assert.equal(a.status, 206);
  assert.equal(b.status, 206);
  assert.equal(a.headers["content-range"], b.headers["content-range"]);
});

test("parallel segments close the link only when every byte is covered, tail first or not; a 0-0 probe closes nothing", async () => {
  const port = await start();
  const url = links.directUrl(`/${BIG_ENC}`, links.forRequest(listReq({ dev: "E".repeat(64) })));
  const size = BIG.length;
  const probe = await get(port, url, { headers: { range: "bytes=0-0" } });
  assert.equal(probe.status, 206);
  assert.equal(probe.body.length, 1);
  await settle();
  const segments = [[3 * size / 4, size - 1], [0, size / 4 - 1], [size / 2, 3 * size / 4 - 1]];
  for (const [a, b] of segments) {
    assert.equal((await get(port, url, { headers: { range: `bytes=${a}-${b}` } })).status, 206);
    await settle();
    assert.equal((await get(port, url, { headers: { range: "bytes=0-0" } })).status, 206, "still open after the tail");
    await settle();
  }
  assert.equal((await get(port, url, { headers: { range: `bytes=${size / 4}-${size / 2 - 1}` } })).status, 206);
  await settle();
  assert.equal((await get(port, url, { headers: { range: "bytes=0-0" } })).headers[LINK_HEADER.toLowerCase()], "used");
});

test("the homebrew list gives every download a direct twin at home and none away", async () => {
  const app = express();
  app.set("trust proxy", true);
  app.use((req, _res, next) => {
    req.auth = { user: "alice" };
    next();
  });
  app.use("/api/homebrew", homebrewRouter({ service: fakeService }));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const list = async (headers) => JSON.parse((await get(port, "/api/homebrew", { headers: { "x-device-key": KEY_A, ...headers } })).body).homebrew[0];
  const homeApp = await list({});
  assert.equal(homeApp.download_url, "/api/homebrew/gh-0123456789ab/download");
  assert.ok(new URL(homeApp.download_direct_url).searchParams.get("sig"));
  assert.ok(homeApp.bundle_direct_url);
  assert.ok(homeApp.files[0].direct_url);
  assert.equal(homeApp.icon_direct_url, undefined);
  const awayApp = await list({ "x-forwarded-for": "198.51.100.9" });
  assert.equal(JSON.stringify(awayApp).includes("direct"), false);
  assert.deepEqual(Object.keys(awayApp), Object.keys(homeApp).filter((k) => !k.includes("direct")));
});

test("outside the home the links go on the public direct address, and nowhere without one", () => {
  const away = listReq({ ip: "198.51.100.9", cf: "198.51.100.9" });
  assert.equal(links.forRequest(away), null);
  settings.save({ publicDirectBaseUrl: "https://dl.example.org:38443/" });
  assert.equal(links.forRequest(away).base, "https://dl.example.org:38443");
  assert.equal(links.forRequest(listReq()).base, "http://192.168.0.136:38000", "home keeps the LAN address");
  assert.equal(links.forRequest(listReq({ ip: "127.0.0.1", cf: "203.0.113.7" })).base, "http://192.168.0.136:38000");
  assert.equal(links.forRequest({ ...away, auth: undefined }), null, "never for a caller who did not sign in");
  assert.throws(() => settings.save({ publicDirectBaseUrl: "https://dl.example.org/x" }), /publicDirectBaseUrl/);
  // One link opens on either address: the host is not signed.
  const url = new URL(links.directUrl(`/${ENC}`, links.forRequest(away)));
  assert.equal(links.verifyRequest(url.pathname, url.search.slice(1)).verdict, "ok");
});

test("how a request arrived: LAN peer, the public proxy, or neither", () => {
  const req = (headers, peer) => ({ socket: { remoteAddress: peer }, get: (h) => headers[h.toLowerCase()] });
  assert.equal(arrivalOf(req({}, "192.168.0.50")), "lan");
  assert.equal(arrivalOf(req({}, "::ffff:127.0.0.1")), "lan");
  assert.equal(arrivalOf(req({}, "198.51.100.9")), null);
  assert.equal(arrivalOf(req({ "x-forwarded-for": "192.168.0.5" }, "192.168.0.50")), null, "a proxy hop is not the LAN");
  assert.equal(arrivalOf(req({ host: "dl.example.org:38443", "x-forwarded-for": "198.51.100.9" }, "172.17.0.1")), "proxy");
  assert.equal(arrivalOf(req({ host: "shop.example", "x-forwarded-host": "dl.example.org:38443" }, "127.0.0.1")), "proxy");
  assert.equal(arrivalOf(req({ host: "dl.example.org:38443", "cf-connecting-ip": "198.51.100.9" }, "127.0.0.1")), null, "the tunnel never");
  assert.equal(arrivalOf(req({ "cf-connecting-ip": "203.0.113.7" }, "127.0.0.1")), null);
});

test("through the public proxy a valid link opens, the tunnel never, and nothing else is on that address", async () => {
  const port = await start();
  const away = listReq({ ip: "198.51.100.9", cf: "198.51.100.9", dev: "F".repeat(64) });
  const url = links.directUrl(`/${ENC}`, links.forRequest(away));
  const viaProxy = { host: "dl.example.org:38443", "x-forwarded-for": "198.51.100.9" };
  const head = await get(port, url, { method: "HEAD", headers: viaProxy });
  assert.equal(head.status, 200);
  assert.equal(head.headers["x-lane"], undefined);
  const plain = await get(port, `/${ENC}`, { method: "HEAD" });
  assert.equal(head.headers.etag, plain.headers.etag);
  assert.equal(head.headers["last-modified"], plain.headers["last-modified"]);
  // The same link through the tunnel goes to the normal stack (and its sign-in).
  assert.equal((await get(port, url, { headers: { "cf-connecting-ip": "198.51.100.9" } })).headers["x-lane"], "main");
  // The public address carries links and nothing else.
  for (const p of ["/admin", `/api/shop/sections${new URL(url).search}`, `/${ENC}`]) {
    const r = await get(port, p, { headers: viaProxy });
    assert.equal(r.status, 404, p);
    assert.equal(r.headers["x-lane"], undefined, p);
  }
  assert.equal((await get(port, url, { method: "POST", headers: viaProxy })).status, 404);
  const ok = await get(port, url, { headers: viaProxy });
  assert.equal(ok.body.toString(), "NSPDATA");
});
