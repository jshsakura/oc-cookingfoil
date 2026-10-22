/**
 * Whether the RetroArch base pack can run the games the server holds: its own
 * retroarch.nro, and for each console with games the core files they name
 * (cores/<core>_libretro_libnx.nro). A ROM whose core is missing fails on the
 * console without a word, so the admin page and the client say so first.
 *
 *   { retroarch: "installed" | "missing",
 *     systems: [{ id, name, games, state: "ready" | "core-missing",
 *                 cores: [{ core, file, games, installed }] }] }
 *
 * It only reads the pack folder; nothing here writes to it.
 */
import fs from "fs";
import path from "path";

/** <retro dir>/retroarch/, or base-pack/ (the earlier name) when only that exists. */
export const packDirOf = (retroDir) =>
  fs.existsSync(path.join(retroDir, "retroarch")) ? path.join(retroDir, "retroarch") : path.join(retroDir, "base-pack");

export const coreFile = (core) => `cores/${core}_libretro_libnx.nro`;

export function packStatus(packDir, games, systems) {
  const has = (rel) => fs.existsSync(path.join(packDir, rel));
  const bySystem = new Map();
  for (const g of games) {
    if (!g.core) continue;
    const cores = bySystem.get(g.system) ?? new Map();
    cores.set(g.core, (cores.get(g.core) ?? 0) + 1);
    bySystem.set(g.system, cores);
  }
  return {
    retroarch: has("retroarch.nro") ? "installed" : "missing",
    systems: [...bySystem].map(([id, cores]) => {
      const list = [...cores].map(([core, n]) => ({ core, file: coreFile(core), games: n, installed: has(coreFile(core)) }));
      return {
        id,
        name: systems[id]?.names?.ko ?? id,
        games: list.reduce((n, c) => n + c.games, 0),
        state: list.every((c) => c.installed) ? "ready" : "core-missing",
        cores: list,
      };
    }),
  };
}
