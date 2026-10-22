/**
 * Putting a file at a name only when nothing is there, for the pack's cores (auto-cores.js, core
 * uploads). Nothing is ever overwritten, and a half-written file never shows under the real name.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";

/**
 * A name beside `abs` in its folder, hidden from the pack listing (base-pack.js skips dot names):
 * .<name>.<12 hex>.<kind>. auto-cores.js recover() deletes the "cfpart" ones a crash leaves.
 */
export const besideName = (abs, kind) => path.join(path.dirname(abs), `.${path.basename(abs)}.${crypto.randomBytes(6).toString("hex")}.${kind}`);

/** link() errors of a disk that has no hard links (exFAT, CIFS, some FUSE) or of another disk, where a copy stands in. */
const NO_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS"]);

const taken = (to) => Object.assign(new Error(`EEXIST: file already exists, ${to}`), { code: "EEXIST" });

/**
 * `from`'s bytes at `to` only when nothing is there: fails with EEXIST when a file got to `to` first. `from`
 * stays. link() makes that check atomically. Without hard links (or across disks) the bytes are copied into
 * a hidden partial file beside `to` (besideName "cfpart", opened with O_EXCL) and flushed to disk; a crash
 * mid-copy leaves only that file, which recover() deletes. The copy then takes the name by link() when this
 * folder allows it, else by rename() once `to` is checked empty.
 *
 * That last rename is the one step that can overwrite: Node has no renameat2(RENAME_NOREPLACE), and
 * creating `to` first with O_EXCL to claim it would leave an empty or partial file under the real name on a
 * crash, the very thing this avoids. Callers hold the pack (pack-fill.js claimFill), so no other writer of
 * the server's can land there; only a file written from outside (a share, a shell) in the microseconds
 * between the check and the rename could be replaced.
 */
export async function linkNoClobber(from, to) {
  try {
    await fsp.link(from, to);
    return;
  } catch (err) {
    if (!NO_LINKS.has(err.code)) throw err;
  }
  if (await fsp.lstat(to).catch(() => null)) throw taken(to);
  const part = besideName(to, "cfpart");
  try {
    const fh = await fsp.open(part, "wx");
    // flush: the stream fsyncs the copy before it closes the handle, so the name never gets unwritten bytes.
    await pipeline(fs.createReadStream(from), fh.createWriteStream({ flush: true })).finally(() => fh.close().catch(() => {}));
    try {
      await fsp.link(part, to);
    } catch (err) {
      if (!NO_LINKS.has(err.code)) throw err;
      if (await fsp.lstat(to).catch(() => null)) throw taken(to);
      await fsp.rename(part, to);
    }
  } finally {
    await fsp.rm(part, { force: true });
  }
}
