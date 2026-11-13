import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

// A Vita is shown the retro systems it has a core for, with the same files as a Switch, and gets the firmware
// those systems need from /api/retro/requirements, a list only a Vita reads and the only paths it can download.
const root = mkdtempSync(path.join(tmpdir(), "cf-retro-vita-"));
const dir = (name) => { const p = path.join(root, name); mkdirSync(p, { recursive: true }); return p; };
const retro = dir("retro");
const GBA_BIOS = "fake gba bios bytes";
const files = {
  "roms/snes/Sample Quest (Korea).sfc": "rom", "roms/gba/Pocket Tale (Korea).gba": "rom", "roms/n64/Heavy Racer (USA).z64": "rom",
  "roms/pcecd/Disc Story (Japan).cue": "cue", "retroarch/system/gba_bios.bin": GBA_BIOS,
};
for (const [rel, body] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(retro, rel)), { recursive: true });
  writeFileSync(path.join(retro, rel), body);
}
Object.assign(process.env, {
  COOK_PORT: "0", COOK_DATA_DIR: dir("data"), COOK_GAMES_DIR: dir("games"), COOK_RETRO_DIR: retro,
  COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "true",
  COOK_TITLEDB_AUTO_FETCH: "false", COOK_PUBLIC_BASE_URL: "", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
});
const { default: server } = await import("../../src/index.js");
if (!server.listening) await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
  setTimeout(() => process.exit(), 100);
});

const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");
async function pair(deviceKey, platform) {
  await fetch(`${base}/api/pair/request`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": deviceKey, Authorization: ALICE },
    body: JSON.stringify(platform ? { platform } : {}),
  });
  const status = await (await fetch(`${base}/api/pair/status?deviceKey=${deviceKey}`, { headers: { Authorization: ALICE } })).json();
  return { "X-Device-Key": deviceKey, "X-Access-Key": status.accessKey };
}
const VITA = await pair("C1".repeat(32), "vita");
const SWITCH = await pair("C2".repeat(32));
const get = (headers, url) => fetch(base + url, { headers });
const json = async (headers, url) => (await get(headers, url)).json();
// The catalog is scanned in the background; ask until the games are in.
async function ready() {
  for (let i = 0; i < 100; i++) {
    if ((await json(SWITCH, "/api/retro/games")).total === 4) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the retro catalog never listed the games");
}
await ready();

test("a Vita sees only the systems with a Vita core, and their games and home rows", async () => {
  const vita = await json(VITA, "/api/retro/systems");
  assert.deepEqual(vita.systems.map((s) => s.id).sort(), ["gba", "pcecd", "snes"]);
  assert.equal(vita.systems.find((s) => s.id === "snes").core.id, "snes9x2005");
  assert.equal(vita.retroarch, undefined, "the Switch's RetroArch pack is not the Vita's");
  const sw = await json(SWITCH, "/api/retro/systems");
  assert.ok(sw.systems.some((s) => s.id === "n64"), "a Switch still sees every system");
  assert.equal(sw.systems.find((s) => s.id === "snes").core.id, "snes9x");

  const games = await json(VITA, "/api/retro/games");
  assert.equal(games.total, 3);
  assert.ok(games.games.every((g) => g.system !== "n64"));
  const swGame = (await json(SWITCH, "/api/retro/games?system=snes")).games[0];
  const vitaGame = (await json(VITA, "/api/retro/games?system=snes")).games[0];
  assert.equal(vitaGame.url, swGame.url, "the same file");
  assert.equal((await json(VITA, "/api/retro/games?system=n64")).total, 0);
  assert.deepEqual((await json(VITA, "/api/retro/home")).systems.map((s) => s.id).sort(), ["gba", "pcecd", "snes"]);
});

test("a Vita reads the firmware its systems need and downloads only those files, each with its md5", async () => {
  const req = await json(VITA, "/api/retro/requirements");
  const gba = req.systems.find((s) => s.id === "gba").files;
  const md5 = createHash("md5").update(GBA_BIOS).digest("hex");
  assert.deepEqual(gba.map(({ url, ...f }) => f), [{ path: "gba_bios.bin", size: GBA_BIOS.length, md5, required: false }]);
  const missing = req.systems.find((s) => s.id === "pcecd").files;
  assert.deepEqual(missing, [{ path: "syscard3.pce", size: null, md5: null, required: true, url: null }]);
  assert.equal(req.systems.some((s) => s.id === "n64"), false);

  const r = await fetch(gba[0].url.startsWith("http") ? gba[0].url : base + gba[0].url, { headers: VITA });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-content-md5"), md5);
  assert.equal(await r.text(), GBA_BIOS);
  for (const bad of ["syscard3.pce", "../roms/snes/Sample Quest (Korea).sfc", "gb_bios.bin", "/etc/passwd", ""]) {
    assert.equal((await get(VITA, `/api/retro/requirements/file?path=${encodeURIComponent(bad)}`)).status, 404, bad);
  }
});

test("a Switch hears 404 on the Vita's firmware addresses and the web what it heard before", async () => {
  for (const url of ["/api/retro/requirements", "/api/retro/requirements/file?path=gba_bios.bin"]) {
    assert.equal((await get(SWITCH, url)).status, 404, url);
    // The web gets what it gets for any address that does not exist under /api/retro.
    const web = { Authorization: ALICE };
    assert.equal((await get(web, url)).status, (await get(web, "/api/retro/no-such-address")).status, url);
  }
});
