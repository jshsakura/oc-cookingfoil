import { test } from "node:test";
import assert from "node:assert/strict";
import { findControlNcaId, listContents } from "../../src/meta/cnmt-parse.js";

// CNMT binary layout (little-endian), per src/meta/cnmt-parse.js:
//   0x00  8   TitleId
//   0x08  4   Version
//   0x0C  1   ContentMetaType
//   0x0D  1   Reserved
//   0x0E  2   ExtendedHeaderSize
//   0x10  2   ContentCount
//   0x12  2   ContentMetaCount
//   0x14  1   ContentMetaAttributes
//   0x15  3   Reserved
//   0x18  4   RequiredDownloadSystemVersion
//   0x1C  4   Reserved
//   0x20  ExtendedHeaderSize bytes
//   then ContentCount x PackagedContentInfo (0x38 bytes):
//     0x00  0x20  Sha256Hash
//     0x20  0x10  NcaId
//     0x30  6     Size (LE 48-bit)
//     0x36  1     ContentType (3 = Control)
//     0x37  1     IdOffset

const HEADER_SIZE = 0x20;
const CONTENT_INFO_SIZE = 0x38;
const CONTENT_TYPE_PROGRAM = 1;
const CONTENT_TYPE_CONTROL = 3;

/**
 * Build a minimal valid CNMT buffer with the given extended-header size and
 * an array of { ncaIdHex, contentType, idOffset } content records.
 */
function buildCnmt({ extendedHeaderSize = 0, contents = [] } = {}) {
  const contentStart = HEADER_SIZE + extendedHeaderSize;
  const buf = Buffer.alloc(contentStart + contents.length * CONTENT_INFO_SIZE);

  buf.writeBigUInt64LE(0x0100000000ABC000n, 0x00); // TitleId
  buf.writeUInt32LE(1, 0x08); // Version
  buf.writeUInt8(0x80, 0x0c); // ContentMetaType = Application
  buf.writeUInt16LE(extendedHeaderSize, 0x0e);
  buf.writeUInt16LE(contents.length, 0x10);
  buf.writeUInt16LE(0, 0x12); // ContentMetaCount

  contents.forEach((c, i) => {
    const off = contentStart + i * CONTENT_INFO_SIZE;
    // Sha256Hash left zeroed — unused by the parser.
    Buffer.from(c.ncaIdHex, "hex").copy(buf, off + 0x20);
    buf.writeUIntLE(c.size ?? 0, off + 0x30, 6);
    buf.writeUInt8(c.contentType, off + 0x36);
    buf.writeUInt8(c.idOffset ?? 0, off + 0x37);
  });

  return buf;
}

// ── findControlNcaId ────────────────────────────────────────────────────

test("findControlNcaId returns the lowercase hex NcaId of the Control entry", () => {
  const ncaHex = "AABBCCDDEEFF00112233445566778899"; // 16 bytes = 32 hex chars
  const buf = buildCnmt({
    contents: [
      { ncaIdHex: "00112233445566778899aabbccddeeff", contentType: CONTENT_TYPE_PROGRAM },
      { ncaIdHex: ncaHex, contentType: CONTENT_TYPE_CONTROL },
    ],
  });

  const result = findControlNcaId(buf);

  assert.equal(result, ncaHex.toLowerCase());
});

test("findControlNcaId returns null when no Control entry is present", () => {
  const buf = buildCnmt({
    contents: [
      { ncaIdHex: "00112233445566778899aabbccddeeff", contentType: CONTENT_TYPE_PROGRAM },
    ],
  });

  assert.equal(findControlNcaId(buf), null);
});

test("findControlNcaId returns null for a buffer shorter than the header", () => {
  const buf = Buffer.alloc(HEADER_SIZE - 1);

  assert.equal(findControlNcaId(buf), null);
});

test("findControlNcaId returns null when declared content records exceed buffer length", () => {
  // ContentCount says 2 records but the buffer only holds room for the header.
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.writeUInt16LE(0, 0x0e); // extendedHeaderSize
  buf.writeUInt16LE(2, 0x10); // contentCount = 2, but no content bytes follow

  assert.equal(findControlNcaId(buf), null);
});

test("findControlNcaId returns null for a non-Buffer input", () => {
  assert.equal(findControlNcaId("not a buffer"), null);
});

test("findControlNcaId accounts for a non-zero ExtendedHeaderSize offset", () => {
  const ncaHex = "0102030405060708090a0b0c0d0e0f10";
  const buf = buildCnmt({
    extendedHeaderSize: 0x10, // Application extended header size
    contents: [{ ncaIdHex: ncaHex, contentType: CONTENT_TYPE_CONTROL }],
  });

  assert.equal(findControlNcaId(buf), ncaHex);
});

// ── listContents ────────────────────────────────────────────────────────

test("listContents returns ncaId/contentType/idOffset for every content record", () => {
  const programId = "11112222333344445555666677778888";
  const controlId = "aaaabbbbccccddddeeeeffff00001111";
  const buf = buildCnmt({
    contents: [
      { ncaIdHex: programId, contentType: CONTENT_TYPE_PROGRAM, idOffset: 0 },
      { ncaIdHex: controlId, contentType: CONTENT_TYPE_CONTROL, idOffset: 1 },
    ],
  });

  const result = listContents(buf);

  assert.deepEqual(result, [
    { ncaId: programId, contentType: CONTENT_TYPE_PROGRAM, idOffset: 0 },
    { ncaId: controlId, contentType: CONTENT_TYPE_CONTROL, idOffset: 1 },
  ]);
});

test("listContents returns an empty array for a header-only buffer with zero content count", () => {
  const buf = buildCnmt({ contents: [] });

  assert.deepEqual(listContents(buf), []);
});

test("listContents stops early (does not throw) when the buffer is truncated mid-records", () => {
  const fullBuf = buildCnmt({
    contents: [
      { ncaIdHex: "11112222333344445555666677778888", contentType: CONTENT_TYPE_PROGRAM },
      { ncaIdHex: "aaaabbbbccccddddeeeeffff00001111", contentType: CONTENT_TYPE_CONTROL },
    ],
  });
  // Truncate so only the first content record fully fits.
  const truncated = fullBuf.subarray(0, HEADER_SIZE + CONTENT_INFO_SIZE + 10);

  const result = listContents(truncated);

  assert.equal(result.length, 1);
  assert.equal(result[0].contentType, CONTENT_TYPE_PROGRAM);
});

test("listContents returns an empty array for a non-Buffer input", () => {
  assert.deepEqual(listContents(null), []);
});

test("listContents returns an empty array for a buffer shorter than the header", () => {
  const buf = Buffer.alloc(HEADER_SIZE - 5);

  assert.deepEqual(listContents(buf), []);
});
