/**
 * What the chat does with games for one person: show them as cards, recommend from the library,
 * and put a game on the person's own console. Every one acts as the account that made the token
 * (the web sign-in, for the chat) and reaches only that account's consoles, wishlist and history.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";
import { CARD_MAX, cardsFor } from "../chat/cards.js";
import { BASES, DEFAULT_LIMIT, GENRES, MAX_LIMIT, recommend } from "../chat/recommend.js";
import { approverOf, sendGame } from "../chat/own-consoles.js";

const CARD = obj({
  kind: oneOf(["switch", "retro"]),
  id: str("Switch base title id or retro game id"),
  name: str(),
  platform: str("the system, such as Nintendo Switch or Game Boy Advance"),
  size: nullable(int("bytes of the main file")),
  korean: obj({ patch: bool("a Korean translation patch is in the library"), ui: bool("the game has Korean text itself") }),
  icon: nullable(str("path of the picture on this server")),
  sendable: bool("the card may offer adding it to a console"),
});

const idsOf = (text) => String(text ?? "").split(/[\s,]+/).filter(Boolean);

export const chatGamesCapabilities = [
  defineCapability({
    id: "games_show",
    area: "games",
    title: "Show games as cards",
    description: "Shows library games to the person as cards (picture, name, system, size, Korean marks). Use it whenever an answer names games, instead of listing them in text.",
    input: {
      type: "object",
      properties: {
        ids: { type: "string", description: `Title ids or retro game ids from the search tools, separated by spaces or commas; at most ${CARD_MAX}` },
      },
      required: ["ids"],
    },
    output: obj({ shown: int("cards the person now sees"), cards: arr(CARD), skipped: arr(str(), "ids the library does not hold") }),
    safety: "read",
    token: true,
    handler: async (ctx, input) => {
      const ids = idsOf(input?.ids);
      const cards = await cardsFor(ids);
      const got = new Set(cards.map((c) => c.id.toUpperCase()));
      return { shown: cards.length, cards, skipped: ids.slice(0, CARD_MAX).filter((id) => !got.has(id.toUpperCase())) };
    },
  }),
  defineCapability({
    id: "games_recommend",
    area: "games",
    title: "Recommend games from the library",
    description: "Picks library games the person has not taken yet, by the genres of their wishlist and recent sends, or by one genre. They arrive as cards.",
    input: {
      type: "object",
      properties: {
        basis: { type: "string", enum: BASES, description: "mixed (default) uses wishlist and recent sends; wishlist or recent alone; genre needs the genre argument" },
        genre: { type: "string", enum: GENRES, description: "For basis genre: the genre key to pick from" },
        limit: { type: "integer", description: `How many to recommend; ${DEFAULT_LIMIT} when left out, at most ${MAX_LIMIT}` },
      },
    },
    output: obj({
      basis: str(),
      genre: nullable(str()),
      fallback: bool("the person has no history, so these are the best reviewed and newest"),
      shown: int("cards the person now sees"),
      cards: arr(CARD),
      reasons: arr(obj({ id: str(), shared: arr(str(), "genres shared with what the person liked") })),
    }),
    safety: "read",
    token: true,
    handler: async (ctx, input = {}) => {
      const out = await recommend(approverOf(ctx.token?.owner), { basis: input.basis, genre: input.genre, limit: input.limit });
      const cards = await cardsFor(out.items.map((i) => i.titleId));
      return { basis: out.basis, genre: out.genre, fallback: out.fallback, shown: cards.length, cards, reasons: out.items.map((i) => ({ id: i.titleId, shared: i.shared })) };
    },
  }),
  defineCapability({
    id: "my_send",
    area: "games",
    title: "Add a game to my console",
    description: "Queues a library game for one of the person's own consoles; the console asks its player before it downloads. Only consoles the person approved themselves are reachable.",
    input: {
      type: "object",
      properties: {
        game: { type: "string", description: "The Switch base game's 16-hex-digit title id, as games_search returns it" },
        device: { type: "string", description: "The console's 8-character code; may be left out when the person has one console, otherwise the error lists them" },
      },
      required: ["game"],
    },
    output: obj({ code: str(), label: str(), existing: bool("the game was already waiting there"), name: str() }),
    safety: "write",
    token: true,
    preview: async (ctx, input) => ({
      game: String(input.game ?? ""),
      changes: "Queues the game for your own console, the one named by device or your only one; the console asks before it downloads.",
    }),
    previewOutput: obj({ game: str(), changes: str() }),
    handler: async (ctx, input) => {
      const out = sendGame(approverOf(ctx.token?.owner), { game: input.game, device: input.device });
      return { code: out.code, label: out.label, existing: out.existing, name: out.item.name };
    },
  }),
];
