import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeNacp,
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
const PUBLISHER_BYTES = 0x100;
const VERSION_OFFSET = 0x3060;
const VERSION_BYTES = 0x10;

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
  });
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
