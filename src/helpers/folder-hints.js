/**
 * Hints for folders left where an older compose file put them.
 */
import fs from "fs";
import path from "path";

const hasEntries = (dir) => {
  try {
    return fs.readdirSync(dir).some((n) => !n.startsWith("."));
  } catch {
    return false;
  }
};

/** data/retro when it still holds files while the retro folder in use is elsewhere and empty, else null. */
export function oldRetroLeftBehind(dataDir, retroDir) {
  const old = path.resolve(dataDir, "retro");
  if (path.resolve(retroDir) === old) return null;
  return hasEntries(old) && !hasEntries(retroDir) ? old : null;
}
