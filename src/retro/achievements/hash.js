/**
 * Which RetroAchievements console each retro system is, and the hash RetroArch
 * sends for a ROM (rcheevos src/hash/rc_hash.c and rc_hash_rom.c): an MD5 of
 * the ROM data with a copier header left out, of the N64 ROM in big-endian
 * order, or of an arcade set's file name. Disc systems and the DS hash parts
 * of the disc or cartridge; those games are matched by title only.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { largestEntry } from "../../helpers/zip-read.js";

/** RetroAchievements console ids (rcheevos include/rc_consoles.h) by retro system id. */
export const CONSOLES = {
  md: 1, n64: 2, snes: 3, gb: 4, gba: 5, gbc: 6, nes: 7, pce: 8, segacd: 9, "32x": 10, sms: 11,
  ps1: 12, lynx: 13, ngp: 14, gg: 15, nds: 18, videopac: 23, a2600: 25, arcade: 27, vb: 28,
  msx: 29, c64: 30, sg: 33, amstrad: 37, saturn: 39, psp: 41, col: 44, a7800: 51, ws: 53,
  neocd: 56, zxs: 59, wsv: 63, pcecd: 76,
};

// RetroArch hashes at most this much of a ROM.
const MAX_BYTES = 64 * 1024 * 1024;

const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");
const startsWith = (buf, text, at = 0) => buf.length > at + text.length && buf.toString("latin1", at, at + text.length) === text;

function n64BigEndian(buf) {
  const out = Buffer.from(buf);
  if (buf[0] === 0x37) for (let i = 0; i + 1 < out.length; i += 2) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  else if (buf[0] === 0x40) for (let i = 0; i + 3 < out.length; i += 4) [out[i], out[i + 1], out[i + 2], out[i + 3]] = [out[i + 3], out[i + 2], out[i + 1], out[i]];
  return out;
}

/** How each content-hashed system turns ROM bytes into what is hashed. Pure. */
const CONTENT = {
  nes: (b) => (b.length > 16 && (startsWith(b, "NES\x1a") || startsWith(b, "FDS\x1a")) ? b.subarray(16) : b),
  snes: (b) => (b.length % 0x2000 === 512 ? b.subarray(512) : b),
  pce: (b) => (b.length & 512 ? b.subarray(512) : b),
  a7800: (b) => (b.length > 128 && startsWith(b, "ATARI7800", 1) ? b.subarray(128) : b),
  lynx: (b) => (b.length > 64 && startsWith(b, "LYNX\0") ? b.subarray(64) : b),
  n64: (b) => ([0x80, 0x37, 0x40, 0xe8, 0x22].includes(b[0]) ? n64BigEndian(b) : null),
};
for (const id of ["gb", "gbc", "gba", "md", "sms", "gg", "32x", "sg", "a2600", "col", "videopac", "ngp", "ws", "wsv", "vb", "msx", "zxs", "amstrad", "c64"]) {
  CONTENT[id] = (b) => b;
}

/** The hash RetroArch computes for `bytes` of a ROM on `system`, or null where it hashes something else. Pure. */
export function hashBytes(system, bytes) {
  const pick = CONTENT[system];
  const data = pick ? pick(bytes) : null;
  return data ? md5(data.subarray(0, MAX_BYTES)) : null;
}

/** An arcade set's hash: its file name without the extension. Pure. */
export const arcadeHash = (file) => md5(path.basename(file, path.extname(file)));

/** Whether a game on `system` gets a hash at all. Pure. */
export const hashable = (system, abs) => Boolean(abs) && (system === "arcade" || (Boolean(CONTENT[system]) && !/\.7z$/i.test(abs)));

/** The hash RetroArch sends for a catalog game, or null when it is matched by title only. */
export async function romHash(game) {
  if (!hashable(game.system, game.abs)) return null;
  if (game.system === "arcade") return arcadeHash(game.abs);
  if (/\.zip$/i.test(game.abs)) {
    const inner = await largestEntry(game.abs, { maxBytes: MAX_BYTES });
    return inner ? hashBytes(game.system, inner.data) : null;
  }
  const stat = await fs.stat(game.abs);
  if (stat.size > MAX_BYTES) return null;
  return hashBytes(game.system, await fs.readFile(game.abs));
}
