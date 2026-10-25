import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashPassword } from "../../src/security/password-hash.js";
import { seedRecords } from "../support/security-db.js";
import { seedConsole } from "../support/console.js";
import { webSession } from "../support/web-session.js";

const TID = "0100000000010000";
const SWITCH_VIDEO = "SwitchTrlr1";
const RETRO_VIDEO = "RetroTrlr_2";

// The fields the console's game detail has without trailers (keyGeneration and keyFirmware came
// with the firmware-override install): trailers must not add any.
const CONSOLE_TITLE_FIELDS = ["bannerUrl", "categories", "category", "categoryLabels", "description", "descriptionCustom",
  "descriptionLang", "dlcTotal", "iconUrl", "icons", "id", "integrity", "intro", "keyFirmware", "keyGeneration", "latestVersion", "name", "names", "notes",
  "numberOfPlayers", "patches", "price", "publisher", "rating", "ratingContent", "region", "releaseDate", "requiredFirmware",
  "score", "scoreCount", "scoreLabel", "scoreLabelKey", "scoreSource", "screenshotCount", "screenshots", "size", "updates",
  "verified", "verified_at", "videos"];

async function serve(t) {
  const data = mkdtempSync(path.join(tmpdir(), "cook-videos-"));
  const games = path.join(data, "games");
  const retro = path.join(data, "retro");
  mkdirSync(games, { recursive: true });
  mkdirSync(path.join(data, "security"), { recursive: true });
  mkdirSync(path.join(data, "titledb"), { recursive: true });
  mkdirSync(path.join(retro, "roms/md"), { recursive: true });
  writeFileSync(path.join(games, `Test Game [${TID}][v0].nsp`), "");
  writeFileSync(path.join(retro, "roms/md/Gunstar Heroes (Japan).md"), "x");
  writeFileSync(path.join(data, "titledb/US.en.json"), JSON.stringify({ 70010000000001: { id: TID, name: "Test Game", description: "A game.", nsuId: 70010000000001 } }));
  writeFileSync(path.join(data, "titledb/ratings-own.json"), JSON.stringify({ version: 1, titles: {
    [TID]: { igdb: { at: Date.now(), id: 7, name: "Test Game", confidence: 1, percent: 90, count: 40, videos: [{ id: SWITCH_VIDEO, name: "Trailer" }] } },
  } }));
  writeFileSync(path.join(data, "retro-meta.json"), JSON.stringify({ version: 3, builtAt: Date.now(), games: {
    "md/Gunstar Heroes (Japan)": { source: "igdb", id: "9", description: { en: "Run and gun." }, videos: [{ id: RETRO_VIDEO, name: "Trailer" }] },
  } }));
  const now = Date.now();
  const user = (role, password) => ({ hash: hashPassword(password), enabled: true, role, createdAt: now, updatedAt: now });
  await seedRecords(data, "user", { alice: user("admin", "alice-password"), bob: user("user", "bob-password-1") });
  const console_ = await seedConsole(data);
  const port = 19800 + (process.pid % 150);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(port), COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_RETRO_DIR: retro,
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false", COOK_RETRO_META: "false", COOK_RATING_SYNC: "false",
      COOK_DEVICE_PAIRING: "true", COOK_EXTRACT_ICONS: "off" },
    stdio: "ignore",
  });
  t.after(() => { child.kill("SIGKILL"); rmSync(data, { recursive: true, force: true }); });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const alice = await webSession(base, "alice", "alice-password");
  const bob = await webSession(base, "bob", "bob-password-1");
  const get = (url, headers) => fetch(`${base}${url}`, { headers: { Accept: "application/json", ...headers } });
  return { get, alice, bob, console: console_ };
}

test("trailers go to an admin's web session only; consoles and user accounts never get them", async (t) => {
  const { get, alice, bob, console: consoleHeaders } = await serve(t);

  const own = await get(`/api/videos/title/${TID}`, alice);
  assert.equal(own.status, 200);
  assert.deepEqual(await own.json(), { videos: [{ id: SWITCH_VIDEO, name: "Trailer" }] });
  assert.equal((await get(`/api/videos/title/${TID}`, bob)).status, 403, "a user account is refused");
  assert.equal((await get(`/api/videos/title/${TID}`, consoleHeaders)).status, 403, "a console is refused");
  assert.equal((await get("/api/videos/title/nothex", alice)).status, 400);
  assert.deepEqual(await (await get("/api/videos/title/0100000000020000", alice)).json(), { videos: [] });

  const list = await (await get("/api/retro/games?pageSize=50", alice)).json();
  const game = list.games.find((g) => g.name.includes("Gunstar"));
  assert.ok(game, "the retro game is listed");
  assert.deepEqual(await (await get(`/api/videos/retro/${game.id}`, alice)).json(), { videos: [{ id: RETRO_VIDEO, name: "Trailer" }] });
  assert.equal((await get(`/api/videos/retro/${game.id}`, consoleHeaders)).status, 403);
  assert.equal((await get("/api/videos/retro/no-such-game", alice)).status, 404);

  // What consoles read is unchanged: no IGDB trailer anywhere, and the detail's fields stay the ones they were.
  for (const url of [`/api/title/${TID}`, "/api/library/sections", `/api/retro/games/${game.id}`, "/api/retro/games?pageSize=50", "/api/retro/home?limit=20"]) {
    const r = await get(url, consoleHeaders);
    assert.equal(r.status, 200, url);
    const text = await r.text();
    assert.ok(!text.includes(SWITCH_VIDEO) && !text.includes(RETRO_VIDEO), `${url} carries no IGDB trailer`);
  }
  const detail = await (await get(`/api/title/${TID}`, consoleHeaders)).json();
  assert.deepEqual(Object.keys(detail).sort(), CONSOLE_TITLE_FIELDS);
  assert.deepEqual(detail.videos, [], "detail.videos stays titledb's (none here), never IGDB's");
  const retroDetail = await (await get(`/api/retro/games/${game.id}`, consoleHeaders)).json();
  assert.equal("videos" in retroDetail, false);
});
