/**
 * Library capabilities: what goes in each folder the server uses (helpers/storage-guide.js).
 */
import { defineCapability } from "./define.js";
import debug from "../debug.js";
import * as envs from "../helpers/envs.js";
import * as storageGuide from "../helpers/storage-guide.js";
import * as folderSync from "../meta/folder-sync.js";
import * as libraryCache from "../meta/library-cache.js";
import { refreshManual } from "../routes/homebrew.js";
import { leanStorageGuide } from "./lean.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";

const where = () => ({ layout: envs.layout, retroDir: envs.retroDir });

const lines = (description) => arr(str(), description);
// One folder's guide (helpers/folder-guides.js). core, bios and arcade are set on retro ROM folders.
const GUIDE = obj({
  path: str("folder relative to the storage root, as the guide tools take it"),
  dir: str("where the folder is on the server"),
  consolePath: nullable(str("where the console puts these files on its SD card")),
  role: str("incoming, games, homebrew, retro, patches, saves, keys or data, or a retro subfolder"),
  system: str("retro system id, on a system's ROM folder"),
  title: str(),
  purpose: lines(),
  accepts: lines("file extensions taken here"),
  structure: lines("an example tree"),
  naming: lines("names the server relies on"),
  server: lines("what the server does with the folder"),
  doNotPut: lines(),
  core: nullable({ type: "object", description: "the RetroArch core a ROM folder uses" }),
  bios: { type: ["object", "array", "null"], description: "a ROM folder: { required, optional, forExt } file groups; the BIOS folder: one entry per system" },
  arcade: nullable({ type: "object", description: "FBNeo BIOS and parent sets, on the arcade folder" }),
  text: str("the same guide as Markdown"),
}, { optional: ["system"] });

export const libraryCapabilities = [
  defineCapability({
    id: "metadata_review",
    area: "library",
    title: "Metadata to review",
    description: "Library games whose name is garbled, missing or has no Korean name, patches for a game the server does not know, and how many retro games lack box art or wait for a Korean name decision.",
    input: { type: "object", properties: {} },
    output: obj({
      game: obj({ total: int(), items: arr(obj({ titleId: str(), name: str(), reasons: arr(oneOf(["garbled", "noName", "noKo"])) }), "at most 500") }),
      retro: obj({ missingArt: int("retro games without box art"), guesses: int("Korean names waiting for retro_ko_name_decide") }),
      patch: obj({ total: int(), items: arr(obj({ id: str(), titleId: str(), name: str() }), "at most 500") }),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/metadata/review" },
    handler: async () => {
      const { metadataReview } = await import("../routes/admin/metadata-api.js");
      return metadataReview();
    },
  }),
  defineCapability({
    id: "library_storage_guide",
    area: "library",
    title: "Storage guide",
    description: "Every folder the server uses, one line each: its path, role and title. Read one folder with library_folder_guide before placing files in it.",
    input: { type: "object", properties: {} },
    output: obj({
      folders: arr(obj({ path: str("the folder's path, as library_folder_guide takes it"), role: str("incoming, games, homebrew, retro, patches, saves, keys or data"), title: str() }), "one line a folder"),
      status: nullable(obj({
        at: int("epoch ms of the last retro scan"),
        enabled: bool("folder making is on"),
        skipped: nullable(str("why nothing was made")),
        made: int("folders that scan made"),
        failed: int("folders that scan could not make"),
      }, { description: "what the last retro scan set up; null before the first" })),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/storage-guide" },
    handler: async () => leanStorageGuide(storageGuide.current(where())),
  }),
  defineCapability({
    id: "library_folder_guide",
    area: "library",
    title: "One folder's guide",
    description: "What one folder takes, how to name and lay out files there, and what the server does with them. Unknown paths return the known ones.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "A guide's path exactly as the storage guide lists it, such as retro/roms/gba (case matters)" },
      },
      required: ["path"],
    },
    output: obj({
      guide: GUIDE,
      error: oneOf(["bad-path", "unknown"], "bad-path: not a folder path; unknown: no guide for it"),
      known: arr(str(), "every guide path, with error unknown"),
    }, { optional: ["guide", "error", "known"] }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/storage-guide/folder" },
    handler: async (ctx, input) => storageGuide.folder(input?.path, where()),
  }),
  defineCapability({
    id: "library_rescan",
    area: "library",
    title: "Read the library again",
    description: "Reads folders again after files were copied in by hand: all, only the games list, or only the homebrew apps. It runs in the background; follow it with jobs_list.",
    input: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["all", "games", "homebrew"], description: "all reads every folder, games the game list, homebrew the hand-placed apps; the default is all" },
      },
    },
    output: obj({ started: oneOf(["all", "games", "homebrew"]), already: bool("that read was already running or waiting, so nothing new started") }),
    preview: async (_ctx, input) => {
      const scope = scopeOf(input);
      return { scope, changes: `Will read ${SCOPES[scope]} again. It changes no file and runs in the background; follow it with jobs_list.` };
    },
    previewOutput: obj({ scope: oneOf(["all", "games", "homebrew"]), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/library/rescan" },
    also: ["POST /admin/api/homebrew/rescan"],
    handler: async (_ctx, input) => {
      const scope = scopeOf(input);
      if (scope === "all") {
        const already = folderSync.status().running;
        folderSync.syncNow("mcp").catch((err) => debug.error("mcp: library read failed: %s", err.message));
        return { started: scope, already };
      }
      if (scope === "homebrew") {
        refreshManual().catch((err) => debug.error("mcp: homebrew read failed: %s", err.message));
        return { started: scope, already: false };
      }
      const already = libraryCache.stats().scan.fullPending;
      if (!already) libraryCache.invalidate({ rescan: true });
      return { started: scope, already };
    },
  }),
];

const SCOPES = { all: "every library folder", games: "the games list", homebrew: "the hand-placed homebrew apps" };
const scopeOf = (input) => {
  const scope = input?.scope ?? "all";
  if (!Object.hasOwn(SCOPES, scope)) throw Object.assign(new Error(`scope is one of ${Object.keys(SCOPES).join(", ")}`), { status: 400 });
  return scope;
};
