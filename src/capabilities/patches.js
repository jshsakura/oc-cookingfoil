/**
 * A game's patches leaving the library: to the patches trash, never deleted, each as its own entry
 * so its stored information comes back with it on trash_restore.
 */
import fsp from "fs/promises";
import path from "path";
import { defineCapability } from "./define.js";
import { arr, bool, int, obj, str, titleId } from "./shape.js";
import * as userPatches from "../meta/user-patches.js";
import { locateContent, trashContent } from "../library/content-remove.js";

export const MAX_PATCHES = 20;

const fail = (status, message) => Object.assign(new Error(message), { status });
const byOf = (ctx) => ctx?.by ?? { type: "token", name: "mcp" };

async function sizeOf(dir) {
  let files = 0;
  let bytes = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    files++;
    bytes += (await fsp.stat(path.join(e.parentPath, e.name))).size;
  }
  return { files, bytes };
}

/** The call's patches as listed and found on disk, refusing the whole call when one is not. */
async function chosen(input) {
  const ids = input?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_PATCHES || !ids.every((id) => typeof id === "string" && id)) {
    throw fail(400, `ids is a list of 1 to ${MAX_PATCHES} patch ids from game_get patches[].id`);
  }
  const picked = await Promise.all([...new Set(ids)].map(async (id) => ({ id, found: await locateContent("patch", id) })));
  const missing = picked.filter((p) => !p.found).map((p) => p.id);
  if (missing.length) throw fail(404, `not a game's patch: ${missing.join(", ")}; take ids from game_get patches[].id`);
  return picked;
}

const PATCH = obj({
  id: str(), titleId: titleId("the game it is for"), folder: str(), name: str(),
  korean: bool("a Korean translation"), required: bool("marked required: consoles install it with the game"),
  files: int(), bytes: int(),
});

export const patchesCapabilities = [
  defineCapability({
    id: "patches_remove",
    area: "games",
    title: "Move patches to the trash",
    description: `Moves up to ${MAX_PATCHES} of a game's patches (game_get patches[].id) to the patches trash, one entry each. trash_restore brings them back.`,
    input: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_PATCHES, description: "Ids of the patches to move, from game_get patches[].id" } },
      required: ["ids"],
    },
    output: obj({
      removed: arr(obj({ id: str(), trash: str("trash entry id, for trash_restore") })),
      failed: arr(obj({ id: str(), error: str() }), "patches that stayed, and why"),
    }),
    preview: async (ctx, input) => {
      const picked = await chosen(input);
      const patches = await Promise.all(picked.map(async ({ id, found }) => {
        const shown = userPatches.forTitle(found.titleId).find((p) => p.id === id);
        return {
          id, titleId: found.titleId, folder: found.folder, name: shown?.name || found.folder,
          korean: userPatches.isKorean({ ...shown, ...userPatches.locate(id) }), required: shown?.required === true,
          ...(await sizeOf(found.dir)),
        };
      }));
      const korean = patches.filter((p) => p.korean).length;
      return {
        patches,
        changes: `Moves ${patches.length} patch folder(s), ${patches.reduce((n, p) => n + p.bytes, 0)} bytes, to the patches trash; consoles stop offering them${korean ? `, ${korean} of them Korean translations` : ""}. Nothing is deleted: trash_restore with the returned ids puts them back with their information.`,
      };
    },
    previewOutput: obj({ patches: arr(PATCH), changes: str() }),
    safety: "write",
    // No http: the route is closed to tokens (TOKEN_BLOCKED_RE); over MCP confirm='approve' gates it.
    token: true,
    handler: async (ctx, input) => {
      const removed = [];
      const failed = [];
      for (const { id, found } of await chosen(input)) {
        try {
          removed.push({ id, trash: (await trashContent("patch", id, found, byOf(ctx))).id });
        } catch (err) {
          if (!(err?.status >= 400 && err.status < 500)) throw err;
          failed.push({ id, error: err.textIn?.("en") ?? err.message });
        }
      }
      return { removed, failed };
    },
  }),
];
