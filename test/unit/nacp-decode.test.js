import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  decodeNacp,
  nacpLanguages,
  slotPriorityOrder,
  NACP_TOTAL_BYTES,
  NACP_LANG_SLOTS,
} from "../../src/meta/nacp-decode.js";

// NACP binary layout, per src/meta/nacp-decode.js:
//   0x0000  16 x 0x300  NameAndPublisher slots (name 0x200 || publisher 0x100)
//   0x3060  0x10        DisplayVersion (null-padded UTF-8)
//   total size: 0x4000

const SLOT_BYTES = 0x300;
const NAME_BYTES = 0x200;
const VERSION_OFFSET = 0x3060;

/**
 * Build a minimal valid NACP buffer. `slots` maps slot index -> { name, publisher }.
 * Unset slots are left all-null (empty name/publisher).
 */
function buildNacp({ slots = {}, version } = {}) {
  const buf = Buffer.alloc(NACP_TOTAL_BYTES);
  for (const [slotIndex, entry] of Object.entries(slots)) {
    const slotOff = Number(slotIndex) * SLOT_BYTES;
    if (entry.name) buf.write(entry.name, slotOff, "utf8");
    if (entry.publisher) buf.write(entry.publisher, slotOff + NAME_BYTES, "utf8");
  }
  if (version) buf.write(version, VERSION_OFFSET, "utf8");
  return buf;
}

// ── decodeNacp: happy path ─────────────────────────────────────────────

test("decodeNacp reads name, publisher, version and pickedSlot from the preferred language slot", () => {
  const buf = buildNacp({
    slots: {
      [NACP_LANG_SLOTS["en"]]: { name: "Cool Game", publisher: "Acme Studio" },
    },
    version: "1.2.3",
  });

  const result = decodeNacp(buf, ["en"]);

  assert.deepEqual(result, {
    name: "Cool Game",
    publisher: "Acme Studio",
    version: "1.2.3",
    pickedSlot: NACP_LANG_SLOTS["en"],
    languages: null,
  });
});

test("nacpLanguages reads the supported-language flag as codes, once each", () => {
  const buf = Buffer.alloc(NACP_TOTAL_BYTES);
  // Slots 0 (en-US), 1 (en-GB), 2 (ja) and 12 (ko).
  buf.writeUInt32LE((1 << 0) | (1 << 1) | (1 << 2) | (1 << 12), 0x302c);
  assert.deepEqual(nacpLanguages(buf), ["en", "ja", "ko"]);
  assert.equal(nacpLanguages(Buffer.alloc(NACP_TOTAL_BYTES)), null, "no flag, no languages");
  assert.equal(nacpLanguages(Buffer.alloc(10)), null);
});

test("decodeNacp prefers an earlier langPriority slot over a later one when both are filled", () => {
  const buf = buildNacp({
    slots: {
      [NACP_LANG_SLOTS["ko"]]: { name: "한국어 이름", publisher: "KR Pub" },
      [NACP_LANG_SLOTS["en"]]: { name: "English Name", publisher: "EN Pub" },
    },
  });

  const result = decodeNacp(buf, ["ko", "en"]);

  assert.equal(result.name, "한국어 이름");
  assert.equal(result.pickedSlot, NACP_LANG_SLOTS["ko"]);
});

test("decodeNacp falls back to any non-empty slot when preferred languages are all empty", () => {
  const buf = buildNacp({
    slots: {
      [NACP_LANG_SLOTS["it"]]: { name: "Solo Italiano", publisher: "IT Pub" },
    },
  });

  // Preferred languages (ko, en) are empty slots; only Italian is filled.
  const result = decodeNacp(buf, ["ko", "en"]);

  assert.equal(result.name, "Solo Italiano");
  assert.equal(result.pickedSlot, NACP_LANG_SLOTS["it"]);
});

test("decodeNacp returns null publisher when the publisher field is all-null", () => {
  const buf = buildNacp({
    slots: {
      [NACP_LANG_SLOTS["en"]]: { name: "No Publisher Game" },
    },
  });

  const result = decodeNacp(buf, ["en"]);

  assert.equal(result.name, "No Publisher Game");
  assert.equal(result.publisher, null);
});

test("decodeNacp returns null version when the version field is all-null", () => {
  const buf = buildNacp({
    slots: {
      [NACP_LANG_SLOTS["en"]]: { name: "No Version Game", publisher: "Pub" },
    },
  });

  const result = decodeNacp(buf, ["en"]);

  assert.equal(result.version, null);
});

// ── decodeNacp: edge cases ──────────────────────────────────────────────

test("decodeNacp returns null when every language slot is all-null (no metadata)", () => {
  const buf = buildNacp({}); // all-zero buffer, no slots filled

  const result = decodeNacp(buf, ["en", "ja", "ko"]);

  assert.equal(result, null);
});

test("decodeNacp returns null for a buffer shorter than NACP_TOTAL_BYTES", () => {
  const shortBuf = Buffer.alloc(NACP_TOTAL_BYTES - 1);

  assert.equal(decodeNacp(shortBuf, ["en"]), null);
});

test("decodeNacp returns null for a non-Buffer input", () => {
  assert.equal(decodeNacp("not a buffer", ["en"]), null);
});

test("decodeNacp trims whitespace-padded name and publisher strings", () => {
  const buf = Buffer.alloc(NACP_TOTAL_BYTES);
  const slotOff = NACP_LANG_SLOTS["en"] * SLOT_BYTES;
  // Write name/publisher with surrounding spaces then null-terminate.
  buf.write("  Spacey Name  ", slotOff, "utf8");
  buf.write("  Spacey Pub  ", slotOff + NAME_BYTES, "utf8");

  const result = decodeNacp(buf, ["en"]);

  assert.equal(result.name, "Spacey Name");
  assert.equal(result.publisher, "Spacey Pub");
});

test("decodeNacp uses the default langPriority (en, ja, ko) when none is given", () => {
  const buf = buildNacp({
    slots: {
      [NACP_LANG_SLOTS["ja"]]: { name: "Japanese Title", publisher: "JP Pub" },
    },
  });

  const result = decodeNacp(buf);

  assert.equal(result.name, "Japanese Title");
  assert.equal(result.pickedSlot, NACP_LANG_SLOTS["ja"]);
});

// ── slotPriorityOrder ────────────────────────────────────────────────────

test("slotPriorityOrder puts requested language slots first, deduped, then the rest in order", () => {
  // "en" and "en-US" both map to slot 0 — must be folded to a single entry.
  const order = slotPriorityOrder(["ko", "en", "en-US"]);

  assert.equal(order[0], NACP_LANG_SLOTS["ko"]);
  assert.equal(order[1], NACP_LANG_SLOTS["en"]);
  assert.equal(order.length, 16, "all 16 slots must appear exactly once");
  assert.equal(new Set(order).size, 16, "no duplicate slot indices");
});

test("slotPriorityOrder returns all 16 slots in numeric order when langPriority is empty", () => {
  const order = slotPriorityOrder([]);

  assert.deepEqual(order, Array.from({ length: 16 }, (_, i) => i));
});

test("slotPriorityOrder ignores unknown language codes", () => {
  const order = slotPriorityOrder(["xx-unknown", "ko"]);

  assert.equal(order[0], NACP_LANG_SLOTS["ko"]);
  assert.equal(order.length, 16);
});

// ── Compressed titles (TitlesDataFormat 1, firmware 21.0.0+) ─────────────
// switchbrew NACP_Format: TitlesDataFormat at 0x3215; when 1, the title block
// is a u16 DataSize then raw DEFLATE data that inflates to 32 x 0x300 slots.

const TITLES_DATA_FORMAT = 0x3215;
const LANGUAGE_FLAG = 0x302c;

/** A NACP whose title block is compressed: `slots` as in buildNacp, up to 32 of them. */
function buildCompressedNacp({ slots = {}, version, rawTitles, payload } = {}) {
  const titles = rawTitles ?? Buffer.alloc(32 * SLOT_BYTES);
  for (const [slotIndex, entry] of Object.entries(slots)) {
    const slotOff = Number(slotIndex) * SLOT_BYTES;
    if (entry.name) titles.write(entry.name, slotOff, "utf8");
    if (entry.publisher) titles.write(entry.publisher, slotOff + NAME_BYTES, "utf8");
  }
  const data = payload ?? deflateRawSync(titles);
  const buf = Buffer.alloc(NACP_TOTAL_BYTES);
  buf.writeUInt16LE(data.length, 0);
  data.copy(buf, 2);
  buf[TITLES_DATA_FORMAT] = 1;
  if (version) buf.write(version, VERSION_OFFSET, "utf8");
  return buf;
}

test("decodeNacp reads a compressed title block", () => {
  const buf = buildCompressedNacp({
    slots: { [NACP_LANG_SLOTS["ko"]]: { name: "농장 캠프", publisher: "가상 스튜디오" }, 0: { name: "Farm Camp", publisher: "Made Up Studio" } },
    version: "1.2.0",
  });
  assert.deepEqual(decodeNacp(buf, ["ko", "en"]), {
    name: "농장 캠프", publisher: "가상 스튜디오", version: "1.2.0", pickedSlot: NACP_LANG_SLOTS["ko"], languages: null,
  });
  assert.equal(decodeNacp(buf, ["en"]).name, "Farm Camp");
});

test("decodeNacp falls back to a slot past 15 when only a newer language is filled", () => {
  const buf = buildCompressedNacp({ slots: { 16: { name: "Gra Testowa", publisher: "Wydawca" } } });
  const result = decodeNacp(buf, ["ko", "en"]);
  assert.equal(result.name, "Gra Testowa");
  assert.equal(result.publisher, "Wydawca");
  assert.equal(result.pickedSlot, 16);
});

test("decodeNacp returns null for corrupt compressed data, without throwing", () => {
  const garbage = Buffer.from([0xff, 0xfe, 0x00, 0x13, 0x37, 0x42, 0x99]);
  assert.equal(decodeNacp(buildCompressedNacp({ payload: garbage }), ["en"]), null);
  const zeroSize = buildCompressedNacp({ slots: { 0: { name: "X" } } });
  zeroSize.writeUInt16LE(0, 0);
  assert.equal(decodeNacp(zeroSize, ["en"]), null, "no data");
  const tooBig = buildCompressedNacp({ slots: { 0: { name: "X" } } });
  tooBig.writeUInt16LE(0x3000, 0);
  assert.equal(decodeNacp(tooBig, ["en"]), null, "DataSize past the title block");
});

test("decodeNacp rejects a compressed block that inflates past 32 slots or short of them", () => {
  const big = Buffer.alloc(32 * SLOT_BYTES * 64);
  big.write("Bomb", 0, "utf8");
  assert.equal(decodeNacp(buildCompressedNacp({ rawTitles: big }), ["en"]), null, "inflate bomb");
  const short = Buffer.alloc(16 * SLOT_BYTES);
  short.write("Short", 0, "utf8");
  assert.equal(decodeNacp(buildCompressedNacp({ rawTitles: short }), ["en"]), null, "not 32 slots");
});

test("decodeNacp leaves the uncompressed format as it was when TitlesDataFormat is 0", () => {
  const buf = buildNacp({ slots: { 0: { name: "Plain Game", publisher: "Plain Pub" } }, version: "1.0" });
  assert.equal(buf[TITLES_DATA_FORMAT], 0);
  assert.equal(decodeNacp(buf, ["en"]).name, "Plain Game");
});

test("decodeNacp treats a TitlesDataFormat it does not know as unreadable, not as plain text", () => {
  const buf = buildNacp({ slots: { 0: { name: "Plain Game", publisher: "Plain Pub" } } });
  buf[TITLES_DATA_FORMAT] = 2;
  assert.equal(decodeNacp(buf, ["en"]), null);
  buf[TITLES_DATA_FORMAT] = 0xff;
  assert.equal(decodeNacp(buf, ["en"]), null);
});

test("decodeNacp skips a name with a replacement or control character and uses the next slot", () => {
  const buf = buildNacp({
    slots: {
      [NACP_LANG_SLOTS["ko"]]: { name: "\uFFFD\u0013broken", publisher: "Pub" },
      [NACP_LANG_SLOTS["en"]]: { name: "Clean Name", publisher: "Bad\u0001Pub" },
    },
  });
  const result = decodeNacp(buf, ["ko", "en"]);
  assert.equal(result.name, "Clean Name");
  assert.equal(result.publisher, null, "a garbled publisher is dropped");
});

test("nacpLanguages reads a compressed NACP's flag and ignores languages the server has none for", () => {
  const buf = buildCompressedNacp({ slots: { 0: { name: "X" } } });
  buf.writeUInt32LE((1 << 0) | (1 << 12) | (1 << 16) | (1 << 17), LANGUAGE_FLAG);
  assert.deepEqual(nacpLanguages(buf), ["en", "ko"]);
  buf.writeUInt32LE((1 << 16) | (1 << 17), LANGUAGE_FLAG);
  assert.equal(nacpLanguages(buf), null, "Polish and Thai only");
});
