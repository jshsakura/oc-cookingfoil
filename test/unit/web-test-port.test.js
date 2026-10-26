import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RESTRICTED_PORTS, SLOTS, webTestPort } from "../web/ports.mjs";

test("no slot of the web suite lands on a port Chromium refuses, and no two slots share a port", () => {
  const ports = Array.from({ length: SLOTS }, (_, slot) => webTestPort(slot));
  assert.equal(ports.filter((p) => RESTRICTED_PORTS.has(p)).length, 0);
  assert.equal(new Set(ports).size, SLOTS);
  assert.ok(ports.every((p) => p >= 3188 && p < 65536));
  // The two ports that sat inside the old range 3188..4187.
  assert.ok(!ports.includes(3659) && !ports.includes(4045));
  assert.equal(webTestPort(0), 3188);
});

test("the suite server starts from empty folders, and only its own", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "web-port-test-"));
  // The folder is named the way the suite names its own, which is all the server goes by.
  const own = path.join(parent, "cookingfoil-web-test-7");
  const dirs = Object.fromEntries(["data", "games", "patches", "saves", "homebrew", "retro"].map((d) => [d, path.join(own, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dirs.games, "Throwaway [0100000000030000][v0].nsp"), "");
  // A folder somebody named by hand, in the place of the games folder.
  const foreign = path.join(parent, "my-games");
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, "keep.txt"), "x");
  try {
    // The server file ends by listening; run only its start-up by stopping it on the first tick.
    const probe = `await import(${JSON.stringify(path.resolve("test/web/server.mjs"))}); process.exit(0);`;
    execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      env: { ...process.env, COOK_DATA_DIR: dirs.data, COOK_GAMES_DIR: foreign, COOK_PATCHES_DIR: dirs.patches, COOK_SAVES_DIR: dirs.saves, COOK_HOMEBREW_DIR: dirs.homebrew, COOK_RETRO_DIR: dirs.retro, COOK_PORT: "0" },
      timeout: 20000,
    });
    assert.equal(fs.existsSync(path.join(foreign, "keep.txt")), true, "a games folder that is not the suite's is left alone");
    // And the suite's own: run it again with the games folder it names itself.
    execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      env: { ...process.env, COOK_DATA_DIR: dirs.data, COOK_GAMES_DIR: dirs.games, COOK_PATCHES_DIR: dirs.patches, COOK_SAVES_DIR: dirs.saves, COOK_HOMEBREW_DIR: dirs.homebrew, COOK_RETRO_DIR: dirs.retro, COOK_PORT: "0" },
      timeout: 20000,
    });
    assert.deepEqual(fs.readdirSync(dirs.games).filter((n) => n.endsWith(".nsp")), ["Test Game [0100000000010000][v0].nsp"], "the leftover game is gone, the seed is back");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
