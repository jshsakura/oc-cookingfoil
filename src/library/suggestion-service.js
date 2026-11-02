/** 제안 on the server's own folders (library/suggestions.js): the admin route and the MCP tools both read it here. */
import path from "path";
import * as libraryCache from "../meta/library-cache.js";
import { latestVersion } from "../meta/titledb-versions.js";
import * as retroCatalog from "../retro/catalog.js";
import { loadSystems } from "../retro/systems.js";
import { dataDir, retroDir } from "../helpers/envs.js";
import { createKept, find, readDiscFiles } from "./suggestions.js";

const kept = createKept(path.join(dataDir, "suggestions-kept.json"));

async function all() {
  await libraryCache.get();
  const catalog = await retroCatalog.current(retroDir).catch(() => ({ games: [] }));
  return find({ games: libraryCache.files(), latestVersion, retroGames: catalog.games, systems: loadSystems(retroDir), discFiles: await readDiscFiles(retroDir) });
}

/** { items, kept }: the findings not kept, and how many are kept. */
export async function current() {
  const [list, ids] = await Promise.all([all(), kept.read()]);
  const items = list.filter((f) => !ids.has(f.id));
  return { items, kept: list.length - items.length };
}

/** The finding with this id, kept or not, or null. */
export const byId = async (id) => (await all()).find((f) => f.id === id) ?? null;

/** 그대로 두기: hides a finding until its files change. False when no finding has this id. */
export async function keep(id) {
  if (!(await byId(id))) return false;
  await kept.add(id);
  return true;
}
