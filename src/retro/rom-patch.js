/**
 * A patch file (IPS, BPS, UPS, xdelta or PPF) applied to one retro ROM of the library, on the admin's
 * word for that game. Nothing here runs on its own.
 *
 *   1. The result is built first, in a dot file beside the ROM (the scanner skips dot files).
 *      A .zip ROM has its largest file patched and is zipped again, the other files kept.
 *   2. The first patch copies the original to <retro dir>/.cookingfoil-originals/<game id>/<file>,
 *      outside the trash, which empties itself. A later patch goes on top and keeps that copy.
 *   3. The result is renamed over the ROM: same name, so its art, bezel and id stay.
 *
 * BPS and UPS refuse a source whose size or CRC-32 is not the patch's own, and check the
 * BPS and UPS refuse a source whose size or CRC-32 is not the patch's own, and check the
 * result's; xdelta3 checks what its patch carries and exits non-zero otherwise. IPS and PPF
 * carry no whole-source checksum and are recorded as unverified (a PPF3's declared size is
 * still checked). A refusal leaves the ROM as it was. A cue sheet game takes its patch on
 * the first track it names, under that track's own name, so the cue keeps pointing at it.
 * restoreOriginal() moves the copy back over the ROM and forgets the patches.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { entryData, zipEntries } from "../helpers/zip-read.js";
import { zipStore } from "../helpers/zip-store.js";
import { RomPatchError } from "./patch-formats/error.js";
import { applyIps } from "./patch-formats/ips.js";
import { applyPpf } from "./patch-formats/ppf.js";
import { applyBps } from "./patch-formats/bps.js";
import { applyUps } from "./patch-formats/ups.js";
import { applyXdelta } from "./patch-formats/xdelta.js";
import { patchOf, setPatch } from "./rom-patch-records.js";
import { cueTrack } from "./rom-index.js";

export { RomPatchError };
export const ORIGINALS_DIR = ".cookingfoil-originals";
export const FORMATS = ["ips", "bps", "ups", "xdelta", "ppf"];
// A ROM, a zip or a patch read into memory is at most this big; xdelta on a plain file reads none.
const MEMORY_MAX = 512 * 1024 * 1024;
const GAME_ID_RE = /^[a-z0-9_.-]{1,64}-[0-9a-f]{10}$/i;
const MAGIC = [["ips", "PATCH"], ["bps", "BPS1"], ["ups", "UPS1"], ["xdelta", "\xd6\xc3\xc4"], ["ppf", "PPF\x00"]].map(([f, m]) => [f, Buffer.from(m, "latin1")]);
const IN_MEMORY = { ips: applyIps, bps: applyBps, ups: applyUps, ppf: applyPpf };

/** Whether `id` has the shape of a retro game id (catalog.js gameId). Pure. */
export const validGameId = (id) => GAME_ID_RE.test(String(id ?? ""));

/** The format a patch file's first bytes say it is, or null. Pure. */
export const patchFormat = (head) => MAGIC.find(([, m]) => head.subarray(0, m.length).equals(m))?.[0] ?? null;

/** Why a game cannot take a patch ("arcade" set, "multi-file" disc or folder game), or null. Pure.
 * A cue sheet names its first track beside it, so a disc game can take a patch on that track. */
export function unpatchable(g) {
  if (g.keepFileName) return "arcade";
  if (!g.abs) return "multi-file";
  if (g.extras?.length && path.extname(g.abs).toLowerCase() !== ".cue") return "multi-file";
  return null;
}

const inside = (root, abs) => path.resolve(abs).startsWith(path.resolve(root) + path.sep);
const exists = (abs) => fsp.lstat(abs).then(() => true, () => false);

const busy = new Set();
/** Runs `fn` while no other patch or restore of game `id` runs; a second one is refused. */
async function locked(id, fn) {
  if (busy.has(id)) throw new RomPatchError("busy", `game ${id} is being patched or restored`, 409);
  busy.add(id);
  try {
    return await fn();
  } finally {
    busy.delete(id);
  }
}

/** A file system refusal as the admin should read it. */
function writeError(err) {
  if (["EROFS", "EACCES", "EPERM"].includes(err.code)) return new RomPatchError("read-only", `cannot write the retro folder: ${err.code}`, 409);
  return err;
}

async function readCapped(abs) {
  if ((await fsp.stat(abs)).size > MEMORY_MAX) throw new RomPatchError("too-large", `${path.basename(abs)} is over ${MEMORY_MAX} bytes`, 413);
  return fsp.readFile(abs);
}

async function readHead(abs, n) {
  const fh = await fsp.open(abs, "r");
  try {
    const head = Buffer.alloc(n);
    const { bytesRead } = await fh.read(head, 0, n, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function writeSynced(abs, data) {
  const fh = await fsp.open(abs, "wx");
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** `source` (bytes) with the patch at `patchPath` applied. xdelta goes through two work files at `work`. */
async function patchBytes(format, source, patchPath, work, bin) {
  if (format !== "xdelta") return IN_MEMORY[format](source, await readCapped(patchPath));
  const [src, out] = [`${work}.src`, `${work}.out`];
  try {
    await writeSynced(src, source);
    await applyXdelta(src, patchPath, out, { bin });
    return await readCapped(out);
  } finally {
    await Promise.all([src, out].map((f) => fsp.rm(f, { force: true })));
  }
}

/** The zip at `abs` with its largest file patched, zipped again (deflated) with the rest as they were. */
async function patchZip(abs, format, patchPath, work, bin) {
  const file = await readCapped(abs);
  const entries = zipEntries(file).map((e) => ({ e, data: e.name.endsWith("/") ? Buffer.alloc(0) : entryData(file, e) }));
  const rom = entries.filter((x) => !x.e.name.endsWith("/")).sort((a, b) => b.e.size - a.e.size)[0];
  if (!rom || entries.some((x) => !x.data)) throw new RomPatchError("zip-unreadable", `${path.basename(abs)} is not a zip this server can read and write again`);
  const data = await patchBytes(format, rom.data, patchPath, work, bin);
  return zipStore(entries.map((x) => ({ name: x.e.name, data: x === rom ? data : x.data })), new Date(), { deflate: true });
}

/** Writes the patched ROM to `tmp`. */
async function buildResult(abs, format, patchPath, tmp, bin) {
  if (path.extname(abs).toLowerCase() === ".zip") return writeSynced(tmp, await patchZip(abs, format, patchPath, tmp, bin));
  if (format === "xdelta") return applyXdelta(abs, patchPath, tmp, { bin });
  return writeSynced(tmp, await patchBytes(format, await readCapped(abs), patchPath, tmp, bin));
}

/** Copies the original ROM to its backup place, whole or not at all. */
async function backUp(abs, backupAbs) {
  await fsp.mkdir(path.dirname(backupAbs), { recursive: true });
  const part = `${backupAbs}.part`;
  await fsp.copyFile(abs, part);
  await fsp.rename(part, backupAbs);
}

/** A patch file's name as it is kept: its base name, printable, at most 200 characters. Pure. */
const patchLabel = (name) => path.basename(String(name ?? "")).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200) || "patch";

/**
 * The file a patch goes on and its name: the first track a cue sheet names (the data track,
 * as rom-index reads it), or the game's own file. The track must sit beside the cue, inside
 * the roms folder; anything else is a multi-file game that takes no patch.
 */
async function patchTarget(dir, g) {
  if (path.extname(g.abs).toLowerCase() !== ".cue") return { abs: g.abs, file: g.file };
  const track = await cueTrack(g.abs);
  if (!track || !inside(path.join(dir, "roms"), track)) throw new RomPatchError("multi-file", `game ${g.id} names no track file beside its cue`);
  return { abs: track, file: path.basename(track) };
}

/**
 * Applies the patch file at `patchPath` (sent as `patchName`) to game `g` of the catalog of the
 * retro folder `dir`: for a cue sheet game, to its first track, under its own name, so the cue
 * keeps pointing at it. Returns the game's patch record (rom-patch-records.js). Throws a
 * RomPatchError, with the ROM untouched, when the game or the patch cannot be used.
 * `bin` names the xdelta3 program (tests).
 */
export async function applyRomPatch(dir, g, { patchPath, patchName, now = new Date(), bin } = {}) {
  const why = unpatchable(g);
  if (why) throw new RomPatchError(why, `game ${g.id} is not a single ROM file`);
  if (!inside(path.join(dir, "roms"), g.abs)) throw new RomPatchError("outside", `game ${g.id} is outside the roms folder`);
  return locked(g.id, async () => {
    const target = await patchTarget(dir, g);
    const record = patchOf(g.id);
    const backup = record?.backup ?? path.posix.join(ORIGINALS_DIR, g.id, target.file);
    const backupAbs = path.join(dir, backup);
    if (record && !(await exists(backupAbs))) throw new RomPatchError("backup-missing", `the original of ${g.id} is gone from ${backup}`, 409);
    const format = patchFormat(await readHead(patchPath, 8));
    if (!format) throw new RomPatchError("unknown-format", "the file is not an IPS, BPS, UPS, xdelta or PPF patch");
    const size = (await fsp.stat(target.abs)).size;
    const tmp = path.join(path.dirname(target.abs), `.${target.file}.${crypto.randomBytes(4).toString("hex")}.cf-patch`);
    try {
      await buildResult(target.abs, format, patchPath, tmp, bin);
      if (!record) await backUp(target.abs, backupAbs);
      await fsp.rename(tmp, target.abs);
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw writeError(err);
    }
    const next = {
      system: g.system,
      path: path.relative(dir, target.abs).split(path.sep).join("/"),
      file: target.file,
      backup,
      original: record?.original ?? { size },
      patches: [...(record?.patches ?? []), { name: patchLabel(patchName), format, verified: format !== "ips" && format !== "ppf", at: now.toISOString() }],
    };
    setPatch(g.id, next);
    return next;
  });
}

/** Moves the original of game `id` back over its ROM and forgets its patches: { id, path, file }. */
export async function restoreOriginal(dir, id) {
  if (!validGameId(id)) throw new RomPatchError("not-patched", `no patch record for ${id}`, 404);
  return locked(id, async () => {
    const record = patchOf(id);
    if (!record) throw new RomPatchError("not-patched", `no patch record for ${id}`, 404);
    const romAbs = path.join(dir, record.path);
    const backupAbs = path.join(dir, record.backup);
    if (!inside(path.join(dir, "roms"), romAbs) || !inside(path.join(dir, ORIGINALS_DIR), backupAbs)) {
      throw new RomPatchError("outside", `the patch record of ${id} points outside the retro folder`);
    }
    if (!fs.existsSync(backupAbs)) throw new RomPatchError("backup-missing", `the original of ${id} is gone from ${record.backup}`, 409);
    try {
      await fsp.mkdir(path.dirname(romAbs), { recursive: true });
      await fsp.rename(backupAbs, romAbs).catch(async (err) => {
        if (err.code !== "EXDEV") throw err;
        // The roms folder is another mount: copy beside the ROM, then swap.
        const tmp = path.join(path.dirname(romAbs), `.${record.file}.${crypto.randomBytes(4).toString("hex")}.cf-restore`);
        await fsp.copyFile(backupAbs, tmp);
        await fsp.rename(tmp, romAbs);
        await fsp.rm(backupAbs, { force: true });
      });
    } catch (err) {
      throw writeError(err);
    }
    await fsp.rm(path.join(dir, ORIGINALS_DIR, id), { recursive: true, force: true });
    setPatch(id, null);
    return { id, path: record.path, file: record.file };
  });
}
