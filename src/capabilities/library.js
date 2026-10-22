/**
 * Library capabilities: what goes in each folder the server uses (helpers/storage-guide.js).
 */
import { defineCapability } from "./define.js";
import * as envs from "../helpers/envs.js";
import * as storageGuide from "../helpers/storage-guide.js";

const where = () => ({ layout: envs.layout, retroDir: envs.retroDir });

export const LIBRARY = [
  defineCapability({
    id: "library_storage_guide",
    area: "library",
    title: "Storage guide",
    description: "Every folder the server uses and what goes in it, as guides with a path each. Read first before placing files; then library_folder_guide for one folder.",
    input: { type: "object", properties: {} },
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
    safety: "read",
    http: { method: "GET", path: "/admin/api/storage-guide/folder" },
    handler: async (ctx, input) => storageGuide.folder(input?.path, where()),
  }),
];
