/**
 * Moves that never replace what is already there, and the in-process locks
 * that keep two of the server's own moves from racing for one place.
 *
 * A POSIX rename silently replaces a file at its target, so "check the name is
 * free, then rename" loses a file whenever something takes the name in between.
 * Here the target is claimed in the same step that fills it:
 *
 *   a file     link(from, to) fails with EEXIST when `to` exists; the old name is
 *              then unlinked. On a filesystem without hard links the name is
 *              claimed with an exclusive create first and the rename lands on
 *              that empty claim, which nobody else will have taken.
 *   a folder   mkdir(to) claims the name (EEXIST when taken). Renaming a folder
 *              onto an empty folder is allowed, and onto a non-empty one fails,
 *              so a folder that filled up meanwhile is never replaced either.
 *
 * Across filesystems (EXDEV) the bytes are copied into a dot-named partial
 * beside the target, checked against the source (sizes, file count, and a hash
 * of the first and last MiB of every file), and only then moved into place with
 * the same no-replace step; the source goes last. A stop mid-copy leaves only
 * the dot-named partial, which no scanner reads and nothing trusts.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";

const NO_LINK = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK"]);
const EDGE_BYTES = 1024 * 1024;
export const PARTIAL_PREFIX = ".cookingfoil-partial-";

// ── locks ────────────────────────────────────────────────────────────
const chains = new Map();

function acquire(key) {
  const prev = chains.get(key) ?? Promise.resolve();
  let release;
  const held = new Promise((r) => { release = r; });
  const tail = prev.then(() => held);
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return prev.then(() => release);
}

/**
 * Runs `fn` holding every lock in `keys` (paths; taken in sorted order, so two
 * callers never wait on each other crosswise). Not reentrant: `fn` must not ask
 * for a key it already holds.
 */
export async function withLocks(keys, fn) {
  const sorted = [...new Set(keys.map((k) => path.resolve(k)))].sort();
  const releases = [];
  try {
    for (const k of sorted) releases.push(await acquire(k));
    return await fn();
  } finally {
    for (const r of releases.reverse()) r();
  }
}

// ── moving without replacing ─────────────────────────────────────────
const realIo = { link: (a, b) => fsp.link(a, b), rename: (a, b) => fsp.rename(a, b) };
let io = realIo;
/** Test-only: replace link and rename (null puts the real ones back). */
export function _setIo(next) {
  io = next ? { ...realIo, ...next } : realIo;
}

/** Drops the empty file this module made to claim `to`, if it is still that one. */
async function dropClaim(to, claim) {
  const now = await fsp.lstat(to).catch(() => null);
  if (now && now.ino === claim.ino && now.dev === claim.dev && now.size === 0) await fsp.unlink(to).catch(() => {});
}

async function moveFile(from, to) {
  try {
    await io.link(from, to);
  } catch (err) {
    if (err.code === "EEXIST") return false;
    if (!NO_LINK.has(err.code)) throw err;
    // No hard links here: claim the name with an exclusive create, then rename onto the claim.
    let claim;
    try {
      const fh = await fsp.open(to, "wx");
      claim = await fh.stat();
      await fh.close();
    } catch (e) {
      if (e.code === "EEXIST") return false;
      throw e;
    }
    try {
      await io.rename(from, to);
    } catch (e) {
      await dropClaim(to, claim);
      throw e;
    }
    return true;
  }
  await fsp.unlink(from);
  return true;
}

async function moveDir(from, to) {
  try {
    await fsp.mkdir(to);
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
  const claim = await fsp.lstat(to);
  try {
    await io.rename(from, to);
    return true;
  } catch (err) {
    const now = await fsp.lstat(to).catch(() => null);
    // rmdir only removes it while it is still empty: something written into it meanwhile stays.
    if (now && now.ino === claim.ino) await fsp.rmdir(to).catch(() => {});
    if (err.code === "ENOTEMPTY" || err.code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Moves `from` to `to` (parents made) unless something is at `to`: false then,
 * and `from` stays. A different filesystem throws EXDEV (moveAcross copies).
 */
export async function moveNoClobber(from, to) {
  const st = await fsp.lstat(from);
  await fsp.mkdir(path.dirname(to), { recursive: true });
  return st.isDirectory() ? moveDir(from, to) : moveFile(from, to);
}

// ── checked copies ───────────────────────────────────────────────────
async function edgeHash(file, size) {
  const h = crypto.createHash("sha256");
  const fh = await fsp.open(file, "r");
  try {
    const read = async (pos, len) => {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, pos);
      h.update(buf.subarray(0, bytesRead));
    };
    await read(0, Math.min(EDGE_BYTES, size));
    if (size > EDGE_BYTES) await read(Math.max(EDGE_BYTES, size - EDGE_BYTES), Math.min(EDGE_BYTES, size - EDGE_BYTES));
  } finally {
    await fh.close();
  }
  return h.digest("hex");
}

/**
 * What a checked copy compares: every regular file under `abs` (or `abs` itself)
 * as "rel\0size\0hash of its first and last MiB", sorted. Links are not followed.
 */
export async function fingerprint(abs) {
  const st = await fsp.lstat(abs);
  if (!st.isDirectory()) return st.isFile() ? [`\0${st.size}\0${await edgeHash(abs, st.size)}`] : [`\0link`];
  const out = [];
  for (const e of await fsp.readdir(abs, { withFileTypes: true, recursive: true })) {
    const full = path.join(e.parentPath ?? e.path, e.name);
    const rel = path.relative(abs, full).split(path.sep).join("/");
    if (e.isFile()) {
      const s = await fsp.lstat(full);
      out.push(`${rel}\0${s.size}\0${await edgeHash(full, s.size)}`);
    } else if (e.isSymbolicLink()) out.push(`${rel}\0link`);
  }
  return out.sort();
}

export class CopyMismatchError extends Error {
  constructor(name) {
    super(`복사본이 원본과 달라 옮기지 않았습니다: ${name}`);
    this.code = "ECOPYMISMATCH";
  }
}

/** A dot-named place beside `to` for a copy that is not checked yet. Pure. */
export const partialOf = (to) => path.join(path.dirname(to), `${PARTIAL_PREFIX}${crypto.randomBytes(5).toString("hex")}-${path.basename(to)}`.slice(0, 255));

/**
 * Copies `from` to the new path `part` and checks it against `from`; on any
 * difference the copy is removed and CopyMismatchError thrown.
 */
export async function copyChecked(from, part) {
  await fsp.mkdir(path.dirname(part), { recursive: true });
  try {
    await fsp.cp(from, part, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    const [a, b] = await Promise.all([fingerprint(from), fingerprint(part)]);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) throw new CopyMismatchError(path.basename(from));
  } catch (err) {
    await fsp.rm(part, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * moveNoClobber, and across filesystems a checked copy into a partial beside
 * `to` that is then moved into place without replacing anything; `from` is
 * removed only once the copy is in place. False when `to` is taken.
 */
export async function moveAcross(from, to) {
  try {
    return await moveNoClobber(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  const part = partialOf(to);
  await copyChecked(from, part);
  let placed = false;
  try {
    placed = await moveNoClobber(part, to);
  } finally {
    if (!placed) await fsp.rm(part, { recursive: true, force: true }).catch(() => {});
  }
  if (placed) await fsp.rm(from, { recursive: true, force: true });
  return placed;
}

/**
 * Whether `abs` would land inside `rootDir` once links are followed: the
 * deepest folder of it that exists, resolved, is inside the resolved root.
 */
export async function realInside(rootDir, abs) {
  const root = await fsp.realpath(rootDir).catch(() => path.resolve(rootDir));
  let dir = path.dirname(path.resolve(abs));
  for (;;) {
    const real = await fsp.realpath(dir).catch(() => null);
    if (real) {
      const rel = path.relative(root, real);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    }
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}
