import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generate } from "otplib";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-otp-"));
process.env.COOK_DATA_DIR = data;
delete process.env.COOK_ADMIN_TOTP_SECRET;
const { codeMatches } = await import("../../src/security/admin-session.js");

const SECRET = "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU";
const at = (offsetSeconds) => generate({ secret: SECRET, epoch: Math.floor(Date.now() / 1000) + offsetSeconds });

test("a code from the step before or after still counts; one far off doesn't", async () => {
  assert.equal(await codeMatches(SECRET, await at(0)), true);
  assert.equal(await codeMatches(SECRET, await at(-30)), true, "typed just after the app rolled over");
  assert.equal(await codeMatches(SECRET, await at(30)), true, "a phone clock a little ahead");
  assert.equal(await codeMatches(SECRET, await at(-120)), false, "minutes old");
  assert.equal(await codeMatches(SECRET, await at(-60), 2), true, "enrollment allows two steps");
  assert.equal(await codeMatches(SECRET, ` ${(await at(0)).slice(0, 3)} ${(await at(0)).slice(3)} `), true, "spaces as the app groups them");
});

test("an enrollment started before a restart can still be confirmed after it", () => {
  const run = (code) => execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: path.join(import.meta.dirname, "../.."), env: { ...process.env, COOK_DATA_DIR: data }, encoding: "utf8" }).trim();
  const started = run('const m = await import("./src/security/admin-secret.js"); console.log(m.startEnrollment());');
  const after = run('const m = await import("./src/security/admin-secret.js"); console.log(m.pendingSecret());');
  assert.equal(after, started, "a new process finds the candidate on disk");
  run('const m = await import("./src/security/admin-secret.js"); m.commitEnrollment();');
  assert.equal(run('const m = await import("./src/security/admin-secret.js"); console.log(String(m.pendingSecret()));'), "null", "confirmed: no candidate left");
});
