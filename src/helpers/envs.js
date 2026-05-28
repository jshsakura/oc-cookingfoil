import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import path from "path";
import fileDirName from "./helpers.js";

const { __dirname } = fileDirName(import.meta);

const gamesPath =
  process.env.COOK_GAMES_DIR ?? path.join(__dirname, "/../../games/");
const romsDirPath = path.resolve(gamesPath);

const jsonTemplatePath = path.resolve(
  process.env.COOK_SHOP_TEMPLATE ??
    path.join(__dirname, "../../shop_template.jsonc")
);

const appPort = process.env.COOK_PORT ?? "80";

const authUsers = process.env.COOK_AUTH_USERS || null;
const unauthorizedMessage =
  process.env.COOK_UNAUTHORIZED_MSG ?? "No tricks and treats for you!!";
const welcomeMessage = process.env.COOK_WELCOME_MSG || null;

// --- Phase 2 additions ---

// Persistent runtime data: extracted icons/metadata + titledb cache.
const dataDir = path.resolve(
  process.env.COOK_DATA_DIR ?? path.join(__dirname, "/../../data/")
);
const iconCacheDir = path.join(dataDir, "extracted");
const titledbCacheDir = path.join(dataDir, "titledb");

// Switch console keys, mounted read-only. Required for NACP extraction
// (Phase 2c); the server runs fine without them — items just show without
// extracted icons/names.
const keysDir = process.env.COOK_KEYS_DIR ?? "/keys";

// User-supplied custom shop entries (default lives alongside the games folder).
const customEntriesPath =
  process.env.COOK_CUSTOM_ENTRIES ??
  path.join(romsDirPath, "custom_entries.jsonc");

// Display-language preference order. ISO-ish codes used in NACP + titledb files.
const langPriority = (process.env.COOK_LANG_PRIORITY ?? "ko,en,ja,en-US")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export {
  romsDirPath,
  jsonTemplatePath,
  appPort,
  authUsers,
  unauthorizedMessage,
  welcomeMessage,
  dataDir,
  iconCacheDir,
  titledbCacheDir,
  keysDir,
  customEntriesPath,
  langPriority,
};
