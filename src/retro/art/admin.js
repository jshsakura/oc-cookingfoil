/**
 * The retro art views the admin page and the retro art capabilities share: how far each system's
 * box art and bezels are, and one game with its system by id.
 */
import { retroDir } from "../../helpers/envs.js";
import * as retroCatalog from "../catalog.js";
import * as retroNames from "../names.js";

/** Per system: games, with box art (borrowed: shown from another set), with their own bezel; and the games without box art. */
export function overview(catalog) {
  const systems = {};
  const missing = [];
  for (const g of catalog.games) {
    const s = (systems[g.system] ??= { id: g.system, name: catalog.systems[g.system]?.names?.ko ?? g.system, games: 0, boxart: 0, borrowed: 0, bezel: 0 });
    s.games++;
    if (g.icon) {
      s.boxart++;
      if (g.iconFrom) s.borrowed++;
    } else missing.push({ id: g.id, system: g.system, name: g.name, title: retroNames.get(g.id), rom: retroCatalog.romKey(g), original: g.original ?? null });
    if (g.bezel && !g.bezel.generic) s.bezel++;
  }
  return { systems: Object.values(systems), missing };
}

/** { g, system } for a game id, or null. */
export async function gameOf(id) {
  const catalog = await retroCatalog.current(retroDir);
  const g = catalog.byId.get(String(id ?? ""));
  return g ? { g, system: catalog.systems[g.system] } : null;
}
