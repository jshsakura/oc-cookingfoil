import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// admin-session reads the data dir at load, so it runs in its own process.
const SCRIPT = `
  import { generate } from "otplib";
  import { verifyTotp } from "../../src/security/admin-session.js";
  const secret = "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU";
  const now = Math.floor(Date.now() / 1000);
  const earlier = await generate({ secret, epoch: now - 30 });
  const current = await generate({ secret, epoch: now });
  const out = {
    first: await verifyTotp(current),
    replay: await verifyTotp(current),
    olderStep: await verifyTotp(earlier),
  };
  process.stdout.write(JSON.stringify(out));
`;

test("an admin sign-in code opens once: the same or an older time step is refused afterwards", () => {
  const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", SCRIPT], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-totp-")), DEBUG: "", COOK_ADMIN_TOTP_SECRET: "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU" },
    encoding: "utf-8",
  }));
  assert.deepEqual(out, { first: true, replay: false, olderStep: false });
});
