/**
 * Reading the library folders as folders: what is in one, a page at a time. The admin file
 * browser's list (routes/admin/files-api.js) over the same module. Writes there (new folder,
 * rename, move, trash) and downloads stay with a person in the browser.
 */
import { defineCapability } from "./define.js";
import { arr, int, nullable, obj, str } from "./shape.js";
import { createFileRoots, FILE_ROOT_KEYS, FileError } from "../library/file-roots.js";

const files = createFileRoots();
const fail = (err) => {
  if (err instanceof FileError) throw Object.assign(new Error(`${err.code}: take root from files_list roots and path from items[].rel`), { status: err.status });
  throw err;
};

export const filesCapabilities = [
  defineCapability({
    id: "files_list",
    area: "library",
    title: "Library folder",
    description: "What one library folder holds, folders first, a page at a time. Walk down with items[].rel as the next path. Hidden server folders are never shown.",
    input: {
      type: "object",
      properties: {
        root: { type: "string", enum: [...FILE_ROOT_KEYS], description: `The library folder to read: ${FILE_ROOT_KEYS.join(", ")}` },
        path: { type: "string", description: "A folder inside the root, from items[].rel of an earlier call; empty for the top" },
        q: { type: "string", description: "Only entries whose name holds this text, ignoring case" },
        sort: { type: "string", enum: ["name", "size", "mtime", "type"], description: "What files are ordered by; folders always come before files" },
        order: { type: "string", enum: ["asc", "desc"], description: "asc for A to Z or smallest and oldest first, desc for the reverse" },
        page: { type: "integer", minimum: 1, description: "Which page of the listing to return, starting at 1" },
        perPage: { type: "integer", minimum: 1, maximum: 500, description: "How many entries a page holds, 100 when not given" },
      },
      required: ["root"],
    },
    output: obj({
      root: str(), path: str("the folder listed"), parent: nullable(str("its parent, null at the top")),
      items: arr(obj({ name: str(), rel: str("path in the root"), type: str("dir or file"), size: nullable(int("bytes, null for a folder")), mtime: int("epoch ms"), ext: nullable(str()) })),
      total: int(), page: int(), perPage: int(), pages: int(), sort: str(), order: str(),
      counts: obj({ dirs: int(), files: int() }),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/files/list" },
    also: ["GET /admin/api/files/roots"],
    handler: async (ctx, input) => files.list(input.root, input.path ?? "", input).catch(fail),
  }),
];
