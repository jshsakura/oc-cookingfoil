import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import path from "path";
import fileDirName from "./helpers.js";

const { __dirname } = fileDirName(import.meta);

/**
 * Backward-compat env var reader.
 * Returns the first defined+non-empty value across the supplied keys.
 * The first key is the canonical (COOK_*) name; the rest are legacy
 * tinfoil-hat aliases we still accept so existing setups keep working.
 */
function pickEnv(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

// One-shot deprecation log for env vars whose feature was removed in the
// rebrand. We log via process.stderr so it surfaces regardless of DEBUG.
const DEPRECATED_FEATURE_VARS = {
  NX_PORTS: "save sync (moved to the oc-save-keeper project)",
  NX_IPS: "save sync (moved to the oc-save-keeper project)",
  NX_USER: "save sync (moved to the oc-save-keeper project)",
  NX_PASSWORD: "save sync (moved to the oc-save-keeper project)",
  SAVE_SYNC_INTERVAL: "save sync (moved to the oc-save-keeper project)",
  SAVES_BACKUP_PATH: "save sync (moved to the oc-save-keeper project)",
};
for (const [v, where] of Object.entries(DEPRECATED_FEATURE_VARS)) {
  if (process.env[v] !== undefined) {
    process.stderr.write(
      `[oc-cookingfoil] ${v} is set but no longer used — ${where}.\n`
    );
  }
}

// Games library. Relative default resolves against CWD — Docker overrides
// via ENV=/games. ROMS_DIR_FULLPATH is the legacy tinfoil-hat name.
const gamesPath =
  pickEnv("COOK_GAMES_DIR", "ROMS_DIR_FULLPATH") ?? "./games";
const romsDirPath = path.resolve(gamesPath);

const jsonTemplatePath = path.resolve(
  pickEnv("COOK_SHOP_TEMPLATE", "JSON_TEMPLATE_PATH") ??
    path.join(__dirname, "../../shop_template.jsonc")
);

const appPort = pickEnv("COOK_PORT", "TINFOIL_HAT_PORT") ?? "80";

const authUsers = pickEnv("COOK_AUTH_USERS", "AUTH_USERS") ?? null;
const unauthorizedMessage =
  pickEnv("COOK_UNAUTHORIZED_MSG", "UNAUTHORIZED_MSG") ??
  "No tricks and treats for you!!";
const welcomeMessage =
  pickEnv("COOK_WELCOME_MSG", "WELCOME_MSG") ?? null;

// --- Phase 2 additions ---

// Persistent runtime data: extracted icons/metadata + titledb cache.
const dataDir = path.resolve(
  process.env.COOK_DATA_DIR ?? path.join(__dirname, "/../../data/")
);
const iconCacheDir = path.join(dataDir, "extracted");
const titledbCacheDir = path.join(dataDir, "titledb");
// Operator-supplied artwork (icon/banner/screenshot) that overrides both the
// titledb CDN proxy and NACP extraction. Kept in its own dir so the prewarm /
// extraction passes never clobber it.
const customArtDir = path.join(dataDir, "custom-art");
// Pending file uploads land here before the user clicks Apply (which moves
// them into the games library). The dir is created lazily on first upload.
const uploadsDir = path.join(dataDir, "uploads");
// Extracted-from-NACP metadata (name/publisher/iconPath/...) keyed by
// titleId. Used as a fallback layer when titledb has no entry — fan and
// homebrew titles end up here.
const extractedMetaDir = path.join(dataDir, "extracted-meta");

// Public base URL override for the ABSOLUTE artwork URLs in the shop
// response. CyberFoil/AeroFoil fetch icons by curling the per-item URL
// verbatim, so the shop must hand out absolute URLs. Normally the origin is
// derived per-request from the Host header; pin this when running behind a
// proxy that rewrites Host, or to force a canonical address. Trailing slash
// trimmed. Unset = derive from each request.
const rawPublicBaseUrl = pickEnv("COOK_PUBLIC_BASE_URL");
const publicBaseUrl = rawPublicBaseUrl
  ? rawPublicBaseUrl.trim().replace(/\/+$/, "")
  : null;

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

// Upload constraints. Conservative defaults; users can override via env.
// 32 GiB ceiling fits dual-layer XCI dumps; bump if you're shipping bigger.
const uploadMaxBytes = Number(process.env.COOK_UPLOAD_MAX_BYTES ?? 32 * 1024 ** 3);
// Disable uploads by default — they need basic-auth AND an explicit opt-in
// because they let an authenticated user grow the games volume.
const uploadsEnabled = process.env.COOK_UPLOADS_ENABLED === "true";

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
  customArtDir,
  keysDir,
  publicBaseUrl,
  customEntriesPath,
  langPriority,
  uploadsDir,
  extractedMetaDir,
  uploadMaxBytes,
  uploadsEnabled,
};
