import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSOLE, seedConsole } from "../support/console.js";

// The retro list opens on the newest game first ("added", today the file's
// mtime; a lasting registration time would need a catalog change this test does
// not ask for). A sort the caller names is kept as named, and an unknown sort
// falls back to the same newest-first order.
const PORT = 18100 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-retro-default-sort-"));
// Names whose alphabetical order differs from the added order, so the two sorts
// cannot pass each other's test by accident.
const GAMES = [
  { file: "roms/snes/Zeta (USA).sfc", body: "ROM newest", at: Date.now() },
  { file: "roms/snes/Alpha (USA).sfc", body: "ROM middle", at: Date.now() - 7200_000 },
  { file: "roms/snes/Mid (USA).sfc", body: "ROM oldest", at: Date.now() - 14400_000 },
];
for (const g of GAMES) {
  fs.mkdirSync(path.dirname(path.join(root, "retro", g.file)), { recursive: true });
  fs.writeFileSync(path.join(root, "retro", g.file), g.body);
  const when = new Date(g.at);
  fs.utimesSync(path.join(root, "retro", g.file), when, when);
}

let child;
before(async () => {
  await seedConsole(path.join(root, "data"));
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: path.join(root, "data"), COOK_GAMES_DIR: path.join(root, "games"),
      COOK_SAVES_DIR: path.join(root, "saves"), COOK_PATCHES_DIR: path.join(root, "patches"), COOK_RETRO_DIR: path.join(root, "retro"),
      COOK_HOMEBREW_DIR: path.join(root, "homebrew"), COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_EXTRACT_ICONS: "off", COOK_ESHOP_PRICES: "false", COOK_RATING_SYNC: "false", COOK_FIRST_RUN_SETUP: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});
after(() => {
  child?.kill("SIGKILL");
  fs.rmSync(root, { recursive: true, force: true });
});

const names = async (query) => {
  const r = await fetch(`${BASE}/api/retro/games?pageSize=10${query ? `&${query}` : ""}`, { headers: CONSOLE });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.total, GAMES.length);
  return d.games.map((g) => g.name);
};

test("without a sort the newest game comes first, an unknown sort says the same", async () => {
  assert.deepEqual(await names(), ["Zeta (USA)", "Alpha (USA)", "Mid (USA)"]);
  assert.deepEqual(await names("sort=bogus"), ["Zeta (USA)", "Alpha (USA)", "Mid (USA)"]);
});

test("a sort the caller names is kept as named", async () => {
  assert.deepEqual(await names("sort=name"), ["Alpha (USA)", "Mid (USA)", "Zeta (USA)"]);
});
