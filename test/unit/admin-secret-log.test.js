import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sealedSecret } from "../support/security-db.js";

// The admin TOTP secret never goes to the log, and an unenrolled secret that an
// older version printed is replaced at boot.
const PORT = 16300 + (process.pid % 500);

function boot(data) {
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_TOTP_SECRET: "", COOK_ADMIN_PASSWORD: "", COOK_TITLEDB_AUTO_FETCH: "false", DEBUG: "oc-cookingfoil*" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const run = { child, out: "", exited: null };
  child.stdout.on("data", (b) => { run.out += b; });
  child.stderr.on("data", (b) => { run.out += b; });
  child.on("exit", (code) => { run.exited = code; });
  return run;
}

function dataDir() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-totp-log-"));
  fs.mkdirSync(path.join(data, "games"));
  fs.mkdirSync(path.join(data, "security"));
  return data;
}

test("boot logs no TOTP secret; the one it makes is kept sealed", async () => {
  const data = dataDir();
  const run = boot(data);
  try {
    for (let i = 0; i < 60 && !run.out.includes("2FA not enrolled"); i++) await new Promise((r) => setTimeout(r, 250));
    assert.match(run.out, /2FA not enrolled yet/);
    assert.ok(!/otpauth:/i.test(run.out), "no otpauth URI in the log");
    const sealed = sealedSecret(data, "admin-totp");
    assert.match(sealed, /^cfsec:v1:/);
    const { open } = await import("../../src/security/secret-box.js");
    const now = JSON.parse(open(sealed).toString("utf8"));
    assert.ok(!run.out.includes(now.secret), "the secret does not appear in the log");
    assert.equal(now.enrolled, false);
  } finally {
    run.child.kill();
  }
});
