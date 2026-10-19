import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ra-link-"));
process.env.COOK_DATA_DIR = root;

const link = await import("../../src/retro/achievements/link.js");
const players = await import("../../src/retro/achievements/players.js");
const { mountAchievements } = await import("../../src/routes/retro-achievements.js");
const { default: raLinkRouter, raLinkPage } = await import("../../src/routes/ra-link.js");

after(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => { link.reset(); players.reset(); });

/** The console's side: a P-256 key pair, and opening an envelope the way the client does with mbedTLS. */
function consoleKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    open(code, { epk, iv, ct }) {
      const x = ecdh.computeSecret(Buffer.from(epk, "base64url"));
      const key = Buffer.from(crypto.hkdfSync("sha256", x, Buffer.alloc(0), "cookingfoil-ra-link", 32));
      const body = Buffer.from(ct, "base64url");
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAAD(Buffer.from(code, "utf8"));
      d.setAuthTag(body.subarray(-16));
      return JSON.parse(Buffer.concat([d.update(body.subarray(0, -16)), d.final()]).toString("utf8"));
    },
  };
}

/** The phone's side, as the page does it: an envelope for `plain` to `publicKey` under `code`. */
function sealFor(publicKey, code, plain) {
  const eph = crypto.createECDH("prime256v1");
  eph.generateKeys();
  const x = eph.computeSecret(Buffer.from(publicKey, "base64url"));
  const key = Buffer.from(crypto.hkdfSync("sha256", x, Buffer.alloc(0), "cookingfoil-ra-link", 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(code, "utf8"));
  const ct = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final(), c.getAuthTag()]);
  return { epk: eph.getPublicKey().toString("base64url"), iv: iv.toString("base64url"), ct: ct.toString("base64url") };
}

test("a link takes one envelope at a time, keeps it for its console until the result, and reopens after a wrong password", async () => {
  const dev = consoleKeys();
  assert.equal(link.open("user:a", "not-a-key"), null);
  assert.equal(link.open("user:a", Buffer.alloc(65, 1).toString("base64url")), null, "an uncompressed point starts with 0x04");
  const asker = { account: "viewer", device: "Living room" };
  const first = link.open("user:a", dev.publicKey, { requester: asker, username: "Mario" });
  const { code } = link.open("user:a", dev.publicKey, { requester: asker, username: "Mario" });
  assert.equal(link.view(first.code), null, "a new link replaces the console's earlier one");
  const other = link.open("user:a|another console", dev.publicKey);
  assert.equal(link.view(code).state, "waiting", "another console of the account keeps its own link");
  assert.equal(link.view(other.code).state, "waiting");
  assert.deepEqual(link.view(code), { state: "waiting", requester: asker, username: "Mario", triesLeft: 3, expiresAt: link.view(code).expiresAt });

  assert.equal(link.take(code, "user:a"), "none");
  assert.equal(link.seal(code, { epk: "x", iv: "y", ct: "z" }), "invalid");
  const env = sealFor(dev.publicKey, code, { u: "Mario", p: "pw" });
  assert.equal(link.seal(code, { ...env, ct: Buffer.alloc(2048).toString("base64url") }), "invalid", "an envelope has a size cap");
  assert.equal(link.seal(code, env), "ok");
  assert.equal(link.seal(code, env), "busy", "one envelope until the console has used it");
  assert.equal(link.take(code, "user:b"), "gone", "only the console that opened the link takes it");
  const taken = link.take(code, "user:a");
  assert.deepEqual(dev.open(code, taken), { u: "Mario", p: "pw" });
  assert.deepEqual(link.take(code, "user:a"), taken, "a reply lost on the way is taken again until the result");
  assert.throws(() => dev.open("another-code", taken), "the code is bound in: an envelope from another link does not open");

  assert.equal(link.finish(code, "user:a", { ok: false, unreadable: true }), "unreadable");
  assert.equal(link.view(code).triesLeft, 3, "an envelope the console could not open spends no try");
  assert.equal(link.take(code, "user:a"), "none", "the envelope goes with the result");
  assert.equal(link.seal(code, env), "ok");
  link.take(code, "user:a");
  assert.equal(link.finish(code, "user:a", { ok: false }), "wrong");
  assert.equal(link.view(code).triesLeft, 2);
  for (const left of [1, 0]) {
    assert.equal(link.seal(code, sealFor(dev.publicKey, code, { u: "Mario", p: "x" })), "ok");
    link.take(code, "user:a");
    assert.equal(link.finish(code, "user:a", { ok: false }), left ? "wrong" : "failed");
  }
  assert.equal(link.seal(code, env), "busy", "three wrong passwords end the link");
});

test("a wait costs nothing until the link changes, and ends at its timeout or when the client leaves", async () => {
  const dev = consoleKeys();
  const { code } = link.open("user:a", dev.publicKey);
  const sealed = link.wait(code, (l) => l.state === "sealed", 5000);
  link.seal(code, sealFor(dev.publicKey, code, { u: "a1", p: "b" }));
  assert.equal((await sealed).state, "sealed");
  const t0 = Date.now();
  assert.equal((await link.wait(code, (l) => l.state === "done", 50)).state, "sealed");
  assert.ok(Date.now() - t0 < 1000);
  const ac = new AbortController();
  const left = link.wait(code, (l) => l.state === "done", 60_000, ac.signal);
  ac.abort();
  assert.equal((await left).state, "sealed");
  const gone = link.wait(code, (l) => l.state === "done", 60_000);
  link.reset();
  assert.equal(await gone, null, "a link that goes ends its waits");
});

test("the console and the phone hand a password over through the server, which registers the name", async () => {
  const app = express();
  app.use((req, _res, next) => { if (req.get("x-user")) req.auth = { user: req.get("x-user") }; next(); });
  const retro = express.Router();
  mountAchievements(retro);
  app.use("/api/retro", retro);
  app.use(raLinkRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const asConsole = (method, url, body) => fetch(`${base}/api/retro/achievements${url}`, {
    method, headers: { "x-user": "viewer", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const asPhone = (method, url, body) => fetch(`${base}/ra-link/api${url}`, {
    method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  try {
    players.register("user:viewer", "Mario");
    const dev = consoleKeys();
    assert.equal((await fetch(`${base}/api/retro/achievements/link`, { method: "POST" })).status, 403);
    assert.equal((await asConsole("POST", "/link", { publicKey: "nope" })).status, 400);
    const opened = await asConsole("POST", "/link", { publicKey: dev.publicKey });
    assert.equal(opened.status, 201);
    const { code, path: page } = await opened.json();
    assert.equal(page, `/ra-link?c=${code}`);

    const html = await (await fetch(`${base}${page}`, { headers: { "Accept-Language": "ko" } })).text();
    assert.match(html, /레트로 업적 연결/);
    assert.match(html, /"@noble\/curves\/":"\/ra-link\/vendor\/curves@2\.4\.0\/"/);
    assert.equal((await fetch(`${base}/ra-link/vendor/curves@2.4.0/nist.js`)).status, 200);
    assert.equal((await fetch(`${base}/ra-link/vendor/curves@2.4.0/package.json`)).status, 404, "only scripts are served");
    assert.equal((await fetch(`${base}/ra-link/app.js`)).status, 200);

    const shown = await (await asPhone("GET", `/${code}`)).json();
    assert.deepEqual(shown, { state: "waiting", requester: { account: "viewer", device: null }, username: null, triesLeft: 3, expiresAt: shown.expiresAt },
      "the phone sees who asked; a name only typed in (maybe someone else's) is not filled in");
    assert.equal((await asPhone("GET", "/unknown")).status, 410);

    // The console waits; the phone's envelope wakes it.
    const waiting = asConsole("GET", `/link/${code}/sealed`);
    assert.equal((await asPhone("POST", `/${code}`, { epk: "a", iv: "b", ct: "c" })).status, 400);
    assert.equal((await asPhone("POST", `/${code}`, sealFor(dev.publicKey, code, { u: "Mario", p: "wrong" }))).status, 202);
    const first = await waiting;
    assert.equal(first.status, 200);
    const envelope = await first.json();
    assert.deepEqual(dev.open(code, envelope), { u: "Mario", p: "wrong" });
    assert.deepEqual(await (await asConsole("GET", `/link/${code}/sealed`)).json(), envelope, "a console whose reply was lost takes it again");
    assert.equal((await asPhone("POST", `/${code}`, sealFor(dev.publicKey, code, { u: "Mario", p: "x" }))).status, 409);

    // The phone waits for the result; the console reports a wrong password, then a right one.
    const result = asPhone("GET", `/${code}?after=taken`);
    assert.deepEqual(await (await asConsole("POST", `/link/${code}/result`, { ok: false })).json(), { state: "wrong" });
    assert.deepEqual(await (await result).json().then((v) => [v.state, v.triesLeft]), ["wrong", 2]);
    await asPhone("POST", `/${code}`, sealFor(dev.publicKey, code, { u: "Mario", p: "right" }));
    assert.deepEqual(dev.open(code, await (await asConsole("GET", `/link/${code}/sealed`)).json()), { u: "Mario", p: "right" });
    assert.equal((await asConsole("POST", `/link/${code}/result`, { ok: true, username: "bad name!" })).status, 400);
    assert.deepEqual(await (await asConsole("POST", `/link/${code}/result`, { ok: true, username: "Mario" })).json(), { state: "done" });
    assert.equal((await (await asPhone("GET", `/${code}?after=taken`)).json()).state, "done");
    assert.equal(players.nameOf("user:viewer"), "Mario");
    const again = await (await asConsole("POST", "/link", { publicKey: dev.publicKey })).json();
    assert.equal((await (await asPhone("GET", `/${again.code}`)).json()).username, "Mario", "a name a console signed in with is filled in next time");

    // Someone who types another player's name gets no pre-filled link out of it.
    players.register("user:other", "Mario");
    const theirs = await (await fetch(`${base}/api/retro/achievements/link`, {
      method: "POST", headers: { "x-user": "other", "Content-Type": "application/json" }, body: JSON.stringify({ publicKey: dev.publicKey }),
    })).json();
    assert.deepEqual(await (await asPhone("GET", `/${theirs.code}`)).json().then((v) => [v.username, v.requester.account]), [null, "other"]);

    // Two consoles of one account each keep their own link.
    const onConsole = (key) => fetch(`${base}/api/retro/achievements/link`, {
      method: "POST", headers: { "x-user": "viewer", "X-Device-Key": key, "Content-Type": "application/json" }, body: JSON.stringify({ publicKey: dev.publicKey }),
    }).then((r) => r.json());
    const [a, b] = [await onConsole("a".repeat(64)), await onConsole("b".repeat(64))];
    assert.equal((await asPhone("GET", `/${a.code}`)).status, 200);
    assert.equal((await asPhone("GET", `/${b.code}`)).status, 200);
    assert.equal((await fetch(`${base}/api/retro/achievements/link/${a.code}/sealed`, { headers: { "x-user": "viewer", "X-Device-Key": "b".repeat(64) } })).status, 410,
      "another console of the same account does not take it");

    assert.equal((await fetch(`${base}/api/retro/achievements/link/${code}/sealed`, { headers: { "x-user": "other" } })).status, 410, "another account's console gets nothing");
    link.reset();
    assert.equal((await asConsole("GET", `/link/${code}/sealed`)).status, 410);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("the page warns on plain http and carries its words safely", () => {
  const html = raLinkPage("en");
  assert.match(html, /id="http-warn"[^>]*hidden/);
  assert.match(html, /plain http/);
  assert.doesNotMatch(html.split('id="ra-text">')[1].split("</script>")[0], /</);
});
