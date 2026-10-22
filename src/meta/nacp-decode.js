import { inflateRawSync } from "node:zlib";

/**
 * Decode an Application Control Property (NACP) blob.
 *
 * Same binary format whether it comes from an NRO's asset section or a
 * package's Control NCA, so this module is the shared decoder.
 *
 * Reference: https://switchbrew.org/wiki/NACP_Format
 *
 *   0x0000   16 × 0x300   NameAndPublisher slots (one per language)
 *                         Each slot:  name (0x200) || publisher (0x100)
 *   0x3060   0x10         DisplayVersion (null-padded UTF-8)
 *   0x3215   0x1          TitlesDataFormat [21.0.0+]: 1 = the title block at
 *                         0x0 is a u16 DataSize, then raw DEFLATE data that
 *                         inflates to 32 slots (libnx nacp.h NacpLanguageEntryData,
 *                         nxdumptool source/core/nacp.c nacpDecompressTitleBlock)
 *
 * The console supports more languages than its hardware UI lists — slots
 * are addressable by index in the table below. Filling priority order
 * means a Korean dashboard finds Korean first, but still falls back to
 * English / Japanese / anything-non-empty before giving up.
 */

const NACP_SLOT_BYTES = 0x300;
const NACP_NAME_BYTES = 0x200;
const NACP_PUBLISHER_BYTES = 0x100;
export const NACP_TOTAL_BYTES = 0x4000;

/**
 * Raise this when decodeNacp learns a NACP layout it could not read before.
 * A stored record whose NACP did not decode carries the version that gave up
 * on it, and nacp-extractor.js reads the file again once the version moves.
 */
export const NACP_DECODER_VERSION = 2;

// Slot index per console language code. Aliases ("en" → en-US, "zh" → CN)
// match how the rest of the codebase talks about langPriority.
export const NACP_LANG_SLOTS = {
  "en-US": 0, "en-GB": 1, "en": 0,
  "ja": 2,
  "fr": 3, "fr-CA": 9,
  "de": 4,
  "es-LA": 5, "es": 6,
  "it": 7,
  "nl": 8,
  "pt": 10, "pt-BR": 15,
  "ru": 11,
  "ko": 12,
  "zh-TW": 13, "zh-Hant": 13, "zh-CN": 14, "zh": 14,
};

// Reverse map: slot index → the language's name in the Control NCA's icon file,
// icon_<name>.dat, as switchbrew's NACP Language table lists them.
export const NACP_SLOT_TO_ICON_NAME = {
  0: "AmericanEnglish",
  1: "BritishEnglish",
  2: "Japanese",
  3: "French",
  4: "German",
  5: "LatinAmericanSpanish",
  6: "Spanish",
  7: "Italian",
  8: "Dutch",
  9: "CanadianFrench",
  10: "Portuguese",
  11: "Russian",
  12: "Korean",
  13: "TraditionalChinese",
  14: "SimplifiedChinese",
  15: "BrazilianPortuguese",
};

const TITLES_DATA_FORMAT = 0x3215;
const TITLES_PLAIN = 0;
const TITLES_COMPRESSED = 1;
const TITLE_BLOCK_BYTES = 0x3000;
const COMPRESSED_SLOTS = 32;

function readNullPaddedUtf8(buf, offset, length) {
  let end = offset;
  const max = Math.min(offset + length, buf.length);
  while (end < max && buf[end] !== 0) end++;
  return buf.subarray(offset, end).toString("utf-8");
}

/**
 * Build the ordered list of slot indices to try when picking a "best"
 * name/icon: user-preferred languages first (with duplicates folded out),
 * then every remaining slot in numeric order so homebrew that only fills
 * English (or only fills one obscure slot) still resolves.
 */
export function slotPriorityOrder(langPriority, slotCount = 16) {
  const tried = new Set();
  const order = [];
  for (const code of langPriority) {
    const slot = NACP_LANG_SLOTS[code];
    if (typeof slot === "number" && !tried.has(slot)) {
      order.push(slot);
      tried.add(slot);
    }
  }
  for (let i = 0; i < slotCount; i++) {
    if (!tried.has(i)) order.push(i);
  }
  return order;
}

// SupportedLanguageFlag (u32 at 0x302C): bit i is NACP language slot i. Bits
// 16 (Polish) and 17 (Thai), 21.0.0+, name languages the server has none for.
const NACP_LANGUAGE_FLAG = 0x302c;
const SLOT_LANGUAGES = ["en", "en", "ja", "fr", "de", "es", "es", "it", "nl", "fr", "pt", "ru", "ko", "zh", "zh", "pt"];

/** The languages a NACP says it supports, as codes ("ko", "en" …), or null when it names none. */
export function nacpLanguages(nacp) {
  if (!Buffer.isBuffer(nacp) || nacp.length < NACP_LANGUAGE_FLAG + 4) return null;
  const flag = nacp.readUInt32LE(NACP_LANGUAGE_FLAG);
  const codes = [...new Set(SLOT_LANGUAGES.filter((_, i) => flag & (1 << i)))];
  return codes.length ? codes : null;
}

/** Whether text read from a game file came out garbled: a replacement or control character. Pure. */
export const garbled = (text) => typeof text === "string" && /[\uFFFD\p{Cc}]/u.test(text);

function readText(buf, offset, length) {
  const text = readNullPaddedUtf8(buf, offset, length).trim();
  return text && !garbled(text) ? text : null;
}

/**
 * The title slots: the 16 stored plain, or the 32 a compressed block inflates
 * to. Null when the compressed block is bad, empty or does not inflate to
 * exactly 32 slots; the output is capped, so a bomb stops at the cap. Null
 * too for a TitlesDataFormat other than 0 and 1: read as plain text it would
 * give a wrong name, and null lets a later decoder version read it again.
 */
function titleSlots(nacp) {
  const format = nacp[TITLES_DATA_FORMAT];
  if (format === TITLES_PLAIN) return nacp.subarray(0, TITLE_BLOCK_BYTES);
  if (format !== TITLES_COMPRESSED) return null;
  const size = nacp.readUInt16LE(0);
  if (size === 0 || size > TITLE_BLOCK_BYTES - 2) return null;
  const expected = COMPRESSED_SLOTS * NACP_SLOT_BYTES;
  try {
    const titles = inflateRawSync(nacp.subarray(2, 2 + size), { maxOutputLength: expected });
    return titles.length === expected ? titles : null;
  } catch {
    return null;
  }
}

/**
 * Pick name + publisher + version out of a NACP blob.
 * Returns `null` if no slot carries a readable name (treat as "no
 * metadata" — caller falls back to filename).
 */
export function decodeNacp(nacp, langPriority = ["en", "ja", "ko"]) {
  if (!Buffer.isBuffer(nacp) || nacp.length < NACP_TOTAL_BYTES) return null;
  const titles = titleSlots(nacp);
  if (!titles) return null;
  const order = slotPriorityOrder(langPriority, titles.length / NACP_SLOT_BYTES);

  let name = null, publisher = null, pickedSlot = null;
  for (const slot of order) {
    const slotOff = slot * NACP_SLOT_BYTES;
    name = readText(titles, slotOff, NACP_NAME_BYTES);
    if (!name) continue;
    publisher = readText(titles, slotOff + NACP_NAME_BYTES, NACP_PUBLISHER_BYTES);
    pickedSlot = slot;
    break;
  }
  if (!name) return null;

  const version = readText(nacp, 0x3060, 0x10);
  return { name, publisher, version, pickedSlot, languages: nacpLanguages(nacp) };
}
