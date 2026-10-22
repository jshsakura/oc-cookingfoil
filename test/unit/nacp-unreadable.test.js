import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { deflateRawSync } from "node:zlib";

// On-disk caches go to a throwaway dir before the modules that read COOK_DATA_DIR load.
const DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cook-nacp-unreadable-"));
process.env.COOK_DATA_DIR = DATA_DIR;

const { decodeNacp, nacpLanguages, NACP_TOTAL_BYTES, NACP_DECODER_VERSION } = await import("../../src/meta/nacp-decode.js");
const { readControlDir } = await import("../../src/meta/extract-providers/nsp.js");
const nro = await import("../../src/meta/extract-providers/nro.js");
const extractor = await import("../../src/meta/nacp-extractor.js");
const extractedMeta = await import("../../src/meta/extracted-meta-store.js");
const { cachePathFor } = await import("../../src/meta/image-cache.js");

const TITLES_DATA_FORMAT = 0x3215;
const ICON = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** A NACP marked compressed whose title block is not DEFLATE data. */
function corruptCompressedNacp() {
  const buf = Buffer.alloc(NACP_TOTAL_BYTES);
  buf.writeUInt16LE(0x40, 0);
  buf.fill(0xab, 2, 2 + 0x40);
  buf[TITLES_DATA_FORMAT] = 1;
  return buf;
}

async function controlPartition(nacp, icons) {
  const dir = await fs.mkdtemp(path.join(DATA_DIR, "ctrl-"));
  const inner = path.join(dir, "0");
  await fs.mkdir(inner, { recursive: true });
  if (nacp) await fs.writeFile(path.join(inner, "control.nacp"), nacp);
  for (const [lang, buf] of Object.entries(icons)) await fs.writeFile(path.join(inner, `icon_${lang}.dat`), buf);
  return dir;
}

before(async () => {
  await extractedMeta.load();
});

beforeEach(() => {
  extractor.resetForTests();
});

test("a control partition with a corrupt compressed NACP still yields its icons, without a name", async () => {
  const dir = await controlPartition(corruptCompressedNacp(), { AmericanEnglish: ICON, Korean: Buffer.from("ko-icon") });

  const found = await readControlDir(dir, ["en", "ja", "ko"]);

  assert.ok(found, "the icons are not thrown away with the NACP");
  assert.equal(found.meta, null);
  assert.equal(found.nacpUnreadable, NACP_DECODER_VERSION);
  assert.deepEqual(found.iconBuffer, ICON);
  assert.equal(found.iconsByLang.ko.toString(), "ko-icon");
});

test("a control partition with no icon and no readable NACP gives nothing", async () => {
  const dir = await controlPartition(corruptCompressedNacp(), {});
  assert.equal(await readControlDir(dir, ["en"]), null);
});

test("an NRO with a corrupt NACP keeps its icon", async () => {
  const record = await nro.extractFromAssets({ icon: ICON, nacp: corruptCompressedNacp() }, { baseTitleId: "0500000000000001" });
  assert.equal(record.name, null);
  assert.deepEqual(record.iconBuffer, ICON);
  assert.equal(record.nacpUnreadable, NACP_DECODER_VERSION);
});

test("a record whose NACP could not be read keeps its icon and is not read again until the decoder changes", async () => {
  const BASE = "0100000000610000";
  const calls = [];
  extractor.setProvider({
    name: "stub",
    async extract(job) {
      calls.push(job);
      return { name: null, publisher: null, version: null, source: "nacp-nsp", iconBuffer: ICON, iconsByLang: {}, nacpUnreadable: NACP_DECODER_VERSION };
    },
  });

  assert.equal(extractor.enqueue({ absPath: "/c.nsp", baseTitleId: BASE, fileName: "c.nsp" }), true);
  await extractor.whenDrained();

  const rec = extractedMeta.get(BASE);
  assert.equal(rec.name, null);
  assert.equal(rec.nacpUnreadable, NACP_DECODER_VERSION);
  assert.deepEqual(await fs.readFile(cachePathFor(BASE, "icon")), ICON);
  assert.equal(extractor.needsReread(rec), false);
  extractor.resetForTests();
  assert.equal(extractor.enqueue({ absPath: "/c.nsp", baseTitleId: BASE, fileName: "c.nsp" }), false, "a rescan leaves it alone");

  await extractedMeta.put({ ...rec, nacpUnreadable: NACP_DECODER_VERSION - 1 });
  assert.equal(extractor.needsReread(extractedMeta.get(BASE)), true, "an older decoder's verdict is read again");
  extractor.forgetTried(); // a new decoder ships with a restart
  assert.equal(extractor.enqueue({ absPath: "/c.nsp", baseTitleId: BASE, fileName: "c.nsp" }), true);
  await extractor.whenDrained();
  assert.equal(calls.at(-1).langIconsOnly, false, "in full, since the name is still missing");
});

// ── fuzz: no corrupt NACP throws anywhere on the read path ─────────────────

/** Small deterministic PRNG so a failure reproduces. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function corruptVariants() {
  const rand = rng(0xc0ffee);
  const random = (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(rand() * 256)));
  const compressed = (block, size = block.length) => {
    const buf = Buffer.alloc(NACP_TOTAL_BYTES);
    buf.writeUInt16LE(size, 0);
    block.copy(buf, 2, 0, Math.min(block.length, 0x3000 - 2));
    buf[TITLES_DATA_FORMAT] = 1;
    return buf;
  };
  const variants = [
    corruptCompressedNacp(),
    compressed(Buffer.alloc(0), 0),
    compressed(random(0x100), 0xffff),
    compressed(deflateRawSync(Buffer.alloc(0x100, 0x41))),
    compressed(deflateRawSync(Buffer.alloc(0x40000, 0x41))),
    compressed(deflateRawSync(Buffer.alloc(0x6000, 0xff))),
    compressed(deflateRawSync(Buffer.alloc(0x6000, 0x41)).subarray(0, 8)),
    Buffer.alloc(NACP_TOTAL_BYTES, 0xff),
    Buffer.alloc(NACP_TOTAL_BYTES - 1),
    Buffer.alloc(0),
  ];
  for (let i = 0; i < 40; i++) {
    const buf = random(NACP_TOTAL_BYTES);
    if (i % 2) buf[TITLES_DATA_FORMAT] = 1;
    variants.push(buf);
  }
  return variants;
}

test("corrupt NACP variants never throw while decoding", () => {
  for (const [i, nacp] of corruptVariants().entries()) {
    assert.doesNotThrow(() => decodeNacp(nacp), `variant ${i}`);
    assert.doesNotThrow(() => nacpLanguages(nacp), `variant ${i}`);
    const meta = decodeNacp(nacp);
    if (meta) assert.equal(typeof meta.name, "string", `variant ${i}`);
  }
  for (const odd of [null, undefined, "nacp", 42, {}, new Uint8Array(NACP_TOTAL_BYTES)]) {
    assert.doesNotThrow(() => decodeNacp(odd));
    assert.doesNotThrow(() => nacpLanguages(odd));
  }
});

test("corrupt NACP variants never throw in a control partition and the icon always survives", async () => {
  for (const [i, nacp] of corruptVariants().entries()) {
    const dir = await controlPartition(nacp, { AmericanEnglish: ICON });
    const found = await readControlDir(dir, ["en"]);
    assert.ok(found, `variant ${i}`);
    assert.deepEqual(found.iconBuffer, ICON, `variant ${i}`);
    if (!found.meta) assert.equal(found.nacpUnreadable, NACP_DECODER_VERSION, `variant ${i}`);
    const record = await nro.extractFromAssets({ icon: ICON, nacp }, { baseTitleId: "0500000000000002" });
    assert.ok(record, `nro variant ${i}`);
    assert.deepEqual(record.iconBuffer, ICON, `nro variant ${i}`);
  }
});
