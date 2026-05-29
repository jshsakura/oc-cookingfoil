/**
 * Pure-JS NRO asset section parser.
 *
 * NRO is Switch homebrew's executable format — a self-contained ELF-ish
 * binary with no encryption. Homebrew toolchains (devkitpro, libtransistor)
 * append an "asset" section after the executable holding:
 *   - the title icon (a small JPEG or PNG, typically 256×256)
 *   - the NACP (Application Control Property) — same blob NSP/XCI
 *     containers carry, so the decoder is shared (../nacp-decode.js)
 *
 * Because none of this is encrypted, we don't need prod.keys. A handful
 * of bytes at known offsets is all it takes.
 *
 * References:
 *   https://switchbrew.org/wiki/NRO
 *   https://switchbrew.org/wiki/NACP_Format
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
 */
import fs from "fs/promises";
import { decodeNacp, NACP_TOTAL_BYTES } from "../nacp-decode.js";

const NRO_MAGIC = Buffer.from("NRO0");
const ASET_MAGIC = Buffer.from("ASET");

async function parseAssets(absPath) {
  const fd = await fs.open(absPath, "r");
  try {
    const headBuf = Buffer.alloc(0x40);
    await fd.read(headBuf, 0, 0x40, 0);
    if (!headBuf.subarray(0x10, 0x14).equals(NRO_MAGIC)) return null;
    const nroSize = headBuf.readUInt32LE(0x18);

    const stat = await fd.stat();
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

export const name = "nro";

export async function extract({ absPath, baseTitleId }, opts = {}) {
  if (!/\.nro$/i.test(absPath)) return null;
  const parsed = await parseAssets(absPath).catch(() => null);
  if (!parsed || !parsed.nacp) return null;
  const meta = decodeNacp(parsed.nacp, opts.langPriority ?? ["en", "ja", "ko"]);
  if (!meta) return null;
  return {
    id: baseTitleId,
    name: meta.name,
    publisher: meta.publisher,
    version: meta.version,
    source: "nro",
    iconBuffer: parsed.icon,
  };
}
