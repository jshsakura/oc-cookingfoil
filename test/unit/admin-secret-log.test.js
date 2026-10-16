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

test("a TOTP secret an older version left in the clear stops the start, naming the file and never logging it", async () => {
  const data = dataDir();
  const OLD = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const file = path.join(data, "security", "admin-totp.json");
  fs.writeFileSync(file, JSON.stringify({ secret: OLD, enrolled: false, createdAt: 1 }));
  const run = boot(data);
  try {
    for (let i = 0; i < 80 && run.exited === null; i++) await new Promise((r) => setTimeout(r, 250));
    assert.notEqual(run.exited, null, "the server stopped");
    assert.notEqual(run.exited, 0);
    assert.match(run.out, /admin-totp\.json/);
    assert.ok(!run.out.includes(OLD), "the old secret is not logged");
    assert.equal(sealedSecret(data, "admin-totp"), undefined, "nothing new was made over it");
    assert.equal(fs.readFileSync(file, "utf8").includes(OLD), true, "the file is left for the operator");
  } finally {
    run.child.kill();
  }
});
