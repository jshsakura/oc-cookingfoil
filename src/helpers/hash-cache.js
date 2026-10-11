/**
 * SHA-256 of files, cached by (size, mtime, inode) and saved to disk so a
 * restart doesn't re-read big folders.
 */
import crypto from "crypto";
import fs from "fs";
import debug from "../debug.js";

const READ_CHUNK = 1024 * 1024;

export class HashCache {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    try {
      for (const [abs, v] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))) this.map.set(abs, v);
    } catch (err) {
      if (err.code !== "ENOENT") debug.error("retro: ignoring %s: %s", file, err.message);
    }
  }

  async hash(f) {
    const key = `${f.size}:${f.mtimeMs}:${f.ino}`;
    const hit = this.map.get(f.abs);
    if (hit?.key === key) return hit.hash;
    const h = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(f.abs, { highWaterMark: READ_CHUNK })) h.update(chunk);
    const hash = h.digest("hex");
    this.map.set(f.abs, { key, hash });
    this.dirty = true;
    return hash;
  }

  /** Save, keeping only the files still in the pack. */
  save(keep) {
    if (!this.dirty && this.map.size === keep.size) return;
    for (const abs of this.map.keys()) if (!keep.has(abs)) this.map.delete(abs);
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (err) {
      debug.error("retro: could not save %s: %s", this.file, err.message);
    }
  }
}
