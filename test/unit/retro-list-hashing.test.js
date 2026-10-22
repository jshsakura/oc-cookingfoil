import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSOLE, seedConsole } from "../support/console.js";

// The retro list carries each game's rom_hash, worked out in the background
// after a scan. A list sent before that is done is partial: it must not be
// cached by its ETag, or a console holds on to null hashes.
const PORT = 18000 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ROMS = 30; // hashed 50 ms apart: well over a second of hashing after the first scan

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-retro-hashing-"));
const put = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
for (let i = 0; i < ROMS; i++) put(`retro/roms/snes/Game ${String(i).padStart(2, "0")} (USA).sfc`, `ROM ${i}`);

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

const get = (headers = {}) => fetch(`${BASE}/api/retro/games?pageSize=100`, { headers: { ...CONSOLE, "Cache-Control": "max-age=0", ...headers } });

test("the retro list is no-store without an ETag until its ROM hashes are worked out, then a stable ETag and 304", async () => {
  const first = await get();
  assert.equal(first.status, 200);
  const early = await first.json();
  assert.equal(early.total, ROMS);
  assert.ok(early.games.some((g) => g.rom_hash === null), "the first answer comes before every hash is known");
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.headers.get("etag"), null, "a partial list has no ETag");

  let done;
  for (let i = 0; i < 100; i++) {
    done = await get();
    if (done.headers.get("cache-control") !== "no-store") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(done.headers.get("cache-control"), /max-age=/);
  assert.ok((await done.json()).games.every((g) => typeof g.rom_hash === "string"), "every hash is in once caching is allowed");
  const etag = done.headers.get("etag");
  assert.ok(etag);
  const again = await get();
  assert.equal(again.headers.get("etag"), etag, "two answers after hashing carry the same ETag");
  assert.equal((await get({ "If-None-Match": etag })).status, 304);
});
