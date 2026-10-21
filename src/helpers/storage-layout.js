/**
 * Where every folder the server uses lives, decided in one place.
 *
 * One storage folder (COOK_STORAGE_DIR, /storage in the image) holds a folder
 * per role, made at start when missing:
 *
 *   incoming   the drop box: files waiting to be sorted (meta/library-organize.js)
 *   games      sorted Switch games, one folder per game with update/ and DLC/
 *   homebrew   .nro apps and app folders
 *   retro      retro ROMs, art and the RetroArch base pack
 *   patches    patches by base title id
 *   saves      save files by title id
 *   keys       your own prod.keys
 *   data       accounts, settings and caches; the one to back up
 *
 * A COOK_<ROLE>_DIR still names its folder anywhere. The storage folder is used
 * only when it exists, so a server with separate mounts (/games, /data, /keys,
 * …) keeps reading them, and a role whose storage folder is missing while its
 * old mount holds files keeps the old mount: nothing a server already had goes
 * out of sight. Without a storage folder the drop box stays <games>/incoming.
 *
 * Run as a script (the image's entrypoint does, as root) it makes the folders
 * and prints "<role> <path>" lines.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ROLES = Object.freeze(["incoming", "games", "homebrew", "retro", "patches", "saves", "keys", "data"]);

const ROLE_ENV = Object.freeze({
  incoming: ["COOK_INCOMING_DIR"],
  games: ["COOK_GAMES_DIR", "ROMS_DIR_FULLPATH"],
  homebrew: ["COOK_HOMEBREW_DIR"],
  retro: ["COOK_RETRO_DIR"],
  patches: ["COOK_PATCHES_DIR"],
  saves: ["COOK_SAVES_DIR"],
  keys: ["COOK_KEYS_DIR"],
  data: ["COOK_DATA_DIR"],
});

const APP_DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data");

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const hasEntries = (p) => {
  try {
    return fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
};

/**
 * Where a role lived before the storage folder: the image's mount when one is
 * there, else the old default. `dirs` holds the roles decided so far. Pure but
 * for `fsCheck.isDir`.
 */
function legacyDir(role, dirs, fsCheck) {
  const mount = `/${role}`;
  if (role !== "incoming" && fsCheck.isDir(mount)) return mount;
  switch (role) {
    case "games": return path.resolve("./games");
    case "data": return path.resolve(APP_DATA);
    case "retro": return path.join(dirs.data, "retro");
    case "incoming": return path.join(dirs.games, "incoming");
    default: return mount;
  }
}

/**
 * The layout for `env`: { storage, root, dirs: { <role>: path }, from: { <role>: "env" | "storage" | "kept" | "legacy" } }.
 * "kept" is a role the storage folder would hold but whose old mount still has files.
 */
export function resolveLayout(env = process.env, fsCheck = { isDir, hasEntries }) {
  const root = String(env.COOK_STORAGE_DIR ?? "").trim();
  const storage = Boolean(root) && fsCheck.isDir(root);
  const dirs = {};
  const from = {};
  // data before retro, games before incoming: their old defaults sit inside those.
  for (const role of ["data", "games", "keys", "homebrew", "retro", "patches", "saves", "incoming"]) {
    const named = ROLE_ENV[role].map((k) => env[k]).find((v) => v !== undefined && v !== "");
    if (named) {
      dirs[role] = path.resolve(named);
      from[role] = "env";
      continue;
    }
    const old = legacyDir(role, dirs, fsCheck);
    if (!storage) {
      dirs[role] = old;
      from[role] = "legacy";
      continue;
    }
    const mine = path.join(path.resolve(root), role);
    const keep = role !== "incoming" && !fsCheck.isDir(mine) && old !== mine && fsCheck.hasEntries(old);
    dirs[role] = keep ? old : mine;
    from[role] = keep ? "kept" : "storage";
  }
  return { storage, root: storage ? path.resolve(root) : null, dirs, from };
}

/** Makes the storage folder's role folders that are missing. Returns the ones made. */
export function ensureLayout(layout) {
  const made = [];
  for (const role of ROLES) {
    if (layout.from[role] !== "storage" || isDir(layout.dirs[role])) continue;
    fs.mkdirSync(layout.dirs[role], { recursive: true });
    made.push(layout.dirs[role]);
  }
  return made;
}

/**
 * The drop box a server had inside its games folder before the storage folder,
 * when the drop box now lives elsewhere: null otherwise. Pure but for `isDir`.
 */
export function oldIncoming(layout, check = isDir) {
  const old = path.join(layout.dirs.games, "incoming");
  return layout.dirs.incoming !== old && check(old) ? old : null;
}

/**
 * Moves what the old drop box held into the new one, entry by entry, never over
 * something already there and only by rename: an entry on another disk stays
 * for the admin to move rather than being copied during start. Returns
 * { moved, left: [names] }; the old folder goes once it is empty.
 */
export function moveOldIncoming(from, to) {
  const left = [];
  let moved = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const dest = path.join(to, name);
    if (fs.existsSync(dest)) {
      left.push(name);
      continue;
    }
    try {
      fs.renameSync(path.join(from, name), dest);
      moved++;
    } catch {
      left.push(name);
    }
  }
  if (!left.length) fs.rmdirSync(from);
  return { moved, left };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const layout = resolveLayout();
  try {
    ensureLayout(layout);
  } catch (err) {
    // A share root cannot write (root_squash, read-only): the server, running as PUID, makes them.
    process.stderr.write(`[oc-cookingfoil] could not make the storage folders as root (${err.code ?? err.message}); the server will try\n`);
  }
  for (const role of ROLES) process.stdout.write(`${role} ${layout.dirs[role]}\n`);
}
