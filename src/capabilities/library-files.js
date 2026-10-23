/**
 * Game files leaving the library: to the games trash, never deleted. One call takes a few files and
 * makes one trash entry per disk, so trash_restore brings the whole call back at once. The library
 * tab's remove route does the same move (library/game-files.js) one file at a time.
 */
import { defineCapability } from "./define.js";
import { arr, int, nullable, obj, str, titleId } from "./shape.js";
import { listedFiles, pathOf, trashGameFiles } from "../library/game-files.js";

export const MAX_FILES = 20;

const fail = (status, message) => Object.assign(new Error(message), { status });
const byOf = (ctx) => ctx?.by ?? { type: "token", name: "mcp" };

/** The listed files for the call's rels, refusing the whole call when one is not listed. */
async function chosen(input) {
  const rels = input?.rels;
  if (!Array.isArray(rels) || !rels.length || rels.length > MAX_FILES || !rels.every((r) => typeof r === "string" && r)) {
    throw fail(400, `rels is a list of 1 to ${MAX_FILES} file paths from game_get files[].rel`);
  }
  const { files, missing, all } = await listedFiles([...new Set(rels)]);
  if (missing.length) throw fail(404, `not files of the library: ${missing.join(", ")}; take paths from game_get files[].rel`);
  if (files.some((f) => !pathOf(f.rel))) throw fail(400, "a path leaves the games folder");
  return { files, all };
}

/** Per game the call touches: how many of its files stay in the library. */
function gamesLeft(files, all) {
  const going = new Set(files.map((f) => f.rel));
  const bases = [...new Set(files.map((f) => f.baseTitleId ?? f.titleId).filter(Boolean))];
  return bases.map((base) => ({ titleId: base, left: all.filter((f) => (f.baseTitleId ?? f.titleId) === base && !going.has(f.rel)).length }));
}

const FILE = obj({
  rel: str("path in the games folder"), name: str(), size: int("bytes"),
  kind: nullable(str("base, update or dlc")), titleId: nullable(titleId()), version: nullable(int()),
});

export const libraryFilesCapabilities = [
  defineCapability({
    id: "library_files_remove",
    area: "library",
    title: "Move game files to the trash",
    description: `Moves up to ${MAX_FILES} game files (game_get files[].rel) to the games trash as one entry. trash_restore brings them back.`,
    input: {
      type: "object",
      properties: { rels: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_FILES, description: "Paths of the files to move, from game_get files[].rel" } },
      required: ["rels"],
    },
    output: obj({ trash: arr(str(), "trash entry ids, one per disk, for trash_restore"), files: arr(str(), "paths moved") }),
    preview: async (ctx, input) => {
      const { files, all } = await chosen(input);
      const bytes = files.reduce((n, f) => n + (f.size ?? 0), 0);
      const games = gamesLeft(files, all);
      return {
        files: files.map(({ rel, name, size, kind, titleId: id, version }) => ({ rel, name, size: size ?? 0, kind, titleId: id, version })),
        count: files.length, bytes, games,
        changes: `Moves ${files.length} file(s), ${bytes} bytes, to the games trash; consoles stop seeing them. ${games.filter((g) => g.left === 0).length} game(s) leave the shop entirely. Nothing is deleted: trash_restore with the returned id puts them back.`,
      };
    },
    previewOutput: obj({
      files: arr(FILE), count: int(), bytes: int(),
      games: arr(obj({ titleId: titleId("base game"), left: int("its files that stay; 0 means it leaves the shop") })),
      changes: str(),
    }),
    safety: "write",
    // No http: the route stays closed to tokens (TOKEN_BLOCKED_RE). Over MCP the call is gated by
    // confirm='approve' after the preview, which a raw HTTP call never shows.
    token: true,
    handler: async (ctx, input) => {
      const { files } = await chosen(input);
      const out = await trashGameFiles(files.map((f) => pathOf(f.rel)), {
        kind: "game", action: "library-file-remove", by: byOf(ctx), name: files.length === 1 ? files[0].name : `${files.length} files`,
      });
      return { trash: out.entries.map((e) => e.id), files: out.files };
    },
  }),
];
