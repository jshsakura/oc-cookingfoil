import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { sfo, FAKE_WORK, FAKE_RIF } from "./fixtures/vita-card.js";
import { adminSession } from "../support/web-session.js";

// A Vita's games as its backups tell them: names, versions, regions and pictures read from the backed-up files
// once, when a version is committed, and never again for a list or a picture. Each account sees its own; the
// admin sees every account's; a secret file is never read.
const root = mkdtempSync(path.join(tmpdir(), "cf-backup-games-"));
const backups = path.join(root, "backups");
mkdirSync(backups, { recursive: true });
const env = {
  COOK_PORT: "0", COOK_DATA_DIR: path.join(root, "data"), COOK_GAMES_DIR: path.join(root, "games"), COOK_BACKUPS_DIR: backups,
  COOK_AUTH_USERS: "alice:alice-password,bob:bob-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_DEVICE_PAIRING: "true",
  COOK_DEVICE_AUTO_APPROVE: "true", COOK_TITLEDB_AUTO_FETCH: "false", COOK_PUBLIC_BASE_URL: "", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
};
Object.assign(process.env, env);
mkdirSync(env.COOK_GAMES_DIR, { recursive: true });
const { default: server } = await import("../../src/index.js");
if (!server.listening) await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const { importUx0 } = await import("../../src/backups/import.js");
const { accountNamed } = await import("../../src/backups/account.js");
const store = await import("../../src/backups/store.js");
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
  setTimeout(() => process.exit(), 100);
});

const basic = (name) => "Basic " + Buffer.from(`${name}:${name}-password`).toString("base64");
async function pair(deviceKey, owner, platform) {
  await fetch(`${base}/api/pair/request`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": deviceKey, Authorization: basic(owner) },
    body: JSON.stringify(platform ? { platform } : {}),
  });
  const status = await (await fetch(`${base}/api/pair/status?deviceKey=${deviceKey}`, { headers: { Authorization: basic(owner) } })).json();
  return { "X-Device-Key": deviceKey, "X-Access-Key": status.accessKey };
}
const ALICE_VITA = await pair("A1".repeat(32), "alice", "vita");
const ALICE_SWITCH = await pair("A2".repeat(32), "alice");
const BOB_VITA = await pair("B1".repeat(32), "bob", "vita");

const png = (w, h, r) => sharp({ create: { width: w, height: h, channels: 4, background: { r, g: 40, b: 90, alpha: 1 } } }).png().toBuffer();
const le32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };

// EBOOT.PBP: the header, then PARAM.SFO, ICON0.PNG, (no ICON1, PIC0), PIC1.PNG, (no SND0), DATA.PSP, DATA.PSAR.
function pbp(parts) {
  const order = [parts.sfo, parts.icon, Buffer.alloc(0), Buffer.alloc(0), parts.pic1, Buffer.alloc(0), Buffer.from("psp"), Buffer.alloc(0)];
  const offs = [];
  let at = 40;
  for (const p of order) { offs.push(at); at += p.length; }
  return Buffer.concat([Buffer.from([0, 0x50, 0x42, 0x50]), le32(0x10000), ...offs.map(le32), ...order]);
}

// A small ISO 9660 image: PSP_GAME holding PARAM.SFO and ICON0.PNG.
function iso(files) {
  const S = 2048;
  const rec = (name, lba, size, dir) => {
    const n = Buffer.from(name, "latin1");
    const len = 33 + n.length + ((33 + n.length) % 2);
    const r = Buffer.alloc(len);
    r[0] = len;
    r.writeUInt32LE(lba, 2); r.writeUInt32BE(lba, 6); r.writeUInt32LE(size, 10); r.writeUInt32BE(size, 14);
    r[25] = dir ? 2 : 0; r[32] = n.length; n.copy(r, 33);
    return r;
  };
  const sectors = (buf) => Math.ceil(buf.length / S);
  let next = 20;
  const placed = files.map(([name, data]) => { const lba = next; next += sectors(data); return { name, data, lba }; });
  const gameDir = Buffer.concat([rec("\0", 19, S, true), rec("\x01", 18, S, true), ...placed.map((f) => rec(`${f.name};1`, f.lba, f.data.length, false))]);
  const rootDir = Buffer.concat([rec("\0", 18, S, true), rec("\x01", 18, S, true), rec("PSP_GAME", 19, S, true)]);
  const pvd = Buffer.alloc(S);
  pvd[0] = 1; pvd.write("CD001", 1, "latin1"); rec("\0", 18, S, true).copy(pvd, 156);
  const image = Buffer.alloc(next * S);
  pvd.copy(image, 16 * S); rootDir.copy(image, 18 * S); gameDir.copy(image, 19 * S);
  for (const f of placed) f.data.copy(image, f.lba * S);
  return image;
}

const card = path.join(root, "card", "ux0");
const put = (rel, data) => { mkdirSync(path.dirname(path.join(card, rel)), { recursive: true }); writeFileSync(path.join(card, rel), data); };
put("app/PCSE00001/eboot.bin", "eboot");
put("app/PCSE00001/sce_sys/param.sfo", sfo([["TITLE", "Game One"], ["APP_VER", "01.00"], ["CATEGORY", "gd"], ["CONTENT_ID", "UP0000-PCSE00001_00-EXAMPLE000000001"]]));
put("app/PCSE00001/sce_sys/icon0.png", await png(128, 128, 200));
put("app/PCSE00001/sce_sys/pic0.png", await png(960, 544, 120));
put("app/PCSE00001/sce_sys/livearea/contents/bg.png", await png(840, 500, 60));
put("app/PCSE00001/sce_sys/package/work.bin", FAKE_WORK);
put("patch/PCSE00001/eboot.bin", "patched");
put("patch/PCSE00001/sce_sys/param.sfo", sfo([["TITLE", "Game One"], ["APP_VER", "01.05"], ["CATEGORY", "gp"]]));
put("license/app/PCSE00001/6488b73b912a753a492e2714e9b38bc7.rif", FAKE_RIF); // privacy-ok: a made-up licence name
put("user/00/savedata/PCSE00001/sce_sys/param.sfo", sfo([["TITLE", "Game One"]]));
put("app/VITASHELL/eboot.bin", "shell");
put("app/VITASHELL/sce_sys/param.sfo", sfo([["TITLE", "VitaShell"], ["APP_VER", "02.02"], ["CATEGORY", "gd"]]));
put("pspemu/PSP/GAME/ULUS10041/EBOOT.PBP", pbp({ sfo: sfo([["TITLE", "PSP Game"], ["DISC_ID", "ULUS10041"], ["DISC_VERSION", "1.01"], ["CATEGORY", "UG"]]), icon: await png(144, 80, 220), pic1: await png(480, 272, 30) }));
put("pspemu/PSP/SAVEDATA/ULUS10041DATA00/PARAM.SFO", sfo([["TITLE", "Slot 1"], ["SAVEDATA_TITLE", "PSP Game"]]));
put("pspemu/ISO/Disc.iso", iso([["PARAM.SFO", sfo([["TITLE", "Disc Game"], ["DISC_ID", "ULJS00002"], ["DISC_VERSION", "1.00"]])], ["ICON0.PNG", await png(144, 80, 90)]]));
put("pspemu/ISO/Other.cso", "compressed");

const alice = () => accountNamed("alice");
const games = async (device) => (await fetch(`${base}/api/backups/games`, { headers: device })).json();

test("a dry import counts the card's games without keeping anything", () => {
  const out = execFileSync(process.execPath, ["scripts/import-backup.mjs", "--platform", "vita", "--account", "alice", "--dry"], {
    cwd: path.join(import.meta.dirname, "../.."), env: { ...process.env, ...env, COOK_IMPORT_SOURCE: card }, encoding: "utf8",
  });
  assert.match(out, /\ngames 5 \(vita 2, psp 3\), named 5, with icon 3, with cover 2\n$/);
  for (const word of ["Game One", "PCSE00001", "ULUS10041", "Disc"]) assert.equal(out.includes(word), false, word);
});

test("an import tells each game from its backups: title, newest version, region, pictures and its units", async () => {
  await importUx0({ ux0: card, accountId: alice().id });
  const list = (await games(ALICE_VITA)).games;
  assert.deepEqual(list.map((g) => [g.id, g.platform, g.title, g.region, g.version]), [
    ["PCSE00001", "vita", "Game One", "US", "01.05"],
    ["VITASHELL", "vita", "VitaShell", null, "02.02"],
    ["ULJS00002", "psp", "Disc Game", "JP", "1.00"],
    ["iso:Other.cso", "psp", "Other", null, null],
    ["ULUS10041", "psp", "PSP Game", "US", "1.01"],
  ], "Vita first, then by title");
  const one = list[0];
  assert.deepEqual(one.units, ["app:PCSE00001", "license:PCSE00001", "patch:PCSE00001", "savedata:PCSE00001"]);
  assert.equal(one.category, "gd");
  assert.equal(one.lastDevice, null, "an import is no console");
  assert.deepEqual([one.icon, one.cover, one.background], ["icon", "cover", "background"].map((r) => `/api/backups/games/PCSE00001/${r}`));
  const psp = list.find((g) => g.id === "ULUS10041");
  assert.deepEqual(psp.units, ["psp-game:ULUS10041", "psp-save:ULUS10041"]);
  assert.ok(psp.icon && psp.cover, "pictures from inside EBOOT.PBP");
  assert.ok(list.find((g) => g.id === "ULJS00002").icon, "a picture from inside the ISO");
  assert.equal(list.find((g) => g.id === "iso:Other.cso").icon, null);
});

test("pictures are shrunk jpgs with an ETag, and a list or picture never opens a body again", async () => {
  const icon = await fetch(`${base}/api/backups/games/PCSE00001/icon`, { headers: ALICE_VITA });
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/jpeg");
  const meta = await sharp(Buffer.from(await icon.arrayBuffer())).metadata();
  assert.ok(meta.width <= 128 && meta.height <= 128);
  const cover = await sharp(Buffer.from(await (await fetch(`${base}/api/backups/games/PCSE00001/cover`, { headers: ALICE_VITA })).arrayBuffer())).metadata();
  assert.deepEqual([cover.width, cover.height], [480, 272]);
  const again = await fetch(`${base}/api/backups/games/PCSE00001/icon`, { headers: { ...ALICE_VITA, "If-None-Match": icon.headers.get("etag") } });
  assert.equal(again.status, 304);

  const before = await games(ALICE_VITA);
  rmSync(path.join(store.accountDir(alice().id), "blobs"), { recursive: true, force: true });
  assert.deepEqual(await games(ALICE_VITA), before, "the list comes from what was kept");
  assert.equal((await fetch(`${base}/api/backups/games/ULUS10041/cover`, { headers: ALICE_VITA })).status, 200);
});

test("each account sees its own games, a Switch none, and a caller with no console is refused", async () => {
  assert.deepEqual((await games(ALICE_SWITCH)).games, []);
  assert.deepEqual((await games(BOB_VITA)).games, []);
  assert.equal((await fetch(`${base}/api/backups/games/PCSE00001/icon`, { headers: BOB_VITA })).status, 404);
  assert.equal((await fetch(`${base}/api/backups/games/PCSE00001/secret`, { headers: ALICE_VITA })).status, 404);
  assert.equal((await fetch(`${base}/api/backups/games`)).status, 401, "no console, no account");
});

test("removing a unit tells its game again from what is left", async () => {
  const r = await fetch(`${base}/api/backups/remove`, { method: "POST", headers: { ...ALICE_VITA, "Content-Type": "application/json" }, body: JSON.stringify({ key: "patch:PCSE00001" }) });
  assert.equal(r.status, 200);
  const one = (await games(ALICE_VITA)).games.find((g) => g.id === "PCSE00001");
  assert.equal(one.version, "01.00");
  assert.equal(one.units.includes("patch:PCSE00001"), false);
});

test("an upload from a console is told at finish, with the console as its last device", async () => {
  const body = sfo([["TITLE", "Uploaded"], ["APP_VER", "01.00"], ["CONTENT_ID", "EP0000-PCSF00009_00-EXAMPLE000000002"]]);
  const sha = createHash("sha256").update(body).digest("hex");
  const manifest = { format: 1, platform: "vita", kind: "app", unit: "PCSF00009", root: "app/PCSF00009", title: "Uploaded", version: "01.00", category: "gd",
    files: [{ path: "sce_sys/param.sfo", size: body.length, mtime: 1700000000, sha256: sha }], secrets: [] };
  const call = (method, url, payload, headers = {}) => fetch(base + url, { method, headers: { ...ALICE_VITA, ...headers }, body: payload });
  const begun = await (await call("POST", "/api/backups/begin", JSON.stringify({ key: "app:PCSF00009", manifest }), { "Content-Type": "application/json" })).json();
  assert.equal((await call("PUT", `/api/backups/upload/${begun.upload}?path=${encodeURIComponent("sce_sys/param.sfo")}&offset=0`, body)).status, 200);
  assert.equal((await call("POST", "/api/backups/finish", JSON.stringify({ upload: begun.upload }), { "Content-Type": "application/json" })).status, 200);
  const g = (await games(ALICE_VITA)).games.find((x) => x.id === "PCSF00009");
  assert.deepEqual([g.title, g.region, g.icon], ["Uploaded", "EU", null]);
  assert.equal(typeof g.lastDevice, "string");
  assert.notEqual(g.lastDevice, "");
});

test("the admin sees every account's games and pictures; nobody else does", async () => {
  assert.notEqual((await fetch(`${base}/admin/api/backups/games`)).status, 200);
  const A = await adminSession(base, "alice", "alice-password", "admin-password-123");
  const d = await (await fetch(`${base}/admin/api/backups/games`, { headers: A })).json();
  assert.equal(d.on, true);
  const [account] = d.accounts;
  assert.equal(account.name, "alice");
  const one = account.games.find((g) => g.id === "PCSE00001");
  assert.ok(one.icon.startsWith(`/admin/api/backups/games/${account.folder}/`));
  assert.equal((await fetch(base + one.icon, { headers: A })).status, 200);
  assert.notEqual((await fetch(base + one.icon)).status, 200);
});

test("a Vita sends a game's picture as it reads it; it comes first, and sending it again changes nothing", async () => {
  const send = (id, role, body, device = ALICE_VITA) => fetch(`${base}/api/backups/games/${id}/art/${role}`, { method: "POST", headers: { ...device, "Content-Type": "image/png" }, body });
  const shell = async () => (await games(ALICE_VITA)).games.find((g) => g.id === "VITASHELL");
  assert.deepEqual([(await shell()).icon, (await shell()).cover], [null, null], "the card gave none");

  const icon = await png(128, 128, 10);
  const first = await send("VITASHELL", "icon", icon);
  assert.equal(first.status, 201);
  assert.equal((await first.json()).url, "/api/backups/games/VITASHELL/icon");
  assert.equal((await send("VITASHELL", "icon", icon)).status, 204, "the same picture again");
  const got = await fetch(`${base}/api/backups/games/VITASHELL/icon`, { headers: ALICE_VITA });
  assert.equal(got.headers.get("content-type"), "image/jpeg");

  const bg = await sharp({ create: { width: 960, height: 544, channels: 3, background: "#204060" } }).jpeg().toBuffer();
  assert.equal((await send("VITASHELL", "background", bg)).status, 201);
  const one = await shell();
  assert.deepEqual([one.background, one.cover], ["/api/backups/games/VITASHELL/background", "/api/backups/games/VITASHELL/cover"], "pic0 makes the cover too");
  const cover = await sharp(Buffer.from(await (await fetch(`${base}/api/backups/games/VITASHELL/cover`, { headers: ALICE_VITA })).arrayBuffer())).metadata();
  assert.deepEqual([cover.width, cover.height], [480, 272]);

  const before = (await games(ALICE_VITA)).games.find((g) => g.id === "PCSE00001").icon;
  const etag = (await fetch(`${base}/api/backups/games/PCSE00001/icon`, { headers: ALICE_VITA })).headers.get("etag");
  assert.equal((await send("PCSE00001", "icon", await png(128, 128, 250))).status, 201);
  assert.equal((await games(ALICE_VITA)).games.find((g) => g.id === "PCSE00001").icon, before);
  assert.notEqual((await fetch(`${base}/api/backups/games/PCSE00001/icon`, { headers: ALICE_VITA })).headers.get("etag"), etag, "the sent one comes before the card's");

  assert.equal((await send("VITASHELL", "icon", Buffer.from("not a picture"))).status, 415);
  assert.equal((await send("PCSZ99999", "icon", icon)).status, 404, "a game the account has no backup of");
  assert.equal((await send("VITASHELL", "secret", icon)).status, 404);
  assert.equal((await send("VITASHELL", "icon", icon, BOB_VITA)).status, 404, "another account's game");
  assert.equal((await send("VITASHELL", "icon", icon, ALICE_SWITCH)).status, 404);
  assert.equal((await send("VITASHELL", "icon", icon, {})).status, 401);
  const big = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(2 * 1024 * 1024)]);
  assert.equal((await send("VITASHELL", "icon", big)).status, 413);
});
