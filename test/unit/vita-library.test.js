import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import express from "express";
import { zipStore } from "../../src/helpers/zip-store.js";
import { sfo } from "./fixtures/vita-card.js";
import { createVitaLibrary, kindOfName, licenseOf } from "../../src/library/vita-library.js";
import { vitaLibraryRouter } from "../../src/routes/vita-library.js";

// The Vita library is plain files, one folder per game: the app .vpk, its [Patch].zip and [DLC].zip.
const root = mkdtempSync(path.join(tmpdir(), "cf-vita-library-"));
after(() => rmSync(root, { recursive: true, force: true }));
const put = (rel, body) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};
const when = new Date(2024, 0, 1);
const workBin = (account) => Buffer.concat([Buffer.alloc(8), Buffer.from(account, "hex"), Buffer.alloc(496)]);
const appSfo = (id, title, ver) => sfo([["TITLE", title], ["TITLE_ID", id], ["APP_VER", ver], ["CONTENT_ID", `UP0001-${id}_00-0000000000000000`]]);

put("Alpha [PCSE00001]/Alpha [PCSE00001].vpk", zipStore([
  { name: "eboot.bin", data: Buffer.from("alpha") },
  { name: "sce_sys/param.sfo", data: appSfo("PCSE00001", "Alpha", "01.00") },
  { name: "sce_sys/icon0.png", data: Buffer.from("icon") },
  { name: "sce_sys/package/work.bin", data: workBin("0123456789abcdef") },
], when));
put("Alpha [PCSE00001]/Alpha [PCSE00001] [Patch].zip", zipStore([
  { name: "patch/PCSE00001/eboot.bin", data: Buffer.from("patched") },
  { name: "patch/PCSE00001/sce_sys/param.sfo", data: appSfo("PCSE00001", "Alpha", "01.03") },
  { name: "patch/PCSE00001/sce_sys/package/head.bin", data: Buffer.from("head") },
], when));
put("Alpha [PCSE00001]/Alpha [PCSE00001] [DLC].zip", zipStore([
  { name: "addcont/PCSE00001/DLC1/a.dat", data: Buffer.from("1") },
  { name: "addcont/PCSE00001/DLC2/b.dat", data: Buffer.from("2") },
  { name: "license/addcont/PCSE00001/DLC1/x.rif", data: workBin("0123456789abcdef") },
], when));
put("Beta [PCSB00002]/Beta [PCSB00002].vpk", zipStore([
  { name: "eboot.bin", data: Buffer.from("beta") },
  { name: "sce_sys/param.sfo", data: appSfo("PCSB00002", "Beta", "01.00") },
], when));
put("Gamma [PCSE00003]/Gamma [PCSE00003].vpk", zipStore([
  { name: "eboot.bin", data: Buffer.from("gamma") },
  { name: "sce_sys/param.sfo", data: appSfo("PCSE00003", "Gamma", "01.00") },
  { name: "sce_sys/package/work.bin", data: workBin("0000000000000000") },
], when));
put("Orphan [PCSE00009] [Patch].zip", zipStore([{ name: "patch/PCSE00009/eboot.bin", data: Buffer.from("x") }], when));
put("broken.vpk", "not a zip");
put(".work/Hidden.vpk", "x");

const crcStore = () => {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), prune: (keep) => { for (const k of [...m.keys()]) if (!keep.has(k)) m.delete(k); } };
};
const library = createVitaLibrary({ dir: () => root, crcs: crcStore() });

test("file names say their kind", () => {
  assert.equal(kindOfName("A [PCSE00001].vpk"), "app");
  assert.equal(kindOfName("A [PCSE00001] [Patch].zip"), "patch");
  assert.equal(kindOfName("A [PCSE00001] [DLC].zip"), "dlc");
  assert.equal(kindOfName("A.zip"), null);
});

test("a work.bin is fake, free or bound to an account by its account bytes", () => {
  assert.equal(licenseOf(workBin("0123456789abcdef")), "fake");
  assert.equal(licenseOf(workBin("0000000000000000")), "free");
  assert.equal(licenseOf(workBin("1122334455667788")), "none");
  assert.equal(licenseOf(null), "none");
});

test("the library lists each game with an app, its patch and DLC beside it, and skips what it cannot read", async () => {
  const games = await library.list();
  assert.deepEqual(games.map((g) => g.id), ["PCSE00001", "PCSB00002", "PCSE00003"]);
  const [alpha, beta, gamma] = games;
  assert.equal(alpha.files.app.name, "Alpha");
  assert.equal(alpha.files.app.region, "US");
  assert.equal(alpha.files.app.license, "fake");
  assert.equal(alpha.files.app.icon, true);
  assert.equal(alpha.files.patch.version, "01.03");
  assert.equal(alpha.files.dlc.count, 2);
  assert.equal(beta.files.app.license, "none");
  assert.equal(beta.files.patch, undefined);
  assert.equal(gamma.files.app.license, "free");
});

test("the CRC of each file is read once in the background, and stays null until then", async () => {
  const before = await library.file("PCSE00001", "app");
  assert.equal(before.crc32, null);
  assert.equal(await library.fillCrcs(), 5);
  const now = await library.file("PCSE00001", "app");
  const body = (await import("node:fs")).readFileSync(now.abs);
  assert.equal(now.crc32, (zlib.crc32(body) >>> 0).toString(16).padStart(8, "0"));
  assert.equal(await library.fillCrcs(), 0);
});

async function serve(platform) {
  const app = express();
  app.use("/api/vita/library", vitaLibraryRouter({ library: () => library, platformOf: () => platform }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/api/vita/library`;
}

test("a Vita gets the list in an envelope, with each file's kind, size, CRC and the app's licence word", async () => {
  await library.fillCrcs();
  const base = await serve("vita");
  const body = await (await fetch(base)).json();
  assert.equal(body.success, true);
  assert.equal(body.meta.total, 3);
  const alpha = body.data.games[0];
  assert.equal(alpha.patch_version, "01.03");
  assert.equal(alpha.icon_url, "/api/vita/library/PCSE00001/icon");
  assert.deepEqual(alpha.files.map((f) => f.kind), ["app", "patch", "dlc"]);
  assert.equal(alpha.files[0].license, "fake");
  assert.equal(alpha.files[1].license, undefined);
  assert.match(alpha.files[0].crc32, /^[0-9a-f]{8}$/);
  assert.equal(body.data.games[1].icon_url, null);
  assert.ok(!JSON.stringify(body).includes(root));
});

test("a file comes whole or by range, with its CRC as the ETag", async () => {
  const base = await serve("vita");
  const list = await (await fetch(base)).json();
  const patch = list.data.games[0].files[1];
  const whole = await fetch(`${base}/PCSE00001/patch`);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("etag"), `"${patch.crc32}"`);
  assert.equal(Number(whole.headers.get("content-length")), patch.size);
  await whole.arrayBuffer();
  const part = await fetch(`${base}/PCSE00001/patch`, { headers: { Range: "bytes=0-3", "If-Range": `"${patch.crc32}"` } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 4);
  assert.equal((await fetch(`${base}/PCSB00002/patch`)).status, 404);
  assert.equal((await fetch(`${base}/PCSE00001/other`)).status, 404);
  assert.equal((await fetch(`${base}/bad/app`)).status, 400);
  assert.equal((await fetch(`${base}/PCSE00001/icon`)).status, 200);
});

test("a Switch is refused the Vita library, and the web reads it", async () => {
  assert.equal((await fetch(await serve("switch"))).status, 404);
  assert.equal((await fetch(await serve(null))).status, 200);
});

test("a file changed since the list was read is a 503 and the list is read again", async () => {
  const base = await serve("vita");
  await (await fetch(base)).json();
  put("Beta [PCSB00002]/Beta [PCSB00002].vpk", zipStore([
    { name: "eboot.bin", data: Buffer.from("beta two") },
    { name: "sce_sys/param.sfo", data: appSfo("PCSB00002", "Beta", "01.01") },
  ], when));
  const res = await fetch(`${base}/PCSB00002/app`);
  assert.equal(res.status, 503);
  const again = await (await fetch(base)).json();
  assert.equal(again.data.games.find((g) => g.id === "PCSB00002").version, "01.01");
});

test("a file put in by hand shows once the list is old enough to be read again", async () => {
  let clock = 0;
  const lib = createVitaLibrary({ dir: () => root, crcs: crcStore(), now: () => clock });
  const before = (await lib.list()).length;
  put("Delta [PCSE00004]/Delta [PCSE00004].vpk", zipStore([
    { name: "eboot.bin", data: Buffer.from("delta") },
    { name: "sce_sys/param.sfo", data: appSfo("PCSE00004", "Delta", "01.00") },
  ], when));
  assert.equal((await lib.list()).length, before);
  clock += 5 * 60 * 1000;
  assert.equal((await lib.list()).length, before + 1);
});
