/**
 * SHA-256 of files, remembered by (size, mtime, inode) in the index
 * (db/stores.js hashStore) so a restart doesn't re-read big folders.
 */
import crypto from "crypto";
import fs from "fs";

const READ_CHUNK = 1024 * 1024;

export class HashCache {
  /** `store` is a hashStore. */
  constructor(store) {
    this.store = store;
  }

  async hash(f) {
    const key = `${f.size}:${f.mtimeMs}:${f.ino}`;
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
