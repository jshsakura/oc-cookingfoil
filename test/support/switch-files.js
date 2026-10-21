// Builders for tiny fake Switch containers (PFS0, HFS0, XCI, cnmt) used by the
// file check tests.
import crypto from "node:crypto";

const sha = (buf) => crypto.createHash("sha256").update(buf).digest();

function stringTable(names) {
  const offsets = [];
  const parts = [];
  let at = 0;
  for (const n of names) {
    offsets.push(at);
    const b = Buffer.from(`${n}\0`, "utf8");
    parts.push(b);
    at += b.length;
  }
  const table = Buffer.concat(parts);
  const padded = Buffer.alloc(Math.ceil(table.length / 0x10) * 0x10 || 0x10);
  table.copy(padded);
  return { offsets, table: padded };
}

/** A PFS0 (NSP/NSZ) holding `files` [{ name, data }]. */
export function buildPfs0(files) {
  const { offsets, table } = stringTable(files.map((f) => f.name));
  const head = Buffer.alloc(0x10 + files.length * 0x18);
  head.write("PFS0", 0, "ascii");
  head.writeUInt32LE(files.length, 4);
  head.writeUInt32LE(table.length, 8);
  let at = 0;
  files.forEach((f, i) => {
    const e = 0x10 + i * 0x18;
    head.writeBigUInt64LE(BigInt(at), e);
    head.writeBigUInt64LE(BigInt(f.data.length), e + 8);
    head.writeUInt32LE(offsets[i], e + 16);
    at += f.data.length;
  });
  return Buffer.concat([head, table, ...files.map((f) => f.data)]);
}

/** An HFS0 holding `files` [{ name, data, hashedSize? }]. */
export function buildHfs0(files) {
  const { offsets, table } = stringTable(files.map((f) => f.name));
  const head = Buffer.alloc(0x10 + files.length * 0x40);
  head.write("HFS0", 0, "ascii");
  head.writeUInt32LE(files.length, 4);
  head.writeUInt32LE(table.length, 8);
  let at = 0;
  files.forEach((f, i) => {
    const e = 0x10 + i * 0x40;
    head.writeBigUInt64LE(BigInt(at), e);
    head.writeBigUInt64LE(BigInt(f.data.length), e + 8);
    head.writeUInt32LE(offsets[i], e + 0x10);
    head.writeUInt32LE(f.hashedSize ?? Math.min(0x200, f.data.length), e + 0x14);
    sha(f.data.subarray(0, f.hashedSize ?? 0x200)).copy(head, e + 0x20);
    at += f.data.length;
  });
  return Buffer.concat([head, table, ...files.map((f) => f.data)]);
}

/** An XCI whose secure partition holds `files` (offsets are relative to the header, wherever it sits). */
export function buildXci(files) {
  const secure = buildHfs0(files);
  const update = buildHfs0([]);
  const root = buildHfs0([{ name: "update", data: update }, { name: "secure", data: secure }]);
  const header = Buffer.alloc(0x200);
  header.write("HEAD", 0x100, "ascii");
  header.writeBigUInt64LE(BigInt(header.length), 0x130);
  header.writeBigUInt64LE(BigInt(0x200), 0x138);
  return Buffer.concat([header, root]);
}

/** A .cnmt with content records [{ ncaId, data | sha256+size, type }]. */
export function buildCnmt(records) {
  const buf = Buffer.alloc(0x20 + records.length * 0x38);
  buf.writeBigUInt64LE(0x0100000000010000n, 0);
  buf.writeUInt8(0x80, 0x0c);
  buf.writeUInt16LE(0, 0x0e);
  buf.writeUInt16LE(records.length, 0x10);
  records.forEach((r, i) => {
    const off = 0x20 + i * 0x38;
    (r.sha256 ? Buffer.from(r.sha256, "hex") : sha(r.data)).copy(buf, off);
    Buffer.from(r.ncaId, "hex").copy(buf, off + 0x20);
    buf.writeUIntLE(r.size ?? r.data.length, off + 0x30, 6);
    buf.writeUInt8(r.type ?? 1, off + 0x36);
  });
  return buf;
}

/** An NCA-shaped blob: 0xC00 header bytes (with `mark` written at 0x200) and some body. */
export function fakeNca(mark = "GOOD", body = 0x400) {
  const buf = Buffer.alloc(0xC00 + body, 0x11);
  buf.write(mark, 0x200, "ascii");
  return buf;
}

const cipher = (algo, key, iv, data) => {
  const c = crypto.createCipheriv(algo, key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
};

/**
 * A meta NCA encrypted the way a console's is, holding `cnmt`: header in
 * AES-XTS with `headerKey`, the PFS0 in AES-CTR under a key sealed with
 * `keyAreaKey` (master key revision `generation - 1`, 0 meaning revision 0).
 */
export function buildMetaNca(cnmt, { headerKey, keyAreaKey, generation = 0, name = "Application_0100000000010000.cnmt" }) {
  const ctrKey = crypto.randomBytes(16);
  const upper = crypto.randomBytes(8);
  const sectionAt = 0xc00;
  const hashTable = Buffer.alloc(0x200, 0x22);
  const pfs0 = buildPfs0([{ name, data: cnmt }]);
  const plain = Buffer.concat([hashTable, pfs0, Buffer.alloc((0x200 - ((hashTable.length + pfs0.length) % 0x200)) % 0x200)]);
  const header = Buffer.alloc(0xc00);
  header.write("NCA3", 0x200, "ascii");
  header[0x205] = 1;
  header[0x220] = generation;
  header.writeUInt32LE(sectionAt / 0x200, 0x240);
  header.writeUInt32LE((sectionAt + plain.length) / 0x200, 0x244);
  cipher("aes-128-ecb", keyAreaKey, null, ctrKey).copy(header, 0x320);
  const fsh = header.subarray(0x400, 0x600);
  fsh[0x02] = 1;
  fsh[0x03] = 2;
  fsh[0x04] = 3;
  fsh.writeUInt32LE(2, 0x08 + 0x24);
  fsh.writeBigUInt64LE(0n, 0x08 + 0x28);
  fsh.writeBigUInt64LE(BigInt(hashTable.length), 0x08 + 0x30);
  fsh.writeBigUInt64LE(BigInt(hashTable.length), 0x08 + 0x38);
  fsh.writeBigUInt64LE(BigInt(pfs0.length), 0x08 + 0x40);
  Buffer.from(upper).reverse().copy(fsh, 0x140);
  const sealed = Buffer.alloc(0xc00);
  for (let i = 0; i < 6; i++) {
    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(i), 8);
    cipher("aes-128-xts", headerKey, iv, header.subarray(i * 0x200, (i + 1) * 0x200)).copy(sealed, i * 0x200);
  }
  const iv = Buffer.alloc(16);
  upper.copy(iv, 0);
  iv.writeBigUInt64BE(BigInt(sectionAt / 16), 8);
  return Buffer.concat([sealed, cipher("aes-128-ctr", ctrKey, iv, plain)]);
}
