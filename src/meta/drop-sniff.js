/**
 * What a drop box file's own bytes say its console is, for the files whose extension
 * does not: a zip by the ROMs inside it or by its arcade set name, a disc image by its
 * boot header, a .md or .bin by the Mega Drive header. Only a file's head or a zip's
 * central directory is read.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { zipDirectory } from "../helpers/zip-read.js";
import { setInfo } from "../retro/arcade.js";
import { systemOfExtension } from "../retro/systems.js";

const RAW = 2352;
const COOKED = 2048;
// The volume descriptor sits in sector 16; its system name ends within 40 bytes of it.
const HEAD = 16 * RAW + 24 + 40;
const HEADED = new Set([".md", ".bin", ".iso", ".img"]);
// What a zip may carry beside its ROM without making it something else.
const DOCS = new Set([".txt", ".nfo", ".diz", ".pdf", ".jpg", ".png", ".md", ".htm", ".html"]);

/** The console a disc or cartridge image's first bytes name, or null. Pure. */
export function systemOfHead(buf) {
  const text = buf.toString("latin1");
  for (const at of [0, 16]) {
    if (text.startsWith("SEGA SEGASATURN", at)) return "saturn";
    if (text.startsWith("SEGADISCSYSTEM", at)) return "segacd";
  }
  if (text.startsWith("SEGA", 0x100)) return "md";
  for (const [at, raw] of [[16 * COOKED, false], [16 * RAW + 16, true], [16 * RAW + 24, true]]) {
    if (!text.startsWith("\x01CD001", at)) continue;
    const name = text.slice(at + 8, at + 40).trim();
    // A cooked PLAYSTATION image is as likely a PS2 DVD, which no core here plays.
    if (name === "PLAYSTATION" && raw) return "ps1";
    if (name === "PSP GAME") return "psp";
  }
  return null;
}

/**
 * The console of a zip from its entry names: the one console its ROMs all name when
 * nothing but notes sits beside them, else the arcade set its name is, else null. Pure.
 */
export function systemOfZip(stem, names, systems) {
  const files = names.filter((n) => !n.endsWith("/")).map((n) => path.posix.extname(n).toLowerCase());
  const roms = files.filter((e) => !DOCS.has(e));
  const named = new Set(roms.map((e) => systemOfExtension(e, systems)));
  if (roms.length && named.size === 1 && !named.has(null)) return [...named][0];
  return systems.arcade && setInfo(stem) ? "arcade" : null;
}

async function head(abs) {
  const fh = await fs.open(abs, "r");
  try {
    const buf = Buffer.alloc(HEAD);
    const { bytesRead } = await fh.read(buf, 0, HEAD, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * rel → console for the `files` ([{ rel, abs }]) whose bytes name one. A .cue is read
 * by the first file it names (`refs`, rel → rels), which must be among `files`.
 */
export async function sniffSystems(files, refs, systems) {
  const absOf = new Map(files.map((f) => [f.rel, f.abs]));
  const out = new Map();
  for (const f of files) {
    const ext = path.posix.extname(f.rel).toLowerCase();
    let system = null;
    if (ext === ".zip") {
      const names = (await zipDirectory(f.abs).catch(() => [])).map((e) => e.name);
      system = systemOfZip(path.posix.basename(f.rel, ext), names, systems);
    } else if (HEADED.has(ext) || ext === ".cue") {
      const abs = ext === ".cue" ? absOf.get(refs.get(f.rel)?.[0]) : f.abs;
      system = abs ? systemOfHead(await head(abs).catch(() => Buffer.alloc(0))) : null;
    }
    if (system && systems[system]) out.set(f.rel, system);
  }
  return out;
}
