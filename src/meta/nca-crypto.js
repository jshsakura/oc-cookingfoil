/**
 * The NCA key handling every reader shares: the 0xC00 header in
 * AES-128-XTS, the key area keys and title key encryption keys of each master
 * key generation, and which generations a prod.keys holds.
 *
 * Reference: https://switchbrew.org/wiki/NCA
 *   header      AES-128-XTS with header_key, 0x200 sectors, tweak = sector number big-endian
 *               (NCA2: each section header is its own sector 0)
 *   key area    4 × 0x10 at 0x300, AES-128-ECB with key_area_key_{application|ocean|system}_XX
 *   title key   AES-128-ECB with titlekek_XX
 * XX is the master key generation, 0-based, two hex digits. A key missing from
 * the file is derived from master_key_XX and the *_source seeds when those are
 * there, the way hactool does.
 *
 * Pure: nothing here reads a file, and no key value leaves a function except as
 * the Buffer its caller asked for.
 */
import crypto from "crypto";

export const HEADER_BYTES = 0xc00;
const SECTOR = 0x200;
const KEY_AREA_NAMES = ["application", "ocean", "system"];
// Master key generations a prod.keys can name: master_key_00 … master_key_3f.
export const MAX_GENERATION = 0x3f;

const ecb = (decrypt, key, data) => {
  const c = decrypt ? crypto.createDecipheriv("aes-128-ecb", key, null) : crypto.createCipheriv("aes-128-ecb", key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
};

/** AES-128-ECB decryption, no padding. */
export const ecbDecrypt = (key, data) => ecb(true, key, data);

const hexOf = (gen) => gen.toString(16).padStart(2, "0");
const key16 = (keys, name) => (keys.get(name)?.length === 32 ? Buffer.from(keys.get(name), "hex") : null);

/** A key named `name` derived from master_key_XX through `sourceName`; null when a part is missing. */
function derived(keys, gen, sourceName) {
  const parts = [`master_key_${hexOf(gen)}`, "aes_kek_generation_source", sourceName, "aes_key_generation_source"].map((n) => key16(keys, n));
  if (parts.some((p) => !p)) return null;
  const [master, kekSeed, source, keySeed] = parts;
  return ecbDecrypt(ecbDecrypt(ecbDecrypt(master, kekSeed), source), keySeed);
}

/** The key area key for a key index (0 application, 1 ocean, 2 system) and generation; null when absent. */
export function keyAreaKey(keys, index, gen) {
  const kind = KEY_AREA_NAMES[index];
  if (!kind || !Number.isInteger(gen) || gen < 0 || gen > MAX_GENERATION) return null;
  return key16(keys, `key_area_key_${kind}_${hexOf(gen)}`) ?? derived(keys, gen, `key_area_key_${kind}_source`);
}

/** The title key encryption key of a generation; null when absent. */
export function titleKek(keys, gen) {
  if (!Number.isInteger(gen) || gen < 0 || gen > MAX_GENERATION) return null;
  const direct = key16(keys, `titlekek_${hexOf(gen)}`);
  if (direct) return direct;
  const master = key16(keys, `master_key_${hexOf(gen)}`);
  const source = key16(keys, "titlekek_source");
  return master && source ? ecbDecrypt(master, source) : null;
}

/**
 * The highest master key generation `keys` can open: a header key, and
 * that generation's application key area key and title key encryption key.
 * null when there is none. Counts only; no key value leaves.
 */
export function maxGeneration(keys) {
  if (!keys || keys.get("header_key")?.length !== 64) return null;
  for (let gen = MAX_GENERATION; gen >= 0; gen--) {
    if (keyAreaKey(keys, 0, gen) && titleKek(keys, gen)) return gen;
  }
  return null;
}

function xts(decrypt, raw, headerKey) {
  const out = Buffer.alloc(HEADER_BYTES);
  const sector = (i, tweak) => {
    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(tweak), 8);
    const c = decrypt ? crypto.createDecipheriv("aes-128-xts", headerKey, iv) : crypto.createCipheriv("aes-128-xts", headerKey, iv);
    Buffer.concat([c.update(raw.subarray(i * SECTOR, (i + 1) * SECTOR)), c.final()]).copy(out, i * SECTOR);
  };
  sector(0, 0);
  sector(1, 1);
  // The magic decides NCA2's tweaks; it sits in sector 1, plain once that sector is decrypted.
  const magic = (decrypt ? out : raw).toString("ascii", 0x200, 0x204);
  for (let i = 2; i < HEADER_BYTES / SECTOR; i++) sector(i, magic === "NCA2" ? 0 : i);
  return out;
}

/** Decrypts the 0xC00 NCA header. */
export const decryptHeader = (raw, headerKey) => xts(true, raw, headerKey);

/** The master key generation an NCA header uses: max(key generation old, key generation) - 1, 0 for 0. Pure. */
export function headerGeneration(header) {
  const byte = Math.max(header[0x206], header[0x220]);
  return byte ? byte - 1 : 0;
}

/** AES-128-CTR over `data` that starts at byte `at` of an NCA section with this key and upper counter half. */
export function ctr(key, upper, at, data) {
  const iv = Buffer.alloc(16);
  upper.copy(iv, 0);
  iv.writeBigUInt64BE(BigInt(Math.floor(at / 16)), 8);
  const c = crypto.createCipheriv("aes-128-ctr", key, iv);
  // A start inside a 16-byte block: skip that many keystream bytes first.
  const skip = at % 16;
  const out = Buffer.concat([c.update(Buffer.concat([Buffer.alloc(skip), data])), c.final()]);
  return out.subarray(skip);
}
