/**
 * After a move or copy: does what landed still read as what it is? The library recognises files by where they are
 * and what they are named, so a place can be allowed and still be wrong. These never refuse (file-roots.js
 * PLACE_RULES refuses the clear mistakes); the page says what it found beside the undo.
 *   other-game        a game landed in a folder holding another game's files
 *   retro-no-system   a ROM landed where no console folder would read it
 *   retro-wrong-system  a ROM landed in a console's folder that does not list its extension
 *   retro-too-deep    a ROM landed deeper than roms/<console>/<folder>/
 */
import fsp from "fs/promises";
import path from "path";
import { baseTitleIdOf } from "../meta/image-cache.js";
import { loadSystems, systemOfFolder } from "../retro/systems.js";

const NAME_ID_RE = /\[([0-9A-F]{16})\]/i;
const ROM_DEPTH = 3; // roms/<console>/<folder>

const gameIn = (name) => {
  const id = NAME_ID_RE.exec(name)?.[1];
  return id ? baseTitleIdOf(id.toUpperCase()) : null;
};

async function gamesIn(dir, { depth = 0, leave = null } = {}) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const found = new Set();
  for (const e of entries) {
    if (e.name === leave) continue;
    if (e.isDirectory()) {
      if (depth) for (const id of await gamesIn(path.join(dir, e.name), { depth: depth - 1 })) found.add(id);
    } else if (gameIn(e.name)) found.add(gameIn(e.name));
  }
  return found;
}

async function otherGame({ name, abs, isDir, destRel, destReal }) {
  if (!destRel) return null;
  const landed = isDir ? await gamesIn(abs, { depth: 1 }) : new Set([gameIn(name)].filter(Boolean));
  if (!landed.size) return null;
  const there = await gamesIn(destReal, { leave: name });
  return there.size && ![...landed].some((id) => there.has(id)) ? "other-game" : null;
}

function retroPlace({ name, isDir, destRel, retroDir }) {
  if (isDir) return null;
  const ext = path.extname(name).toLowerCase();
  const systems = loadSystems(retroDir);
  if (!Object.values(systems).some((s) => s.extensions.includes(ext))) return null;
  const parts = destRel ? destRel.split("/") : [];
  // Bios, retroarch and the art folders hold files with these extensions on purpose.
  if (parts.length && parts[0] !== "roms") return null;
  const id = parts.length > 1 ? systemOfFolder(parts[1], systems) : null;
  if (!id) return "retro-no-system";
  if (!systems[id].extensions.includes(ext)) return "retro-wrong-system";
  return parts.length > ROM_DEPTH ? "retro-too-deep" : null;
}

/** What is awkward about `name`, now at `abs` in the folder `destRel` of the root `toKey`, or null. */
export async function reviewPlace({ name, abs, isDir, toKey, destRel, destReal, rootDir }) {
  if (toKey === "games") return otherGame({ name, abs, isDir, destRel, destReal });
  if (toKey === "retro") return retroPlace({ name, isDir, destRel, retroDir: rootDir });
  return null;
}
