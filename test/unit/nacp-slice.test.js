import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCnmt, buildPfs0, buildXci } from "../support/switch-files.js";

// extractFromPfs0 cuts the meta and control NCAs out of a package and hands them to nstool;
// a stand-in nstool writes what each "NCA" (JSON here) names, so no keys or real files are needed.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-nacp-slice-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.writeFileSync(path.join(root, "prod.keys"), "header_key = 00\n");
process.env.COOK_NSTOOL_BIN = path.join(import.meta.dirname, "../fixtures/fake-nstool/nstool");
process.env.COOK_PROD_KEYS_PATH = path.join(root, "prod.keys");
process.env.COOK_DATA_DIR = path.join(root, "data");
const { extractFromPfs0 } = await import("../../src/meta/extract-providers/nsp.js");
const nszProvider = await import("../../src/meta/extract-providers/nsz.js");

const CONTROL_ID = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const NACP_BYTES = 0x4000;

function nacp(name) {
  const buf = Buffer.alloc(NACP_BYTES);
  buf.write(name, 0, "utf8"); // American English slot
  buf.write("Pub", 0x200, "utf8");
  return buf;
}

const fakeNca = (files) => Buffer.from(JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString("base64")])) }));
const cnmtNca = () => fakeNca({ "0/Application_0100000000010000.cnmt": buildCnmt([{ ncaId: CONTROL_ID, data: Buffer.alloc(16), type: 3 }]) });
const controlNca = (name) => fakeNca({ "0/control.nacp": nacp(name) });
const contents = (name) => [
  { name: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.nca", data: Buffer.alloc(4096, 9) },
  { name: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2.cnmt.nca", data: cnmtNca() },
  { name: `${CONTROL_ID}.nca`, data: controlNca(name) },
];

test("an NSP's NACP is read from its meta and control NCAs alone", async () => {
  const file = path.join(root, "game.nsp");
  fs.writeFileSync(file, buildPfs0(contents("Slice Game")));
  const read = await extractFromPfs0({ absPath: file, baseTitleId: "0100000000010000" }, { langPriority: ["en"] });
  assert.equal(read?.name, "Slice Game");
  assert.equal(read.source, "nacp-nsp");
});

test("an XCI's or XCZ's NACP is read from its secure partition the same way", async () => {
  for (const ext of ["xci", "xcz"]) {
    const file = path.join(root, `game.${ext}`);
    fs.writeFileSync(file, buildXci(contents(`Cart Game ${ext}`)));
    const read = await extractFromPfs0({ absPath: file, baseTitleId: "0100000000010000" }, { langPriority: ["en"] });
    assert.equal(read?.name, `Cart Game ${ext}`, ext);
    assert.equal(read.source, `nacp-${ext}`);
  }
});

test("the NSZ provider cuts an XCZ open the same way, without decompressing it", async () => {
  process.env.COOK_NSZ_BIN = path.join(root, "no-nsz-here");
  const file = path.join(root, "trimmed.xcz");
  fs.writeFileSync(file, buildXci(contents("Ink Game")));
  const read = await nszProvider.extract({ absPath: file, baseTitleId: "0100000000010000" }, { langPriority: ["en"] });
  delete process.env.COOK_NSZ_BIN;
  assert.equal(read?.name, "Ink Game");
  assert.equal(read.source, "nacp-xcz");
});

test("an XCZ whose control NCA is compressed (.ncz) gives no name rather than a wrong one", async () => {
  const file = path.join(root, "packed.xcz");
  const files = contents("Never Read").map((f) => (f.name === `${CONTROL_ID}.nca` ? { ...f, name: `${CONTROL_ID}.ncz` } : f));
  fs.writeFileSync(file, buildXci(files));
  assert.equal(await extractFromPfs0({ absPath: file, baseTitleId: "0100000000010000" }), null);
});

test("a package whose meta NCA is bigger than its cap is not cut out", async () => {
  const file = path.join(root, "fat-meta.nsp");
  const files = contents("Fat").map((f) => (f.name.endsWith(".cnmt.nca") ? { ...f, data: Buffer.concat([f.data, Buffer.alloc((1 << 20) + 1, 0x20)]) } : f));
  fs.writeFileSync(file, buildPfs0(files));
  assert.equal(await extractFromPfs0({ absPath: file, baseTitleId: "0100000000010000" }), null);
});
