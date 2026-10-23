/**
 * Capabilities over the library's games.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, num, obj, str, titleId } from "./shape.js";
import { findLibraryGames } from "../meta/library-games.js";
import { MAX_LIMIT, SORTS } from "../meta/game-search.js";
import { titleDetail } from "../meta/title-detail.js";
import * as shopCache from "../meta/shop-cache.js";
import * as titledbStore from "../meta/titledb-store.js";
import * as userPatches from "../meta/user-patches.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const badInput = (message) => Object.assign(new Error(message), { status: 400 });

/** One base game for an agent: the shop detail without its URLs, plus what the library holds of it. */
async function gameOf(input) {
  const base = String(input?.titleId ?? "").toUpperCase();
  if (!TITLE_ID_RE.test(base)) throw badInput("titleId must be 16 hex digits");
  await shopCache.get();
  const files = shopCache.files().filter((f) => f.baseTitleId === base);
  const d = await titleDetail(base, { lang: input.lang ?? "en", asked: input.lang ?? null, price: false });
  if (!d && !files.length) throw notFound(`no game ${base}: not in titledb, the library or the admin's edits; find ids with games_search`);
  const have = new Set(files.map((f) => `${f.titleId}@${f.version}`));
  const updateId = `${base.slice(0, 13)}800`;
  return {
    titleId: base,
    name: d?.name ?? null,
    names: d?.names ?? null,
    publisher: d?.publisher ?? null,
    description: d?.description ?? null,
    edited: Boolean(d?.descriptionCustom),
    notes: d?.notes ?? null,
    categories: d?.categories ?? null,
    releaseDate: d?.releaseDate ?? null,
    region: d?.region ?? null,
    players: d?.numberOfPlayers ?? null,
    size: d?.size ?? null,
    requiredFirmware: d?.requiredFirmware ?? null,
    score: d?.score ?? null,
    screenshots: d?.screenshotCount ?? 0,
    banner: Boolean(d?.bannerUrl),
    latestVersion: d?.latestVersion ?? null,
    updates: (d?.updates ?? []).map((u) => ({ version: u.version, date: u.date ?? null, inLibrary: have.has(`${updateId}@${u.version}`) })),
    dlc: { total: d?.dlcTotal ?? titledbStore.dlcIdsOf(base).length, inLibrary: [...new Set(files.filter((f) => f.kind === "dlc").map((f) => f.titleId))] },
    files: files.map(({ rel, kind, titleId: id, version, size }) => ({ rel, kind, titleId: id, version, size })),
    patches: userPatches.forTitle(base).map((p) => ({ id: p.id, name: p.name, version: p.version ?? null, required: p.required === true, korean: userPatches.isKorean(p) })),
    integrity: d?.integrity ?? [],
    verified: Boolean(d?.verified),
  };
}

export const gamesCapabilities = [
  defineCapability({
    id: "games_search",
    area: "games",
    title: "Search library games",
    description: "Find base games in the library by part of any name (Korean initials work), or by a full or partial title ID. Use the title ID it returns with other game tools.",
    input: {
      type: "object",
      properties: {
        q: { type: "string", description: "Words from the game's name in any language, Korean initials, or part of the title ID" },
        limit: { type: "integer", description: `How many games to return, best match first; 20 when left out, at most ${MAX_LIMIT}` },
        offset: { type: "integer", description: "How many matching games to skip, for the next page; 0 when left out" },
        sort: { type: "string", enum: SORTS, description: "Order among equal matches: name, or recent for the newest in the library first" },
      },
    },
    output: obj({
      total: int("games matching the query"),
      offset: int(),
      items: arr(obj({
        titleId: titleId("base game id"),
        name: str("name shown in the shop"),
        edited: bool("an admin wrote this game's name, description or notes"),
        matched: str("the other name that matched, when it is not the shown one"),
      }, { optional: ["matched"] })),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/games/search" },
    handler: async (ctx, input = {}) => findLibraryGames(String(input.q ?? ""), { limit: input.limit, offset: input.offset, sort: input.sort }),
  }),
  defineCapability({
    id: "game_get",
    area: "games",
    title: "One game",
    description: "One base game by title ID: names, description, publisher, published updates and DLC with which are in the library, its library files, patches and file-check findings.",
    input: {
      type: "object",
      properties: {
        titleId: { type: "string", description: "Base game title ID, 16 hex digits (ends in 000), as games_search returns it" },
        lang: { type: "string", description: "Language for name and description, such as ko, en or ja; the server's order when left out" },
      },
      required: ["titleId"],
    },
    output: obj({
      titleId: titleId("base game id"),
      name: nullable(str("name shown in the shop")),
      names: nullable({ type: "object", description: "name per language code" }),
      publisher: nullable(str()),
      description: nullable(str()),
      edited: bool("the description is the admin's"),
      notes: nullable(str("the admin's install notes")),
      categories: nullable(arr(str(), "genre keys")),
      releaseDate: nullable({ type: ["string", "integer"], description: "as titledb has it, often yyyymmdd" }),
      region: nullable(str()),
      players: nullable(int()),
      size: nullable(num("bytes, as titledb has it")),
      requiredFirmware: nullable(str()),
      score: nullable(num("review score 0-100")),
      screenshots: int("how many the shop shows"),
      banner: bool("the shop has a banner"),
      latestVersion: nullable(int("newest published update version")),
      updates: arr(obj({ version: int(), date: nullable(str()), inLibrary: bool() }), "published updates, oldest first"),
      dlc: obj({ total: int("published DLC"), inLibrary: arr(titleId(), "DLC title ids the library holds") }),
      files: arr(obj({ rel: str("path in the games folder"), kind: nullable(str("base, update or dlc")), titleId: nullable(titleId()), version: nullable(int()), size: num("bytes") })),
      patches: arr(obj({ id: str(), name: str(), version: nullable(str()), required: bool(), korean: bool("a Korean translation") })),
      integrity: arr(obj({ file: str(), kind: nullable(str()), titleId: nullable(str()), verdict: str("modified or damaged") }), "library files the file check flagged"),
      verified: bool("the admin tried it on a console"),
    }),
    safety: "read",
    token: true,
    handler: async (ctx, input) => gameOf(input),
  }),
];
