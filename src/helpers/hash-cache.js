/**
 * SHA-256 of files, remembered by fileKey (size, mtime, ctime, inode) in the index
 * (db/stores.js hashStore) so a restart doesn't re-read big folders.
 */
import crypto from "crypto";
import fs from "fs";

const READ_CHUNK = 1024 * 1024;

/**
 * What says a file is unchanged: size, mtime, ctime and inode. ctime is in it because a
 * copy that overwrites in place and puts the mtime back (SMB, Windows) keeps the other
 * three; the kernel moves ctime on every write and nothing can set it back. Pure.
 */
export const fileKey = (st) => `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`;

export class HashCache {
  /** `store` is a hashStore. Each file passed to hash() carries abs and its stat's size, mtimeMs, ctimeMs and ino. */
  constructor(store) {
    this.store = store;
  }

  async hash(f) {
    const key = fileKey(f);
    const hit = this.store.get(f.abs);
    if (hit?.key === key) return hit.hash;
    const h = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(f.abs, { highWaterMark: READ_CHUNK })) h.update(chunk);
    const hash = h.digest("hex");
    this.store.set(f.abs, { key, hash });
    return hash;
  }

  /** Forget the files no longer in the folder. */
  save(keep) {
    this.store.prune(keep);
  }
}
