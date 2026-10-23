/**
 * Lowers one decrypted NCA header to an older master key generation.
 *
 * Reference: https://switchbrew.org/wiki/NCA
 *   0x200  "NCA3"
 *   0x206  key generation old, 0x220 key generation (generations.js headerBytes)
 *   0x207  key area key index: 0 application, 1 ocean, 2 system
 *   0x230  rights ID; all zero for standard crypto, else its last byte is the key generation byte
 *   0x300  key area, 4 × 0x10, AES-128-ECB with key_area_key_{index}_{generation}
 *
 * Standard crypto: the key area is decrypted with the old generation's key
 * area key and sealed again with the target's, so the same content keys come
 * out on a console that only has the target's keys.
 * Title key crypto (a rights ID): the key area is unused and stays as it is;
 * the rights ID's generation byte follows the target, and the ticket with the
 * title key is rewrapped to match (ticket.js).
 *
 * Pure: returns a new buffer, never changes `plain`.
 */
import { ecbDecrypt, ecbEncrypt, headerGeneration, keyAreaKey } from "../nca-crypto.js";
import { firmwareOf, headerBytes, keyGenerationByte } from "./generations.js";
import { RewrapError } from "./refusals.js";

const KEY_AREA = [0x300, 0x340];
const RIGHTS_ID = [0x230, 0x240];

/** The rights ID of a decrypted header as 32 lower-case hex digits; null for standard crypto. */
export function rightsIdOf(plain) {
  const id = plain.subarray(...RIGHTS_ID);
  return id.some((b) => b !== 0) ? id.toString("hex") : null;
}

/** A key area key for `gen`, or a keyMissing refusal naming that generation. */
function keyFor(keys, index, gen) {
  const key = keyAreaKey(keys, index, gen);
  if (!key) throw new RewrapError("keyMissing", { gen, firmware: firmwareOf(gen) }, `no key_area_key index ${index} for generation ${gen}`);
  return key;
}

/**
 * The header lowered to `target`; `plain` itself when its generation is
 * `target` or lower already. Throws RewrapError.
 */
export function lowerHeader(plain, target, keys) {
  const gen = headerGeneration(plain);
  if (gen <= target) return plain;
  if (plain.toString("ascii", 0x200, 0x204) !== "NCA3") throw new RewrapError("unsupported", {}, "only NCA3 headers are rewrapped");
  const out = Buffer.from(plain);
  if (rightsIdOf(plain)) {
    out[RIGHTS_ID[1] - 1] = keyGenerationByte(target);
  } else {
    const index = plain[0x207];
    const contentKeys = ecbDecrypt(keyFor(keys, index, gen), plain.subarray(...KEY_AREA));
    ecbEncrypt(keyFor(keys, index, target), contentKeys).copy(out, KEY_AREA[0]);
  }
  const bytes = headerBytes(target);
  out[0x206] = bytes.old;
  out[0x220] = bytes.current;
  return out;
}
