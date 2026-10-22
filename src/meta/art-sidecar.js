/**
 * Pictures a media folder carries itself, so the folder reads at a glance on a
 * PC, keeps its pictures when it is moved off this server, and a picture changed
 * there by hand is the one served:
 *
 *   icon.webp  banner.webp  screenshot-01.webp … screenshot-99.webp
 *
 * at the folder's root. The files are the truth: what is there and its version
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
import sharp from "sharp";

const NAME_RE = /^(icon|banner|screenshot-(\d{2}))\.(webp|jpe?g|png)$/i;
export const MAX_SHOTS = 8;

/** Whether `rel`, a path relative to an item's folder, is one of its pictures (only at the root). Pure. */
export function isArtSidecar(rel) {
  const m = NAME_RE.exec(rel);
  return Boolean(m) && m[2] !== "00";
}

/** The file name (without extension) of a part: "icon", "banner" or "screenshot-NN" for screenshot n. Pure. */
export const slotName = (part, n = null) => (part === "shot" ? `screenshot-${String(n).padStart(2, "0")}` : part);

// A file this young may still be being copied in: it is shown, but not turned into .webp yet.
const SETTLE_MS = 5000;

const versionOf = (st) => `${Math.trunc(st.mtimeMs).toString(36)}${st.size.toString(36)}`;

/**
 * Every picture file in `dir`, by slot: Map slot → [{ file, slot, ext, mtimeMs, size }]
 * newest first. `ignore` holds names that belong to the item itself (a release's own icon.jpg).
 */
function filesBySlot(dir, ignore) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return new Map();
    throw err;
  }
  const out = new Map();
  for (const name of names) {
    const m = NAME_RE.exec(name);
    if (!m || m[2] === "00" || ignore?.has(name)) continue;
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

/**
 * What `dir` holds: { icon, banner, shots, untidy }, each picture { file, slot, ext, version }
 * or null, `shots` in their numbers' order (at most MAX_SHOTS). `untidy` is true when
 * normalize() has work to do: a picture that is not .webp, or a slot with more than one file.
 */
export function read(dir, { ignore = null } = {}) {
  const bySlot = filesBySlot(dir, ignore);
  const pick = (slot) => bySlot.get(slot)?.[0] ?? null;
  const shots = [...bySlot.keys()].filter((s) => s.startsWith("screenshot-")).sort().slice(0, MAX_SHOTS).map(pick);
  const untidy = [...bySlot.values()].some((list) => list.length > 1 || list[0].ext !== "webp");
  return { icon: pick("icon"), banner: pick("banner"), shots, untidy };
}

/** One version for a set of screenshots: changes when any of them does. Pure. */
export const shotsVersion = (shots) =>
  shots.length ? crypto.createHash("sha1").update(shots.map((s) => `${s.slot}:${s.version}`).join("|")).digest("base64url").slice(0, 12) : null;

function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** Removes every file of `slot` in `dir` but `keep`. */
function clearSlot(dir, slot, keep = null, ignore = null) {
  for (const f of filesBySlot(dir, ignore).get(slot) ?? []) if (f.file !== keep) fs.rmSync(f.file, { force: true });
}

/** Writes `webp` as `slot` in `dir`, the slot's other files removed. Returns the file. */
export function write(dir, slot, webp, { ignore = null } = {}) {
  const file = path.join(dir, `${slot}.webp`);
  writeAtomic(file, webp);
  clearSlot(dir, slot, file, ignore);
  return file;
}

/** Removes `slot` from `dir`, in every format. */
export const remove = (dir, slot, { ignore = null } = {}) => clearSlot(dir, slot, null, ignore);

/** Picture bytes as a .webp no larger than w × h, upright, without metadata. */
export async function toWebp(raw, w, h) {
  return sharp(raw, { failOn: "none", limitInputPixels: 50e6 })
    .rotate()
    .resize({ width: w, height: h, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, effort: 5 })
    .toBuffer();
}

/**
 * Leaves one .webp per slot in `dir`: the file each slot shows, turned into
 * .webp when it is not one (no larger than `sizeOf(slot)` = [w, h]), the rest
 * removed. A picture that cannot be read is left where it is, and a slot with a
 * file changed in the last few seconds waits for a later call. Returns how many slots changed.
 */
export async function normalize(dir, sizeOf, { ignore = null, onError = () => {}, now = Date.now() } = {}) {
  let changed = 0;
  for (const [slot, list] of filesBySlot(dir, ignore)) {
    const [newest] = list;
    if (list.length === 1 && newest.ext === "webp") continue;
    if (now - newest.mtimeMs < SETTLE_MS) continue;
    try {
      if (newest.ext === "webp") clearSlot(dir, slot, newest.file, ignore);
      else {
        const [w, h] = sizeOf(slot);
        write(dir, slot, await toWebp(fs.readFileSync(newest.file), w, h), { ignore });
      }
      changed++;
    } catch (err) {
      onError(slot, err);
    }
  }
  return changed;
}

/** Renames the screenshots in `dir` to screenshot-01 … in their order, after one was removed. */
export function renumberShots(dir, { ignore = null, onMove = () => {} } = {}) {
  const { shots } = read(dir, { ignore });
  shots.forEach((s, i) => {
    const to = slotName("shot", i + 1);
    if (s.slot === to) return;
    const file = path.join(dir, `${to}.${s.ext}`);
    fs.renameSync(s.file, file);
    onMove(s.slot, to);
  });
}

/**
 * Moves `from` (a file) into `dir` as `slot` unless the folder already has that
 * slot, which wins: the file there is the truth. `from` is gone either way.
 * Works across disks. Returns whether it moved.
 */
export function adopt(from, dir, slot, { ignore = null } = {}) {
  const has = filesBySlot(dir, ignore).has(slot);
  if (!has) {
    const to = path.join(dir, `${slot}${path.extname(from).toLowerCase()}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.renameSync(from, to);
      return true;
    } catch (err) {
      if (err.code !== "EXDEV") throw err;
      fs.copyFileSync(from, `${to}.${process.pid}.tmp`);
      fs.renameSync(`${to}.${process.pid}.tmp`, to);
    }
  }
  fs.rmSync(from, { force: true });
  return !has;
}
