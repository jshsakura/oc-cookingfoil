/**
 * Pure-JS NRO asset section parser.
 *
 * NRO is Switch homebrew's executable format — a self-contained ELF-ish
 * binary with no encryption. Homebrew toolchains (devkitpro, libtransistor)
 * append an "asset" section after the executable holding:
 *   - the title icon (a small JPEG or PNG, typically 256×256)
 *   - the NACP (Application Control Property) — Nintendo's metadata
 *     blob with name + publisher per language, version, etc.
 *
 * Because none of this is encrypted, we don't need prod.keys. A handful
 * of bytes at known offsets is all it takes.
 *
 * References:
 *   https://switchbrew.org/wiki/NRO
 *   https://switchbrew.org/wiki/NACP_Format
 *
 * Format (little-endian throughout):
 *
 *   0x10  4   "NRO0" magic
 *   0x18  4   nro_size                       (file size of NRO body, not incl. asset)
 *
 *   At byte offset `nro_size`:
 *   0x00  4   "ASET" magic
 *   0x04  4   version (0)
 *   0x08  8   icon_offset  (relative to asset start)
 *   0x10  8   icon_size
 *   0x18  8   nacp_offset
 *   0x20  8   nacp_size
 *   0x28  8   romfs_offset
 *   0x30  8   romfs_size
 *
 *   NACP (0x4000 bytes):
 *   0x0000   16 × 0x300   NameAndPublisher slots (per language)
 *                         Each slot:  name (0x200) || publisher (0x100)
 *   ...
 *   0x3060   0x10         DisplayVersion (null-padded UTF-8)
 *   ...
 *   (we surface name, publisher, version — rest can be added later)
 */
import fs from "fs/promises";

const NRO_MAGIC = Buffer.from("NRO0");
const ASET_MAGIC = Buffer.from("ASET");

const NACP_SLOT_BYTES = 0x300;
const NACP_NAME_BYTES = 0x200;
const NACP_PUBLISHER_BYTES = 0x100;
const NACP_TOTAL_BYTES = 0x4000;

// Slot index per NACP language. Order matches Nintendo's enum so we can
// prefer the user's language while still falling back to whatever's
// present. Anything not in this list is tried last (slot order).
const NACP_LANG_SLOTS = {
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

function readNullPaddedUtf8(buf, offset, length) {
  let end = offset;
  const max = Math.min(offset + length, buf.length);
  while (end < max && buf[end] !== 0) end++;
  return buf.subarray(offset, end).toString("utf-8");
}

async function parseAssets(absPath) {
  const fd = await fs.open(absPath, "r");
  try {
    const headBuf = Buffer.alloc(0x40);
    await fd.read(headBuf, 0, 0x40, 0);
    if (!headBuf.subarray(0x10, 0x14).equals(NRO_MAGIC)) return null;
    const nroSize = headBuf.readUInt32LE(0x18);

    const stat = await fd.stat();
    // No asset section if the file ends right after the NRO body.
    if (stat.size <= nroSize + 0x38) return null;

    const assetHeader = Buffer.alloc(0x38);
    await fd.read(assetHeader, 0, 0x38, nroSize);
    if (!assetHeader.subarray(0, 4).equals(ASET_MAGIC)) return null;

    const iconOff = Number(assetHeader.readBigUInt64LE(0x08));
    const iconSize = Number(assetHeader.readBigUInt64LE(0x10));
    const nacpOff = Number(assetHeader.readBigUInt64LE(0x18));
    const nacpSize = Number(assetHeader.readBigUInt64LE(0x20));

    let icon = null;
    // 10 MiB cap — homebrew icons are tens of KB; anything bigger is
    // either malformed or actively hostile.
    if (iconSize > 0 && iconSize < 10 * 1024 * 1024) {
      icon = Buffer.alloc(iconSize);
      await fd.read(icon, 0, iconSize, nroSize + iconOff);
    }

    let nacp = null;
    if (nacpSize >= NACP_TOTAL_BYTES) {
      nacp = Buffer.alloc(NACP_TOTAL_BYTES);
      await fd.read(nacp, 0, NACP_TOTAL_BYTES, nroSize + nacpOff);
    }
    return { icon, nacp };
  } finally {
    await fd.close();
  }
}

function decodeNacp(nacp, langPriority) {
  // Try the user's preferred languages first, then fall back to scanning
  // every slot for a non-empty name. Homebrew often only fills the
  // English slot, so the broad fallback matters.
  const tried = new Set();
  const tryOrder = [];
  for (const code of langPriority) {
    const slot = NACP_LANG_SLOTS[code];
    if (typeof slot === "number" && !tried.has(slot)) {
      tryOrder.push(slot);
      tried.add(slot);
    }
  }
  for (let i = 0; i < 16; i++) {
    if (!tried.has(i)) tryOrder.push(i);
  }

  let name = null, publisher = null;
  for (const slot of tryOrder) {
    const slotOff = slot * NACP_SLOT_BYTES;
    const n = readNullPaddedUtf8(nacp, slotOff, NACP_NAME_BYTES).trim();
    if (!n) continue;
    name = n;
    publisher =
      readNullPaddedUtf8(nacp, slotOff + NACP_NAME_BYTES, NACP_PUBLISHER_BYTES).trim() || null;
    break;
  }

  const version = readNullPaddedUtf8(nacp, 0x3060, 0x10).trim() || null;
  return { name, publisher, version };
}

export const name = "nro";

export async function extract({ absPath, baseTitleId }, opts = {}) {
  if (!/\.nro$/i.test(absPath)) return null;
  const parsed = await parseAssets(absPath).catch(() => null);
  if (!parsed || !parsed.nacp) return null;
  const meta = decodeNacp(parsed.nacp, opts.langPriority ?? ["en", "ja", "ko"]);
  if (!meta.name) return null;
  return {
    id: baseTitleId,
    name: meta.name,
    publisher: meta.publisher,
    version: meta.version,
    source: "nro",
    iconBuffer: parsed.icon,
  };
}
