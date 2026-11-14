import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipStore } from "../../src/helpers/zip-store.js";
import { sfo } from "./fixtures/vita-card.js";
import { webSession } from "../support/web-session.js";

// /api/homebrew is one list filtered by the console's platform: a Vita gets the .vpk apps only, a Switch, the web
// signed in with no console the Switch apps only, and an app of the other platform is not there to fetch.
const root = mkdtempSync(path.join(tmpdir(), "cf-homebrew-vita-"));
const homebrew = path.join(root, "homebrew");
const put = (rel, body) => {
  mkdirSync(path.dirname(path.join(homebrew, rel)), { recursive: true });
  writeFileSync(path.join(homebrew, rel), body);
};

function fakeNro(name, version) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(name, 0);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

const ICON = Buffer.from("not really a png");
const VPK = zipStore([
  { name: "eboot.bin", data: Buffer.from("eboot") },
  { name: "sce_sys/param.sfo", data: sfo([["TITLE", "Free TV"], ["TITLE_ID", "FREETV001"], ["APP_VER", "02.02"], ["CATEGORY", "gd"]]) },
  { name: "sce_sys/icon0.png", data: ICON },
], new Date(2024, 0, 1), { deflate: true });
put("tool/tool.nro", fakeNro("Tool", "1.4.0"));
put("freetv/FreeTV.vpk", VPK);
put("freetv/.cookingfoil.json", JSON.stringify({ platform: "vita" }));
const RETRO = zipStore([
  { name: "eboot.bin", data: Buffer.from("retro") },
  { name: "sce_sys/param.sfo", data: sfo([["TITLE", "RetroArch"], ["TITLE_ID", "RETROVITA"], ["APP_VER", "00.00"], ["CATEGORY", "gd"]]) },
], new Date(2024, 0, 1), { deflate: true });
put("retroarch/RetroArch.vpk", RETRO);
put("retroarch/.cookingfoil.json", JSON.stringify({ platform: "vita", display_version: " 1.22.2 " }));
put("broken/broken.vpk", "not a zip");
put("broken/.cookingfoil.json", JSON.stringify({ platform: "vita" }));

Object.assign(process.env, {
  COOK_PORT: "0", COOK_DATA_DIR: path.join(root, "data"), COOK_GAMES_DIR: path.join(root, "games"), COOK_HOMEBREW_DIR: homebrew,
  COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "true",
  COOK_TITLEDB_AUTO_FETCH: "false", COOK_PUBLIC_BASE_URL: "", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
});
mkdirSync(path.join(root, "games"), { recursive: true });
const { refreshManual } = await import("../../src/routes/homebrew.js");
const { default: server } = await import("../../src/index.js");
if (!server.listening) await new Promise((r) => server.once("listening", r));
await refreshManual();
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
  // The whole server runs in this process and keeps its timers: the file ends here once its tests are done.
  setTimeout(() => process.exit(), 100);
});

const ALICE = { Authorization: "Basic " + Buffer.from("alice:alice-password").toString("base64") };
async function approve(deviceKey, platform) {
  const asked = await fetch(`${base}/api/pair/request`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": deviceKey, ...ALICE }, body: JSON.stringify(platform ? { platform } : {}),
  });
  assert.equal(asked.status, 200);
  const status = await (await fetch(`${base}/api/pair/status?deviceKey=${deviceKey}`, { headers: ALICE })).json();
  return { "X-Device-Key": deviceKey, "X-Access-Key": status.accessKey };
}
const VITA = await approve("E1".repeat(32), "vita");
const SWITCH = await approve("E2".repeat(32));
const WEB = await webSession(base, "alice", "alice-password");
const list = async (headers, query = "") => (await (await fetch(`${base}/api/homebrew${query}`, { headers })).json()).homebrew;

test("a Vita gets its .vpk apps only, with what it installs them by, and without ?with=titles", async () => {
  const rows = await list(VITA);
  assert.deepEqual(rows.map((r) => r.title_id).sort(), ["FREETV001", "RETROVITA"], "the Switch .nro and the .vpk that is no Vita app are left out");
  const app = rows.find((r) => r.title_id === "FREETV001");
  assert.equal(app.display_version, null, "no display version unless the folder gives one");
  assert.equal(app.install_type, "vpk");
  assert.equal(app.title_id, "FREETV001");
  assert.equal(app.name, "Free TV");
  assert.equal(app.version, "02.02");
  assert.equal(app.size, VPK.length);
  assert.equal(app.hash, crypto.createHash("sha256").update(VPK).digest("hex"));
  assert.equal(app.download_url, `/api/homebrew/${app.id}/download`);
  assert.match(app.icon_url, new RegExp(`^/api/homebrew/${app.id}/icon`));
  for (const field of ["install_path", "install_dir", "files", "archive", "bundle_url", "forwarder_title_id"]) assert.equal(app[field], null, field);
  assert.deepEqual(await list(VITA, "?with=titles"), rows);
});

test("an app whose APP_VER says nothing shows the folder's display version, and is still installed by APP_VER", async () => {
  const retro = (await list(VITA)).find((r) => r.title_id === "RETROVITA");
  assert.equal(retro.version, "00.00");
  assert.equal(retro.display_version, "1.22.2");
  assert.equal(retro.hash, crypto.createHash("sha256").update(RETRO).digest("hex"));
});

test("a Vita takes its .vpk whole or in pieces, under the ETag of its hash, and its icon", async () => {
  const app = (await list(VITA)).find((r) => r.title_id === "FREETV001");
  const whole = await fetch(base + app.download_url, { headers: VITA });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("etag"), `"${app.hash}"`);
  assert.ok(Buffer.from(await whole.arrayBuffer()).equals(VPK));
  const piece = await fetch(base + app.download_url, { headers: { ...VITA, Range: "bytes=4-9" } });
  assert.equal(piece.status, 206);
  assert.ok(Buffer.from(await piece.arrayBuffer()).equals(VPK.subarray(4, 10)));
  assert.equal((await fetch(base + app.icon_url, { headers: VITA })).status, 200);
});

test("a Switch, and the web with no console, get the Switch apps only, and no .vpk to fetch", async () => {
  const vpk = (await list(VITA)).find((r) => r.title_id === "FREETV001");
  for (const [who, headers] of [["a Switch", SWITCH], ["the web", WEB]]) {
    const res = await fetch(`${base}/api/homebrew?with=titles`, { headers });
    assert.equal(res.status, 200, `${who}: ${await res.clone().text()}`);
    const rows = (await res.json()).homebrew;
    assert.deepEqual(rows.map((r) => r.name), ["Tool"], who);
    assert.equal(rows.some((r) => r.install_type === "vpk"), false, who);
    assert.equal((await fetch(`${base}/api/homebrew/${vpk.id}/download`, { headers })).status, 404, who);
  }
  const [nro] = await list(SWITCH);
  assert.equal((await fetch(`${base}/api/homebrew/${nro.id}/download`, { headers: VITA })).status, 404, "a Vita never gets a .nro");
  assert.equal((await fetch(`${base}/api/homebrew/${nro.id}/download`, { headers: SWITCH })).status, 200);
  const escape = await fetch(`${base}/api/homebrew/m-..%2F..%2Fetc/download`, { headers: VITA });
  assert.ok([400, 404].includes(escape.status), `an id is never a path: ${escape.status}`);
});
