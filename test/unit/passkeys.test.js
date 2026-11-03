import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeAuthenticator } from "../support/fake-authenticator.js";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-passkeys-"));
const passkeys = await import("../../src/security/passkeys.js");

const HOST = "cook.example.com";
const ORIGIN = `https://${HOST}`;
const ALICE = { kind: "password", name: "alice" };

/** A browser request on `host`, carrying the challenge cookie a ceremony set. */
function browser(host = HOST, proto = "https") {
  const jar = {};
  const req = (extra = {}) => ({
    protocol: proto, secure: proto === "https", socket: {}, ip: "203.0.113.5",
    headers: { host, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), ...extra },
    get(n) { return this.headers[n.toLowerCase()]; },
  });
  const keep = (line) => { const [pair] = line.split(";"); const eq = pair.indexOf("="); jar[pair.slice(0, eq)] = pair.slice(eq + 1); };
  return { req, keep };
}

async function add(scope, owner, auth, b = browser()) {
  const { options, cookie } = await passkeys.startAdd(b.req(), scope, owner, "alice");
  b.keep(cookie);
  return passkeys.finishAdd(b.req(), scope, owner, auth.create(options));
}

async function signIn(scope, auth, b = browser(), opts) {
  const { options, cookie } = await passkeys.startSignIn(b.req(), scope);
  b.keep(cookie);
  return passkeys.finishSignIn(b.req(), scope, auth.get(options, opts));
}

const refused = (code) => (err) => err instanceof passkeys.PasskeyError && err.code === code;

test("a passkey added while signed in signs that account in, and its use is recorded", async () => {
  passkeys._reset();
  const auth = fakeAuthenticator({ origin: ORIGIN });
  const added = await add("web", ALICE, auth);
  assert.equal(added.id, auth.id);
  assert.equal(await signIn("web", auth), "password:alice");
  const [listed] = passkeys.list("web", ALICE);
  assert.equal(listed.id, auth.id);
  assert.equal(listed.rpID, HOST);
  assert.ok(listed.lastUsedAt > 0, "last use is kept");
  assert.equal(await signIn("web", auth), "password:alice", "a second sign-in with a higher counter works");
});

test("a challenge is good once: the same answer sent again is refused", async () => {
  passkeys._reset();
  const auth = fakeAuthenticator({ origin: ORIGIN });
  await add("web", ALICE, auth);
  const b = browser();
  const { options, cookie } = await passkeys.startSignIn(b.req(), "web");
  b.keep(cookie);
  const answer = auth.get(options);
  assert.equal(await passkeys.finishSignIn(b.req(), "web", answer), "password:alice");
  await assert.rejects(passkeys.finishSignIn(b.req(), "web", answer), refused("expired"));
});

test("a passkey works only in its own scope and on the host it was added on", async () => {
  passkeys._reset();
  const auth = fakeAuthenticator({ origin: ORIGIN });
  await add("web", ALICE, auth);
  await assert.rejects(signIn("admin", auth), refused("unknown"), "a web passkey is not an admin one");
  const other = fakeAuthenticator({ origin: "https://other.example.com" });
  await assert.rejects(signIn("web", auth, browser("other.example.com"), { rpID: "other.example.com", at: "https://other.example.com" }), refused("unknown"));
  await assert.rejects(signIn("web", other, browser("other.example.com")), refused("unknown"), "a key nobody added");
});

test("an answer signed for another site or without user verification is refused", async () => {
  passkeys._reset();
  const auth = fakeAuthenticator({ origin: ORIGIN });
  await add("web", ALICE, auth);
  await assert.rejects(signIn("web", auth, browser(), { at: "https://phish.example.net" }), refused("failed"));
  await assert.rejects(signIn("web", auth, browser(), { rpID: "phish.example.net" }), refused("failed"));
  const held = passkeys.list("web", ALICE).length;
  await assert.rejects(add("web", ALICE, fakeAuthenticator({ origin: ORIGIN, verified: false })), refused("failed"));
  assert.equal(passkeys.list("web", ALICE).length, held, "an unverified passkey is not kept");
});

test("an answer meant for another account's challenge does not add to this one", async () => {
  passkeys._reset();
  const b = browser();
  const { options, cookie } = await passkeys.startAdd(b.req(), "web", ALICE, "alice");
  b.keep(cookie);
  const bob = { kind: "password", name: "bob" };
  await assert.rejects(passkeys.finishAdd(b.req(), "web", bob, fakeAuthenticator({ origin: ORIGIN }).create(options)), refused("expired"));
  assert.equal(passkeys.list("web", bob).length, 0);
});

test("plain http and bare addresses cannot use passkeys; localhost can", async () => {
  passkeys._reset();
  await assert.rejects(passkeys.startSignIn(browser(HOST, "http").req(), "web"), refused("insecure"));
  await assert.rejects(passkeys.startSignIn(browser("192.0.2.10", "https").req(), "web"), refused("insecure"));
  assert.equal(passkeys.relyingParty(browser("localhost:8465", "http").req()).rpID, "localhost");
});

test("an owner removes only their own passkeys, and the list stops at its limit", async () => {
  passkeys._reset();
  const auth = fakeAuthenticator({ origin: ORIGIN });
  await add("web", ALICE, auth);
  assert.equal(passkeys.remove("web", { kind: "password", name: "bob" }, auth.id), false);
  assert.equal(passkeys.remove("admin", null, auth.id), false);
  assert.equal(passkeys.remove("web", ALICE, auth.id), true);
  await assert.rejects(signIn("web", auth), refused("unknown"));
  for (let i = 0; i < passkeys.MAX_PER_OWNER; i++) await add("admin", null, fakeAuthenticator({ origin: ORIGIN }));
  await assert.rejects(passkeys.startAdd(browser().req(), "admin", null, "admin"), refused("limit"));
});

test("passkeys are kept in the security database across a restart", async () => {
  passkeys._reset();
  const auth = fakeAuthenticator({ origin: ORIGIN });
  await add("web", { kind: "google", sub: "g-1" }, auth);
  passkeys._reset();
  assert.equal(await signIn("web", auth), "google:g-1");
});
