import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPfs0, buildXci, buildMetaNca } from "../support/switch-files.js";
import { readCnmts } from "../../src/meta/nca-reader.js";
import { readCnmtIdentity } from "../../src/meta/cnmt-parse.js";

const headerKey = crypto.randomBytes(32);
const kak = crypto.randomBytes(16);
const keys = new Map([["header_key", headerKey.toString("hex")], ["key_area_key_application_04", kak.toString("hex")]]);

function cnmt({ titleId, version, type, appId }) {
  const buf = Buffer.alloc(0x28);
  buf.writeBigUInt64LE(BigInt(`0x${titleId}`), 0);
  buf.writeUInt32LE(version, 8);
  buf[0x0c] = type;
  buf.writeUInt16LE(appId ? 8 : 0, 0x0e);
  if (appId) buf.writeBigUInt64LE(BigInt(`0x${appId}`), 0x20);
  return buf;
}

const update = cnmt({ titleId: "0100ABCD00010800", version: 196608, type: 0x81, appId: "0100ABCD00010000" });
const base = cnmt({ titleId: "0100ABCD00010000", version: 0, type: 0x80 });
const meta = (c) => buildMetaNca(c, { headerKey, keyAreaKey: kak, generation: 5 });

function withFile(name, data, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cook-nca-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return fn(file).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test("reads an update's id, version and game from its NSP without a tool", () =>
  withFile("whatever.nsp", buildPfs0([{ name: "0123.nca", data: Buffer.alloc(0x400, 1) }, { name: "abcd.cnmt.nca", data: meta(update) }]), async (file) => {
    const [first] = await readCnmts(file, keys);
    assert.deepEqual(readCnmtIdentity(first.cnmt), { titleId: "0100ABCD00010800", version: 196608, kind: "update", baseTitleId: "0100ABCD00010000" });
  }));

test("reads every cnmt of a cartridge image, the game and the update it carries", () =>
  withFile("cart.xci", buildXci([{ name: "a.cnmt.nca", data: meta(base) }, { name: "b.cnmt.nca", data: meta(update) }]), async (file) => {
    const ids = (await readCnmts(file, keys)).map((x) => readCnmtIdentity(x.cnmt).titleId);
    assert.deepEqual(ids, ["0100ABCD00010000", "0100ABCD00010800"]);
  }));

test("derives the key area key from the master key when prod.keys lists only the sources", () => {
  const ecb = (k, d) => { const c = crypto.createDecipheriv("aes-128-ecb", k, null); c.setAutoPadding(false); return Buffer.concat([c.update(d), c.final()]); };
  const [master, kekSeed, source, keySeed] = [0, 1, 2, 3].map(() => crypto.randomBytes(16));
  const derived = ecb(ecb(ecb(master, kekSeed), source), keySeed);
  const sources = new Map([
    ["header_key", headerKey.toString("hex")], ["master_key_00", master.toString("hex")], ["aes_kek_generation_source", kekSeed.toString("hex")],
    ["key_area_key_application_source", source.toString("hex")], ["aes_key_generation_source", keySeed.toString("hex")],
  ]);
  return withFile("g.nsp", buildPfs0([{ name: "m.cnmt.nca", data: buildMetaNca(base, { headerKey, keyAreaKey: derived }) }]), async (file) => {
    assert.equal(readCnmtIdentity((await readCnmts(file, sources))[0].cnmt).titleId, "0100ABCD00010000");
  });
});

test("gives nothing for wrong keys, no keys or a file that is no package", async () => {
  const wrong = new Map([["header_key", crypto.randomBytes(32).toString("hex")], ["key_area_key_application_04", kak.toString("hex")]]);
  await withFile("g.nsp", buildPfs0([{ name: "m.cnmt.nca", data: meta(base) }]), async (file) => {
    assert.deepEqual(await readCnmts(file, wrong), []);
    assert.deepEqual(await readCnmts(file, null), []);
  });
  await withFile("junk.nsp", Buffer.alloc(0x2000, 7), async (file) => assert.deepEqual(await readCnmts(file, keys), []));
});
