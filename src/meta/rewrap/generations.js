/**
 * Master key generations and the firmware each one arrived with: the one
 * table the server maps a console's firmware version to its generation with.
 *
 * A generation is 0-based, as in prod.keys names (master_key_00 is 1.0.0's).
 * A console asks with its firmware version (?rewrap=21.0.1), which maps to a
 * generation here, and the server reports the highest one its keys reach. Each generation came with one firmware, its minimum:
 * 1.0.0 = 0, 3.0.0 = 1, 3.0.1 = 2, 4.0.0 = 3, 5.0.0 = 4, 6.0.0 = 5, 6.2.0 = 6,
 * 7.0.0 = 7, 8.1.0 = 8, 9.0.0 = 9, 9.1.0 = 10, 12.1.0 = 11, 13.0.0 = 12, and
 * from 14.0.0 one more per major version (21.0.0 = 20). A firmware between two
 * of these runs with the earlier one's generation (2.3.0 with 0, 12.0.3 with 10).
 *
 * Inside the files a generation is written as a "key generation" byte one
 * higher (0 and 1 both meaning generation 0), split across two header fields
 * for firmware 3.0.0's sake: key_generation_old (0x206) holds 0, 1 or 2, and
 * key_generation (0x220) the rest. A rights ID's last byte and a ticket's
 * master key revision hold the same byte.
 *
 * Pure.
 */
import { MAX_GENERATION } from "../nca-crypto.js";

const FIRMWARE = [
  "1.0.0", "3.0.0", "3.0.1", "4.0.0", "5.0.0", "6.0.0", "6.2.0", "7.0.0", "8.1.0", "9.0.0", "9.1.0",
  "12.1.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", "17.0.0", "18.0.0", "19.0.0", "20.0.0", "21.0.0",
];
const LAST_LISTED = FIRMWARE.length - 1;
const LAST_MAJOR = 21;

/** Whether `gen` is a generation number at all. */
export const isGeneration = (gen) => Number.isInteger(gen) && gen >= 0 && gen <= MAX_GENERATION;

/** The firmware a generation arrived with, "21.0.0"; null for a non-generation. */
export function firmwareOf(gen) {
  if (!isGeneration(gen)) return null;
  return gen <= LAST_LISTED ? FIRMWARE[gen] : `${LAST_MAJOR + gen - LAST_LISTED}.0.0`;
}

/** A firmware string as the u32 a cnmt stores it in: major << 26 | minor << 20 | micro << 16. */
export function systemVersionOf(firmware) {
  const [major, minor, micro] = firmware.split(".").map(Number);
  return ((major << 26) | (minor << 20) | (micro << 16)) >>> 0;
}

/** The key generation byte files write for a generation. */
export const keyGenerationByte = (gen) => (gen === 0 ? 0 : gen + 1);

/** { old, current }: the bytes for header 0x206 and 0x220. */
export function headerBytes(gen) {
  const byte = keyGenerationByte(gen);
  return byte <= 2 ? { old: byte, current: 0 } : { old: 2, current: byte };
}

const FIRST_VERSIONS = FIRMWARE.map((f) => f.split(".").map(Number));
const before = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The generation a firmware version [major, minor, micro] runs with: the last whose first firmware is not newer. */
export function generationOfVersion(version) {
  if (version[0] > LAST_MAJOR) return Math.min(LAST_LISTED + version[0] - LAST_MAJOR, MAX_GENERATION);
  let gen = 0;
  FIRST_VERSIONS.forEach((first, i) => {
    if (before(first, version) <= 0) gen = i;
  });
  return gen;
}

/**
 * What a ?rewrap= value asks for: { generation, systemVersion, label }, or
 * null for anything else (a list from a repeated parameter, signs, spaces,
 * out-of-range parts).
 *
 *   "21.0.1"  the console's firmware: its generation, and the cnmt's
 *             RequiredSystemVersion lowered to exactly that version
 *   "20"      a bare generation (client 0.4.26): RequiredSystemVersion lowered
 *             to the generation's first firmware
 *
 * `label` is the normalized value ("21.0.1", "g20"): what caches and ETags key on.
 */
export function parseTarget(raw) {
  if (typeof raw !== "string") return null;
  const bare = /^\d{1,2}$/.exec(raw);
  if (bare) {
    const generation = Number(raw);
    if (!isGeneration(generation)) return null;
    return { generation, systemVersion: systemVersionOf(firmwareOf(generation)), label: `g${generation}` };
  }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const version = m.slice(1).map(Number);
  const [major, minor, micro] = version;
  if (major < 1 || major > 0x3f || minor > 0x3f || micro > 0xf) return null;
  const label = version.join(".");
  return { generation: generationOfVersion(version), systemVersion: systemVersionOf(label), label };
}
