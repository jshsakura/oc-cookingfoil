/**
 * Retro box art capabilities: how far each system is, libretro and SteamGridDB names to pick from,
 * and the three ways to fix a game's art (sync what is missing, match a libretro name, use a
 * SteamGridDB cover). A picture the server did not fetch itself goes to the retro trash first.
 */
import fs from "fs";
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";
import * as envs from "../helpers/envs.js";
import * as retroCatalog from "../retro/catalog.js";
import * as art from "../retro/art/sync.js";
import { wasFetched } from "../retro/art/fetched.js";
import { gameOf, overview } from "../retro/art/admin.js";
import * as integrations from "../security/integrations.js";

const SGDB_COVER_RE = /^https:\/\/cdn\d*\.steamgriddb\.com\//;
const QUERY_MAX = 100;

const fail = (status, message) => Object.assign(new Error(message), { status });
const route = () => import("../routes/admin/retro-art-api.js");
const ghToken = () => integrations.get("github").token;

function sgdbKey() {
  const { apiKey } = integrations.get("steamgriddb");
  if (!apiKey) throw fail(409, "No SteamGridDB key: the admin adds it under Integrations on the admin page");
  return apiKey;
}

async function gameAt(id) {
  const found = await gameOf(id);
  if (!found) throw fail(404, `no retro game ${id}; find ids with retro_games_search`);
  return found;
}

/** What a game's art is now: whether each picture exists and whether a person put it there. */
function artNow({ g, system }) {
  const rom = retroCatalog.romKey(g);
  const map = art.readMap(envs.retroDir, g.system);
  const file = (abs) => (fs.existsSync(abs) ? (wasFetched(abs) ? "fetched" : "placed") : "none");
  return {
    id: g.id, system: g.system, name: g.name, romKey: rom,
    artMatch: Object.hasOwn(map, rom) ? map[rom] : null,
    boxart: file(art.boxartPath(envs.retroDir, system, rom)),
    bezel: file(art.bezelPath(envs.retroDir, system, rom)),
  };
}

const PICTURE = oneOf(["none", "fetched", "placed"], "none; fetched by the server (fetched again on change); placed by a person (goes to the retro trash on change)");
const ART_NOW = obj({
  id: str(), system: str(), name: str("file name without extension"), romKey: str(),
  artMatch: nullable(str("libretro name matched now")), boxart: PICTURE, bezel: PICTURE,
});
const OUTCOME = str("ok, removed, none, or why the download failed");

function checkName(name) {
  if (name === null) return null;
  if (typeof name !== "string" || !name.trim() || name.includes("/") || name.includes("..")) throw fail(400, "name must be a libretro box art name from retro_art_candidates, or null for no art");
  return name;
}

function checkCoverUrl(url) {
  if (!SGDB_COVER_RE.test(String(url ?? ""))) throw fail(400, "url must be a SteamGridDB cover url from retro_sgdb_covers (https://cdn*.steamgriddb.com/...)");
  return String(url);
}

const GAME_ID = { type: "string", description: "Retro game id, such as gba-0123456789, as retro_games_search returns it" };

export const retroArtCapabilities = [
  defineCapability({
    id: "retro_art_status",
    area: "retro",
    title: "Retro art status",
    description: "Per system: games, how many have box art (borrowed from another set) and their own bezel; the art sync job. List the games still missing art with retro_games_search missingArt.",
    input: { type: "object", properties: {} },
    output: obj({
      systems: arr(obj({ id: str(), name: str(), games: int(), boxart: int(), borrowed: int(), bezel: int(), missing: int() })),
      job: nullable(obj({ system: nullable(str()), startedAt: int("epoch ms"), finishedAt: int("epoch ms"), error: str(), summary: { type: "object", description: "per system: matched, missed, boxart, bezel, errors" } }, { optional: ["finishedAt", "error", "summary"], description: "the running or last art sync" })),
      steamgriddb: bool("a SteamGridDB key is set"),
      github: bool("a GitHub token is set (more libretro lookups per hour)"),
    }),
    safety: "read",
    token: true,
    handler: async () => {
      const { systems } = overview(await retroCatalog.current(envs.retroDir));
      const job = (await route()).artJob();
      return {
        systems: systems.map((s) => ({ ...s, missing: s.games - s.boxart })),
        job: job ? { system: job.system, startedAt: job.startedAt, ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}), ...(job.error ? { error: job.error } : {}), ...(job.summary ? { summary: job.summary } : {}) } : null,
        steamgriddb: integrations.configured("steamgriddb"),
        github: integrations.configured("github"),
      };
    },
  }),
  defineCapability({
    id: "retro_art_candidates",
    area: "retro",
    title: "libretro art names for a game",
    description: "libretro box art names close to a game's title, best first, with a preview image url each. Pick one for retro_art_match; an empty list means try another q.",
    input: {
      type: "object",
      properties: {
        id: GAME_ID,
        q: { type: "string", description: "Title to search, in English as libretro names are; the game's own title when left out" },
      },
      required: ["id"],
    },
    output: obj({ q: str("the title searched"), names: arr(obj({ name: str("libretro box art name"), preview: nullable(str("image url")) })) }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro-art/candidates" },
    handler: async (ctx, input) => {
      const { g, system } = await gameAt(input?.id);
      const q = String(input.q ?? "").trim().slice(0, QUERY_MAX) || g.original || g.name;
      const names = await art.candidates(g.system, system, q, { token: ghToken() });
      return { q, names: names.map((name) => ({ name, preview: art.libretroUrl(system, name) })) };
    },
  }),
  defineCapability({
    id: "retro_sgdb_search",
    area: "retro",
    title: "Search SteamGridDB",
    description: "SteamGridDB games for a title, when libretro has no art for it. Needs the admin's SteamGridDB key. Then retro_sgdb_covers with a game id.",
    input: {
      type: "object",
      properties: { q: { type: "string", description: "Game title to search for, in English works best" } },
      required: ["q"],
    },
    output: obj({ games: arr(obj({ id: int("SteamGridDB game id"), name: str(), year: nullable(int()) })) }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro-art/sgdb" },
    handler: async (ctx, input) => {
      const q = String(input?.q ?? "").trim().slice(0, QUERY_MAX);
      if (!q) throw fail(400, "q is empty");
      return { games: await art.sgdbSearch(q, sgdbKey()) };
    },
  }),
  defineCapability({
    id: "retro_sgdb_covers",
    area: "retro",
    title: "SteamGridDB covers",
    description: "Portrait covers SteamGridDB has for one of its games, as image urls. Use one with retro_cover_set.",
    input: {
      type: "object",
      properties: { sgdbId: { type: "integer", description: "SteamGridDB game id from retro_sgdb_search, not a retro game id" } },
      required: ["sgdbId"],
    },
    output: obj({ covers: arr(obj({ url: str("full image, for retro_cover_set"), thumb: str("small preview") })) }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro-art/sgdb/:id" },
    handler: async (ctx, input) => {
      const id = input?.sgdbId;
      if (!Number.isInteger(id) || id < 1 || id > 9_999_999_999) throw fail(400, "sgdbId must be a SteamGridDB game id");
      return { covers: await art.sgdbCovers(id, sgdbKey()) };
    },
  }),
  defineCapability({
    id: "retro_art_sync",
    area: "retro",
    title: "Fetch missing retro art",
    description: "Matches every ROM without art to libretro by exact title and downloads box art and bezels, for one system or all. Fills gaps only. Runs as a job; follow it with jobs_list.",
    input: {
      type: "object",
      properties: { system: { type: "string", description: "Only this system id, such as gba; every system with ROMs when left out" } },
    },
    output: obj({ started: bool(), system: nullable(str()), startedAt: int("epoch ms") }),
    preview: async (ctx, input) => {
      const { systems } = overview(await retroCatalog.current(envs.retroDir));
      if (input.system && !systems.some((s) => s.id === input.system)) throw fail(400, `no ROMs for system ${input.system}`);
      const job = (await route()).artJob();
      return {
        systems: systems.filter((s) => !input.system || s.id === input.system).map((s) => ({ id: s.id, games: s.games, missing: s.games - s.boxart })),
        running: Boolean(job && !job.finishedAt),
        changes: "Adds box art and bezels only where none exist yet. Existing pictures stay as they are.",
      };
    },
    previewOutput: obj({
      systems: arr(obj({ id: str(), games: int(), missing: int("games without box art it will try") })),
      running: bool("a sync is running already; starting another is refused"),
      changes: str(),
    }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-art/sync" },
    handler: async (ctx, input) => {
      const started = await (await route()).startArtSync(input.system ?? null);
      if (started.error) throw fail(started.status === 409 ? 409 : 400, started.status === 409 ? "an art sync is running already; follow it with jobs_list" : `unknown system ${input.system}`);
      return { started: true, system: started.job.system ?? null, startedAt: started.job.startedAt };
    },
  }),
  defineCapability({
    id: "retro_art_match",
    area: "retro",
    title: "Match a retro game's art",
    description: "Uses one libretro name's box art and bezel for a game (from retro_art_candidates), or null for no art. Replaces the game's current pictures.",
    input: {
      type: "object",
      properties: {
        id: GAME_ID,
        name: { type: ["string", "null"], description: "libretro box art name from retro_art_candidates, exactly; null marks the game as having no art" },
      },
      required: ["id", "name"],
    },
    output: obj({ boxart: OUTCOME, bezel: OUTCOME }),
    preview: async (ctx, input) => {
      const found = await gameAt(input.id);
      const name = checkName(input.name);
      return { now: artNow(found), name, preview: name ? art.libretroUrl(found.system, name) : null, changes: "Replaces the box art and bezel with this name's. Placed pictures go to the retro trash; fetched ones are fetched again." };
    },
    previewOutput: obj({ now: ART_NOW, name: nullable(str()), preview: nullable(str("the new box art's image url")), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-art/match" },
    handler: async (ctx, input) => {
      const { g, system } = await gameAt(input.id);
      const result = await art.applyMatch(envs.retroDir, g.system, system, retroCatalog.romKey(g), checkName(input.name));
      await retroCatalog.scan(envs.retroDir);
      return result;
    },
  }),
  defineCapability({
    id: "retro_cover_set",
    area: "retro",
    title: "Use a SteamGridDB cover",
    description: "Uses a SteamGridDB cover (from retro_sgdb_covers) as a game's box art, shrunk to a small PNG. For games libretro has no art for.",
    input: {
      type: "object",
      properties: {
        id: GAME_ID,
        url: { type: "string", description: "The cover's url from retro_sgdb_covers, on cdn*.steamgriddb.com" },
      },
      required: ["id", "url"],
    },
    output: obj({ boxart: oneOf(["ok"]) }),
    preview: async (ctx, input) => {
      const found = await gameAt(input.id);
      return { now: artNow(found), url: checkCoverUrl(input.url), changes: "Replaces the box art with this cover. A placed box art goes to the retro trash first." };
    },
    previewOutput: obj({ now: ART_NOW, url: str(), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-art/cover" },
    handler: async (ctx, input) => {
      const { g, system } = await gameAt(input.id);
      await art.saveCover(envs.retroDir, system, retroCatalog.romKey(g), checkCoverUrl(input.url));
      await retroCatalog.scan(envs.retroDir);
      (await import("../routes/retro.js")).rebuildRetroShortcut(g.id);
      return { boxart: "ok" };
    },
  }),
];
