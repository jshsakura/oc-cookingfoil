import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { hashPassword } from "../../src/security/password-hash.js";
import { seedRecords } from "../support/security-db.js";
import { webSession } from "../support/web-session.js";

// Pictures are not library files: with web uploads off an admin account still edits a game's
// and a retro game's pictures, while a user-role account is refused and the upload tray stays off.
const PORT = 26300 + (process.pid % 500);
const base = `http://127.0.0.1:${PORT}`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-art-no-uploads-"));
const games = path.join(data, "games");
const retro = path.join(data, "retro");
const BASE_ID = "0100000000ABC000";
let child;
let alice;
let bob;

before(async () => {
  fs.mkdirSync(games, { recursive: true });
  fs.mkdirSync(path.join(retro, "roms", "md"), { recursive: true });
  fs.writeFileSync(path.join(retro, "roms", "md", "Some Game (Japan).zip"), "x");
  const now = Date.now();
  const user = (role, password) => ({ hash: hashPassword(password), enabled: true, role, createdAt: now, updatedAt: now });
  await seedRecords(data, "user", { alice: user("admin", "alice-password"), bob: user("user", "bob-password-1") });
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_RETRO_DIR: retro,
      COOK_UPLOADS_ENABLED: "false", COOK_TITLEDB_AUTO_FETCH: "false", COOK_EXTRACT_ICONS: "off", COOK_RETRO_META: "false",
      COOK_RATING_SYNC: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  alice = await webSession(base, "alice", "alice-password");
  bob = await webSession(base, "bob", "bob-password-1");
});

after(() => {
  child?.kill("SIGKILL");
  fs.rmSync(data, { recursive: true, force: true });
});

async function picture(headers, url) {
  const fd = new FormData();
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#2080c0" } }).png().toBuffer();
  fd.append("file", new Blob([png], { type: "image/png" }), "tiny.png");
  return fetch(base + url, { method: "POST", headers, body: fd });
}

async function retroId() {
  const d = await (await fetch(`${base}/api/retro/games`, { headers: alice })).json();
  assert.equal(d.games.length, 1);
  return d.games[0].id;
}

test("the page's editor probe answers an admin account and refuses a user-role one", async () => {
  assert.equal((await fetch(`${base}/api/art/access`, { headers: alice })).status, 200);
  assert.equal((await fetch(`${base}/api/art/access`, { headers: bob })).status, 403);
  assert.equal((await fetch(`${base}/api/art/search?slot=icon&q=x`, { headers: bob })).status, 403, "picture search is the admin's too");
  assert.equal((await fetch(`${base}/api/art/remote?url=x`, { headers: bob })).status, 403);
  assert.equal((await fetch(`${base}/api/art/search?slot=boxart&retro=x`, { headers: bob })).status, 403, "a retro cover search too");
  assert.equal((await fetch(`${base}/api/art/search?slot=boxart&retro=no-such-game`, { headers: alice })).status, 404, "a retro cover needs its game");
});

test("with uploads off an admin still sets a game's icon, and the upload tray stays off", async () => {
  assert.equal((await fetch(`${base}/api/uploads`, { headers: alice })).status, 503, "library uploads follow their own setting");
  assert.equal((await picture(alice, `/api/art/${BASE_ID}/icon`)).status, 201);
  assert.equal((await picture(bob, `/api/art/${BASE_ID}/icon`)).status, 403);
});

test("an admin sets a retro game's box art from the dashboard; a user-role account cannot", async () => {
  const id = await retroId();
  const before = await (await fetch(`${base}/api/retro/games/${id}`, { headers: alice })).json();
  assert.equal(before.boxartUrl, null);
  assert.equal((await picture(bob, `/api/art/retro/${id}/boxart`)).status, 403);
  assert.equal((await picture(alice, `/api/art/retro/nope/boxart`)).status, 404);
  const bad = new FormData();
  bad.append("file", new Blob([Buffer.from("not an image")], { type: "image/png" }), "x.png");
  assert.equal((await fetch(`${base}/api/art/retro/${id}/boxart`, { method: "POST", headers: alice, body: bad })).status, 400);
  assert.equal((await picture(alice, `/api/art/retro/${id}/boxart`)).status, 201);
  const after = await (await fetch(`${base}/api/retro/games/${id}`, { headers: alice })).json();
  assert.match(after.boxartUrl, /\/boxart\?v=/);
  assert.equal((await fetch(base + after.boxartUrl, { headers: alice })).status, 200);
});
