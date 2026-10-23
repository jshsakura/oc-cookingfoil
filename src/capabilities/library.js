/**
 * Library capabilities: what goes in each folder the server uses (helpers/storage-guide.js).
 */
import { defineCapability } from "./define.js";
import * as envs from "../helpers/envs.js";
import * as storageGuide from "../helpers/storage-guide.js";
import { arr, nullable, obj, oneOf, str } from "./shape.js";

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
    id: "library_storage_guide",
    area: "library",
    title: "Storage guide",
    description: "Every folder the server uses and what goes in it, as guides with a path each. Read first before placing files; then library_folder_guide for one folder.",
    input: { type: "object", properties: {} },
    output: obj({
      text: str("every guide as one Markdown document"),
      status: nullable({ type: "object", description: "what the last retro scan set up; null before the first" }),
      guides: arr(GUIDE),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/storage-guide" },
    handler: async () => {
      const { text, guides, status } = storageGuide.current(where());
      return { text, status: status ?? null, guides };
    },
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
];
