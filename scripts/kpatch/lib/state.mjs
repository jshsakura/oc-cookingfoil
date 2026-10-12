/**
 * What this tool installed, so a later run knows which patches it may replace.
 * Patches a person put in the folder never appear here and are left alone.
 */
import fs from "node:fs";
import path from "node:path";

export function loadState(home) {
  const file = path.join(home, "state.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { installed: {} };
}

export function saveState(home, state) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, "state.json");
  fs.writeFileSync(`${file}.part`, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(`${file}.part`, file);
}
