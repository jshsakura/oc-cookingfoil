/**
 * The PS Vita library (routes/vita-library.js) as a tool: the games in the vita folder and their files.
 * The files themselves and the icons are a console's and the web page's downloads, never a tool.
 */
import { defineCapability } from "./define.js";
import { arr, int, nullable, obj, oneOf, str } from "./shape.js";

const FILE = obj({
  kind: oneOf(["app", "patch", "dlc"], "the .vpk, the patch zip or the DLC zip"),
  name: str("the file's name"),
  size: int("bytes"),
  crc32: nullable(str("the whole file's CRC-32, 8 hex digits; null until the server has read it")),
  license: oneOf(["fake", "free", "none"], "the app's work.bin: NoNpDrm's fake licence, account 0, or none in the file (the console's own licence is needed)"),
  url: str("where a console downloads it"),
}, { optional: ["license"] });

const GAME = obj({
  id: str("the title id, as PCSE00123"),
  name: str("the title from param.sfo"),
  version: nullable(str("the app's APP_VER")),
  patch_version: nullable(str("the patch zip's APP_VER, null without one")),
  region: nullable(str("US, EU, JP, AS or KR, from the content id")),
  size: int("all its files, in bytes"),
  icon_url: nullable(str("its icon0.png, null when the .vpk has none")),
  dlc_count: int("DLC folders in its DLC zip"),
  files: arr(FILE, "app first, then patch and DLC"),
});

export const vitaLibraryCapabilities = [
  defineCapability({
    id: "vita_library_list",
    area: "library",
    title: "List the PS Vita library",
    description: "Every PS Vita game in the vita folder: title id, name, versions, region, and each file (.vpk, patch, DLC zip) with its CRC-32 and the app's licence kind. Empty while the folder is missing.",
    input: { type: "object", properties: {} },
    output: obj({ games: arr(GAME, "by name") }),
    safety: "read",
    http: { method: "GET", path: "/api/vita/library/" },
    handler: async () => {
      const { vitaLibrary, gameRow } = await import("../routes/vita-library.js");
      const lib = vitaLibrary();
      return { games: (await lib.list()).map((g) => gameRow(g, null, lib.crcOf)) };
    },
  }),
];
