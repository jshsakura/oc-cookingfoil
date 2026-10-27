/**
 * A small JSON file the server keeps in memory but does not own: the file is the truth. Every read
 * checks the file's stamp (one stat), so an edit by hand or by another tool shows with no restart.
 * The server's own write remembers its stamp, so it is not read back. A file that does not parse
 * (an editor halfway through a save), is not an object, or cannot be read keeps the last good values.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";

const stampOf = (st) => `${st.mtimeMs}:${st.ctimeMs}:${st.size}:${st.ino}`;

/** { read, write, forget } for `file`, an object keyed by id. `indent` 0 writes it on one line. */
export function jsonFile(file, { label = path.basename(file), indent = 1 } = {}) {
  let value = null;
  let stamp = null;

  function read() {
    let st;
    try {
      st = fs.statSync(file);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      if (stamp !== "missing") [value, stamp] = [{}, "missing"];
      return value;
    }
    const now = stampOf(st);
    if (now === stamp) return value;
    try {
      const got = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!got || typeof got !== "object" || Array.isArray(got)) throw new Error("not an object");
      value = got;
    } catch (err) {
      debug.error("%s: %s is unreadable (%s); keeping the last good values", label, file, err.message);
      value ??= {};
    }
    stamp = now;
    return value;
  }

  function write(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, indent || undefined)}\n`);
    fs.renameSync(`${file}.tmp`, file);
    value = next;
    stamp = stampOf(fs.statSync(file));
  }

  /** Drops what is held, for tests. */
  function forget() {
    [value, stamp] = [null, null];
  }

  return { read, write, forget };
}
