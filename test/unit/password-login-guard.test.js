import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// Switching ID and password sign-in off needs Google sign-in and an approved
// Google admin: otherwise nobody could reach /admin to switch it back on.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-pwguard-"));
process.env.COOK_ADMIN_EMAIL = "owner@example.com";
const { mountServerSettingsApi } = await import("../../src/routes/admin/server-settings-api.js");
const googleConfig = await import("../../src/security/google-config.js");
const accounts = await import("../../src/security/google-accounts.js");
const env = await import("../../src/helpers/envs.js");
const { mountManageApi } = await import("../../src/routes/admin/manage-api.js");
const users = await import("../../src/security/users.js");

async function post(body) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountServerSettingsApi(router, () => true);
  app.use("/admin", router);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/admin/api/server-settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("password sign-in stays on until Google sign-in has an approved admin", async () => {
  let r = await post({ passwordLogin: false });
  assert.equal(r.status, 409);
  assert.equal(r.body.field, "passwordLogin");
  assert.equal(env.passwordLogin, true);

  googleConfig.save({ enabled: true, clientId: "test-client.apps.googleusercontent.com", clientSecret: "GOCSPX-test-secret-value" });
  r = await post({ passwordLogin: false });
  assert.equal(r.status, 409, "Google is on, but no Google admin yet");

  assert.equal(accounts.signIn({ sub: "owner-1", email: "owner@example.com" }).role, "admin");
  r = await post({ passwordLogin: false });
  assert.equal(r.status, 200);
  assert.equal(env.passwordLogin, false);

  r = await post({ passwordLogin: true, consolePasswordsLanOnly: true });
  assert.equal(r.status, 200);
  assert.equal(env.passwordLogin, true);
  assert.equal(env.consolePasswordsLanOnly, true);
});

test("while Google-only, the last ID-and-password account cannot be removed (the server would open up)", async () => {
  users.add("solo", "solo-password-1", "admin");
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountManageApi(router, () => true);
  app.use("/admin", router);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const settings = await import("../../src/security/server-settings.js");
    settings.save({ passwordLogin: false });
    const r = await fetch(`${base}/admin/api/users/solo?allowEmpty=1`, { method: "DELETE", headers: { Origin: base } });
    assert.equal(r.status, 409);
    assert.ok(users.list().some((u) => u.name === "solo"));
    settings.save({ passwordLogin: true });
  } finally {
    server.close();
  }
});
