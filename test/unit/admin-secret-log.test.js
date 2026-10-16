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

test("boot logs no TOTP secret and replaces one an older version logged", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-totp-log-"));
  fs.mkdirSync(path.join(data, "games"));
  fs.mkdirSync(path.join(data, "security"));
  const OLD = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  fs.writeFileSync(path.join(data, "security", "admin-totp.json"), JSON.stringify({ secret: OLD, enrolled: false, createdAt: 1 }));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_TOTP_SECRET: "", COOK_ADMIN_PASSWORD: "", COOK_TITLEDB_AUTO_FETCH: "false", DEBUG: "oc-cookingfoil*" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (b) => { out += b; });
  child.stderr.on("data", (b) => { out += b; });
  try {
    for (let i = 0; i < 60 && !out.includes("2FA not enrolled"); i++) await new Promise((r) => setTimeout(r, 250));
    assert.match(out, /2FA not enrolled yet/);
    assert.ok(!/otpauth:/i.test(out), "no otpauth URI in the log");
    const sealed = sealedSecret(data, "admin-totp");
    assert.match(sealed, /^cfsec:v1:/, "the secret is sealed, the plain one from before included");
    assert.match(fs.readFileSync(path.join(data, "security", "admin-totp.json"), "utf8"), /^cfsec:v1:/, "the old file is sealed in place");
    const { open } = await import("../../src/security/secret-box.js");
    const now = JSON.parse(open(sealed).toString("utf8"));
    assert.notEqual(now.secret, OLD, "the logged secret was replaced");
    assert.ok(!out.includes(now.secret) && !out.includes(OLD), "neither secret appears in the log");
    assert.equal(now.enrolled, false);
  } finally {
    child.kill();
  }
});
