/**
 * The cores in the RetroArch base pack as the admin's core screen shows them:
 * each file with its size, hash and date, the consoles whose games use it, and
 * where it stands against the official libretro build the server pins
 * (data/official-cores-<version>.js):
 *
 *   official   byte for byte the file in the official bundle
 *   modified   the bundle has a file of this name, but this one differs
 *              (a build made for a Korean patch, say); never replaced
 *   extra      the bundle has no file of this name
 *
 * Reads only; the hashes come from the same cache the pack manifest uses.
 */
import fsp from "fs/promises";
import path from "path";
import official from "./data/official-cores-1.22.2.js";
import { listPack } from "./base-pack.js";

export const OFFICIAL_VERSION = official.version;
const CORE_RE = /^retroarch\/cores\/([a-z0-9_]+)_libretro_libnx\.nro$/;

/** RetroArch's own name for a core, from info/<core>_libretro.info, or null. */
async function displayName(packDir, core) {
  try {
    const text = await fsp.readFile(path.join(packDir, "info", `${core}_libretro.info`), "utf8");
    return text.match(/^\s*display_name\s*=\s*"([^"]*)"/m)?.[1] || null;
  } catch {
    return null;
  }
}

export const originOf = (name, sha256) => {
  const known = official.files[name];
  return !known ? "extra" : known[0] === sha256 ? "official" : "modified";
};

async function entry(f, hashCache) {
  const sha256 = await hashCache.hash(f);
  const name = path.basename(f.abs);
  return { size: f.size, sha256, modifiedAt: Math.floor(f.mtimeMs / 1000), origin: originOf(name === "retroarch.nro" ? "retroarch_switch.nro" : name, sha256) };
}

/**
 * { official, retroarch: E | null, cores: [{ core, file, name, ...E, systems: [{ id, name, games }] }] }
 * with E = { size, sha256, modifiedAt, origin }. `games` are the catalog's, each naming its core.
 */
export async function listCores(packDir, hashCache, games, systems) {
  const users = new Map();
  for (const g of games) {
    if (!g.core) continue;
    const bySystem = users.get(g.core) ?? new Map();
    bySystem.set(g.system, (bySystem.get(g.system) ?? 0) + 1);
    users.set(g.core, bySystem);
  }
  const files = await listPack(packDir);
  const nro = files.find((f) => f.path === "switch/retroarch_switch.nro");
  const cores = [];
  for (const f of files) {
    const core = f.path.match(CORE_RE)?.[1];
    if (!core) continue;
    cores.push({
      core,
      file: `cores/${path.basename(f.abs)}`,
      name: await displayName(packDir, core),
      ...(await entry(f, hashCache)),
      systems: [...(users.get(core) ?? [])].map(([id, n]) => ({ id, name: systems[id]?.names?.ko ?? id, games: n })),
    });
  }
  return { official: OFFICIAL_VERSION, retroarch: nro ? await entry(nro, hashCache) : null, cores };
}
