// Firmware-override install ("NCA rewrap"): a game file asked for with ?rewrap=<firmware> is
// served lowered to that firmware's master key generation, same size, with every hash it
// touches still right. Everything here runs on random keys and synthetic files.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import {
  applyPatches, buildMetaNca, buildCnmt, buildNcz, buildProgramNca, buildTicket, ctr, ecb, keysUpTo, makeKeys, openHeader, rightsIdFor,
} from "../support/rewrap-files.js";
import { buildPfs0, buildXci } from "../support/switch-files.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rewrap-"));
const keysFile = path.join(root, "prod.keys");
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_PROD_KEYS_PATH = keysFile;

const { parseTarget, firmwareOf, systemVersionOf, generationOfVersion } = await import("../../src/meta/rewrap/generations.js");
const { lowerHeader } = await import("../../src/meta/rewrap/header.js");
const { lowerTicket } = await import("../../src/meta/rewrap/ticket.js");
const { buildPatchMap } = await import("../../src/meta/rewrap/patch-map.js");
const { overlay } = await import("../../src/meta/rewrap/patch-stream.js");
const { refusalText, REWRAP_WORDS } = await import("../../src/meta/rewrap/refusals.js");
const serve = await import("../../src/meta/rewrap/serve.js");
const { maxGeneration, headerGeneration } = await import("../../src/meta/nca-crypto.js");
const { readCnmts } = await import("../../src/meta/nca-reader.js");
const { readKeyGeneration } = await import("../../src/meta/key-generation.js");
const { libraryAbove, titleKeyNeed } = await import("../../src/meta/key-needs.js");
const { largeFiles, GAME_FILE_RE } = await import("../../src/helpers/file-send.js");

after(() => fs.rmSync(root, { recursive: true, force: true }));

const K = makeKeys(20);
const writeKeys = (keys) => fs.writeFileSync(keysFile, [...keys].map(([n, v]) => `${n} = ${v}`).join("\n") + "\n");
const v = (s) => systemVersionOf(s);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest();

function refusal(fn) {
  return fn().then(() => assert.fail("expected a refusal"), (err) => err);
}

/** A file on disk; returns its path. */
function file(name, data) {
  const p = path.join(root, "games", name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}

// ── generations ──────────────────────────────────────────────────────────────

test("a console's firmware maps to its master key generation by Nintendo's boundaries", () => {
  const cases = { "1.0.0": 0, "2.3.0": 0, "3.0.0": 1, "3.0.2": 2, "6.1.0": 5, "6.2.0": 6, "8.0.1": 7, "8.1.0": 8, "9.0.1": 9, "11.0.1": 10, "12.0.3": 10, "12.1.0": 11, "13.2.1": 12, "16.1.0": 15, "21.0.0": 20, "21.0.1": 20, "22.1.0": 21 };
  for (const [fw, gen] of Object.entries(cases)) assert.equal(parseTarget(fw).generation, gen, fw);
  assert.equal(firmwareOf(20), "21.0.0");
  assert.equal(firmwareOf(11), "12.1.0");
  assert.equal(firmwareOf(21), "22.0.0", "one more per major after the table");
  assert.equal(generationOfVersion([22, 0, 0]), 21);
});

test("the rewrap value is a firmware version or a bare generation, strictly", () => {
  assert.deepEqual(parseTarget("21.0.1"), { generation: 20, systemVersion: (21 << 26) | (1 << 16), label: "21.0.1" });
  assert.deepEqual(parseTarget("20"), { generation: 20, systemVersion: v("21.0.0"), label: "g20" }, "client 0.4.26 sends the generation");
  for (const bad of ["21.0", "21.0.1.0", " 21.0.1", "21.0.16", "64.0.0", "0.1.0", "-1", "64", "1e1", "0x14", "", undefined, ["20", "21"], { a: 1 }]) {
    assert.equal(parseTarget(bad), null, JSON.stringify(bad));
  }
});

test("the keys' reach is the highest generation with both a key area key and a title kek", () => {
  assert.equal(maxGeneration(K.keys), 20);
  assert.equal(maxGeneration(keysUpTo(K, 15).keys), 15);
  const noKek = new Map([...K.keys].filter(([n]) => n !== "titlekek_0e"));
  assert.equal(maxGeneration(keysUpTo({ keys: noKek }, 14).keys), 13);
  assert.equal(maxGeneration(new Map([["key_area_key_application_00", "b".repeat(32)]])), null, "no header key");
});

// ── header and ticket ────────────────────────────────────────────────────────

test("a standard-crypto header lowered to N gives the same content keys under N's key area key", () => {
  const { nca, contentKeys } = buildProgramNca(K, 18);
  const plain = openHeader(nca.subarray(0, 0xc00), K.headerKey);
  const before = Buffer.from(plain);
  const lowered = lowerHeader(plain, 15, K.keys);
  assert.equal(headerGeneration(lowered), 15);
  assert.deepEqual([lowered[0x206], lowered[0x220]], [2, 16]);
  assert.ok(ecb(K.kak[15], lowered.subarray(0x300, 0x340), true).equals(contentKeys));
  assert.ok(plain.equals(before), "the input is not changed");
  assert.deepEqual([lowerHeader(plain, 0, K.keys)[0x206], lowerHeader(plain, 0, K.keys)[0x220]], [0, 0]);
  assert.deepEqual([lowerHeader(plain, 1, K.keys)[0x206], lowerHeader(plain, 1, K.keys)[0x220]], [2, 0], "3.0.0 lives in the old byte");
});

test("a header already at or below N is returned untouched", () => {
  const plain = openHeader(buildProgramNca(K, 12).nca.subarray(0, 0xc00), K.headerKey);
  assert.equal(lowerHeader(plain, 12, K.keys), plain);
  assert.equal(lowerHeader(plain, 20, K.keys), plain);
});

test("a titlekey ticket lowered to N holds the same title key under titlekek N, and says N everywhere", () => {
  const titleKey = crypto.randomBytes(16);
  const ticket = buildTicket(K, 18, rightsIdFor(18), titleKey);
  const lowered = lowerTicket(ticket, 18, 15, K.keys);
  assert.ok(ecb(K.kek[15], lowered.subarray(0x180, 0x190), true).equals(titleKey));
  assert.equal(lowered[0x285], 16, "master key revision holds the key generation byte");
  assert.equal(lowered[0x2af], 16, "and so does the rights ID");
  assert.equal(lowered.length, ticket.length);
  assert.throws(() => lowerTicket(buildTicket(K, 18, rightsIdFor(18), titleKey, { keyType: 1 }), 18, 15, K.keys), { code: "rewrap.personalTicket" });
});

// ── patch maps ───────────────────────────────────────────────────────────────

/** An NSP with a standard program NCA, a hashed meta NCA, and its parts. */
function standardNsp(gen, rsv = v("19.0.1")) {
  const program = buildProgramNca(K, gen);
  const meta = buildMetaNca(K, gen, buildCnmt({ requiredSystemVersion: rsv }));
  const data = buildPfs0([{ name: "aaaa.nca", data: program.nca }, { name: "bbbb.cnmt.nca", data: meta.nca }]);
  return { data, program, meta };
}

/** The cnmt of the meta NCA at `at` in `buf`, checked the way a console reads it: every hash verified. */
function readVerifiedCnmt(buf, at, keys) {
  const header = openHeader(buf.subarray(at, at + 0xc00), K.headerKey);
  const fsh = header.subarray(0x400, 0x600);
  assert.ok(sha(fsh).equals(header.subarray(0x280, 0x2a0)), "FS header hash");
  const gen = headerGeneration(header);
  const key = ecb(Buffer.from(keys.get(`key_area_key_application_${gen.toString(16).padStart(2, "0")}`), "hex"), header.subarray(0x320, 0x330), true);
  const start = header.readUInt32LE(0x240) * 0x200;
  const end = header.readUInt32LE(0x244) * 0x200;
  const section = ctr(key, Buffer.from(fsh.subarray(0x140, 0x148)).reverse(), start, buf.subarray(at + start, at + end));
  const bs = fsh.readUInt32LE(0x28);
  const table = section.subarray(Number(fsh.readBigUInt64LE(0x30)), Number(fsh.readBigUInt64LE(0x30)) + Number(fsh.readBigUInt64LE(0x38)));
  const data = section.subarray(Number(fsh.readBigUInt64LE(0x40)), Number(fsh.readBigUInt64LE(0x40)) + Number(fsh.readBigUInt64LE(0x48)));
  assert.ok(sha(table).equals(fsh.subarray(0x08, 0x28)), "master hash");
  for (let b = 0; b * bs < data.length; b++) {
    assert.ok(sha(data.subarray(b * bs, Math.min((b + 1) * bs, data.length))).equals(table.subarray(b * 32, b * 32 + 32)), `block ${b} hash`);
  }
  return { gen, data };
}

test("an NSP lowered to N: same size, headers at N, RequiredSystemVersion lowered with every hash right", async () => {
  const { data, program } = standardNsp(19, v("20.1.0"));
  const p = file("std.nsp", data);
  const target = parseTarget("16.0.3");
  const patches = await buildPatchMap(p, target, K.keys);
  const out = applyPatches(data, patches);
  assert.equal(out.length, data.length);
  assert.ok(patches.every((x, i) => i === 0 || patches[i - 1].offset + patches[i - 1].bytes.length <= x.offset), "sorted, no overlap");

  const entries = (await import("../../src/meta/pfs0.js")).parsePfs0Header(out).entries;
  const prog = openHeader(out.subarray(entries[0].offset, entries[0].offset + 0xc00), K.headerKey);
  assert.equal(headerGeneration(prog), 15);
  assert.ok(ecb(K.kak[15], prog.subarray(0x300, 0x340), true).equals(program.contentKeys));
  assert.ok(out.subarray(entries[0].offset + 0xc00, entries[0].offset + entries[0].size).equals(data.subarray(entries[0].offset + 0xc00, entries[0].offset + entries[0].size)), "the body is untouched");

  const { gen, data: pfs0 } = readVerifiedCnmt(out, entries[1].offset, K.keys);
  assert.equal(gen, 15);
  const cnmtAt = (await import("../../src/meta/pfs0.js")).parsePfs0Header(pfs0).entries[0].offset;
  assert.equal(pfs0.readUInt32LE(cnmtAt + 0x28), v("16.0.3"), "exactly the console's firmware");

  // A console with only generation 15's keys reads it.
  const lowKeys = keysUpTo(K, 15).keys;
  const [first] = await readCnmts(file("std-lowered.nsp", out), lowKeys);
  assert.equal(first.cnmt.readUInt32LE(0x28), v("16.0.3"));
});

test("a bare generation lowers RequiredSystemVersion to that generation's first firmware", async () => {
  const { data } = standardNsp(19, v("20.1.0"));
  const out = applyPatches(data, await buildPatchMap(file("bare.nsp", data), parseTarget("15"), K.keys));
  const entries = (await import("../../src/meta/pfs0.js")).parsePfs0Header(out).entries;
  const { data: pfs0 } = readVerifiedCnmt(out, entries[1].offset, K.keys);
  assert.equal(pfs0.readUInt32LE((await import("../../src/meta/pfs0.js")).parsePfs0Header(pfs0).entries[0].offset + 0x28), v("16.0.0"));
});

test("a file already within N needs no patch at all", async () => {
  const { data } = standardNsp(12, v("13.0.0"));
  assert.deepEqual(await buildPatchMap(file("old.nsp", data), parseTarget("16.0.0"), K.keys), []);
});

test("a game within N whose RequiredSystemVersion is still newer gets only the cnmt lowered", async () => {
  const { data } = standardNsp(15, v("16.1.0"));
  const patches = await buildPatchMap(file("rsv.nsp", data), parseTarget("16.0.0"), K.keys);
  const entries = (await import("../../src/meta/pfs0.js")).parsePfs0Header(data).entries;
  assert.ok(patches.length > 0);
  assert.ok(patches.every((x) => x.offset >= entries[1].offset), "the program NCA is left alone");
  readVerifiedCnmt(applyPatches(data, patches), entries[1].offset, K.keys);
});

test("titlekey games: NCA rights ID byte, ticket and the .tik/.cert names follow N", async () => {
  const titleKey = crypto.randomBytes(16);
  const rid = rightsIdFor(18);
  const program = buildProgramNca(K, 18, { rightsId: rid });
  const meta = buildMetaNca(K, 18, buildCnmt({ requiredSystemVersion: v("19.0.0") }));
  const ridHex = rid.toString("hex");
  const data = buildPfs0([
    { name: "aaaa.ncz", data: buildNcz(K, 18, { rightsId: rid }).ncz },
    { name: "bbbb.nca", data: program.nca },
    { name: "cccc.cnmt.nca", data: meta.nca },
    { name: `${ridHex}.tik`, data: buildTicket(K, 18, rid, titleKey) },
    { name: `${ridHex}.cert`, data: Buffer.alloc(0x700, 7) },
  ]);
  const out = applyPatches(data, await buildPatchMap(file("tk.nsz", data), parseTarget("16.0.0"), K.keys));
  assert.equal(out.length, data.length);
  const entries = (await import("../../src/meta/pfs0.js")).parsePfs0Header(out).entries;
  const lowered = ridHex.slice(0, 30) + "10";
  assert.deepEqual(entries.map((e) => e.name), ["aaaa.ncz", "bbbb.nca", "cccc.cnmt.nca", `${lowered}.tik`, `${lowered}.cert`]);
  for (const e of entries.slice(0, 2)) {
    const h = openHeader(out.subarray(e.offset, e.offset + 0xc00), K.headerKey);
    assert.equal(headerGeneration(h), 15);
    assert.equal(h.subarray(0x230, 0x240).toString("hex"), lowered);
  }
  const tik = out.subarray(entries[3].offset, entries[3].offset + entries[3].size);
  assert.ok(ecb(K.kek[15], tik.subarray(0x180, 0x190), true).equals(titleKey));
  assert.equal(tik.subarray(0x2a0, 0x2b0).toString("hex"), lowered);
});

test("an NCZ is changed only inside its NCA header; the section table and blocks stay as they are", async () => {
  const { ncz, contentKeys } = buildNcz(K, 19);
  const meta = buildMetaNca(K, 19, buildCnmt({ requiredSystemVersion: v("20.0.0") }));
  const data = buildPfs0([{ name: "aaaa.ncz", data: ncz }, { name: "bbbb.cnmt.nca", data: meta.nca }]);
  const patches = await buildPatchMap(file("std.nsz", data), parseTarget("18.1.0"), K.keys);
  const [nczEntry] = (await import("../../src/meta/pfs0.js")).parsePfs0Header(data).entries;
  const inNcz = patches.filter((x) => x.offset < nczEntry.offset + nczEntry.size);
  assert.ok(inNcz.length && inNcz.every((x) => x.offset >= nczEntry.offset && x.offset + x.bytes.length <= nczEntry.offset + 0xc00));
  const out = applyPatches(data, patches);
  assert.equal(out.toString("ascii", nczEntry.offset + 0x4000, nczEntry.offset + 0x4008), "NCZSECTN");
  const h = openHeader(out.subarray(nczEntry.offset, nczEntry.offset + 0xc00), K.headerKey);
  assert.equal(headerGeneration(h), 17);
  assert.ok(ecb(K.kak[17], h.subarray(0x300, 0x340), true).equals(contentKeys));
});

test("an XCZ is lowered in its secure partition without touching the hashed entry heads", async () => {
  const { ncz } = buildNcz(K, 19);
  const meta = buildMetaNca(K, 19, buildCnmt({ requiredSystemVersion: v("20.0.0") }));
  const data = buildXci([{ name: "aaaa.ncz", data: ncz }, { name: "bbbb.cnmt.nca", data: meta.nca }]);
  const patches = await buildPatchMap(file("cart.xcz", data), parseTarget("17.0.0"), K.keys);
  assert.ok(patches.length > 0);
  const [first] = await readCnmts(file("cart-lowered.xcz", applyPatches(data, patches)), keysUpTo(K, 16).keys);
  assert.equal(first.cnmt.readUInt32LE(0x28), v("17.0.0"));
});

test("keys older than the game: 409 code rewrap.keysTooOld naming the prod.keys version to get", async () => {
  const { data } = standardNsp(19);
  const err = await refusal(() => buildPatchMap(file("new.nsp", data), parseTarget("12.1.0"), keysUpTo(K, 16).keys));
  assert.equal(err.code, "rewrap.keysTooOld");
  assert.deepEqual(err.vars, { version: "20.0.0" });
  assert.equal(err.message, "The server's prod.keys is too old to continue. Replace it with prod.keys from firmware 20.0.0 or later.");
  assert.equal(refusalText(err.code, err.vars, "ko"), "서버 prod.keys 의 버전이 낮아 진행할 수 없습니다. 20.0.0 이상 버전의 prod.keys 로 교체해 주세요.");
  assert.ok(!/[0-9a-f]{32}/.test(JSON.stringify(err)), "no key value");
});

test("other refusals carry their codes: no keys, a personalized ticket, a ticket that is missing, not a container", async () => {
  const { data } = standardNsp(19);
  assert.equal((await refusal(() => buildPatchMap(file("a.nsp", data), parseTarget("16.0.0"), new Map()))).code, "rewrap.noKeys");
  const rid = rightsIdFor(19);
  const lone = buildPfs0([{ name: "a.nca", data: buildProgramNca(K, 19, { rightsId: rid }).nca }]);
  assert.equal((await refusal(() => buildPatchMap(file("lone.nsp", lone), parseTarget("16.0.0"), K.keys))).code, "rewrap.unsupported");
  const personal = buildPfs0([{ name: "a.nca", data: buildProgramNca(K, 19, { rightsId: rid }).nca }, { name: `${rid.toString("hex")}.tik`, data: buildTicket(K, 19, rid, crypto.randomBytes(16), { keyType: 1 }) }]);
  assert.equal((await refusal(() => buildPatchMap(file("personal.nsp", personal), parseTarget("16.0.0"), K.keys))).code, "rewrap.personalTicket");
  assert.equal((await refusal(() => buildPatchMap(file("junk.nsp", Buffer.alloc(0x100, 1)), parseTarget("16.0.0"), K.keys))).code, "rewrap.unsupported");
});

test("a meta NCA whose hashes were already wrong is refused, not fixed", async () => {
  const { data } = standardNsp(19, v("20.1.0"));
  const entries = (await import("../../src/meta/pfs0.js")).parsePfs0Header(data).entries;
  const broken = Buffer.from(data);
  broken[entries[1].offset + 0xc00 + 0x60] ^= 1; // a byte of the encrypted cnmt PFS0
  assert.equal((await refusal(() => buildPatchMap(file("broken.nsp", broken), parseTarget("16.0.0"), K.keys))).code, "rewrap.unsupported");
});

test("every refusal reads in all twelve client languages", () => {
  const keysOf = (lang) => Object.keys(REWRAP_WORDS[lang]).sort().join();
  for (const lang of ["en", "ko", "ja", "zh", "zh-Hant", "es", "fr", "de", "it", "pt", "ru", "nl"]) assert.equal(keysOf(lang), keysOf("en"), lang);
  assert.equal(refusalText("rewrap.keysTooOld", { version: "21.0.0" }, "xx"), REWRAP_WORDS.en.keysTooOld.replace("{version}", "21.0.0"));
});

// ── streaming ────────────────────────────────────────────────────────────────

test("a patch map laid over any chunk of the stream writes exactly the overlapping bytes", () => {
  const patches = [{ offset: 10, bytes: Buffer.from("ABCD") }, { offset: 20, bytes: Buffer.from("EF") }];
  const file = Buffer.alloc(30, 0x2e);
  const whole = applyPatches(file, patches);
  for (let start = 0; start < 30; start++) {
    for (let end = start + 1; end <= 30; end++) {
      assert.ok(overlay(file.subarray(start, end), start, patches).equals(whole.subarray(start, end)), `${start}-${end}`);
    }
  }
  const untouched = file.subarray(0, 5);
  assert.equal(overlay(untouched, 0, patches), untouched, "no copy when nothing overlaps");
});

let server, base, served, original;

before(async () => {
  writeKeys(K.keys);
  original = standardNsp(19, v("20.1.0")).data;
  file("Game [0100ABCD00010000]/game.nsp", original);
  const app = express();
  app.use(largeFiles(path.join(root, "games"), GAME_FILE_RE));
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}/Game%20%5B0100ABCD00010000%5D/game.nsp`;
  served = applyPatches(original, await buildPatchMap(path.join(root, "games", "Game [0100ABCD00010000]", "game.nsp"), parseTarget("16.0.0"), K.keys));
});
after(() => server?.close());

test("GET ?rewrap= streams the lowered file whole, and HEAD reports the same length", async () => {
  const r = await fetch(`${base}?rewrap=16.0.0`);
  assert.equal(r.status, 200);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(served));
  const head = await fetch(`${base}?rewrap=16.0.0`, { method: "HEAD" });
  assert.equal(head.headers.get("content-length"), String(original.length));
  assert.ok(!served.equals(original));
});

test("a Range across a patched boundary returns the patched bytes, and resumes with If-Range", async () => {
  const entries = (await import("../../src/meta/pfs0.js")).parsePfs0Header(original).entries;
  const from = entries[0].offset - 5;
  const to = entries[0].offset + 0x210;
  const r = await fetch(`${base}?rewrap=16.0.0`, { headers: { Range: `bytes=${from}-${to}` } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), `bytes ${from}-${to}/${original.length}`);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(served.subarray(from, to + 1)));
  const etag = r.headers.get("etag");
  const resumed = await fetch(`${base}?rewrap=16.0.0`, { headers: { Range: `bytes=${to + 1}-`, "If-Range": etag } });
  assert.equal(resumed.status, 206);
  assert.ok(Buffer.from(await resumed.arrayBuffer()).equals(served.subarray(to + 1)));
});

test("the ETag differs between the original and each target, so no cache mixes them", async () => {
  const tags = await Promise.all(["", "?rewrap=16.0.0", "?rewrap=16.0.1", "?rewrap=15"].map(async (q) => (await fetch(base + q, { method: "HEAD" })).headers.get("etag")));
  assert.equal(new Set(tags).size, 4);
  // node:http, not fetch: fetch adds its own cache headers to a conditional request.
  const statusOf = (url, etag) => new Promise((resolve, reject) => {
    http.get(url, { headers: { "If-None-Match": etag } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
  });
  assert.equal(await statusOf(base, tags[1]), 200, "the lowered file's ETag does not validate the original");
  assert.equal(await statusOf(`${base}?rewrap=16.0.0`, tags[1]), 304);
});

test("patch maps are kept per target: the same one is reused, another target gets its own", async () => {
  const abs = path.join(root, "games", "Game [0100ABCD00010000]", "game.nsp");
  const st = fs.statSync(abs);
  const a = serve.plan(abs, st, "16.0.0");
  assert.equal(serve.plan(abs, st, "16.0.0"), a, "parallel and later requests share one");
  const b = await serve.plan(abs, st, "18.0.0");
  assert.notDeepEqual((await a).patches, b.patches);
  assert.equal((await a).tag, "rewrap-16.0.0");
});

test("a refusal is a 409 { error, errors, code } with error in the request's language, never cached", async () => {
  const bad = await fetch(`${base}?rewrap=16.0`, { headers: { "Accept-Language": "ko" } });
  assert.equal(bad.status, 409);
  assert.equal(bad.headers.get("cache-control"), "no-store");
  const badBody = await bad.json();
  assert.deepEqual(badBody, {
    error: refusalText("rewrap.badTarget", {}, "ko"),
    errors: Object.fromEntries(Object.keys(REWRAP_WORDS).map((l) => [l, refusalText("rewrap.badTarget", {}, l)])),
    code: "rewrap.badTarget",
  });

  writeKeys(keysUpTo(K, 16).keys);
  serve.clearPlans();
  try {
    const old = await fetch(`${base}?rewrap=12.1.0`, { headers: { "Accept-Language": "ja" } });
    assert.equal(old.status, 409);
    const body = await old.json();
    assert.equal(body.code, "rewrap.keysTooOld");
    assert.equal(body.error, "サーバーの prod.keys のバージョンが古いため続行できません。20.0.0 以降の prod.keys に置き換えてください。");
    const head = await fetch(`${base}?rewrap=12.1.0`, { method: "HEAD" });
    assert.equal(head.status, 409, "HEAD is refused the same way");
  } finally {
    writeKeys(K.keys);
  }
});

// ── library facts ────────────────────────────────────────────────────────────

test("a file's key generation is the highest among its NCA headers, NSZ and XCZ included", async () => {
  const data = buildPfs0([{ name: "a.ncz", data: buildNcz(K, 17).ncz }, { name: "b.nca", data: buildProgramNca(K, 12).nca }]);
  assert.equal(await readKeyGeneration(file("gen.nsz", data), K.keys), 17);
  assert.equal(await readKeyGeneration(file("gen.xcz", buildXci([{ name: "a.nca", data: buildProgramNca(K, 9).nca }])), K.keys), 9);
  assert.equal(await readKeyGeneration(file("gen2.nsz", data), new Map()), null, "no keys, no answer");
});

test("the library count names the games above the keys and the prod.keys version that covers them", () => {
  const gens = new Map([["A@0", 19], ["A@65536", 20], ["B@0", 12]]);
  const gen = (f) => gens.get(`${f.titleId}@${f.version}`);
  const files = [
    { titleId: "A", baseTitleId: "A", version: 0, kind: "base" },
    { titleId: "A", baseTitleId: "A", version: 65536, kind: "update" },
    { titleId: "B", baseTitleId: "B", version: 0, kind: "base" },
    { titleId: "C", baseTitleId: "C", version: 0, kind: "base" },
  ];
  assert.deepEqual(libraryAbove(16, files, gen), { above: 1, version: "21.0.0", known: 3, unknown: 1 });
  assert.deepEqual(libraryAbove(20, files, gen), { above: 0, version: null, known: 3, unknown: 1 });
  assert.deepEqual(titleKeyNeed("A", files, gen), { keyGeneration: 20, keyFirmware: "21.0.0" });
  assert.deepEqual(titleKeyNeed("C", files, gen), { keyGeneration: null, keyFirmware: null });
});
