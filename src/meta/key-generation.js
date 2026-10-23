/**
 * The master key generation a game file needs: the highest one among the
 * headers of its NCAs (an NSZ's NCZ entries start with their NCA's header).
 * A console whose firmware is older than that generation's cannot decrypt the
 * file without a rewrap (meta/rewrap/).
 *
 * Reads 0xC00 bytes per NCA, nothing else.
 */
import fs from "fs/promises";
import { readPfs0Entries } from "./pfs0.js";
import { readXciSecureEntries } from "./hfs0.js";
import { HEADER_BYTES, decryptHeader, headerGeneration } from "./nca-crypto.js";

const NCA_RE = /\.(nca|ncz)$/i;
const XCI_RE = /\.xc[iz]$/i;

/** The generation the NSP, NSZ, XCI or XCZ at `absPath` needs; null when the keys or the file cannot tell. */
export async function readKeyGeneration(absPath, keys) {
  const headerKey = keys?.get("header_key");
  if (headerKey?.length !== 64) return null;
  const entries = (XCI_RE.test(absPath) ? await readXciSecureEntries(absPath) : await readPfs0Entries(absPath)) ?? [];
  const ncas = entries.filter((e) => NCA_RE.test(e.name) && e.size >= HEADER_BYTES);
  if (!ncas.length) return null;
  const key = Buffer.from(headerKey, "hex");
  const handle = await fs.open(absPath, "r");
  try {
    let highest = null;
    for (const entry of ncas) {
      const raw = Buffer.alloc(HEADER_BYTES);
      const { bytesRead } = await handle.read(raw, 0, HEADER_BYTES, entry.offset);
      if (bytesRead < HEADER_BYTES) return null;
      const plain = decryptHeader(raw, key);
      if (!/^NCA[23]$/.test(plain.toString("ascii", 0x200, 0x204))) return null;
      highest = Math.max(highest ?? 0, headerGeneration(plain));
    }
    return highest;
  } finally {
    await handle.close();
  }
}
