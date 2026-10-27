/**
 * "찜": the games the token's owner wants, by title id. The same list the web page's heart edits
 * and the owner's consoles read from GET /api/device/wishlist.
 */
import { defineCapability } from "./define.js";
import { arr, bool, obj, str } from "./shape.js";
import * as wishlist from "../security/wishlist.js";
import { tokenApprover } from "../security/admin-actor.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const owner = (ctx) => tokenApprover(ctx.token?.owner);
const WISH = obj({ titleId: str("16 hex digits, the base game"), name: str(), addedAt: str("ISO time") });

export const wishlistCapabilities = [
  defineCapability({
    id: "games_wishlist",
    area: "games",
    title: "List wished games",
    description: "Lists the games on the wishlist of the account that made this token, newest first. Its consoles show the same list.",
    input: { type: "object", properties: {} },
    output: obj({ items: arr(WISH) }),
    safety: "read",
    http: { method: "GET", path: "/pair/api/wishlist" },
    handler: async (ctx) => ({ items: wishlist.list(owner(ctx)) }),
  }),
  defineCapability({
    id: "games_wishlist_set",
    area: "games",
    title: "Add or remove a wished game",
    description: "Adds a game to the wishlist by its base title id, or removes it. Adding one already there changes nothing.",
    input: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["add", "remove"], description: "add puts the game on the list; remove takes it off" },
        titleId: { type: "string", description: "The base game's 16-hex-digit title id, such as 0100000000010000, from game_get" },
        name: { type: "string", description: "For add: the game name shown beside it on the web and the console" },
      },
      required: ["op", "titleId"],
    },
    output: obj({ done: str(), changed: bool("false when the list already was so"), item: WISH }),
    safety: "write",
    http: { method: "POST", path: "/pair/api/wishlist" },
    also: ["POST /pair/api/wishlist/remove"],
    handler: async (ctx, input) => {
      const titleId = wishlist.cleanTitleId(input.titleId);
      if (!titleId) throw fail(400, "titleId is 16 hex digits");
      if (input.op === "remove") return { done: "remove", changed: wishlist.remove(owner(ctx), titleId), item: { titleId, name: "", addedAt: "" } };
      if (input.op !== "add") throw fail(400, "op is add or remove");
      const out = wishlist.add(owner(ctx), titleId, input.name);
      if (out.refused) throw fail(409, `the wishlist is full (${wishlist.MAX_WISHES})`);
      return { done: "add", changed: !out.existing, item: out.wish };
    },
  }),
];
