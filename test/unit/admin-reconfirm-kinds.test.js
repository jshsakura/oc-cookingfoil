// Which proof switching a plugin on asks for, by who is asking and what guards the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "reconfirm-kinds-"));
process.env.COOK_ADMIN_TOTP_SECRET = "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU";
delete process.env.COOK_ADMIN_PASSWORD;
const { reconfirm, reconfirmKind, resetReconfirm } = await import("../../src/security/admin-reconfirm.js");
const { markEnrolled } = await import("../../src/security/admin-secret.js");
const { generate } = await import("otplib");

const google = { webUser: { kind: "google", sub: "sub-1", email: "admin@example.com" } };
const nobody = {};

test("a Google admin on a server with no accounts and no admin password cannot switch a plugin on, and is told why", async () => {
  assert.equal(reconfirmKind(google), "unavailable");
  assert.deepEqual(await reconfirm(google, { password: "anything at all" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await reconfirm(google, {}), { ok: false, reason: "unavailable" });
});

test("with only an authenticator set up, a code from it is asked for; a wrong or missing one is refused", async () => {
  markEnrolled();
  resetReconfirm();
  assert.equal(reconfirmKind(nobody), "totp");
  assert.equal((await reconfirm(nobody, {})).reason, "wrong");
  assert.equal((await reconfirm(nobody, { code: "000000" })).reason, "wrong");
  const code = await generate({ secret: process.env.COOK_ADMIN_TOTP_SECRET });
  assert.deepEqual(await reconfirm(nobody, { code }), { ok: true });
  resetReconfirm();
});
