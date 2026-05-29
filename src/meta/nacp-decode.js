/**
 * Decode a Nintendo Application Control Property blob.
 *
 * Same binary format whether it comes from an NRO's asset section or a
 * Switch game's Control NCA, so this module is the shared decoder.
 *
 * Reference: https://switchbrew.org/wiki/NACP_Format
 *
 *   0x0000   16 × 0x300   NameAndPublisher slots (one per language)
 *                         Each slot:  name (0x200) || publisher (0x100)
 *   0x3060   0x10         DisplayVersion (null-padded UTF-8)
 *
 * The Switch supports more languages than its hardware UI lists — slots
 * are addressable by index in the table below. Filling priority order
 * means a Korean dashboard finds Korean first, but still falls back to
 * English / Japanese / anything-non-empty before giving up.
 */

const NACP_SLOT_BYTES = 0x300;
const NACP_NAME_BYTES = 0x200;
const NACP_PUBLISHER_BYTES = 0x100;
export const NACP_TOTAL_BYTES = 0x4000;

// Slot index per Switch language code. Aliases ("en" → en-US, "zh" → CN)
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
  "zh-TW": 13, "zh-CN": 14, "zh": 14,
};

// Reverse map: slot index → preferred icon filename suffix used by Nintendo
// when extracting the Control NCA. icon_AmericanEnglish.dat etc.
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
  13: "TaiwaneseChinese",
  14: "SimplifiedChinese",
  15: "BrazilianPortuguese",
};

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
export function slotPriorityOrder(langPriority) {
  const tried = new Set();
  const order = [];
  for (const code of langPriority) {
    const slot = NACP_LANG_SLOTS[code];
    if (typeof slot === "number" && !tried.has(slot)) {
      order.push(slot);
      tried.add(slot);
    }
  }
  for (let i = 0; i < 16; i++) {
    if (!tried.has(i)) order.push(i);
  }
  return order;
}

/**
 * Pick name + publisher + version out of a NACP blob.
 * Returns `null` if no slot carries a non-empty name (treat as "no
 * metadata" — caller falls back to filename).
 */
export function decodeNacp(nacp, langPriority = ["en", "ja", "ko"]) {
  if (!Buffer.isBuffer(nacp) || nacp.length < NACP_TOTAL_BYTES) return null;
  const order = slotPriorityOrder(langPriority);

  let name = null, publisher = null, pickedSlot = null;
  for (const slot of order) {
    const slotOff = slot * NACP_SLOT_BYTES;
    const n = readNullPaddedUtf8(nacp, slotOff, NACP_NAME_BYTES).trim();
    if (!n) continue;
    name = n;
    publisher =
      readNullPaddedUtf8(nacp, slotOff + NACP_NAME_BYTES, NACP_PUBLISHER_BYTES).trim() || null;
    pickedSlot = slot;
    break;
  }
  if (!name) return null;

  const version = readNullPaddedUtf8(nacp, 0x3060, 0x10).trim() || null;
  return { name, publisher, version, pickedSlot };
}
