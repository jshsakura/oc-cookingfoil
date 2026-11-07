/**
 * The shared trash and the move journal (library/trash-service.js), the 휴지통 tab's
 * routes as tools. Emptying deletes for good, so its route refuses automation tokens
 * (admin-page.js TOKEN_BLOCKED_RE); MCP serves it alone (mcp: true) behind a preview that
 * names every entry and confirm='approve', and the chat puts it in the approve tier.
 *
 * ctx.by is who asks, as the trash records it ({ type, name }); a tool call
 * without one is recorded as a token.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, num, obj, str } from "./shape.js";
import { leanTrash } from "./lean.js";

const service = () => import("../library/trash-service.js");
const byOf = (ctx) => ctx?.by ?? { type: "token", name: "mcp" };

const BYTES_COUNT = obj({ bytes: int(), count: int() });
const MOVE = obj({
  id: str(),
  at: num("epoch ms"),
  action: str(),
  fromRoot: str("library folder: games, incoming, patches, saves, homebrew, retro or data"),
  from: str("path in fromRoot"),
  toRoot: str(),
  to: str("path in toRoot"),
  undoable: bool(),
  reason: nullable(str("why not: undone, missing, changed, taken, gone-root or bad-path")),
}, { description: "also by, type, size, undone, released, held" });

// Checked here as the HTTP route checks it: a tool call reaches this handler without the route.
async function idList(input) {
  const ids = input?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 300)) {
    throw new (await service()).TrashError("ids is a list of 1 to 1000 item ids", 400);
  }
  return [...new Set(ids)];
}

/** English for an MCP caller: the service's refusals are worded for the admin page's language. */
async function inEnglish(fn) {
  const { TrashError } = await service();
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TrashError && err.textIn) throw Object.assign(new Error(err.textIn("en")), { status: err.status ?? 409 });
    throw err;
  }
}

/** What trash_empty would delete: the ids given, or with all everything the trash_list at version showed. */
async function emptyTarget(input) {
  const { TrashError } = await service();
  const hasIds = input?.ids !== undefined;
  if (hasIds === (input?.all === true)) throw new TrashError("give ids (the entries to delete) or all: true, not both", 400);
  if (hasIds) return idList(input);
  if (typeof input.version !== "string" || !input.version) throw new TrashError("all needs version as trash_list returned it: everything means everything that list showed", 400);
  if (input.listedAt !== undefined && typeof input.listedAt !== "number") throw new TrashError("listedAt is the number trash_list returned", 400);
  return { all: true, version: input.version, listedAt: input.listedAt };
}

/** How many entries the preview names; the count and bytes always cover all of them. */
const EMPTY_NAMES = 50;

const MOVE_ARG = { type: "string", description: "The id of a move as trash_journal returns it; undone moves keep their id for release." };

export const trashCapabilities = [
  defineCapability({
    id: "trash_list",
    area: "library",
    title: "List the trash",
    description: "Lists what waits in the library folders' trash, newest first, one line each (where from, size, age), 20 a page. Use before trash_restore and trash_empty, whose all takes its version.",
    input: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many entries to return; 20 when left out, at most 200" },
        offset: { type: "integer", description: "How many entries to skip, for the next page of the list" },
      },
    },
    output: obj({
      items: arr(obj({
        id: str("entry id for trash_restore"),
        root: str("library folder it came from"),
        kind: str(),
        name: str(),
        size: int("bytes"),
        trashedAt: num("epoch ms"),
        ageDays: int(),
        files: int("files in the entry"),
        missing: int("files no longer there"),
        incomplete: int("files only partly there"),
      }, { optional: ["missing", "incomplete"] }), "newest first, this page"),
      total: BYTES_COUNT,
      roots: { type: "object", description: "{ bytes, count } per library folder" },
      noticeDays: int("age after which entries count as old"),
      old: BYTES_COUNT,
      offset: int(),
      version: str("digest of the entries listed; trash_empty with all takes it back"),
      listedAt: num("epoch ms the list was made; trash_empty with all takes it back"),
      unavailable: arr(obj({ root: str(), home: str() }), "trash folders on a disk that is not mounted"),
    }, { optional: ["unavailable"] }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/trash" },
    handler: async (_ctx, input = {}) => leanTrash(await (await service()).list(), input),
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
    output: obj({
      restored: arr(obj({ id: str(), name: str(), renamed: arr(obj({ rel: str(), to: str() }), "put back under a numbered name") }, { description: "also root and items" })),
      failed: arr(obj({ id: str(), error: str() }), "entries that stayed in the trash, and why"),
    }),
    preview: async (ctx, input) => {
      const ids = await idList(input);
      const byId = new Map((await (await service()).list()).items.map((e) => [e.id, e]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) throw Object.assign(new Error(`not in the trash: ${missing.join(", ")}; see trash_list`), { status: 404 });
      const entries = ids.map((id) => byId.get(id)).map(({ id, root, name, size }) => ({ id, root, name, size }));
      return {
        entries,
        changes: `Puts ${entries.length} entr${entries.length === 1 ? "y" : "ies"} back where they were. A taken name ${input.exactName === true ? "keeps that entry in the trash" : "gets a numbered name"}; nothing is overwritten.`,
      };
    },
    previewOutput: obj({ entries: arr(obj({ id: str(), root: str(), name: str(), size: int("bytes") })), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/trash/restore" },
    handler: async (ctx, input) => (await service()).restore(await idList(input), byOf(ctx), { exactName: input.exactName === true, lang: "en" }),
  }),
  defineCapability({
    id: "trash_empty",
    area: "library",
    title: "Empty the trash",
    description: "Deletes trash entries for good: the ids given, or with all everything trash_list showed (pass its version and listedAt). The preview names each entry and its size; nothing brings them back.",
    input: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string", minLength: 1, maxLength: 300 }, minItems: 1, maxItems: 1000, description: "The entries to delete for good, from trash_list; at most 1000 in one call. Not with all." },
        all: { type: "boolean", description: "true deletes every entry the trash_list at version showed. Not with ids." },
        version: { type: "string", description: "For all: the version trash_list returned; refused when the trash no longer matches what that list showed." },
        listedAt: { type: "number", description: "For all: the listedAt trash_list returned; an entry that came in after it is left alone." },
      },
    },
    output: obj({ removed: int("entries deleted"), bytes: int("bytes freed") }),
    preview: async (_ctx, input) => inEnglish(async () => {
      const svc = await service();
      const ids = await svc.targetsOf(await emptyTarget(input));
      const byId = new Map((await svc.list()).items.map((e) => [e.id, e]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) throw Object.assign(new Error(`not in the trash: ${missing.join(", ")}; see trash_list`), { status: 404 });
      const entries = ids.map((id) => byId.get(id));
      const bytes = entries.reduce((n, e) => n + e.size, 0);
      const n = entries.length;
      return {
        count: n,
        bytes,
        entries: entries.slice(0, EMPTY_NAMES).map(({ id, root, name, size, items }) => ({ id, root, name, size, files: items?.length ?? 0 })),
        changes: `Deletes ${n} entr${n === 1 ? "y" : "ies"} (${(bytes / 1e9).toFixed(2)} GB) for good${n > EMPTY_NAMES ? `; the first ${EMPTY_NAMES} are named` : ""}. Nothing brings them back.`,
      };
    }),
    previewOutput: obj({
      count: int("entries that would be deleted"),
      bytes: int("bytes they hold"),
      entries: arr(obj({ id: str(), root: str(), name: str(), size: int("bytes"), files: int() }), `the entries, at most ${EMPTY_NAMES}`),
      changes: str(),
    }),
    safety: "destructive",
    mcp: true,
    http: { method: "POST", path: "/admin/api/trash/empty" },
    handler: async (ctx, input) => inEnglish(async () => (await service()).empty(await emptyTarget(input), byOf(ctx))),
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
