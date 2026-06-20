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
// A scheme is REQUIRED: the value is concatenated verbatim in front of the
// proxy path ("<base>/api/shop/icon/..."), so a bare "host.tld" produces a
// schemeless string that CyberFoil's curl and Tinfoil's downloader both treat
// as invalid (icons silently fail, tapping a title does nothing). It's an easy
// footgun — operators paste just the domain — so we self-heal: prepend https://
// (the overwhelmingly common case for a domain behind a TLS-terminating proxy)
// and warn loudly so a plain-HTTP setup can correct it.
function normalizeBaseUrl(raw) {
  if (!raw) return null;
  let v = raw.trim().replace(/\/+$/, "");
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) {
    process.stderr.write(
      `[oc-cookingfoil] COOK_PUBLIC_BASE_URL="${v}" has no scheme — assuming ` +
        `"https://${v}". Set http:// explicitly if your proxy serves plain HTTP.\n`
    );
    v = `https://${v}`;
  }
  return v;
}
const rawPublicBaseUrl = pickEnv("COOK_PUBLIC_BASE_URL");
const publicBaseUrl = normalizeBaseUrl(rawPublicBaseUrl);

// /admin 2FA. The admin dashboard sits inside the basic-auth perimeter and
// adds a TOTP second factor. Unset = /admin disabled entirely. Generate a
// base32 secret once (the server logs a provisioning URI on boot) and keep it
// out of source control. Session lifetime after a successful code, in hours.
const adminTotpSecret = pickEnv("COOK_ADMIN_TOTP_SECRET") ?? null;
const adminSessionHours = Math.max(1, Number(process.env.COOK_ADMIN_SESSION_HOURS ?? 8));

// Switch console keys, mounted read-only. Required for NACP extraction
// (Phase 2c); the server runs fine without them — items just show without
// extracted icons/names.
const keysDir = process.env.COOK_KEYS_DIR ?? "/keys";

// Icon/metadata extraction policy (Phase 2c). Controls when we pull the
// icon (and fallback name/publisher) straight out of the game container
// instead of leaning on blawar/titledb's Nintendo CDN URL:
//   all     — extract for EVERY title, so covers render fully offline and
//             the on-device icon matches the actual file. titledb's CDN URL
//             becomes a fallback only. Requires prod.keys + nstool; degrades
//             gracefully to CDN when they're absent. (default)
//   missing — extract only titles blawar/titledb can't cover (homebrew /
//             fan / synthetic title IDs). Lighter I/O; titledb-covered
//             titles keep using the CDN icon.
//   off     — never extract.
// The extractor skips any container whose icon is already cached on disk,
// so `all` is a one-time background pass, not a per-boot re-dump.
const VALID_EXTRACT_MODES = new Set(["all", "missing", "off"]);
const rawExtractIcons = (pickEnv("COOK_EXTRACT_ICONS") ?? "all").toLowerCase();
const extractIcons = VALID_EXTRACT_MODES.has(rawExtractIcons)
  ? rawExtractIcons
  : "all";
if (rawExtractIcons !== extractIcons) {
  process.stderr.write(
    `[oc-cookingfoil] COOK_EXTRACT_ICONS="${rawExtractIcons}" is invalid — ` +
      `falling back to "all" (valid: all | missing | off).\n`
  );
}

// Whether to emit the top-level `titledb` metadata map in the shop response.
//
// OFF by default — and that is deliberate. CyberFoil/AeroFoil's legacy shop
// parser (remoteInstall.cpp::AppendLegacyTitleDbFromJson) turns EVERY titledb
// entry into a list item with an EMPTY download url, deduped on "tid:<id>"
// instead of the file's url. Those never collide with the real file entries,
// so a response carrying both `files` and `titledb` produces a second, url-less
// "ghost" row per title. selectTitle() early-returns on `url.empty()`, so those
// ghost rows can't be checked or installed — the on-device symptom is "the list
// shows but A/＋ do nothing on half the rows". tinfoil-hat never shipped a
// titledb, which is why it didn't hit this.
//
// The per-file entries already carry name + size + titleId + icon_url, and
// CyberFoil pulls richer metadata from its own offline DB by titleId, so
// dropping titledb costs the priority clients nothing. Flip this on only for
// stock Tinfoil, whose detail view / search reads the titledb override map.
const emitTitledb = process.env.COOK_EMIT_TITLEDB === "true";

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
  extractIcons,
  emitTitledb,
  publicBaseUrl,
  adminTotpSecret,
  adminSessionHours,
  customEntriesPath,
  langPriority,
  uploadsDir,
  extractedMetaDir,
  uploadMaxBytes,
  uploadsEnabled,
};
