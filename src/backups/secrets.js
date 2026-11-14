/**
 * A Vita's secret files (work.bin, .rif, license.db) at rest: each sealed on its own (security/secret-box.js),
 * bound to its account, platform, unit, version and path, under a name made from its path, never from what is
 * in it. Only that account's Vita consoles are given one back (routes/backups.js); everywhere else they are a
 * count.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { sealBackupSecret, openBackupSecret, SecretLostError } from "../security/secret-box.js";
import * as store from "./store.js";

export { SecretLostError };

/** Where a secret belongs, as the sealing binds it. */
export const secretPlace = (accountId, platform, key, version, file) => [accountId, platform, key, String(version), file];

// A secret is sealed with the CRC-32 of its plain bytes in front, under the same place with this tag added, so
// the CRC a zip needs is never written anywhere outside the seal. A secret sealed before CRCs were opens under
// the place alone and is sealed again with its CRC the first time one is asked for.
const WITH_CRC = "with-crc32";

/** `plain` sealed for `place`, its CRC-32 inside the seal. */
export function sealSecret(plain, place) {
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(plain));
  const inner = Buffer.concat([crc, plain]);
  try {
    return sealBackupSecret(inner, [...place, WITH_CRC]);
  } finally {
    inner.fill(0);
  }
}

/** { plain, crc } of a sealed secret; crc null for one sealed before CRCs were. */
function openSecret(sealed, place) {
  let inner;
  try {
    inner = openBackupSecret(sealed, [...place, WITH_CRC]);
  } catch (err) {
    if (!(err instanceof SecretLostError)) throw err;
    return { plain: openBackupSecret(sealed, place), crc: null };
  }
  const out = { plain: Buffer.from(inner.subarray(4)), crc: inner.readUInt32BE(0) };
  inner.fill(0);
  return out;
}

export const secretName = (file) => `${crypto.createHash("sha256").update(`secret path\0${file}`).digest("hex").slice(0, 32)}.sealed`;

const sealedPath = (accountId, platform, key, version, file) => path.join(store.secretDir(accountId, platform, key, version), secretName(file));

async function readSealed(file) {
  return fsp.readFile(file).catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
}

/** The plain bytes of one secret of a version, or null when that version has no such secret. */
export async function readSecret(accountId, platform, key, version, file) {
  const sealed = await readSealed(sealedPath(accountId, platform, key, version, file));
  return sealed ? openSecret(sealed, secretPlace(accountId, platform, key, version, file)).plain : null;
}

/** The CRC-32 of one secret's plain bytes, or null when that version has no such secret. */
export async function secretCrc(accountId, platform, key, version, file) {
  const at = sealedPath(accountId, platform, key, version, file);
  const sealed = await readSealed(at);
  if (!sealed) return null;
  const place = secretPlace(accountId, platform, key, version, file);
  const { plain, crc } = openSecret(sealed, place);
  try {
    if (crc !== null) return crc;
    const resealed = sealSecret(plain, place);
    await fsp.writeFile(`${at}.tmp`, resealed);
    await fsp.rename(`${at}.tmp`, at);
    return zlib.crc32(plain);
  } finally {
    plain.fill(0);
  }
}
