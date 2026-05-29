/**
 * Minimal parser for a PackagedContentMeta (.cnmt) binary file.
 *
 * Reference: https://switchbrew.org/wiki/CNMT
 *
 * Structure (little-endian throughout):
 *
 *   0x00  8   TitleId
 *   0x08  4   Version
 *   0x0C  1   ContentMetaType  (0x80=Application, 0x81=Patch, 0x82=AddOnContent, ...)
 *   0x0D  1   Reserved
 *   0x0E  2   ExtendedHeaderSize
 *   0x10  2   ContentCount
 *   0x12  2   ContentMetaCount
 *   0x14  1   ContentMetaAttributes
 *   0x15  3   Reserved
 *   0x18  4   RequiredDownloadSystemVersion
 *   0x1C  4   Reserved
 *   0x20  ExtendedHeaderSize bytes
 *
 *   Then ContentCount × PackagedContentInfo (0x38 bytes each):
 *     0x00  0x20  Sha256Hash
 *     0x20  0x10  NcaId
 *     0x30  6     Size (LE 48-bit)
 *     0x36  1     ContentType   (0=Meta, 1=Program, 2=Data, 3=Control,
 *                                4=HtmlDocument, 5=LegalInformation,
 *                                6=DeltaFragment)
 *     0x37  1     IdOffset      (DLC sub-id, 0 for base)
 *
 * We only need the NcaId for the Control entry (type 3) — the rest is
 * parsed defensively so a malformed .cnmt doesn't take the server down.
 */
const HEADER_SIZE = 0x20;
const CONTENT_INFO_SIZE = 0x38;
const CONTENT_TYPE_CONTROL = 3;

export function findControlNcaId(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return null;

  const extendedHeaderSize = buf.readUInt16LE(0x0E);
  const contentCount = buf.readUInt16LE(0x10);

  const contentStart = HEADER_SIZE + extendedHeaderSize;
  const needed = contentStart + contentCount * CONTENT_INFO_SIZE;
  if (buf.length < needed) return null;

  for (let i = 0; i < contentCount; i++) {
    const off = contentStart + i * CONTENT_INFO_SIZE;
    const contentType = buf[off + 0x36];
    if (contentType !== CONTENT_TYPE_CONTROL) continue;
    const ncaIdBytes = buf.subarray(off + 0x20, off + 0x30);
    // NCA filenames in PFS0 are the lowercase hex of the 16-byte id.
    return ncaIdBytes.toString("hex").toLowerCase();
  }
  return null;
}

/**
 * Read all (NcaId, ContentType) pairs. Used by tests and the future debug
 * surface — the extractor itself only needs the Control entry.
 */
export function listContents(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return [];
  const extendedHeaderSize = buf.readUInt16LE(0x0E);
  const contentCount = buf.readUInt16LE(0x10);
  const contentStart = HEADER_SIZE + extendedHeaderSize;
  const out = [];
  for (let i = 0; i < contentCount; i++) {
    const off = contentStart + i * CONTENT_INFO_SIZE;
    if (off + CONTENT_INFO_SIZE > buf.length) break;
    out.push({
      ncaId: buf.subarray(off + 0x20, off + 0x30).toString("hex").toLowerCase(),
      contentType: buf[off + 0x36],
      idOffset: buf[off + 0x37],
    });
  }
  return out;
}
