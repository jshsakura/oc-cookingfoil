/**
 * Pictures a media folder carries itself, so the folder reads at a glance on a
 * PC, keeps its pictures when it is moved off this server, and a picture changed
 * there by hand is the one served:
 *
 *   <item folder>/metadata/icon.webp  banner.webp  screenshot-01.webp … screenshot-99.webp
 *
 * One metadata/ folder per item, never installed or downloaded with it, so it is
 * removed in one go and never mixed with the item's own files. Inside it the
 * files are the truth: what is there and its version
 * come from the disk, never from a record. The server writes .webp; a .jpg,
 * .jpeg or .png of a slot's name put there by hand is read too and turned into
 * the slot's .webp by normalize(), which leaves one file per slot.
 *
 * Which file of a slot shows: one put there by hand (not .webp, as the server
 * writes only .webp) over the server's, then the newest. A copy keeps the date of
 * the file it came from, so the date alone would let an old picture lose.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { shrink, sidecarSpec, writeAtomic } from "./art-ingest.js";
import debug from "../debug.js";
import { discard } from "../library/trash-service.js";

export const META_DIR = "metadata";
const NAME_RE = /^(icon|banner|screenshot-(\d{2}))\.(webp|jpe?g|png)$/i;
// A picture being written, cleared when left behind.
const TEMP_RE = /^\.(icon|banner|screenshot-\d{2})\.(webp|jpe?g|png)\.\d+\.tmp$/i;
const STALE_TEMP_MS = 10 * 60_000;
export const MAX_SHOTS = 8;

/** Whether `rel`, a "/"-separated path relative to an item's folder, is in its metadata folder. Pure. */
export const isMetadata = (rel) => rel.split("/")[0].toLowerCase() === META_DIR;

/**
 * Whether `rel` can only be a file the server wrote into a metadata folder: a slot's .webp or one being
 * written. A .png, .jpg or .json there may be an app's own, so it never proves the folder is the server's. Pure.
 */
export function isOurMetadata(rel) {
  const [top, name, more] = rel.split("/");
  return top.toLowerCase() === META_DIR && more === undefined && ((NAME_RE.test(name) && /\.webp$/i.test(name)) || TEMP_RE.test(name));
}

/** The metadata folder of an item's folder. */
export const metadataDir = (folder) => path.join(folder, META_DIR);

/** The file name (without extension) of a part: "icon", "banner" or "screenshot-NN" for screenshot n. Pure. */
export const slotName = (part, n = null) => (part === "shot" ? `screenshot-${String(n).padStart(2, "0")}` : part);

// A file this young may still be being copied in: it is shown, but not turned into .webp yet.
const SETTLE_MS = 5000;

const versionOf = (st) => `${Math.trunc(st.mtimeMs).toString(36)}${st.size.toString(36)}`;

/** Every picture file in `dir`, by slot: Map slot → [{ file, slot, ext, mtimeMs, size }], the one shown first. */
function filesBySlot(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return new Map();
    throw err;
  }
  const out = new Map();
  for (const name of names) {
    if (TEMP_RE.test(name)) {
      clearStaleTemp(path.join(dir, name));
      continue;
    }
    const m = NAME_RE.exec(name);
    if (!m || m[2] === "00") continue;
    let st;
    try {
      st = fs.statSync(path.join(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const slot = m[1].toLowerCase();
    const list = out.get(slot) ?? [];
    list.push({ file: path.join(dir, name), slot, ext: m[3].toLowerCase(), mtimeMs: st.mtimeMs, size: st.size, version: versionOf(st) });
    out.set(slot, list);
  }
  const byHand = (f) => (f.ext === "webp" ? 0 : 1);
  for (const list of out.values()) list.sort((a, b) => byHand(b) - byHand(a) || b.mtimeMs - a.mtimeMs);
  return out;
}

function clearStaleTemp(file) {
  try {
    if (Date.now() - fs.statSync(file).mtimeMs > STALE_TEMP_MS) fs.rmSync(file, { force: true });
  } catch { /* gone already */ }
}

/**
 * What `dir` holds: { icon, banner, shots, untidy, signature }, each picture { file, slot, ext, version }
 * or null, `shots` in their numbers' order (at most MAX_SHOTS). `untidy` is true when
 * normalize() has work to do: a picture that is not .webp, or a slot with more than one file.
 */
export function read(dir) {
  const bySlot = filesBySlot(dir);
  const pick = (slot) => bySlot.get(slot)?.[0] ?? null;
  const shots = [...bySlot.keys()].filter((s) => s.startsWith("screenshot-")).sort().slice(0, MAX_SHOTS).map(pick);
  const untidy = [...bySlot.values()].some((list) => list.length > 1 || list[0].ext !== "webp");
  // Every picture file there, so a tidy that failed is not tried again until one changes.
  const signature = [...bySlot.values()].flat().map((f) => `${path.basename(f.file)}:${f.version}`).sort().join("|");
  return { icon: pick("icon"), banner: pick("banner"), shots, untidy, signature };
}

/** The version of one picture file, as read() gives it. */
export const versionOfFile = (file) => versionOf(fs.statSync(file));

/** One version for a set of screenshots: changes when any of them does. Pure. */
export const shotsVersion = (shots) =>
  shots.length ? crypto.createHash("sha1").update(shots.map((s) => `${s.slot}:${s.version}`).join("|")).digest("hex").slice(0, 12) : null;

const tempOf = (file) => path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);

/** Pictures a slot no longer shows go to the trash, never away: a person may have put them there. */
export async function toTrash(files, action) {
  if (files.length) await discard(files, { kind: "item-art", action, name: path.basename(files[0]) });
}

/** Moves every file of `slot` in `dir` but `keep` to the trash. */
async function clearSlot(dir, slot, keep = null, action = "art-replace") {
  await toTrash((filesBySlot(dir).get(slot) ?? []).filter((f) => f.file !== keep).map((f) => f.file), action);
}

/** Writes `webp` as `slot` in `dir`, the slot's other files moved to the trash. Returns the file. */
export async function write(dir, slot, webp) {
  const file = path.join(dir, `${slot}.webp`);
  writeAtomic(file, webp);
  // The new picture is in place and shown; a leftover of the slot that could not go is only noted.
  await clearSlot(dir, slot, file).catch((err) => debug.error("art: %s of %s: its old files stay: %s", slot, dir, err.message));
  return file;
}

/** Moves `slot` of `dir`, in every format, to the trash. */
export const remove = (dir, slot) => clearSlot(dir, slot, null, "art-remove");

/** Picture bytes as a .webp no larger than w × h, upright, without metadata. */
export function toWebp(raw, w, h) {
  return shrink(raw, sidecarSpec(w, h));
}

/**
 * Leaves one .webp per slot in `dir`: the file each slot shows, turned into
 * .webp when it is not one (no larger than `sizeOf(slot)` = [w, h]), the rest
 * removed. A picture that cannot be read is left where it is, and a slot with a
 * file changed in the last few seconds waits for a later call. Returns how many slots changed.
 */
export async function normalize(dir, sizeOf, { onError = () => {}, now = Date.now() } = {}) {
  let changed = 0;
  for (const [slot, list] of filesBySlot(dir)) {
    const [newest] = list;
    if (list.length === 1 && newest.ext === "webp") continue;
    if (now - newest.mtimeMs < SETTLE_MS) continue;
    try {
      if (newest.ext === "webp") await clearSlot(dir, slot, newest.file);
      else {
        const [w, h] = sizeOf(slot);
        await write(dir, slot, await toWebp(fs.readFileSync(newest.file), w, h));
      }
      changed++;
    } catch (err) {
      onError(slot, err);
    }
  }
  return changed;
}

/** Renames the screenshots in `dir` to screenshot-01 … in their order, after one was removed. */
export function renumberShots(dir, { onMove = () => {} } = {}) {
  const { shots } = read(dir);
  shots.forEach((s, i) => {
    const to = slotName("shot", i + 1);
    if (s.slot === to) return;
    fs.renameSync(s.file, path.join(dir, `${to}.${s.ext}`));
    onMove(s.slot, to);
  });
}

/**
 * Moves `from` (a file) into `dir` as `slot` unless the folder already has that
 * slot, which wins: the file there is the truth, and `from` stays where it is for
 * the caller to send to the trash. Works across disks. Returns whether it moved.
 */
export function adopt(from, dir, slot) {
  if (filesBySlot(dir).has(slot)) return false;
  const to = path.join(dir, `${slot}${path.extname(from).toLowerCase()}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    const tmp = tempOf(to);
    try {
      fs.copyFileSync(from, tmp);
      fs.renameSync(tmp, to);
    } catch (copyErr) {
      fs.rmSync(tmp, { force: true });
      throw copyErr;
    }
    fs.rmSync(from, { force: true });
  }
  return true;
}
