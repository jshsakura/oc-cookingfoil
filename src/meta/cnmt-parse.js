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

const META_APPLICATION = 0x80;
const META_PATCH = 0x81;
const META_ADD_ON = 0x82;
const CONTENT_TYPE_DELTA = 6;

/**
 * Install facts from a .cnmt: the bytes the console ends up storing (content
 * sizes are of the plain NCAs, so NSZ files report their unpacked size too),
 * the firmware an application or patch needs, and the base update a DLC needs.
 *
 * Extended header (switchbrew CNMT):
 *   Application / Patch  0x08  u32 RequiredSystemVersion
 *   AddOnContent         0x08  u32 RequiredApplicationVersion
 */
export function readCnmtFacts(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return null;
  const type = buf[0x0C];
  const extendedHeaderSize = buf.readUInt16LE(0x0E);
  const contentCount = buf.readUInt16LE(0x10);
  const contentStart = HEADER_SIZE + extendedHeaderSize;
  if (buf.length < contentStart + contentCount * CONTENT_INFO_SIZE) return null;

  let contentSize = 0;
  for (let i = 0; i < contentCount; i++) {
    const off = contentStart + i * CONTENT_INFO_SIZE;
    if (buf[off + 0x36] === CONTENT_TYPE_DELTA) continue;
    contentSize += buf.readUIntLE(off + 0x30, 6);
  }
  const facts = { contentSize, requiredSystemVersion: null, requiredApplicationVersion: null };
  if (extendedHeaderSize >= 0x0C) {
    const required = buf.readUInt32LE(HEADER_SIZE + 0x08);
    if (type === META_APPLICATION || type === META_PATCH) facts.requiredSystemVersion = required || null;
    if (type === META_ADD_ON) facts.requiredApplicationVersion = required || null;
  }
  return facts;
}

/** Firmware version number → "16.0.3"; null for 0 or garbage. */
export function firmwareString(version) {
  if (!Number.isInteger(version) || version <= 0) return null;
  const major = version >>> 26;
  const minor = (version >>> 20) & 0x3f;
  const micro = (version >>> 16) & 0xf;
  return major ? `${major}.${minor}.${micro}` : null;
}
