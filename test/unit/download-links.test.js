import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";

// Direct links: signed, bound to one console, closed once delivered, answered
// only when they come through the direct address's proxy on this host.
const dir = mkdtempSync(path.join(tmpdir(), "cook-direct-"));
const games = path.join(dir, "games");
mkdirSync(path.join(games, "Game"), { recursive: true });
const BIG = Buffer.alloc(4 * 1024 * 1024, 7);
writeFileSync(path.join(games, "Game", "file [0100000000010000][v0].nsp"), "NSPDATA");
writeFileSync(path.join(games, "Game", "big [0100000000020000][v0].nsp"), BIG);
const nro = path.join(dir, "app.nro");
writeFileSync(nro, "NROBYTES");
process.env.COOK_DATA_DIR = dir;
process.env.COOK_PUBLIC_DIRECT_BASE_URL = "";
process.env.COOK_RATING_SYNC = "false";
const express = (await import("express")).default;
const env = await import("../../src/helpers/envs.js");
const settings = await import("../../src/security/server-settings.js");
const links = await import("../../src/security/download-links.js");
const state = await import("../../src/security/download-state.js");
const users = await import("../../src/security/users.js");
const store = await import("../../src/security/store.js");
const { defaultGateways, isLocalHop, setGatewaysForTests } = await import("../../src/security/local-hop.js");
const { addRange, covers, deliveredBytes, createCoverage, MAX_INTERVALS } = await import("../../src/security/link-coverage.js");
const { createBan } = await import("../../src/security/download-ban.js");
const { default: directLane, LINK_HEADER, laneOf, proxiedClient, viaDirectProxy } = await import("../../src/security/direct-lane.js");
const { homebrewRouter } = await import("../../src/routes/homebrew.js");

const KEY_A = "A".repeat(64);
const KEY_B = "B".repeat(64);
const DL_HOST = "dl.example.org:38443";
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

users.add("alice", "alice-password-1");
users.add("bob", "bob-password-12");
setGatewaysForTests(["172.17.0.1"]);
const fakeService = {
  list: async () => [{ id: "gh-0123456789ab", name: "App", file_name: "app.nro", files: [{ path: "switch/app/app.nro", size: 8, sha256: "x" }] }],
  download: async (id) => (id === "gh-0123456789ab" ? { path: nro, sha256: "f00d", file_name: "app.nro" } : null),
  file: async (id, p) => (id === "gh-0123456789ab" && p === "switch/app/app.nro" ? { path: nro, sha256: "f00d" } : null),
  icon: async () => null,
};

/** A fake request as a list route sees it after sign-in. */
function listReq({ user = "alice", dev = KEY_A, paired = null, ua = "console" } = {}) {
  const headers = { ...(dev ? { "x-device-key": dev } : {}), "user-agent": ua };
  return { auth: user ? { user } : undefined, pairedDevice: paired ?? undefined, get: (h) => headers[h.toLowerCase()] };
}

async function start({ ban } = {}) {
  const app = express();
  app.set("trust proxy", "loopback, uniquelocal");
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

/** A request as the proxy on the host sends it (from loopback, Host fixed, X-Forwarded-For written). */
const PROXY = { host: DL_HOST, "x-forwarded-for": "198.51.100.9" };

function get(port, url, { method = "GET", headers = PROXY, abortAfter = 0 } = {}) {
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
const linkHeader = (r) => r.headers?.[LINK_HEADER.toLowerCase()];

test("with no direct address there are no direct links and the lane is off", async () => {
  settings.save({ publicDirectBaseUrl: null });
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

test("the direct address takes scheme, host and port only", () => {
  assert.throws(() => settings.save({ publicDirectBaseUrl: "https://dl.example.org/files" }), /publicDirectBaseUrl/);
  settings.save({ publicDirectBaseUrl: `https://${DL_HOST}/`, downloadLinkTtl: "3600" });
  assert.equal(env.publicDirectBaseUrl, `https://${DL_HOST}`);
});

test("only signed-in requests get links, and each console gets its own", () => {
  assert.equal(links.forRequest(listReq({ user: null })), null, "not signed in");
  const a = links.forRequest(listReq({ dev: KEY_A }));
  const b = links.forRequest(listReq({ dev: KEY_B }));
  const bob = links.forRequest(listReq({ user: "bob", dev: KEY_A }));
  assert.ok(a && b && bob);
  assert.equal(a.base, `https://${DL_HOST}`);
  assert.notEqual(a.u, b.u);
  assert.notEqual(a.u, bob.u);
  assert.equal(links.forRequest(listReq({ dev: KEY_A })).u, a.u, "stable");
  // A browser has no device id: its User-Agent tells it apart.
  assert.notEqual(links.forRequest(listReq({ dev: null, ua: "Firefox" })).u, links.forRequest(listReq({ dev: null, ua: "Chrome" })).u);
  assert.ok(!a.u.includes("alice") && !a.u.includes("AAAA"));
});

test("direct twins: names, the shop list form, and the signature over path and query but not the host", () => {
  assert.equal(links.directName("url"), "direct_url");
  assert.equal(links.directName("romUrl"), "romDirectUrl");
  assert.equal(links.directName("download_url"), "download_direct_url");
  const link = links.forRequest(listReq());
  const json = JSON.stringify({ files: [{ url: `../${ENC}`, size: 7 }], icon: "/api/shop/icon/x", ext: { url: "https://cdn.example/a.nsp" } });
  const out = JSON.parse(links.withShopDirect(json, link));
  assert.equal(out.files[0].url, `../${ENC}`);
  const d = new URL(out.files[0].direct_url);
  assert.equal(d.host, DL_HOST);
  assert.equal(d.pathname, `/${ENC}`);
  assert.equal(d.searchParams.get("u"), link.u);
  assert.equal(out.ext.direct_url, undefined);
  // Made on another base, the same path and query still verify.
  const other = new URL(links.directUrl(`/${ENC}`, { ...link, base: "http://192.168.0.136:38000" }));
  assert.equal(other.search, d.search);

  const signed = new URL(links.directUrl("/api/homebrew/gh-0123456789ab/file?path=switch%2Fapp%2Fapp.nro", link));
  const q = signed.search.slice(1);
  assert.equal(links.verifyRequest(signed.pathname, q).verdict, "ok");
  assert.equal(links.verifyRequest(signed.pathname, q.replace("app.nro", "evil.nro")).verdict, "bad");
  assert.equal(links.verifyRequest(signed.pathname, `${q}&extra=1`).verdict, "bad");
  assert.equal(links.verifyRequest(signed.pathname, q.replace(`u=${link.u}`, "u=iAAAAAAAAAAAA")).verdict, "bad");
  assert.equal(links.verifyRequest(signed.pathname, q.replace(`g=${link.g}`, `g=${link.g + 1}`)).verdict, "bad");
  assert.equal(links.verifyRequest("/api/homebrew/gh-0123456789ab/download", q).verdict, "bad");
  assert.equal(links.verifyRequest(signed.pathname, `${q}&exp=1`).verdict, "bad", "two expiries");
  const params = [...new URLSearchParams(q)].reverse();
  assert.equal(links.verifyRequest(signed.pathname, new URLSearchParams(params).toString()).verdict, "ok", "order does not matter");
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
  assert.deepEqual(addRange([[0, 4], [20, 29]], [40, 49]), [[0, 4], [20, 29], [40, 49]]);
  assert.deepEqual(addRange([[0, 4], [10, 14], [20, 29]], [3, 21]), [[0, 29]]);
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

test("a link scattered over more than the interval cap stops being tracked", () => {
  const c = createCoverage();
  const total = 1000;
  for (let i = 0; i <= MAX_INTERVALS; i++) c.add("wide", 9e9, { range: [i * 10, i * 10], total });
  // Filling every gap now would cover the file, but the link is no longer tracked.
  let closed = false;
  for (let i = 0; i < total / 10; i++) closed = c.add("wide", 9e9, { range: [i * 10, i * 10 + 9], total }) || closed;
  assert.equal(closed, false);
  // One that stays under the cap closes as usual.
  const ok = createCoverage();
  for (let i = 0; i < 10; i++) ok.add("n", 9e9, { range: [i * 20, i * 20], total: 200 });
  assert.equal(ok.add("n", 9e9, { range: [0, 199], total: 200 }), true);
});

test("ten invalid links in ten minutes block a client for ten minutes", () => {
  const bans = [];
  const ban = createBan({ onBan: (ip) => bans.push(ip) });
  const t0 = 1_000_000;
  for (let i = 0; i < 9; i++) assert.equal(ban.recordBad("198.51.100.9", t0 + i), false);
  assert.equal(ban.isBanned("198.51.100.9", t0 + 9), false);
  assert.equal(ban.recordBad("198.51.100.9", t0 + 10), true);
  assert.deepEqual(bans, ["198.51.100.9"]);
  assert.equal(ban.isBanned("198.51.100.9", t0 + 9 * 60_000), true);
  assert.equal(ban.isBanned("198.51.100.9", t0 + 11 * 60_000), false);
  assert.equal(ban.isBanned("198.51.100.8", t0), false);
  const slow = createBan();
  for (let i = 0; i < 20; i++) slow.recordBad("198.51.100.7", t0 + i * 70_000);
  assert.equal(slow.isBanned("198.51.100.7", t0 + 20 * 70_000), false);
  const small = createBan({ maxEntries: 3 });
  for (let i = 0; i < 10; i++) small.recordBad(`198.51.101.${i}`, t0);
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

test("only the proxy on this host is let in, and the client is the address it wrote", () => {
  const req = (headers, peer) => ({ socket: { remoteAddress: peer }, get: (h) => headers[h.toLowerCase()] });
  assert.deepEqual(defaultGateways("Iface\tDestination\tGateway\neth0\t00000000\t0100A8C0\neth0\t0000A8C0\t00000000\n"), ["192.168.0.1"]);
  assert.equal(isLocalHop("127.0.0.1"), true);
  assert.equal(isLocalHop("::ffff:172.17.0.1"), true);
  assert.equal(isLocalHop("192.168.0.50"), false);
  assert.equal(proxiedClient("10.0.0.1, 198.51.100.9"), "198.51.100.9");
  assert.equal(proxiedClient("not-an-ip"), null);
  assert.equal(viaDirectProxy(req(PROXY, "127.0.0.1")), "198.51.100.9");
  assert.equal(viaDirectProxy(req(PROXY, "172.17.0.1")), "198.51.100.9");
  // A client's own X-Forwarded-For entries are ignored: only the proxy's last one counts.
  assert.equal(viaDirectProxy(req({ ...PROXY, "x-forwarded-for": "127.0.0.1, 198.51.100.9" }, "127.0.0.1")), "198.51.100.9");
  // A LAN device naming the direct host, the tunnel, another host, a mismatched forwarded host, no client: all refused.
  assert.equal(viaDirectProxy(req(PROXY, "192.168.0.50")), null);
  assert.equal(viaDirectProxy(req({ ...PROXY, "cf-connecting-ip": "198.51.100.9" }, "127.0.0.1")), null);
  assert.equal(viaDirectProxy(req({ ...PROXY, host: "shop.example" }, "127.0.0.1")), null);
  assert.equal(viaDirectProxy(req({ ...PROXY, "x-forwarded-host": "shop.example" }, "127.0.0.1")), null);
  assert.equal(viaDirectProxy(req({ host: DL_HOST }, "127.0.0.1")), null);
});

test("through the proxy a console's link opens; everything else stays off that address", async () => {
  const port = await start();
  const link = links.forRequest(listReq());
  const url = links.directUrl(`/${ENC}`, link);

  const head = await get(port, url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers["x-lane"], undefined);
  assert.equal(head.headers["x-cookingfoil-max-connections"], String(env.downloadMaxConnections));
  // Through the tunnel, or from anywhere but the proxy, the lane steps aside.
  assert.equal((await get(port, url, { headers: { ...PROXY, "cf-connecting-ip": "198.51.100.9" } })).headers["x-lane"], "main");
  assert.equal((await get(port, url, { headers: { host: "shop.example" } })).headers["x-lane"], "main");
  // On the direct address nothing but links: no pages, no lists, no unsigned files, no writes.
  for (const p of ["/admin", `/api/admin/users${new URL(url).search}`, `/api/homebrew${new URL(url).search}`, `/${ENC}`]) {
    const r = await get(port, p);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers["x-lane"], undefined, p);
  }
  assert.equal((await get(port, url, { method: "POST" })).status, 404);

  const forged = await get(port, url.replace(/sig=[^&]+/, `sig=${"A".repeat(22)}`));
  assert.equal(forged.status, 403);
  assert.equal(linkHeader(forged), "invalid");
  assert.equal(linkHeader(await get(port, links.directUrl(`/${ENC}`, { ...link, exp: 1000 }))), "expired");
  assert.equal((await get(port, links.directUrl(`/${encodeURIComponent("Game/gone.nsp")}`, link))).status, 404);

  const ok = await get(port, url);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), "NSPDATA");
});

test("a whole download closes the link; the next list carries a working one; other consoles are unaffected", async () => {
  const port = await start();
  const link = links.forRequest(listReq({ dev: KEY_A }));
  const other = links.forRequest(listReq({ dev: KEY_B }));
  const url = links.directUrl(`/${ENC}`, link);
  const otherUrl = links.directUrl(`/${ENC}`, other);
  assert.equal((await get(port, url)).status, 200);
  await settle();
  const again = await get(port, url);
  assert.equal(again.status, 403);
  assert.equal(linkHeader(again), "used");
  assert.equal((await get(port, otherUrl)).status, 200, "the same account's other console");
  const next = links.forRequest(listReq({ dev: KEY_A }));
  assert.equal(next.g, link.g + 1);
  assert.equal((await get(port, links.directUrl(`/${ENC}`, next))).status, 200);
});

test("split ranges close the link only after the last one lands; a cut-off response counts for nothing", async () => {
  const port = await start();
  const link = links.forRequest(listReq({ user: "bob", dev: KEY_B }));
  const url = links.directUrl(`/${BIG_ENC}`, link);
  const half = BIG.length / 2;
  assert.ok((await get(port, url, { abortAfter: 64 * 1024 })).aborted);
  await settle();
  assert.equal((await get(port, url, { headers: { ...PROXY, range: `bytes=0-${half - 1}` } })).status, 206);
  await settle();
  assert.equal((await get(port, url, { method: "HEAD" })).status, 200, "still open");
  const second = await get(port, url, { headers: { ...PROXY, range: `bytes=${half}-` } });
  assert.equal(second.status, 206);
  assert.equal(second.body.length, half);
  await settle();
  assert.equal(linkHeader(await get(port, url)), "used");
});

test("parallel segments close the link only when every byte is covered, tail first or not; a 0-0 probe closes nothing", async () => {
  const port = await start();
  const url = links.directUrl(`/${BIG_ENC}`, links.forRequest(listReq({ dev: "E".repeat(64) })));
  const size = BIG.length;
  const range = (r) => ({ headers: { ...PROXY, range: r } });
  const probe = await get(port, url, range("bytes=0-0"));
  assert.equal(probe.status, 206);
  assert.equal(probe.body.length, 1);
  await settle();
  for (const [a, b] of [[3 * size / 4, size - 1], [0, size / 4 - 1], [size / 2, 3 * size / 4 - 1]]) {
    assert.equal((await get(port, url, range(`bytes=${a}-${b}`))).status, 206);
    await settle();
    assert.equal((await get(port, url, range("bytes=0-0"))).status, 206, "still open");
    await settle();
  }
  assert.equal((await get(port, url, range(`bytes=${size / 4}-${size / 2 - 1}`))).status, 206);
  await settle();
  assert.equal(linkHeader(await get(port, url, range("bytes=0-0"))), "used");
});

test("a link closes when its account or its approved console can no longer sign in", async () => {
  const port = await start();
  users.add("carol", "carol-password-1");
  const carol = links.directUrl(`/${ENC}`, links.forRequest(listReq({ user: "carol", dev: KEY_A })));
  users.setEnabled("carol", false);
  const revoked = await get(port, carol);
  assert.equal(revoked.status, 403);
  assert.equal(linkHeader(revoked), "revoked");

  const KEY_P = "C".repeat(64);
  store.approveDevice(KEY_P, { label: "living room", accessKeyHash: "h" });
  const paired = links.directUrl(`/${ENC}`, links.forRequest(listReq({ user: null, dev: null, paired: KEY_P })));
  assert.equal((await get(port, paired, { method: "HEAD" })).status, 200);
  store.revokeDevice(KEY_P);
  assert.equal(linkHeader(await get(port, paired)), "revoked");
});

test("homebrew downloads, query and all, go through the same lane", async () => {
  const port = await start();
  const link = links.forRequest(listReq());
  assert.equal((await get(port, links.directUrl("/api/homebrew/gh-0123456789ab/download", link))).body.toString(), "NROBYTES");
  assert.equal((await get(port, links.directUrl("/api/homebrew/gh-0123456789ab/file?path=switch%2Fapp%2Fapp.nro", link))).body.toString(), "NROBYTES");
});

test("used links and generations survive a restart; expired ones are dropped", async () => {
  const port = await start();
  const link = links.forRequest(listReq({ dev: KEY_A }));
  const url = links.directUrl(`/${ENC}`, link);
  assert.equal((await get(port, url)).status, 200);
  await settle();
  state.flush();
  const file = path.join(dir, "security", "download-links.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(Object.keys(JSON.parse(readFileSync(file, "utf8")).used).length >= 1);
  state.resetForTests();
  assert.equal(linkHeader(await get(port, url)), "used");
  assert.equal(links.forRequest(listReq({ dev: KEY_A })).g, link.g + 1);
  assert.deepEqual(state.pruned({ ids: { x: { seen: 0 } }, used: { s: 1 } }, Date.now(), 3600), { ids: {}, used: {} });
});

test("one account keeps at most a few identities; the one unseen longest goes", () => {
  const acct = { kind: "user", id: "dave" };
  const ids = Object.fromEntries(Array.from({ length: state.MAX_IDS_PER_ACCOUNT }, (_, i) => [`u${i}`, { acct, seen: 100 + i }]));
  const withOther = { ...ids, z: { acct: { kind: "user", id: "erin" }, seen: 1 } };
  const room = state.makeRoom(withOther, acct, "new");
  assert.equal(Object.keys(room).length, state.MAX_IDS_PER_ACCOUNT);
  assert.equal(room.u0, undefined, "the oldest of dave's");
  assert.ok(room.z, "another account's is untouched");
  // Through the real path: many browsers for one account never grow past the cap.
  users.add("dave", "dave-password-12");
  const tags = Array.from({ length: 20 }, (_, i) => links.forRequest(listReq({ user: "dave", dev: null, ua: `Browser ${i}` })).u);
  const kept = tags.filter((u) => state.identity(u));
  assert.equal(kept.length, state.MAX_IDS_PER_ACCOUNT);
  assert.deepEqual(kept, tags.slice(-state.MAX_IDS_PER_ACCOUNT));
});

test("a client that keeps sending forged links through the proxy is blocked by its own address", async () => {
  const ban = createBan({ limit: 3 });
  const port = await start({ ban });
  const link = links.forRequest(listReq());
  const good = links.directUrl(`/${ENC}`, links.forRequest(listReq({ dev: KEY_B, user: "bob" })));
  const stale = links.directUrl(`/${ENC}`, { ...link, exp: 1000 });
  const from = (ip) => ({ headers: { host: DL_HOST, "x-forwarded-for": ip }, method: "HEAD" });
  for (let i = 0; i < 5; i++) await get(port, stale, from("198.51.100.77"));
  assert.equal((await get(port, good, from("198.51.100.77"))).status, 200, "expired links don't count");
  const forged = good.replace(/sig=[^&]+/, `sig=${"B".repeat(22)}`);
  // Spoofed entries on the left change nothing: the proxy's own entry is the client.
  for (let i = 0; i < 3; i++) await get(port, forged, from(`10.0.0.${i}, 198.51.100.77`));
  const blocked = await get(port, good, from("198.51.100.77"));
  assert.equal(blocked.status, 403);
  assert.equal(linkHeader(blocked), "blocked");
  assert.equal((await get(port, good, from("198.51.100.78"))).status, 200, "other clients are not");
});

test("a file has the same ETag and Last-Modified on both lanes, so If-Range resumes across them", async () => {
  const port = await start();
  const url = links.directUrl(`/${BIG_ENC}`, links.forRequest(listReq({ dev: "D".repeat(64) })));
  const direct = await get(port, url, { method: "HEAD" });
  const plain = await get(port, `/${BIG_ENC}`, { method: "HEAD", headers: { host: "shop.example" } });
  assert.equal(plain.headers["x-lane"], "main");
  assert.equal(direct.headers["x-lane"], undefined);
  assert.ok(direct.headers.etag);
  assert.equal(direct.headers.etag, plain.headers.etag);
  assert.equal(direct.headers["last-modified"], plain.headers["last-modified"]);
  const a = await get(port, url, { headers: { ...PROXY, range: "bytes=100-199", "if-range": plain.headers.etag } });
  const b = await get(port, `/${BIG_ENC}`, { headers: { host: "shop.example", range: "bytes=100-199", "if-range": plain.headers.etag } });
  assert.equal(a.status, 206);
  assert.equal(b.status, 206);
  assert.equal(a.headers["content-range"], b.headers["content-range"]);
});

test("the homebrew list gives every download a direct twin when signed in and none without the setting", async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = { user: "alice" };
    next();
  });
  app.use("/api/homebrew", homebrewRouter({ service: fakeService }));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const list = async () => JSON.parse((await get(port, "/api/homebrew", { headers: { "x-device-key": KEY_A } })).body).homebrew[0];
  const on = await list();
  assert.equal(on.download_url, "/api/homebrew/gh-0123456789ab/download");
  assert.ok(new URL(on.download_direct_url).searchParams.get("sig"));
  assert.ok(on.bundle_direct_url);
  assert.ok(on.files[0].direct_url);
  assert.equal(on.icon_direct_url, undefined);
  settings.save({ publicDirectBaseUrl: null });
  const off = await list();
  assert.equal(JSON.stringify(off).includes("direct"), false);
  assert.deepEqual(Object.keys(off), Object.keys(on).filter((k) => !k.includes("direct")));
  settings.save({ publicDirectBaseUrl: `https://${DL_HOST}` });
});
