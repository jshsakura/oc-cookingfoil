/**
 * Which art files the server fetched itself (libretro box art, Bezel Project
 * bezels), so a later match may replace them without asking. Anything else in
 * those folders (a scan or bezel a person put there, a cover uploaded on the
 * admin page) is a person's file: replacing it moves it to the trash first.
 *
 * Kept beside the files, one line per download, in each folder's
 * .cookingfoil-fetched.jsonl: { n: <file name>, size, mtimeMs }. The last line
 * for a name wins. A file counts as fetched only while it is still the bytes the
 * server wrote (same size and mtime), so a picture swapped in by hand under the
 * same name is protected too. Dot files are skipped by every scanner.
 */
import fs from "fs";
import path from "path";

export const LEDGER = ".cookingfoil-fetched.jsonl";

const ledgerOf = (file) => path.join(path.dirname(file), LEDGER);

/** Notes that the server just wrote `file`. Never throws: a missing note only means a later replace is kept in the trash. */
export function noteFetched(file) {
  try {
    const st = fs.statSync(file);
    fs.appendFileSync(ledgerOf(file), `${JSON.stringify({ n: path.basename(file), size: st.size, mtimeMs: Math.round(st.mtimeMs) })}\n`);
  } catch {
    // Kept as a person's file.
  }
}

/** Whether `file` is, byte for byte as far as size and mtime tell, what the server fetched. */
export function wasFetched(file) {
  let text;
  try {
    text = fs.readFileSync(ledgerOf(file), "utf8");
  } catch {
    return false;
  }
  const name = path.basename(file);
  let last = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const l = JSON.parse(line);
      if (l.n === name) last = l;
    } catch {
      // A line cut by a stop.
    }
  }
  if (!last) return false;
  const st = fs.statSync(file, { throwIfNoEntry: false });
  return Boolean(st) && st.size === last.size && Math.round(st.mtimeMs) === last.mtimeMs;
}
