/**
 * Retro game capabilities: find a game across every name it goes by, and read one game whole.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";
import * as envs from "../helpers/envs.js";
import * as catalog from "../retro/catalog.js";
import * as retroNames from "../retro/names.js";
import * as koMatch from "../retro/ko-match.js";
import * as variantPicks from "../retro/variant-picks.js";
import * as coreSettings from "../retro/core-settings.js";
import * as metaStore from "../retro/meta/store.js";
import * as metaEdits from "../retro/meta/edits.js";
import { readMap } from "../retro/art/sync.js";
import { representative } from "../retro/variants.js";
import { folded, gameMatches, groupOf, listedGames, retroMetaKey, titleOf } from "../retro/game-view.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const GAME_ID_RE = /^[a-z0-9_-]{1,24}-[0-9a-f]{10}$/;
const LANG = "ko";

const badInput = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const bezelOf = (g) => (!g.bezel ? "none" : g.bezel.generic ? "system" : "game");

const ITEM = obj({
  id: str("retro game id: <system>-<10 hex>"),
  system: str("system id, such as gba or snes"),
  name: str("name shown on consoles"),
  original: str("the English title when the shown name is another language's"),
  file: str("ROM file name"),
  boxart: bool("has box art"),
  versions: int("files in its version group"),
  coreOff: bool("its core is switched off, so consoles can't take it"),
}, { optional: ["original", "coreOff"] });

function searchGames(cat, input) {
  const needle = folded(input.q ?? "");
  const system = input.system ?? "";
  if (system && !Object.hasOwn(cat.systems, system)) throw badInput(`unknown system ${system}; retro_requirements lists the systems`);
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));
  const offset = Math.max(0, input.offset ?? 0);
  const all = input.allVersions === true;
  const found = (g) => !needle || (all ? gameMatches(g, needle) : groupOf(cat, g).members.some((m) => gameMatches(m, needle)));
  const off = coreSettings.off();
  // Sorted by the name an agent is shown, not the file's.
  const hits = (all ? cat.games : listedGames(cat))
    .filter((g) => (!system || g.system === system) && (input.missingArt !== true || !g.icon) && found(g))
    .map((g) => ({ g, title: titleOf(g, LANG) }))
    .sort((a, b) => a.title.name.localeCompare(b.title.name, LANG));
  return {
    total: hits.length,
    offset,
    items: hits.slice(offset, offset + limit).map(({ g, title: { name, original } }) => ({
      id: g.id, system: g.system, name, ...(original ? { original } : {}), file: g.file, boxart: Boolean(g.icon),
      versions: groupOf(cat, g).members.length, ...(off.has(g.core) ? { coreOff: true } : {}),
    })),
  };
}

function gameView(cat, id) {
  if (!GAME_ID_RE.test(id)) throw badInput("id must be a retro game id such as gba-0123456789, as retro_games_search returns it");
  const g = cat.byId.get(id);
  if (!g) throw notFound(`no retro game ${id}; find ids with retro_games_search`);
  const system = cat.systems[g.system];
  const rom = catalog.romKey(g);
  const map = readMap(envs.retroDir, g.system);
  const group = groupOf(cat, g);
  const rep = representative(group, variantPicks.get(group.id));
  const key = retroMetaKey(cat, g);
  const collected = metaStore.get(key);
  const { name, names, original, region } = titleOf(g, LANG);
  return {
    id: g.id,
    system: g.system,
    systemName: system?.names?.en ?? g.system,
    name,
    names: names ?? null,
    original: original ?? null,
    region: region ?? null,
    file: g.file,
    size: g.size ?? null,
    core: g.core ?? null,
    coreOff: coreSettings.off().has(g.core),
    romKey: rom,
    boxart: Boolean(g.icon),
    bezel: bezelOf(g),
    artMatch: Object.hasOwn(map, rom) ? map[rom] : null,
    artMatched: Object.hasOwn(map, rom),
    adminName: retroNames.get(g.id) ?? null,
    koName: koMatch.confirmed(g)?.ko ?? null,
    metaKey: key,
    meta: collected && !collected.miss ? collected : null,
    metaEdit: metaEdits.get(key),
    representative: rep.id,
    versions: group.members.map((m) => ({ id: m.id, file: m.file, name: titleOf(m, LANG).name })),
  };
}

export const retroGamesCapabilities = [
  defineCapability({
    id: "retro_games_search",
    area: "retro",
    title: "Search retro games",
    description: "Find retro games by any name they go by (shown, English, Korean, the admin's, the file's), by system, or those without box art. One row per game unless allVersions.",
    input: {
      type: "object",
      properties: {
        q: { type: "string", description: "Part of a name in any language or of the file name; all games when left out" },
        system: { type: "string", description: "Only this system id, such as gba, snes or arcade" },
        missingArt: { type: "boolean", description: "Only games that have no box art yet, to find what needs matching" },
        allVersions: { type: "boolean", description: "Every file of a version group, not only the one consoles list" },
        limit: { type: "integer", description: `How many to return, by name; ${DEFAULT_LIMIT} when left out, at most ${MAX_LIMIT}` },
        offset: { type: "integer", description: "How many matching games to skip, for the next page" },
      },
    },
    output: obj({ total: int("games matching"), offset: int(), items: arr(ITEM) }),
    safety: "read",
    token: true,
    handler: async (ctx, input = {}) => searchGames(await catalog.current(envs.retroDir), input),
  }),
  defineCapability({
    id: "retro_game_get",
    area: "retro",
    title: "One retro game",
    description: "One retro game by id: its names, ROM file, core, box art and bezel state, the libretro name its art was matched to, collected details and the admin's edits, and its versions.",
    input: {
      type: "object",
      properties: { id: { type: "string", description: "Retro game id, such as gba-0123456789, as retro_games_search returns it" } },
      required: ["id"],
    },
    output: obj({
      id: str(),
      system: str(),
      systemName: str(),
      name: str("name shown on consoles"),
      names: nullable({ type: "object", description: "name per language code" }),
      original: nullable(str("English title when the shown name is another language's")),
      region: nullable(str("kr, jp, us, eu, asia, br or world")),
      file: str("ROM file name"),
      size: nullable(int("bytes")),
      core: nullable(str("RetroArch core")),
      coreOff: bool("its core is switched off"),
      romKey: str("the name box art and bezels are filed under"),
      boxart: bool(),
      bezel: oneOf(["none", "system", "game"]),
      artMatch: nullable(str("libretro box art name the ROM was matched to; null for none or no art")),
      artMatched: bool("art matching has decided for this ROM (artMatch null then means no art exists)"),
      adminName: nullable(obj({ ko: str(), en: str() }, { optional: ["ko", "en"], description: "the admin's name" })),
      koName: nullable(str("Korean title found by the ROM's content hash")),
      metaKey: str("key its details are stored under, shared by its versions"),
      meta: nullable({ type: "object", description: "collected details: description, publisher, developer, releaseDate, numberOfPlayers, genres, sources" }),
      metaEdit: nullable({ type: "object", description: "the admin's edits laid over the collected details" }),
      representative: str("id of the version consoles list"),
      versions: arr(obj({ id: str(), file: str(), name: str() })),
    }),
    safety: "read",
    token: true,
    handler: async (ctx, input) => gameView(await catalog.current(envs.retroDir), String(input?.id ?? "")),
  }),
];
