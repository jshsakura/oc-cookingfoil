/**
 * Master key generations and the firmware each one arrived with: the one
 * table the server names a generation's firmware with.
 *
 * A generation is 0-based, as in prod.keys names (master_key_00 is 1.0.0's).
 * Each generation came with one firmware, its minimum:
 * 1.0.0 = 0, 3.0.0 = 1, 3.0.1 = 2, 4.0.0 = 3, 5.0.0 = 4, 6.0.0 = 5, 6.2.0 = 6,
 * 7.0.0 = 7, 8.1.0 = 8, 9.0.0 = 9, 9.1.0 = 10, 12.1.0 = 11, 13.0.0 = 12, and
 * from 14.0.0 one more per major version (21.0.0 = 20). A firmware between two
 * of these runs with the earlier one's generation (2.3.0 with 0, 12.0.3 with 10).
 *
 * Pure.
 */
import { MAX_GENERATION } from "./nca-crypto.js";

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
