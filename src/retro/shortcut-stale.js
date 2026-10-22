/**
 * Which consoles' HOME menu shortcuts were made for another core than the one
 * the console plays with now. A shortcut launches its core's NRO by path, so a
 * console whose core changed (the admin's pick in the cores tab, a systems.json
 * edit, a server update) has to have its shortcuts downloaded again.
 *
 * The server cannot see the console's SD card, so it remembers per console the
 * core its shortcuts were last built for (`base`, taken the first time the
 * console is seen and again whenever the admin acknowledges) and marks the
 * console when the core in use differs from it:
 *
 *   stale() → { <system id>: { from, to, at } }
 *
 * Going back to `base` clears the mark. Kept in ${COOK_DATA_DIR}/retro-shortcut-cores.json.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";

function load(file) {
  try {
    const read = JSON.parse(fs.readFileSync(file, "utf8"));
    return { base: { ...(read?.base ?? {}) }, stale: { ...(read?.stale ?? {}) } };
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("retro: %s is unreadable, starting over: %s", file, err.message);
    return { base: {}, stale: {} };
  }
}

export function createStaleStore(file) {
  let state = load(file);
  let seen = {};
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 1)}\n`);
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      debug.error("retro: could not save %s: %s", file, err.message);
    }
  };
  return {
    stale: () => state.stale,
    /** `cores` is { <system id>: <core in use> } for the consoles that have ROMs. Returns the marks. */
    observe(cores, now = Date.now()) {
      seen = { ...cores };
      const next = { base: {}, stale: {} };
      for (const [id, core] of Object.entries(cores)) {
        const base = state.base[id] ?? core;
        next.base[id] = base;
        if (core === base) continue;
        const old = state.stale[id];
        next.stale[id] = old?.to === core && old.from === base ? old : { from: base, to: core, at: now };
      }
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        state = next;
        save();
      }
      return state.stale;
    },
    /** The shortcuts of `system` have been downloaded again for the core now in use. */
    ack(system) {
      if (!state.stale[system]) return false;
      const { [system]: _gone, ...rest } = state.stale;
      state = { base: { ...state.base, [system]: seen[system] ?? state.stale[system].to }, stale: rest };
      save();
      return true;
    },
  };
}
