// A new server connects consoles by QR (or the client downloaded from the web page),
// and consoles that sign in with an ID and password stay out until that is turned on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";

const read = (extra) => {
  const env = { ...process.env, COOK_DATA_DIR: os.tmpdir(), ...extra };
  delete env.COOK_DEVICE_PAIRING;
  delete env.COOK_CONSOLE_PASSWORDS;
  Object.assign(env, extra);
  const out = execFileSync(process.execPath, ["--input-type=module", "-e",
    "const e = await import('./src/helpers/envs.js'); console.log(JSON.stringify({ pairing: e.devicePairing, passwords: e.consolePasswords }));"],
  { env, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop());
};

test("unset, QR pairing is on and password consoles are off", () => {
  assert.deepEqual(read({}), { pairing: true, passwords: false });
});

test("either can still be set the other way", () => {
  assert.deepEqual(read({ COOK_DEVICE_PAIRING: "false", COOK_CONSOLE_PASSWORDS: "true" }), { pairing: false, passwords: true });
});
