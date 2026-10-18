// A new server connects consoles by QR (or the client downloaded from the web page).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";

const read = (extra) => {
  const env = { ...process.env, COOK_DATA_DIR: os.tmpdir() };
  delete env.COOK_DEVICE_PAIRING;
  Object.assign(env, extra);
  const out = execFileSync(process.execPath, ["--input-type=module", "-e",
    "const e = await import('./src/helpers/envs.js'); console.log(JSON.stringify({ pairing: e.devicePairing, passwords: 'consolePasswords' in e }));"],
  { env, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop());
};

test("unset, QR pairing is on, and there is no console-password switch at all", () => {
  assert.deepEqual(read({}), { pairing: true, passwords: false });
  assert.deepEqual(read({ COOK_CONSOLE_PASSWORDS: "true" }), { pairing: true, passwords: false }, "the old variable does nothing");
});

test("pairing can still be switched off", () => {
  assert.deepEqual(read({ COOK_DEVICE_PAIRING: "false" }), { pairing: false, passwords: false });
});
