import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";

// Download tokens: a signed-in client that declares direct-token gets a token
// header and fixed download URLs on the direct address; the direct address's
// proxy forwards those downloads with the token as a Bearer header.
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
const tokens = await import("../../src/security/download-token.js");
const users = await import("../../src/security/users.js");
const store = await import("../../src/security/store.js");
const { defaultGateways, isLocalHop, setGatewaysForTests } = await import("../../src/security/local-hop.js");
const { createBan } = await import("../../src/security/download-ban.js");
const { default: directLane, TOKEN_STATE_HEADER, laneOf, proxiedClient, viaDirectProxy, bearerToken } = await import("../../src/security/direct-lane.js");
const { homebrewRouter } = await import("../../src/routes/homebrew.js");
const health = await import("../../src/security/direct-health.js");

const KEY_A = "A".repeat(64);
const KEY_B = "B".repeat(64);
const DL_HOST = "dl.example.org:38443";
const DL = `https://${DL_HOST}`;
const FEATURES = { "x-cookingfoil-features": "direct-token" };
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
function listReq({ user = "alice", dev = KEY_A, paired = null, ua = "console", features = "direct-token" } = {}) {
  const headers = { ...(dev ? { "x-device-key": dev } : {}), "user-agent": ua, ...(features ? { "x-cookingfoil-features": features } : {}) };
  return { auth: user ? { user } : undefined, pairedDevice: paired ?? undefined, get: (h) => headers[h.toLowerCase()] };
}
const tokenFor = (opts) => tokens.issue(links.forRequest(listReq(opts)).who);

async function listen(app) {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server.address().port;
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
  return listen(app);
}

/** The homebrew list behind a sign-in and the token header, as index.js mounts them. */
async function listApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = { user: "alice" };
    next();
  });
  app.use(links.tokenHeader());
  app.use("/api/homebrew", homebrewRouter({ service: fakeService }));
  return listen(app);
}

/** A request as the proxy on the host sends it (from loopback, Host fixed, X-Forwarded-For written). */
const PROXY = { host: DL_HOST, "x-forwarded-for": "198.51.100.9" };
const bearer = (token, extra = {}) => ({ headers: { ...PROXY, authorization: `Bearer ${token}`, ...extra } });

function get(port, url, { method = "GET", headers = PROXY } = {}) {
  const u = new URL(url, "http://x");
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

const ENC = encodeURIComponent("Game/file [0100000000010000][v0].nsp");
const BIG_ENC = encodeURIComponent("Game/big [0100000000020000][v0].nsp");
const tokenState = (r) => r.headers?.[TOKEN_STATE_HEADER.toLowerCase()];

test("with no direct address nothing changes: no token, normal URLs, the lane is off", async () => {
  settings.save({ publicDirectBaseUrl: null });
  assert.equal(links.forRequest(listReq()), null);
  assert.equal(links.directUrl("/api/saves/x/download", links.forRequest(listReq())), "/api/saves/x/download");
  assert.equal(links.withShopDirect('{"url":"../a.nsp"}', null), '{"url":"../a.nsp"}');
  const lane = await start();
  assert.equal((await get(lane, `/${ENC}`, { headers: { ...PROXY, authorization: "Bearer x.y" } })).headers["x-lane"], "main");
  const port = await listApp();
  const r = await get(port, "/api/homebrew", { headers: { "x-device-key": KEY_A, ...FEATURES } });
  assert.equal(r.headers["x-cookingfoil-download-token"], undefined);
  const hb = JSON.parse(r.body).homebrew[0];
  assert.equal(hb.download_url, "/api/homebrew/gh-0123456789ab/download");
  assert.equal(r.body.includes("direct"), false);
});

test("the direct address takes scheme, host and port only", () => {
  assert.throws(() => settings.save({ publicDirectBaseUrl: "https://dl.example.org/files" }), /publicDirectBaseUrl/);
  settings.save({ publicDirectBaseUrl: `${DL}/`, downloadLinkTtl: "21600" });
  assert.equal(env.publicDirectBaseUrl, DL);
  assert.equal(env.downloadLinkTtl, 21600);
});

test("only signed-in clients that declare direct-token get a token and direct URLs", () => {
  assert.equal(links.forRequest(listReq({ user: null })), null, "not signed in");
  assert.equal(links.forRequest(listReq({ features: null })), null, "no feature header");
  assert.equal(links.forRequest(listReq({ features: "zstd, other" })), null, "other features");
  assert.ok(links.forRequest(listReq({ features: "zstd, Direct-Token" })), "listed among others, any case");
  const link = links.forRequest(listReq());
  assert.equal(links.directUrl("/api/homebrew/x/file?path=a%2Fb", link), `${DL}/api/homebrew/x/file?path=a%2Fb`);
  assert.equal(links.directUrl(null, link), null);
  assert.equal(links.directUrl("https://cdn.example.org/a.png", link), "https://cdn.example.org/a.png");
  const json = JSON.stringify({ files: [{ url: `../${ENC}`, variants: [{ url: "../Game%2Fv.nsp" }] }], icon: "/api/shop/icon/x" });
  assert.equal(links.withShopDirect(json, link), JSON.stringify({ files: [{ url: `${DL}/${ENC}`, variants: [{ url: `${DL}/Game%2Fv.nsp` }] }], icon: "/api/shop/icon/x" }));
});

test("a token is stable inside a quarter of its lifetime, lives at least the full lifetime and names its console", () => {
  const ttl = 21600;
  const now = 1_800_000_123;
  const { iat, exp } = tokens.stepFor(now, ttl);
  assert.ok(iat <= now && exp - now >= ttl && exp - now <= ttl + ttl / 4);
  assert.deepEqual(tokens.stepFor(now + 5, ttl), { iat, exp });
  const who = links.forRequest(listReq()).who;
  const a = tokens.issue(who, now * 1000, ttl);
  assert.equal(tokens.issue(who, (now + 5) * 1000, ttl), a);
  assert.notEqual(tokens.issue(who, (now + ttl / 4) * 1000, ttl), a, "the next step");
  assert.notEqual(tokens.issue(links.forRequest(listReq({ dev: KEY_B })).who, now * 1000, ttl), a, "another console");
  assert.match(a, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  const payload = JSON.parse(Buffer.from(a.split(".")[0], "base64url").toString());
  assert.deepEqual(payload, { v: 1, sub: { acct: { kind: "user", id: "alice" }, dev: KEY_A, agent: null, paired: false }, iat, exp });
  assert.equal(tokens.verify(a, now * 1000).verdict, "ok");
  assert.equal(tokens.verify(a, exp * 1000).verdict, "expired");
  // A changed payload or MAC, junk, nothing: invalid.
  const forged = Buffer.from(JSON.stringify({ ...payload, sub: { ...payload.sub, acct: { kind: "user", id: "bob" } } })).toString("base64url");
  assert.equal(tokens.verify(`${forged}.${a.split(".")[1]}`, now * 1000).verdict, "invalid");
  assert.equal(tokens.verify(`${a.split(".")[0]}.${"A".repeat(43)}`, now * 1000).verdict, "invalid");
  for (const bad of [null, "", "x", "a.b.c", "a b.c"]) assert.equal(tokens.verify(bad).verdict, "invalid", String(bad));
});

test("the key is kept private and survives a reload", () => {
  const token = tokenFor();
  const file = path.join(dir, "security", "download-link.key");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readFileSync(file).length, 32);
  tokens.resetKeyForTests();
  assert.equal(tokens.verify(token).verdict, "ok");
  assert.equal(existsSync(path.join(dir, "security", "download-links.json")), false, "no per-link state is written");
});

test("bearer headers are read strictly", () => {
  assert.equal(bearerToken("Bearer abc.def"), "abc.def");
  assert.equal(bearerToken("bearer abc.def"), "abc.def");
  for (const h of [undefined, "", "Bearer", "Basic YWxpY2U6eA==", "Bearer a b", "Token abc"]) assert.equal(bearerToken(h), null, String(h));
});

test("which paths the lane can reach", () => {
  assert.equal(laneOf(`/${ENC}`), "file");
  assert.equal(laneOf("/api/retro/games/snes-0123456789/rom"), "route");
  assert.equal(laneOf("/api/homebrew/gh-0123456789ab/file"), "route");
  for (const p of ["/", "/admin", "/api/admin/users", "/api/retro/games", "/api/shop/sections", "/api/shop/info", "/shop.json", "/login", "/API/retro/games/x/rom", "/api/inbox/upload"]) {
    assert.equal(laneOf(p), null, p);
  }
});

test("only the proxy on this host is let in, and the client is the address it wrote", () => {
  const req = (headers, peer) => ({ socket: { remoteAddress: peer }, get: (h) => headers[h.toLowerCase()] });
  assert.deepEqual(defaultGateways("Iface\tDestination\tGateway\neth0\t00000000\t0100A8C0\neth0\t0000A8C0\t00000000\n"), ["192.168.0.1"]);
  assert.equal(isLocalHop("127.0.0.1"), true);
  assert.equal(isLocalHop("::ffff:172.17.0.1"), true);
  assert.equal(isLocalHop("10.0.0.50"), false);
  assert.equal(proxiedClient("10.0.0.1, 198.51.100.9"), "198.51.100.9");
  assert.equal(proxiedClient("not-an-ip"), null);
  assert.equal(viaDirectProxy(req(PROXY, "127.0.0.1")), "198.51.100.9");
  assert.equal(viaDirectProxy(req(PROXY, "172.17.0.1")), "198.51.100.9");
  assert.equal(viaDirectProxy(req({ ...PROXY, "x-forwarded-for": "127.0.0.1, 198.51.100.9" }, "127.0.0.1")), "198.51.100.9");
  assert.equal(viaDirectProxy(req(PROXY, "10.0.0.50")), null);
  assert.equal(viaDirectProxy(req({ ...PROXY, "cf-connecting-ip": "198.51.100.9" }, "127.0.0.1")), null);
  assert.equal(viaDirectProxy(req({ ...PROXY, host: "shop.example.org" }, "127.0.0.1")), null);
  assert.equal(viaDirectProxy(req({ ...PROXY, "x-forwarded-host": "shop.example.org" }, "127.0.0.1")), null);
  assert.equal(viaDirectProxy(req({ host: DL_HOST }, "127.0.0.1")), null);
});

test("on the direct address a valid token opens downloads; nothing else is there", async () => {
  const port = await start();
  const token = tokenFor();
  const url = `/${ENC}`;
  const head = await get(port, url, { method: "HEAD", ...bearer(token) });
  assert.equal(head.status, 200);
  assert.equal(head.headers["x-lane"], undefined);
  assert.equal(head.headers["x-cookingfoil-max-connections"], String(env.downloadMaxConnections));
  const ok = await get(port, url, bearer(token));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), "NSPDATA");
  // Through the tunnel, or from anywhere but the proxy, the lane steps aside.
  assert.equal((await get(port, url, bearer(token, { "cf-connecting-ip": "198.51.100.9" }))).headers["x-lane"], "main");
  assert.equal((await get(port, url, { headers: { host: "shop.example.org", authorization: `Bearer ${token}` } })).headers["x-lane"], "main");
  // No pages, no lists, no writes, even with a good token.
  for (const p of ["/admin", "/api/admin/users", "/api/homebrew", "/api/shop/info", "/shop.json"]) {
    const r = await get(port, p, bearer(token));
    assert.equal(r.status, 404, p);
    assert.equal(r.headers["x-lane"], undefined, p);
  }
  assert.equal((await get(port, url, { method: "POST", ...bearer(token) })).status, 404);
  assert.equal((await get(port, `/${encodeURIComponent("Game/gone.nsp")}`, bearer(token))).status, 404);
  // Homebrew, query and all.
  assert.equal((await get(port, "/api/homebrew/gh-0123456789ab/download", bearer(token))).body.toString(), "NROBYTES");
  assert.equal((await get(port, "/api/homebrew/gh-0123456789ab/file?path=switch%2Fapp%2Fapp.nro", bearer(token))).body.toString(), "NROBYTES");
});

test("missing, broken, expired and revoked tokens are 401 and say which", async () => {
  const port = await start();
  const url = `/${ENC}`;
  for (const headers of [PROXY, bearer("nope").headers, bearer(`${tokenFor().split(".")[0]}.${"Q".repeat(43)}`).headers]) {
    const r = await get(port, url, { headers });
    assert.equal(r.status, 401);
    assert.equal(tokenState(r), "invalid");
    assert.match(r.headers["www-authenticate"], /^Bearer/);
  }
  const old = tokens.issue(links.forRequest(listReq()).who, Date.now() - 2 * 86400_000);
  const expired = await get(port, url, bearer(old));
  assert.equal(expired.status, 401);
  assert.equal(tokenState(expired), "expired");

  users.add("carol", "carol-password-1");
  const carol = tokenFor({ user: "carol" });
  assert.equal((await get(port, url, { method: "HEAD", ...bearer(carol) })).status, 200);
  users.setEnabled("carol", false);
  const revoked = await get(port, url, bearer(carol));
  assert.equal(revoked.status, 401);
  assert.equal(tokenState(revoked), "revoked");

  const KEY_P = "C".repeat(64);
  store.approveDevice(KEY_P, { label: "living room", accessKeyHash: "h" });
  const paired = tokenFor({ user: null, dev: null, paired: KEY_P });
  assert.equal((await get(port, url, { method: "HEAD", ...bearer(paired) })).status, 200);
  store.revokeDevice(KEY_P);
  assert.equal(tokenState(await get(port, url, bearer(paired))), "revoked");
});

test("basic auth and device keys open nothing on the direct address", async () => {
  const port = await start();
  const basic = "Basic " + Buffer.from("alice:alice-password-1").toString("base64");
  const r = await get(port, `/${ENC}`, { headers: { ...PROXY, authorization: basic, "x-device-key": KEY_A } });
  assert.equal(r.status, 401);
  assert.equal(tokenState(r), "invalid");
  assert.equal(r.headers["x-lane"], undefined);
});

test("one token serves many ranges, a 0-0 probe and the whole file, again and again", async () => {
  const port = await start();
  const token = tokenFor();
  const url = `/${BIG_ENC}`;
  const probe = await get(port, url, bearer(token, { range: "bytes=0-0" }));
  assert.equal(probe.status, 206);
  assert.equal(probe.headers["content-range"], `bytes 0-0/${BIG.length}`);
  const half = BIG.length / 2;
  const parts = await Promise.all([`bytes=${half}-${BIG.length - 1}`, `bytes=0-${half - 1}`].map((range) => get(port, url, bearer(token, { range }))));
  assert.deepEqual(parts.map((p) => p.status), [206, 206]);
  assert.ok(Buffer.concat([parts[1].body, parts[0].body]).equals(BIG));
  assert.equal((await get(port, url, bearer(token))).status, 200);
  assert.equal((await get(port, url, bearer(token))).body.length, BIG.length, "still open after a full delivery");
});

test("a file has the same ETag and Last-Modified on both lanes, so If-Range resumes across them", async () => {
  const port = await start();
  const token = tokenFor({ dev: "D".repeat(64) });
  const url = `/${BIG_ENC}`;
  const direct = await get(port, url, { method: "HEAD", ...bearer(token) });
  const plain = await get(port, url, { method: "HEAD", headers: { host: "shop.example.org" } });
  assert.equal(plain.headers["x-lane"], "main");
  assert.equal(direct.headers["x-lane"], undefined);
  assert.ok(direct.headers.etag);
  assert.equal(direct.headers.etag, plain.headers.etag);
  assert.equal(direct.headers["last-modified"], plain.headers["last-modified"]);
  const a = await get(port, url, bearer(token, { range: "bytes=100-199", "if-range": plain.headers.etag }));
  const b = await get(port, url, { headers: { host: "shop.example.org", range: "bytes=100-199", "if-range": plain.headers.etag } });
  assert.equal(a.status, 206);
  assert.equal(b.status, 206);
  assert.equal(a.headers["content-range"], b.headers["content-range"]);
  const stale = await get(port, url, bearer(token, { range: "bytes=100-199", "if-range": '"other"' }));
  assert.equal(stale.status, 200, "a changed file restarts from the beginning");
});

test("a client that keeps sending invalid tokens is blocked by its own address", async () => {
  const ban = createBan({ limit: 3 });
  const port = await start({ ban });
  const good = tokenFor({ user: "bob", dev: KEY_B });
  const old = tokens.issue(links.forRequest(listReq()).who, Date.now() - 2 * 86400_000);
  const from = (ip, token) => ({ method: "HEAD", headers: { host: DL_HOST, "x-forwarded-for": ip, authorization: `Bearer ${token}` } });
  for (let i = 0; i < 5; i++) await get(port, `/${ENC}`, from("198.51.100.77", old));
  assert.equal((await get(port, `/${ENC}`, from("198.51.100.77", good))).status, 200, "expired tokens don't count");
  // Spoofed entries on the left change nothing: the proxy's own entry is the client.
  for (let i = 0; i < 3; i++) await get(port, `/${ENC}`, from(`10.0.0.${i}, 198.51.100.77`, "forged.token"));
  const blocked = await get(port, `/${ENC}`, from("198.51.100.77", good));
  assert.equal(blocked.status, 403);
  assert.equal(tokenState(blocked), "blocked");
  assert.equal((await get(port, `/${ENC}`, from("198.51.100.78", good))).status, 200, "other clients are not");
});

test("a list for a direct-token client: fixed direct URLs, a token header (on 304 too), an ETag of the body alone", async () => {
  const port = await listApp();
  const ask = (headers) => get(port, "/api/homebrew", { headers: { "x-device-key": KEY_A, ...headers } });
  const on = await ask(FEATURES);
  const token = on.headers["x-cookingfoil-download-token"];
  assert.equal(tokens.verify(token).verdict, "ok");
  const hb = JSON.parse(on.body).homebrew[0];
  assert.equal(hb.download_url, `${DL}/api/homebrew/gh-0123456789ab/download`);
  assert.equal(hb.bundle_url, `${DL}/api/homebrew/gh-0123456789ab/bundle`);
  assert.equal(hb.files[0].url, `${DL}/api/homebrew/gh-0123456789ab/file?path=switch%2Fapp%2Fapp.nro`);
  assert.equal(hb.icon_url.startsWith("/api/homebrew/"), true, "artwork stays on the shop address");
  assert.equal(on.body.includes("direct_url"), false, "no twins");
  const again = await ask(FEATURES);
  assert.equal(again.body.toString(), on.body.toString(), "the same on every refresh");
  assert.equal(again.headers.etag, on.headers.etag);
  const cached = await ask({ ...FEATURES, "if-none-match": on.headers.etag });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers["x-cookingfoil-download-token"], token);
  // Another console, same account: same body and ETag, its own token.
  const other = await get(port, "/api/homebrew", { headers: { "x-device-key": KEY_B, ...FEATURES } });
  assert.equal(other.headers.etag, on.headers.etag);
  assert.notEqual(other.headers["x-cookingfoil-download-token"], token);

  const off = await ask({});
  assert.equal(off.headers["x-cookingfoil-download-token"], undefined);
  const plain = JSON.parse(off.body).homebrew[0];
  assert.equal(plain.download_url, "/api/homebrew/gh-0123456789ab/download");
  assert.deepEqual(Object.keys(plain), Object.keys(hb));
  assert.notEqual(off.headers.etag, on.headers.etag);
});

test("lists never depend on whether the direct address answers", async () => {
  const port = await listApp();
  const ask = () => get(port, "/api/homebrew", { headers: { "x-device-key": KEY_A, ...FEATURES } });
  health.setForTests(true);
  const up = await ask();
  health.setForTests(false);
  const down = await ask();
  assert.equal(down.body.toString(), up.body.toString());
  assert.ok(down.headers["x-cookingfoil-download-token"]);
});

test("the probe looks the host up, asks base/, and counts any answer", async () => {
  const asked = [];
  await health.probe(DL, { lookup: async (h) => asked.push(h), fetchImpl: async (url, o) => { asked.push(url, o.method); return { status: 404 }; } });
  assert.deepEqual(asked, ["dl.example.org", `${DL}/`, "GET"]);
  await assert.rejects(health.probe("https://dl.example.org", { lookup: async () => {}, fetchImpl: async () => { throw new Error("timeout"); } }));
  assert.deepEqual(health.nextHealth({ up: false, since: null, fails: 3 }, true, 5), { up: true, since: 5, fails: 0, checkedAt: 5, error: null });
});

test("checks run only while requests come in, at most once a minute, one at a time", async () => {
  const { RECHECK_MS: recheck } = health;
  const t0 = Date.now();
  let probes = 0;
  const failing = { lookup: async () => {}, fetchImpl: async () => { probes++; throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } };
  const answering = { lookup: async () => {}, fetchImpl: async () => { probes++; return { status: 404 }; } };
  health.setForTests(true, { options: failing, checkedAt: t0 });
  health.touch(t0 + recheck - 1000);
  await health.pending();
  assert.equal(probes, 0, "not due yet");
  health.touch(t0 + recheck);
  await health.pending();
  assert.equal(probes, 1);
  assert.equal(health.isUp(), true, "one failure is not enough");
  health.touch(t0 + recheck + 30_000);
  await health.pending();
  assert.equal(probes, 1, "the next check waits a minute");
  health.touch(t0 + 2 * recheck);
  await health.pending();
  assert.equal(probes, 2);
  assert.equal(health.isUp(), false, "two failures in a row");
  assert.equal(health.status().error, "ECONNREFUSED");
  health.setForTests(false, { options: answering, checkedAt: t0 });
  health.touch(t0 + recheck);
  health.touch(t0 + recheck);
  await health.pending();
  assert.equal(probes, 3, "one at a time");
  assert.equal(health.isUp(), true, "one success brings it back");
  assert.equal(health.due({ up: true, fails: 0, checkedAt: null }, "a", "a", 0), true);
  assert.equal(health.due({ up: true, fails: 0, checkedAt: 0 }, "b", "a", 0), true, "a new address");
  health.setForTests(true, { options: {} });
});

test("a hung lookup or a 5xx is a failure, and the time limit covers the lookup too", async () => {
  const started = Date.now();
  await assert.rejects(health.probe("https://dl.example.org", { timeoutMs: 100, lookup: () => new Promise(() => {}), fetchImpl: async () => ({ status: 404 }) }), /timed out/);
  assert.ok(Date.now() - started < 1000);
  await assert.rejects(health.probe("https://dl.example.org", { lookup: async () => {}, fetchImpl: async () => ({ status: 502 }) }), /502/);
  health.setForTests(true, { options: { timeoutMs: 50, lookup: () => new Promise(() => {}) }, checkedAt: 0 });
  health.touch(20 * 60_000);
  await health.pending();
  assert.equal(health.status().error, "ETIMEDOUT");
  health.setForTests(true, { options: {} });
});
