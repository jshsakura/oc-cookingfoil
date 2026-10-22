/**
 * Capabilities over the library's games.
 */
import { defineCapability } from "./define.js";
import { findLibraryGames } from "../meta/library-games.js";
import { MAX_LIMIT, SORTS } from "../meta/game-search.js";

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
    safety: "read",
    http: { method: "GET", path: "/admin/api/games/search" },
    handler: async (ctx, input = {}) => findLibraryGames(String(input.q ?? ""), { limit: input.limit, offset: input.offset, sort: input.sort }),
  }),
];
