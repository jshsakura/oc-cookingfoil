/**
 * Checks a CookingFoil client build before it is offered as an update.
 *
 *   0x10  "NRO0"; 0x18 u32 the NRO's size (where its assets begin)
 *   then  "ASET", and icon / NACP / RomFS as { u64 offset, u64 size } at 0x08,
 *         0x18, 0x28, offsets from the ASET start
 *   NACP  0x4000 bytes; the display version at 0x3060, "x.y.z"
 *
 * The file must end exactly where its last section does: a truncated upload is
 * shorter, something appended is longer. Pure apart from nothing: it takes the
 * file's bytes.
 */

const NRO_MAGIC_AT = 0x10;
const NRO_SIZE_AT = 0x18;
const NRO_MIN = 0x80;
const ASET_HEADER = 0x38;
const NACP_SIZE = 0x4000;
const VERSION_AT = 0x3060;
const VERSION_LEN = 0x10;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export class ClientBuildError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ClientBuildError(code, message);
};

/** { version } for a valid build; throws ClientBuildError saying what is wrong. */
export function inspectNro(buf) {
  if (!buf.length) fail("empty", "the file is empty");
  if (buf.length < NRO_MIN || buf.toString("latin1", NRO_MAGIC_AT, NRO_MAGIC_AT + 4) !== "NRO0") fail("not-nro", "no NRO0 header at 0x10");
  const nroSize = buf.readUInt32LE(NRO_SIZE_AT);
  if (nroSize < NRO_MIN || nroSize + ASET_HEADER > buf.length) fail("truncated", `the header says ${nroSize} bytes of code, the file has ${buf.length}`);
  if (buf.toString("latin1", nroSize, nroSize + 4) !== "ASET") fail("no-assets", "no ASET block after the NRO");
  const section = (at) => ({ offset: Number(buf.readBigUInt64LE(nroSize + at)), size: Number(buf.readBigUInt64LE(nroSize + at + 8)) });
  const sections = [section(0x08), section(0x18), section(0x28)];
  const end = Math.max(ASET_HEADER, ...sections.filter((s) => s.size).map((s) => s.offset + s.size));
  if (nroSize + end !== buf.length) {
    fail(nroSize + end > buf.length ? "truncated" : "trailing-bytes", `the headers say ${nroSize + end} bytes, the file has ${buf.length}`);
  }
  const nacp = sections[1];
  if (nacp.size < NACP_SIZE) fail("no-nacp", "no NACP in the assets");
  const at = nroSize + nacp.offset + VERSION_AT;
  const raw = buf.toString("utf8", at, at + VERSION_LEN);
  const version = raw.slice(0, raw.includes("\0") ? raw.indexOf("\0") : raw.length).trim();
  if (!VERSION_RE.test(version)) fail("bad-version", `the NACP display version "${version}" is not x.y.z`);
  return { version };
}

/** -1, 0 or 1 for two "x.y.z" versions. Pure. */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/**
 * What is wrong with a homebrew .nro's framing, or null: the NRO0 header, and a
 * file size that matches the header (plus its ASET block, when it has one). The
 * NACP is not required here. Pure.
 */
export function nroProblem(buf) {
  if (buf.length < NRO_MIN || buf.toString("latin1", NRO_MAGIC_AT, NRO_MAGIC_AT + 4) !== "NRO0") return "not-nro";
  const nroSize = buf.readUInt32LE(NRO_SIZE_AT);
  if (nroSize < NRO_MIN || nroSize > buf.length) return "truncated";
  if (nroSize === buf.length) return null;
  if (nroSize + ASET_HEADER > buf.length || buf.toString("latin1", nroSize, nroSize + 4) !== "ASET") return "trailing-bytes";
  try {
    inspectNro(buf);
    return null;
  } catch (err) {
    // Only the size checks count here; a homebrew NACP needs no x.y.z version.
    return ["truncated", "trailing-bytes"].includes(err.code) ? err.code : null;
  }
}
