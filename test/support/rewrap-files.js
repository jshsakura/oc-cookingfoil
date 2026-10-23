// Synthetic NCAs, NCZs, tickets and keys for the rewrap tests: random keys, real
// crypto (AES-XTS headers, AES-ECB key areas and title keys, AES-CTR sections) and
// correct section hashes, so a lowered file can be checked the way a console reads it.
import crypto from "node:crypto";
import { buildPfs0 } from "./switch-files.js";
import { headerBytes, keyGenerationByte } from "../../src/meta/rewrap/generations.js";

const sha = (buf) => crypto.createHash("sha256").update(buf).digest();
const cipher = (algo, key, iv, data, decrypt = false) => {
  const c = decrypt ? crypto.createDecipheriv(algo, key, iv) : crypto.createCipheriv(algo, key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
};
export const ecb = (key, data, decrypt = false) => cipher("aes-128-ecb", key, null, data, decrypt);

/** Random keys for generations 0..`upTo`: { keys (name → hex, as prod-keys.js loadKeys), headerKey, kak[gen], kek[gen] }. */
export function makeKeys(upTo) {
  const headerKey = crypto.randomBytes(32);
  const kak = [];
  const kek = [];
  const keys = new Map([["header_key", headerKey.toString("hex")]]);
  for (let gen = 0; gen <= upTo; gen++) {
    kak[gen] = crypto.randomBytes(16);
    kek[gen] = crypto.randomBytes(16);
    const hex = gen.toString(16).padStart(2, "0");
    keys.set(`key_area_key_application_${hex}`, kak[gen].toString("hex"));
    keys.set(`titlekek_${hex}`, kek[gen].toString("hex"));
  }
  return { keys, headerKey, kak, kek };
}

/** Keys `k` with every generation above `gen` taken out. */
export function keysUpTo(k, gen) {
  const keys = new Map([...k.keys].filter(([name]) => {
    const m = /_([0-9a-f]{2})$/.exec(name);
    return !m || parseInt(m[1], 16) <= gen;
  }));
  return { ...k, keys };
}

function sealHeader(header, headerKey) {
  const out = Buffer.alloc(0xc00);
  for (let i = 0; i < 6; i++) {
    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(i), 8);
    cipher("aes-128-xts", headerKey, iv, header.subarray(i * 0x200, (i + 1) * 0x200)).copy(out, i * 0x200);
  }
  return out;
}

export function openHeader(raw, headerKey) {
  const out = Buffer.alloc(0xc00);
  for (let i = 0; i < 6; i++) {
    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(i), 8);
    cipher("aes-128-xts", headerKey, iv, raw.subarray(i * 0x200, (i + 1) * 0x200), true).copy(out, i * 0x200);
  }
  return out;
}

function plainHeader({ gen, contentType = 0, rightsId = null }) {
  const header = Buffer.alloc(0xc00);
  crypto.randomBytes(0x200).copy(header, 0); // the two RSA signatures
  header.write("NCA3", 0x200, "ascii");
  header[0x205] = contentType;
  const bytes = headerBytes(gen);
  header[0x206] = bytes.old;
  header[0x220] = bytes.current;
  if (rightsId) rightsId.copy(header, 0x230);
  return header;
}

/** A rights ID for title 0100ABCD00010000 at `gen`. */
export function rightsIdFor(gen) {
  const id = Buffer.alloc(16);
  id.writeBigUInt64BE(0x0100abcd00010000n, 0);
  id[15] = keyGenerationByte(gen);
  return id;
}

/**
 * A program NCA of generation `gen`: { nca, contentKeys } with `contentKeys`
 * (0x40) sealed in its key area, or a rights ID instead when `rightsId` is given.
 */
export function buildProgramNca(k, gen, { rightsId = null, body = 0x400 } = {}) {
  const header = plainHeader({ gen, rightsId });
  const contentKeys = crypto.randomBytes(0x40);
  if (!rightsId) ecb(k.kak[gen], contentKeys).copy(header, 0x300);
  return { nca: Buffer.concat([sealHeader(header, k.headerKey), crypto.randomBytes(body)]), contentKeys };
}

/** An NCZ: the NCA header area (0x4000) as it was, then the section table and "compressed" blocks. */
export function buildNcz(k, gen, opts) {
  const { nca, contentKeys } = buildProgramNca(k, gen, { ...opts, body: 0x4000 - 0xc00 });
  return { ncz: Buffer.concat([nca, Buffer.from("NCZSECTN"), crypto.randomBytes(0x200)]), contentKeys };
}

/** A cnmt of `type` (0x80 application, 0x81 patch) asking for `requiredSystemVersion`. */
export function buildCnmt({ type = 0x80, requiredSystemVersion }) {
  const buf = Buffer.alloc(0x20 + 0x10);
  buf.writeBigUInt64LE(0x0100abcd00010000n, 0);
  buf[0x0c] = type;
  buf.writeUInt16LE(0x10, 0x0e);
  buf.writeUInt32LE(requiredSystemVersion, 0x20 + 0x08);
  return buf;
}

/**
 * A meta NCA of generation `gen` holding `cnmt` in a hashed, AES-CTR PFS0
 * section with every hash right: { nca, ctrKey, upper }.
 */
export function buildMetaNca(k, gen, cnmt, { blockSize = 0x40 } = {}) {
  const pfs0 = buildPfs0([{ name: "Application_0100abcd00010000.cnmt", data: cnmt }]);
  const blocks = Math.ceil(pfs0.length / blockSize);
  const table = Buffer.concat(Array.from({ length: blocks }, (_, b) => sha(pfs0.subarray(b * blockSize, Math.min((b + 1) * blockSize, pfs0.length)))));
  const tableSize = table.length;
  const dataAt = Math.ceil(tableSize / 0x20) * 0x20;
  const section = Buffer.alloc(Math.ceil((dataAt + pfs0.length) / 0x200) * 0x200);
  table.copy(section, 0);
  pfs0.copy(section, dataAt);

  const header = plainHeader({ gen, contentType: 1 });
  const sectionAt = 0xc00;
  header.writeUInt32LE(sectionAt / 0x200, 0x240);
  header.writeUInt32LE((sectionAt + section.length) / 0x200, 0x244);
  const ctrKey = crypto.randomBytes(16);
  const keyArea = Buffer.concat([crypto.randomBytes(0x20), ctrKey, crypto.randomBytes(0x10)]);
  ecb(k.kak[gen], keyArea).copy(header, 0x300);
  const upper = crypto.randomBytes(8);
  const fsh = header.subarray(0x400, 0x600);
  fsh[0x02] = 1;
  fsh[0x03] = 2;
  fsh[0x04] = 3;
  sha(table).copy(fsh, 0x08);
  fsh.writeUInt32LE(blockSize, 0x28);
  fsh.writeUInt32LE(2, 0x2c);
  fsh.writeBigUInt64LE(0n, 0x30);
  fsh.writeBigUInt64LE(BigInt(tableSize), 0x38);
  fsh.writeBigUInt64LE(BigInt(dataAt), 0x40);
  fsh.writeBigUInt64LE(BigInt(pfs0.length), 0x48);
  Buffer.from(upper).reverse().copy(fsh, 0x140);
  sha(fsh).copy(header, 0x280);
  return { nca: Buffer.concat([sealHeader(header, k.headerKey), ctr(ctrKey, upper, sectionAt, section)]), ctrKey, upper };
}

/** AES-CTR at section offset `at` the way an NCA counts. */
export function ctr(key, upper, at, data) {
  const iv = Buffer.alloc(16);
  upper.copy(iv, 0);
  iv.writeBigUInt64BE(BigInt(at / 16), 8);
  return cipher("aes-128-ctr", key, iv, data);
}

/** A common RSA-2048 ticket for `rightsId` holding `titleKey` sealed with titlekek_{gen}. */
export function buildTicket(k, gen, rightsId, titleKey, { keyType = 0 } = {}) {
  const t = Buffer.alloc(0x2c0);
  t.writeUInt32LE(0x010004, 0);
  crypto.randomBytes(0x100).copy(t, 4);
  const body = 0x140;
  ecb(k.kek[gen], titleKey).copy(t, body + 0x40);
  t[body + 0x141] = keyType;
  t[body + 0x145] = keyGenerationByte(gen);
  rightsId.copy(t, body + 0x160);
  return t;
}

/** `buf` with `patches` ([{ offset, bytes }]) written in. */
export function applyPatches(buf, patches) {
  const out = Buffer.from(buf);
  for (const p of patches) p.bytes.copy(out, p.offset);
  return out;
}
