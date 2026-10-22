/**
 * Adding and removing a RetroArch core by hand from the admin page. A core is
 * code the consoles run, so an upload must look like one: named
 * <core>_libretro_libnx.nro, an NRO by its header, and not over CORE_MAX_BYTES.
 * A core that is replaced or removed goes to the retro trash (trash.js), from
 * where the trash tab puts it back; nothing is deleted.
 *
 * A core placed here is the operator's own: nothing the server fetches later
 * replaces it (the pack plan's ownership rule).
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { coreFile, packDirOf } from "./pack-status.js";
import { fillBusy } from "./pack-fill.js";
import { listTrash, TrashError, trashFiles } from "./trash.js";

export const CORE_MAX_BYTES = 256 * 1024 * 1024;
export const CORE_NAME_RE = /^([a-z0-9_]+)_libretro_libnx\.nro$/;
const NRO_MAGIC_AT = 0x10;

export class CoreError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const FILL_RUNNING = "RetroArch 팩을 채우는 중입니다. 끝난 뒤에 다시 합니다";

/** The cores that sit in the trash, by name ("mgba"): the server must not put its own copy in their place. */
export async function trashedCores(retroDir) {
  return new Set((await listTrash(retroDir)).filter((e) => e.system === "core").map((e) => CORE_NAME_RE.exec(e.name)?.[1]).filter(Boolean));
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

async function toTrash(retroDir, abs, name) {
  const rel = path.relative(retroDir, abs).split(path.sep).join("/");
  const size = (await fsp.stat(abs)).size;
  return trashFiles(retroDir, { id: trashId(name), system: "core", name, file: rel, size }, [rel]);
}

/**
 * Puts one uploaded file (`abs`, sent as `name`) into retroarch/cores/. A core of that
 * name is refused unless `replace`, and then goes to the trash first.
 */
export async function placeCore(retroDir, { abs, name }, { replace = false } = {}) {
  if (fillBusy()) throw new CoreError(409, FILL_RUNNING);
  if (!CORE_NAME_RE.test(name)) throw new CoreError(400, "코어 파일 이름은 <코어>_libretro_libnx.nro 여야 합니다");
  const { size } = await fsp.stat(abs);
  if (size > CORE_MAX_BYTES) throw new CoreError(413, `코어 파일은 ${CORE_MAX_BYTES / 1048576}MB 까지 받습니다`);
  if (!(await isNro(abs))) throw new CoreError(400, "Switch 용 NRO 파일이 아닙니다");
  const dest = path.join(packDirOf(retroDir), "cores", name);
  let trashed = null;
  if (fs.existsSync(dest)) {
    if (!replace) throw new CoreError(409, "같은 이름의 코어가 이미 있습니다. 바꾸려면 교체를 확인합니다");
    trashed = (await toTrash(retroDir, dest, name)).entry;
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(abs, dest);
  return { core: name.match(CORE_NAME_RE)[1], file: `cores/${name}`, size, ...(trashed ? { trashed } : {}) };
}

/** Moves a core to the trash. Refused (409, with how many games use it) unless `force` when `games` use it. */
export async function removeCore(retroDir, core, games, { force = false } = {}) {
  if (fillBusy()) throw new CoreError(409, FILL_RUNNING);
  if (!/^[a-z0-9_]+$/.test(String(core ?? ""))) throw new CoreError(400, "코어 이름이 맞지 않습니다");
  const abs = path.join(packDirOf(retroDir), coreFile(core));
  if (!fs.existsSync(abs)) throw new CoreError(404, "그런 코어가 없습니다");
  const using = games.filter((g) => g.core === core).length;
  if (using && !force) throw new CoreError(409, `게임 ${using}개가 이 코어를 씁니다`, { using });
  try {
    return { core, using, ...(await toTrash(retroDir, abs, path.basename(abs))) };
  } catch (err) {
    throw err instanceof TrashError ? new CoreError(409, err.message) : err;
  }
}
