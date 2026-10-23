/**
 * The shared trash and the move journal (library/trash-service.js), the 휴지통 tab's
 * routes as tools. Emptying is not here: it deletes for good, so only a person on
 * the admin page may (opt-out.js lists it as token-blocked).
 *
 * ctx.by is who asks, as the trash records it ({ type, name }); a tool call
 * without one is recorded as a token.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, num, obj, str } from "./shape.js";

const service = () => import("../library/trash-service.js");
const byOf = (ctx) => ctx?.by ?? { type: "token", name: "mcp" };

const BYTES_COUNT = obj({ bytes: int(), count: int() });
const MOVE = obj({
  id: str(),
  at: num("epoch ms"),
  action: str(),
  fromRoot: str("library folder: games, incoming, patches, saves, homebrew or retro"),
  from: str("path in fromRoot"),
  toRoot: str(),
  to: str("path in toRoot"),
  undoable: bool(),
  reason: nullable(str("why not: undone, missing, changed, taken, gone-root or bad-path")),
}, { description: "also by, type, size, undone, released, held" });

const MOVE_ARG = { type: "string", description: "The id of a move as trash_journal returns it; undone moves keep their id for release." };

export const trashCapabilities = [
  defineCapability({
    id: "trash_list",
    area: "library",
    title: "List the trash",
    description: "Lists what was removed from the library folders and waits in their trash: where it was, why, by whom, size and age. Use before trash_restore.",
    input: { type: "object", properties: {} },
    output: obj({
      items: arr(obj({
        id: str("entry id for trash_restore"),
        root: str("library folder it came from"),
        name: str(),
        size: int("bytes"),
        trashedAt: num("epoch ms"),
        ageDays: int(),
      }, { description: "also kind, action, by, items (the files, by path) and more" }), "newest first"),
      total: BYTES_COUNT,
      roots: { type: "object", description: "{ bytes, count } per library folder" },
      noticeDays: int("age after which entries count as old"),
      old: BYTES_COUNT,
      version: str("digest of the listed ids"),
      listedAt: num("epoch ms"),
      unavailable: arr(obj({ root: str(), home: str() }), "trash folders on a disk that is not mounted"),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/trash" },
    handler: async () => (await service()).list(),
  }),
  defineCapability({
    id: "trash_restore",
    area: "library",
    title: "Restore trash entries",
    description: "Puts trash entries back where they were. Nothing is overwritten: a taken place gets a numbered name, or with exactName the entry stays in the trash.",
    input: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string", minLength: 1, maxLength: 300 }, minItems: 1, maxItems: 1000, description: "The entry ids to put back, from trash_list; at most 1000 in one call, each one at most once." },
        exactName: { type: "boolean", description: "When true, an entry whose original name is taken stays in the trash instead of coming back renamed." },
      },
      required: ["ids"],
    },
    safety: "write",
    http: { method: "POST", path: "/admin/api/trash/restore" },
    handler: async (ctx, input) => {
      const s = await service();
      // Checked here as the HTTP route checks it: a tool call reaches this handler without the route.
      const ids = input?.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 300)) {
        throw new s.TrashError("ids is a list of 1 to 1000 item ids", 400);
      }
      return s.restore([...new Set(ids)], byOf(ctx), { exactName: input.exactName === true });
    },
  }),
  defineCapability({
    id: "trash_journal",
    area: "library",
    title: "List library moves",
    description: "Lists the moves the server made between library folders, newest first, with whether each can still be undone and why not. Use before trash_undo.",
    input: { type: "object", properties: { limit: { type: "integer", description: "How many moves to return, newest first: from 1 to 1000, 200 when it is left out." } } },
    output: obj({
      items: arr(MOVE, "newest first"),
      total: int(),
      held: arr(MOVE, "undone moves whose file the drop box leaves alone until released"),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/trash/journal" },
    handler: async (_ctx, input) => (await service()).journal({ limit: Math.min(Math.max(Number(input?.limit) || 200, 1), 1000) }),
  }),
  defineCapability({
    id: "trash_undo",
    area: "library",
    title: "Undo a library move",
    description: "Moves a journaled file back to where it was, only while its old place is free and it is unchanged. A file sorted from the drop box then stays there.",
    input: { type: "object", properties: { id: MOVE_ARG }, required: ["id"] },
    safety: "write",
    http: { method: "POST", path: "/admin/api/trash/undo" },
    handler: async (ctx, input) => (await service()).undo(input.id, byOf(ctx)),
  }),
  defineCapability({
    id: "trash_release",
    area: "library",
    title: "Let the drop box sort a file again",
    description: "A file an undo put back in the drop box stays there; this lets the drop box sort it again on its next pass. Takes the id of the undone move.",
    input: { type: "object", properties: { id: MOVE_ARG }, required: ["id"] },
    safety: "write",
    http: { method: "POST", path: "/admin/api/trash/release" },
    handler: async (ctx, input) => (await service()).release(input.id, byOf(ctx)),
  }),
];
