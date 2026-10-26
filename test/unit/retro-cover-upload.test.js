import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { CONSOLE, seedConsole } from "../support/console.js";
import { adminSession } from "../support/web-session.js";

// The admin uploads a cover for any retro game, found by name whether it has art
// or not; it is stored shrunk, and only behind the admin session.
const PORT = 16100 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
// The library is read by an approved console; changes go through the admin page.
const ALICE = CONSOLE;

async function boot(dirs) {
  await seedConsole(dirs.data);
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: dirs.data, COOK_GAMES_DIR: dirs.games, COOK_RETRO_DIR: dirs.retro,
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_RATING_SYNC: "false",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("a cover uploaded from the retro tab replaces the box art, shrunk", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-retro-cover-"));
  const dirs = Object.fromEntries(["data", "games", "retro"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(dirs.retro, "roms", "snes"), { recursive: true });
  fs.writeFileSync(path.join(dirs.retro, "roms", "snes", "Super Mario World (USA).sfc"), Buffer.alloc(1024));
  const server = await boot(dirs);
  try {
    const admin = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")) };

    let found = [];
    for (let i = 0; i < 40 && !found.length; i++) {
      found = (await (await fetch(`${BASE}/admin/api/retro-art/games?q=mario`, { headers: admin })).json()).games;
      if (!found.length) await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(found.length, 1);
    assert.equal(found[0].boxart, false);
    const game = found[0].id;

    const jpeg = await sharp({ create: { width: 1000, height: 1500, channels: 3, background: "#2050c0" } }).jpeg().toBuffer();
    const up = (body, type, headers = admin) => fetch(`${BASE}/admin/api/retro-art/cover/upload?game=${encodeURIComponent(game)}`, { method: "POST", headers: { ...headers, "Content-Type": type }, body });
    assert.equal((await up(jpeg, "image/jpeg", ALICE)).status, 403, "a console never uploads art");
    assert.equal((await up("hello", "text/plain")).status, 415);
    assert.equal((await up(Buffer.from("not an image"), "image/png")).status, 400);

    const r = await up(jpeg, "image/jpeg");
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.from, jpeg.length);
    const png = fs.readdirSync(path.join(dirs.retro, "thumbnails"), { recursive: true }).find((p) => String(p).endsWith(".png"));
    assert.ok(png, "the box art was written");
    const meta = await sharp(path.join(dirs.retro, "thumbnails", png)).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["png", 400, 600]);

    const again = (await (await fetch(`${BASE}/admin/api/retro-art/games?q=mario`, { headers: admin })).json()).games;
    assert.equal(again[0].boxart, true, "the list follows at once");

    // The tile: WebP whatever the client names.
    const tile = (accept) => fetch(`${BASE}/api/retro/games/${encodeURIComponent(game)}/icon?size=sm`, { headers: { ...ALICE, Accept: accept } });
    for (const accept of ["image/jpeg", "image/webp"]) {
      const t = await tile(accept);
      assert.equal(t.status, 200);
      assert.match(t.headers.get("content-type"), /webp/, accept);
      assert.equal((await sharp(Buffer.from(await t.arrayBuffer())).metadata()).width, 160);
    }
  } finally {
    server.kill();
  }
});
