/**
 * Adding and removing a RetroArch core by hand from the admin page. A core is
 * code the consoles run, so an upload must look like one: named
 * <core>_libretro_libnx.nro, an NRO by its header, and not over CORE_MAX_BYTES.
 * A core that is replaced or removed goes to the retro trash (trash.js), from
 * where the trash tab puts it back; nothing is deleted.
 *
 * A core placed here is the operator's own: nothing the server fetches later
 * replaces it (the pack plan's ownership rule). An upload holds the pack
 * (pack-fill.js claimFill) like a core job or a fill does, so it is refused while
 * one runs, and it never overwrites: a file that got to the place first wins.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { linkNoClobber } from "./no-clobber.js";
import { claimFill } from "./pack-fill.js";
import { coreFile, packDirOf } from "./pack-status.js";
import { TrashError, trashFiles } from "./trash.js";
import { coreText } from "./core-messages.js";

export const CORE_MAX_BYTES = 256 * 1024 * 1024;
export const CORE_NAME_RE = /^([a-z0-9_]+)_libretro_libnx\.nro$/;
const NRO_MAGIC_AT = 0x10;

export class CoreError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }

  /** A refusal named by its core-messages.js key: the message in English, with `code` and `vars` for the route to translate. */
  static of(status, code, vars = {}, extra = {}) {
    return Object.assign(new CoreError(status, coreText("en", code, vars), extra), { code, vars });
  }
}

/** Whether the file starts like an NRO: "NRO0" at 0x10. */
async function isNro(abs) {
  const fh = await fsp.open(abs, "r");
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, NRO_MAGIC_AT);
    return bytesRead === 4 && buf.toString("latin1") === "NRO0";
  } finally {
    await fh.close();
  }
}

/** A trash entry id for a core: "core-" and 10 hex of its file name. Pure. */
const trashId = (name) => `core-${crypto.createHash("sha1").update(name).digest("hex").slice(0, 10)}`;

/** Moves a core file (`abs`, named `name`) into the retro trash; restoreEntry() puts it back. */
export async function toTrash(retroDir, abs, name) {
  const rel = path.relative(retroDir, abs).split(path.sep).join("/");
  const size = (await fsp.stat(abs)).size;
  return trashFiles(retroDir, { id: trashId(name), system: "core", name, file: rel, size }, [rel]);
}

/**
 * Puts one uploaded file (`abs`, sent as `name`) into retroarch/cores/. A core of that
 * name is refused unless `replace`, and then goes to the trash first. Refused (409,
 * reason "busy") while a core job or a pack fill holds the pack; the upload is put in
 * place without overwriting (409 when a file got there first) and only then removed.
 */
export async function placeCore(retroDir, { abs, name }, { replace = false } = {}) {
  if (!CORE_NAME_RE.test(name)) throw CoreError.of(400, "badName");
  const { size } = await fsp.stat(abs);
  if (size > CORE_MAX_BYTES) throw CoreError.of(413, "tooLarge", { mb: CORE_MAX_BYTES / 1048576 });
  if (!(await isNro(abs))) throw CoreError.of(400, "notSwitchNro");
  const release = claimFill();
  if (!release) throw CoreError.of(409, "busyUpload", {}, { reason: "busy" });
  try {
    const dest = path.join(packDirOf(retroDir), "cores", name);
    let trashed = null;
    if (fs.existsSync(dest)) {
      if (!replace) throw CoreError.of(409, "coreExists");
      trashed = (await toTrash(retroDir, dest, name)).entry;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await linkNoClobber(abs, dest);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      throw CoreError.of(409, trashed ? "uploadTakenTrashed" : "uploadTaken", { name }, trashed ? { trashed } : {});
    }
    await fsp.rm(abs, { force: true });
    return { core: name.match(CORE_NAME_RE)[1], file: `cores/${name}`, size, ...(trashed ? { trashed } : {}) };
  } finally {
    release();
  }
}

/** Moves a core to the trash. Refused (409, with how many games use it) unless `force` when `games` use it. */
export async function removeCore(retroDir, core, games, { force = false } = {}) {
  if (!/^[a-z0-9_]+$/.test(String(core ?? ""))) throw CoreError.of(400, "badCore");
  const abs = path.join(packDirOf(retroDir), coreFile(core));
  if (!fs.existsSync(abs)) throw CoreError.of(404, "noSuchCore");
  const using = games.filter((g) => g.core === core).length;
  if (using && !force) throw CoreError.of(409, "coreInUse", { n: using }, { using });
  try {
    return { core, using, ...(await toTrash(retroDir, abs, path.basename(abs))) };
  } catch (err) {
    throw err instanceof TrashError ? new CoreError(409, err.message) : err;
  }
}
