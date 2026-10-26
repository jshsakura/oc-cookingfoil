import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// The app key is read at import time.
process.env.COOK_DROPBOX_APP_KEY = "test-app-key";
const { default: express } = await import("express");
const bridge = await import("../../src/routes/dropbox-bridge.js");

const app = express();
app.get(`${bridge.BRIDGE_PATH}/oauth/dropbox/callback`, bridge.dropboxCallback);
// Stands in for the library's sign-in: X-Test-User names the account.
app.use((req, _res, next) => {
  if (req.get("x-test-user")) req.auth = { user: req.get("x-test-user") };
  next();
});
app.use(bridge.BRIDGE_PATH, bridge.dropboxSessionsRouter());
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}${bridge.BRIDGE_PATH}`;
const post = (path, body = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => bridge.resetForTests());
test.after(() => server.close());

async function start() {
  const r = await post("/v1/sessions/start", { device_id: "console-1" });
  assert.equal(r.status, 200);
  return r.json();
}

test("a sign-in goes pending, approved by the phone's callback, then consumed exactly once", async () => {
  const s = await start();
  const authorize = new URL(s.authorize_url);
  assert.equal(authorize.origin + authorize.pathname, "https://www.dropbox.com/oauth2/authorize");
  assert.equal(authorize.searchParams.get("client_id"), "test-app-key");
  assert.equal(authorize.searchParams.get("token_access_type"), "offline");
  assert.equal(authorize.searchParams.get("redirect_uri"), `${base}/oauth/dropbox/callback`);
  assert.equal(s.poll_url, `${base}/v1/sessions/${s.session_id}/status`);

  assert.equal((await (await post(`/v1/sessions/${s.session_id}/status`, { poll_token: s.poll_token })).json()).status, "pending");
  assert.equal((await post(`/v1/sessions/${s.session_id}/consume`, { poll_token: s.poll_token })).status, 409, "nothing to hand over yet");

  const cb = await fetch(`${base}/oauth/dropbox/callback?state=${authorize.searchParams.get("state")}&code=AUTHCODE`);
  assert.equal(cb.status, 200);
  assert.match(await cb.text(), /Dropbox/);
  assert.equal((await (await post(`/v1/sessions/${s.session_id}/status`, { poll_token: s.poll_token })).json()).status, "approved");

  const done = await (await post(`/v1/sessions/${s.session_id}/consume`, { poll_token: s.poll_token })).json();
  assert.equal(done.authorization_code, "AUTHCODE");
  assert.equal(done.token_endpoint, "https://api.dropboxapi.com/oauth2/token");
  // PKCE: the challenge sent to Dropbox is the S256 of the verifier handed to the console.
  assert.equal(crypto.createHash("sha256").update(done.code_verifier).digest("base64url"), authorize.searchParams.get("code_challenge"));
  assert.equal((await post(`/v1/sessions/${s.session_id}/consume`, { poll_token: s.poll_token })).status, 409, "one use only");
});

test("a wrong poll token is refused and a replayed or unknown state lands on the expired page", async () => {
  const s = await start();
  assert.equal((await post(`/v1/sessions/${s.session_id}/status`, { poll_token: "x".repeat(40) })).status, 401);
  assert.equal((await fetch(`${base}/oauth/dropbox/callback?state=nope&code=X`)).status, 410);
  const state = new URL(s.authorize_url).searchParams.get("state");
  assert.equal((await fetch(`${base}/oauth/dropbox/callback?state=${state}&code=A`)).status, 200);
  assert.equal((await fetch(`${base}/oauth/dropbox/callback?state=${state}&code=B`)).status, 410, "a state works once");
  assert.equal((await (await post(`/v1/sessions/missing/status`, { poll_token: s.poll_token })).json()).status, "expired");
});

test("a denied sign-in reports failed with Dropbox's reason", async () => {
  const s = await start();
  const state = new URL(s.authorize_url).searchParams.get("state");
  await fetch(`${base}/oauth/dropbox/callback?state=${state}&error=access_denied&error_description=The+user+chose+not+to+give+your+app+access`);
  assert.equal((await (await post(`/v1/sessions/${s.session_id}/status`, { poll_token: s.poll_token })).json()).status, "failed");
  const r = await post(`/v1/sessions/${s.session_id}/consume`, { poll_token: s.poll_token });
  assert.equal(r.status, 409);
  assert.match((await r.json()).detail, /chose not to give/);
});

test("one account holds only its own share of sign-ins in progress", async () => {
  const as = (user) => fetch(`${base}/v1/sessions/start`, { method: "POST", headers: { "Content-Type": "application/json", "X-Test-User": user }, body: "{}" });
  for (let i = 0; i < bridge.MAX_SESSIONS_PER_ACCOUNT; i++) assert.equal((await as("alice")).status, 200);
  const full = await as("alice");
  assert.equal(full.status, 429);
  assert.ok(Number(full.headers.get("retry-after")) > 0);
  assert.equal((await as("bob")).status, 200, "another account still signs in");
});
