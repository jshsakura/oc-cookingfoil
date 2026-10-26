/**
 * A homebrew .nro with the icon an admin uploaded in place of its own, so the
 * app on the card and its HOME-menu shortcut show the same picture.
 *
 * The asset section (meta/extract-providers/nro.js) is written again as
 * header, icon, NACP, RomFS; the executable before it is untouched. Copies are
 * kept per app under <data dir>/homebrew/nro-icon/, named by the original's
 * sha256 and the icon's version, with their own size and sha256 beside them,
 * and the app's older copies go when a new one is made.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import sharp from "sharp";

const ICON_MAX = 0x20000;

const NRO_MAGIC = Buffer.from("NRO0");
const ASET_MAGIC = Buffer.from("ASET");
const ASET_HEADER = 0x38;
// Homebrew .nro files are a few MB; a bigger one is left as it is rather than read into memory.
const MAX_NRO_BYTES = 128 * 1024 * 1024;

export const copyDir = () => path.join(dataDir, "homebrew", "nro-icon");

/**
 * The .nro bytes with `icon` (a JPEG) as its asset icon, or null when `nro`
 * has no asset section to write it into. Pure.
 */
export function replaceIcon(nro, icon) {
  if (nro.length < 0x40 || !nro.subarray(0x10, 0x14).equals(NRO_MAGIC)) return null;
  const nroSize = nro.readUInt32LE(0x18);
  if (nro.length < nroSize + ASET_HEADER || !nro.subarray(nroSize, nroSize + 4).equals(ASET_MAGIC)) return null;
  const head = nro.subarray(nroSize, nroSize + ASET_HEADER);
  const part = (at) => {
    const off = Number(head.readBigUInt64LE(at));
    const size = Number(head.readBigUInt64LE(at + 8));
    if (!size) return Buffer.alloc(0);
    if (nroSize + off + size > nro.length) throw new Error("asset section runs past the file");
    return nro.subarray(nroSize + off, nroSize + off + size);
  };
  const nacp = part(0x18);
  const romfs = part(0x28);
  const out = Buffer.from(head);
  let at = ASET_HEADER;
  for (const [field, buf] of [[0x08, icon], [0x18, nacp], [0x28, romfs]]) {
    out.writeBigUInt64LE(BigInt(buf.length ? at : 0), field);
    out.writeBigUInt64LE(BigInt(buf.length), field + 8);
    at += buf.length;
  }
  return Buffer.concat([nro.subarray(0, nroSize), out, icon, nacp, romfs]);
}

const copyName = (id, srcSha, version) => `${id}-${String(srcSha).slice(0, 16)}-${version}`;

/** The copy made earlier: { path, size, sha256 }, or null. Never reads the .nro. */
export function cachedCopy(id, srcSha, version) {
  if (!srcSha || !version) return null;
  const base = path.join(copyDir(), copyName(id, srcSha, version));
  try {
    const info = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"));
    if (fs.statSync(`${base}.nro`).size !== info.size) return null;
    return { path: `${base}.nro`, size: info.size, sha256: info.sha256 };
  } catch {
    return null;
  }
}

const making = new Map();

/** Makes (or finds) the copy of `srcPath` with the icon at `iconPath`. Null when the file can't take one. */
export function ensureCopy(id, srcPath, srcSha, iconPath, version) {
  const have = cachedCopy(id, srcSha, version);
  if (have) return Promise.resolve(have);
  if (!srcPath || !srcSha || !iconPath || !version) return Promise.resolve(null);
  const name = copyName(id, srcSha, version);
  if (!making.has(name)) {
    making.set(name, make(id, name, srcPath, iconPath).finally(() => making.delete(name)));
  }
  return making.get(name);
}

async function make(id, name, srcPath, iconPath) {
  const st = await fsp.stat(srcPath);
  if (st.size > MAX_NRO_BYTES) return null;
  const patched = replaceIcon(await fsp.readFile(srcPath), await iconJpeg(iconPath));
  if (!patched) return null;
  const dir = copyDir();
  await fsp.mkdir(dir, { recursive: true });
  const base = path.join(dir, name);
  const info = { size: patched.length, sha256: crypto.createHash("sha256").update(patched).digest("hex") };
  await fsp.writeFile(`${base}.nro.tmp`, patched);
  await fsp.rename(`${base}.nro.tmp`, `${base}.nro`);
  await fsp.writeFile(`${base}.json`, JSON.stringify(info));
  await dropOlder(id, name);
  return { path: `${base}.nro`, ...info };
}

/** Removes the app's copies other than `keep` (another original or icon), or all of them. */
export async function dropOlder(id, keep = null) {
  const prefix = `${id}-`;
  for (const f of await fsp.readdir(copyDir()).catch(() => [])) {
    if (f.startsWith(prefix) && !f.startsWith(`${keep}.`)) await fsp.rm(path.join(copyDir(), f), { force: true });
  }
}

/** The 256-px icon as a baseline JPEG without metadata, as the HOME menu wants it. */
export async function iconJpeg(src) {
  for (const quality of [90, 80, 70]) {
    const buf = await sharp(src, { failOn: "none" })
      .resize(256, 256, { fit: "cover" })
      .flatten({ background: "#000000" })
      .jpeg({ quality, progressive: false, mozjpeg: false, chromaSubsampling: "4:2:0" })
      .toBuffer();
    if (buf.length < ICON_MAX) return buf;
  }
  throw new Error("icon too large");
}
