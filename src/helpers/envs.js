import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import path from "path";
import fileDirName from "./helpers.js";
import { envString, envNumber, envBool } from "./env-read.js";

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
let welcomeMessage =
  pickEnv("COOK_WELCOME_MSG", "WELCOME_MSG") ?? null;

// --- Phase 2 additions ---

// Persistent runtime data: extracted icons/metadata + titledb cache.
const dataDir = path.resolve(
  envString("COOK_DATA_DIR", path.join(__dirname, "/../../data/"))
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
let publicBaseUrl = normalizeBaseUrl(rawPublicBaseUrl);

// /admin 2FA. The admin dashboard sits inside the basic-auth perimeter and
// adds a TOTP second factor. Unset = /admin disabled entirely. Generate a
// base32 secret once (the server logs a provisioning URI on boot) and keep it
// out of source control. Session lifetime after a successful code, in hours.
const adminTotpSecret = pickEnv("COOK_ADMIN_TOTP_SECRET") ?? null;
const adminSessionHours = envNumber("COOK_ADMIN_SESSION_HOURS", 8, { min: 1 });
// For an operator without an authenticator app: when set, /admin asks for this
// password instead of a TOTP code. Keep it apart from the shop accounts, which
// are shared with every player; shorter than 12 characters is refused.
const ADMIN_PASSWORD_MIN = 12;
const adminPassword = (() => {
  const raw = pickEnv("COOK_ADMIN_PASSWORD");
  if (!raw) return null;
  if (raw.length >= ADMIN_PASSWORD_MIN) return raw;
  process.stderr.write(
    `[oc-cookingfoil] COOK_ADMIN_PASSWORD is shorter than ${ADMIN_PASSWORD_MIN} characters; ignoring it and keeping TOTP.\n`
  );
  return null;
})();

// Who owns this server. Used as the account label in the authenticator entry
// (so "CookingFoil (you@example.com)" is distinguishable from every other TOTP
// row) and shown on the admin pages. Never sent to unauthenticated clients.
// Deliberately lenient validation — this is a display label, not a mail route;
// a malformed value is dropped with a warning rather than failing the boot.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rawAdminEmail = pickEnv("COOK_ADMIN_EMAIL");
const adminEmail = (() => {
  if (!rawAdminEmail) return null;
  const trimmed = rawAdminEmail.trim();
  if (EMAIL_RE.test(trimmed)) return trimmed;
  process.stderr.write(
    `[oc-cookingfoil] COOK_ADMIN_EMAIL is not a valid address ("${trimmed}") — ignoring it.\n`
  );
  return null;
})();

// Console keys, mounted read-only. Required for NACP extraction
// (Phase 2c); the server runs fine without them — items just show without
// extracted icons/names.
const keysDir = envString("COOK_KEYS_DIR", "/keys");

// Icon/metadata extraction policy (Phase 2c). Controls when we pull the
// icon (and fallback name/publisher) straight out of the game container
// instead of leaning on blawar/titledb's eShop CDN URL:
//   all     — extract for EVERY title, so covers render fully offline and
//             the on-device icon matches the actual file. titledb's CDN URL
//             becomes a fallback only. Requires prod.keys + nstool; degrades
//             gracefully to CDN when they're absent. Use ONLY for a LAN with
//             no internet — otherwise it needlessly unpacks multi-GB XCI/NSZ.
//   missing — extract only titles blawar/titledb can't cover (homebrew /
//             fan / synthetic title IDs). Lighter I/O; titledb-covered titles
//             keep the CDN icon (name+icon already known from the filename's
//             title ID). No wasted nstool unpack on retail dumps. (DEFAULT)
//   off     — never extract.
// The extractor skips any container whose icon is already cached on disk,
// so `all` is a one-time background pass, not a per-boot re-dump.
const VALID_EXTRACT_MODES = new Set(["all", "missing", "off"]);
const rawExtractIcons = (pickEnv("COOK_EXTRACT_ICONS") ?? "missing").toLowerCase();
let extractIcons = VALID_EXTRACT_MODES.has(rawExtractIcons)
  ? rawExtractIcons
  : "missing";
if (rawExtractIcons !== extractIcons) {
  process.stderr.write(
    `[oc-cookingfoil] COOK_EXTRACT_ICONS="${rawExtractIcons}" is invalid — ` +
      `falling back to "missing" (valid: all | missing | off).\n`
  );
}

// Size cap for AUTO extraction (GB). Even in "missing" mode a genuinely-
// uncovered giant container (≥6 GB XCI / NSZ) would let the background worker
// grind for minutes and hit COOK_EXTRACT_TIMEOUT_MS. We skip auto-enqueuing
// anything larger than this — the file keeps its filename fallback (rare).
// 0 or negative disables the cap (unlimited). Default 4 GB.
const extractMaxGb = envNumber("COOK_EXTRACT_MAX_GB", 4);
const extractMaxBytes = extractMaxGb > 0 ? extractMaxGb * 1024 ** 3 : 0;

// Inter-job pacing (ms) for the background extraction worker. A small delay
// between jobs keeps the one-time pass from saturating disk/CPU while the
// server is answering shop requests — "run gently, not a thundering pass".
// Concurrency (COOK_EXTRACT_CONCURRENCY) is unchanged; this only spaces jobs
// out. 0 disables the delay. Default 250 ms.
const extractPaceMs = envNumber("COOK_EXTRACT_PACE_MS", 250, { min: 0 });

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
const emitTitledb = envBool("COOK_EMIT_TITLEDB", false);

// User-supplied custom shop entries (default lives alongside the games folder).
const customEntriesPath = envString(
  "COOK_CUSTOM_ENTRIES",
  path.join(romsDirPath, "custom_entries.jsonc")
);

// Display-language preference order. ISO-ish codes used in NACP + titledb files.
let langPriority = envString("COOK_LANG_PRIORITY", "ko,en,ja,en-US")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Upload constraints. Conservative defaults; users can override via env.
// 32 GiB ceiling fits dual-layer XCI dumps; bump if you're shipping bigger.
const uploadMaxBytes = envNumber("COOK_UPLOAD_MAX_BYTES", 32 * 1024 ** 3, { min: 1 });
// Disable uploads by default — they need basic-auth AND an explicit opt-in
// because they let an authenticated user grow the games volume.
let uploadsEnabled = envBool("COOK_UPLOADS_ENABLED", false);
// The temporary share inbox: signed-in web users leave files, a memo and links
// for the operator. On by default; one upload and the whole inbox are capped.
let inboxEnabled = envBool("COOK_INBOX_ENABLED", true);
let inboxMaxBytes = envNumber("COOK_INBOX_MAX_BYTES", 2 * 1024 ** 3, { min: 1, integer: true });
let inboxQuotaBytes = envNumber("COOK_INBOX_QUOTA_BYTES", 20 * 1024 ** 3, { min: 1, integer: true });
// Base games in the sections list carry their eShop price, looked up in the
// background from the public eShop price endpoint. Off for offline servers.
let eshopPrices = envBool("COOK_ESHOP_PRICES", true);
// The "popular" order comes from the search index the US eShop site
// uses (Algolia). The defaults are the public search-only credentials that
// site ships to every visitor; override them or turn the ranking off.
let eshopPopularity = envBool("COOK_ESHOP_POPULARITY", true);
const eshopAlgoliaAppId = envString("COOK_ESHOP_ALGOLIA_APP_ID", "U3B6GR4UA3").trim();
const eshopAlgoliaKey = envString("COOK_ESHOP_ALGOLIA_KEY", "a29c6927638bfd8cee23993e51e721c9").trim();
// Icons, banners and screenshots are fetched from the eShop CDN (the
// URLs titledb lists) and cached on disk. false serves only what is cached,
// extracted from the game files, or uploaded on the admin page.
let eshopArtwork = envBool("COOK_ESHOP_ARTWORK", true);
// oc-scraper base URL (e.g. http://host:18765). Base games then carry Steam /
// IGDB / RAWG review scores from it, matched by title id. Empty turns it off.
const ratingsUrl = envString("COOK_RATINGS_URL", "").trim();
// CookingFoil's own rating collector: Steam always (no key), IGDB when a Twitch
// client id and secret are given. On by default; false turns the loop off.
let ratingSync = envBool("COOK_RATING_SYNC", true);
// Retro game details (description, publisher, release date, genres,
// screenshots) collected slowly from LaunchBox, and IGDB with its keys.
// false keeps what was collected and fetches nothing more.
let retroMeta = envBool("COOK_RETRO_META", true);
// Dropbox save sync for the client app: this server relays the Dropbox
// sign-in (PKCE, so only the app key, no secret). Empty turns it off.
const dropboxAppKey = envString("COOK_DROPBOX_APP_KEY", "").trim();
// The public address Dropbox sends the phone back to (https, registered in the
// Dropbox app). Only the sign-in callback uses it, so consoles on the LAN keep
// their LAN addresses, which COOK_PUBLIC_BASE_URL would replace everywhere.
const dropboxRedirectBase = normalizeBaseUrl(envString("COOK_DROPBOX_REDIRECT_BASE", ""));
// Google sign-in for the web (phone) pages: an OAuth "Web application" client.
// Both empty turns it off. The callback is <base>/auth/google/callback, where
// the base is COOK_GOOGLE_REDIRECT_BASE, else the Dropbox one, else the public URL.
const googleClientId = envString("COOK_GOOGLE_CLIENT_ID", "").trim();
const googleClientSecret = envString("COOK_GOOGLE_CLIENT_SECRET", "").trim();
const googleRedirectBase = normalizeBaseUrl(envString("COOK_GOOGLE_REDIRECT_BASE", ""));
const igdbClientId = envString("COOK_IGDB_CLIENT_ID", "").trim();
const igdbClientSecret = envString("COOK_IGDB_CLIENT_SECRET", "").trim();
// SteamGridDB API key (steamgriddb.com/profile/preferences/api): cover search when matching games by hand.
// First-run setup: while there is no account, browsers are sent to /setup to create
// the admin. false keeps an account-less server open (LAN-only servers, tests).
const firstRunSetup = envBool("COOK_FIRST_RUN_SETUP", true);
const steamGridDbKey = envString("COOK_STEAMGRIDDB_KEY", "").trim();
// User patches (mods, cheats) to hand to clients: <dir>/<base title id>/<patch>/.
// Missing folder means no patches.
const patchesDir = path.resolve(envString("COOK_PATCHES_DIR", "/patches"));
// Save files the shop hands out (a save with everything unlocked, …). Off until this folder exists.
const savesDir = path.resolve(envString("COOK_SAVES_DIR", "/saves"));
// Retro games, bezels and the RetroArch base pack. The feature is off until this folder exists.
const retroDir = path.resolve(envString("COOK_RETRO_DIR", path.join(dataDir, "retro")));
// Homebrew (.nro apps) for clients: hand-placed ones in <dir>/<app>/<app>.nro,
// plus the latest release of each GitHub repository in COOK_HOMEBREW_REPOS
// ("owner/name" or github.com addresses, separated by commas or spaces).
// /api/shop/info lists the "homebrew" feature only while at least one app is listed.
const homebrewDir = path.resolve(envString("COOK_HOMEBREW_DIR", "/homebrew"));
const homebrewRepos = envString("COOK_HOMEBREW_REPOS", "")
  .split(/[\s,]+/)
  .filter(Boolean);
// Optional; raises GitHub's limit of 60 unauthenticated requests an hour.
const githubToken = envString("COOK_GITHUB_TOKEN", "").trim();
// Operator alerts on Telegram (settings tab, or these as the fallback): the bot's token,
// the chat it writes to, and which events (comma list; empty means all).
const telegramBotToken = envString("COOK_TELEGRAM_BOT_TOKEN", "").trim();
const telegramChatId = envString("COOK_TELEGRAM_CHAT_ID", "").trim();
const telegramEvents = envString("COOK_TELEGRAM_EVENTS", "").trim();
// "on" puts [승인] [거절] buttons on approval alerts; off unless set.
const telegramButtons = envString("COOK_TELEGRAM_BUTTONS", "").trim().toLowerCase();
// Telegram user ids who may press them in a group chat (comma list).
const telegramApprovers = envString("COOK_TELEGRAM_APPROVERS", "").replace(/\s+/g, "");
// Hours between release checks of each followed repository; "check now" on the admin page ignores it.
const homebrewCheckHours = envNumber("COOK_HOMEBREW_CHECK_HOURS", 6, { min: 1 });

// Device pairing lane (CyberFoil). Opt-in and ADDITIVE: when on, the public
// /api/pair/* endpoints go live and an approved (deviceKey + accessKey) pair is
// accepted as an alternative to basic-auth. On unless set to false: QR (and the
// client downloaded from the web page) is how a console connects by default.
// For a pairing-ONLY server ("아무나 못붙음"), leave COOK_AUTH_USERS empty so the
// basic-auth lane is disabled and an approved device is the sole way in.
let devicePairing = envBool("COOK_DEVICE_PAIRING", true);
// Consoles that sign in with an ID and password (Basic): CyberFoil, Tinfoil and
// older CookingFoil builds. Off, only a console's access key or session token
// (a client downloaded from the web page, or QR pairing) gets in; the web page
// and the admin page sign in as before, and this machine itself still may.
// Off unless set to true: turn it on for Tinfoil, CyberFoil or older builds.
let consolePasswords = envBool("COOK_CONSOLE_PASSWORDS", false);
// With pairing on: a console that signs in with an account or its device login
// is approved on the spot (no QR scan), and gets its access key on its next
// pairing poll. Consoles with no sign-in still wait for approval. On unless set
// to false, which makes every console wait for the admin (manual approval).
// "all" approves every console that asks, signed in or not: for a server only
// your own consoles can reach.
const autoApproveMode = envString("COOK_DEVICE_AUTO_APPROVE", "true").trim().toLowerCase();
let deviceAutoApprove = !["false", "0", "no", "off"].includes(autoApproveMode);
let deviceAutoApproveAll = autoApproveMode === "all";

// titledb: fetched in the background and refreshed on a timer; the regions are
// the per-language name lists it reads (see titledb-fetcher.js DEFAULT_REGIONS).
let titledbAutoFetch = envBool("COOK_TITLEDB_AUTO_FETCH", true);
let titledbRegions = envString("COOK_TITLEDB_REGIONS", "").split(",").map((s) => s.trim()).filter(Boolean);
// Where titledb is read from: a base address holding <region>.json files. Empty is
// blawar/titledb itself; a fork or mirror goes here if that one ever stops.
let titledbSource = envString("COOK_TITLEDB_URL", "").trim().replace(/\/+$/, "");
// How many connections one console may open for one download (Range requests
// in parallel). Only advertised (X-CookingFoil-Max-Connections, /api/shop/info
// download.maxConnections), not enforced: the client opens up to this many.
let downloadMaxConnections = envNumber("COOK_DOWNLOAD_MAX_CONNECTIONS", 4, { min: 1, max: 8, integer: true });
// The direct download address (security/download-links.js, direct-lane.js): a
// proxy in front of this server that forwards only GET/HEAD downloads with a
// Bearer token. When set, signed-in clients that declare direct-token get a
// download token (valid downloadLinkTtl seconds) and their download URLs on it.
let publicDirectBaseUrl = normalizeBaseUrl(pickEnv("COOK_PUBLIC_DIRECT_BASE_URL"));
if (publicDirectBaseUrl && !publicDirectBaseUrl.startsWith("https://")) {
  process.stderr.write(`[oc-cookingfoil] COOK_PUBLIC_DIRECT_BASE_URL must be an https address; it is ignored.\n`);
  publicDirectBaseUrl = null;
}
let downloadLinkTtl = envNumber("COOK_DOWNLOAD_LINK_TTL", 21600, { min: 3600, max: 604800, integer: true });
// The secret the direct address's proxy sends as X-CookingFoil-Edge (direct-lane.js),
// so another container on the docker bridge can't pose as it. Compose only, never
// an admin setting; while it is empty the direct address serves nothing.
const directEdgeSecret = envString("COOK_DIRECT_EDGE_SECRET", "").trim();
// Safe restart (security/drain.js): the Retry-After a new request is given while
// the server drains, and how long running requests may take to finish before
// they are cut. At most 35 s, inside compose's stop_grace_period of 40 s.
let restartRetryAfter = envNumber("COOK_RESTART_RETRY_AFTER", 20, { min: 1, max: 300, integer: true });
let restartGrace = envNumber("COOK_RESTART_GRACE", 25, { min: 1, max: 35, integer: true });
// NSZ conversion queue (meta/nsz-queue.js): compresses .nsp files in the games
// folder to .nsz, run from the admin page's 변환 tab. Off until turned on there.
let nszEnabled = envBool("COOK_NSZ_ENABLED", false);
// New .nsp files the library finds are queued by themselves while the queue is on.
let nszAutoQueue = envBool("COOK_NSZ_AUTO_QUEUE", true);
// nsz -l (zstd level) and -t (threads); workers is how many files at once.
let nszLevel = envNumber("COOK_NSZ_LEVEL", 18, { min: 1, max: 22, integer: true });
let nszThreads = envNumber("COOK_NSZ_THREADS", 4, { min: 1, max: 32, integer: true });
let nszWorkers = envNumber("COOK_NSZ_WORKERS", 1, { min: 1, max: 3, integer: true });
// Files smaller than this are left as they are. A file starts only with its own size free (plus 1 GB);
// the floor, 0 unless set, keeps that much more free on top.
let nszMinSizeMb = envNumber("COOK_NSZ_MIN_SIZE_MB", 100, { min: 1, max: 1048576, integer: true });
let nszDiskFloorGb = envNumber("COOK_NSZ_DISK_FLOOR_GB", 0, { min: 0, max: 1048576, integer: true });
// nsz -B: block compression instead of solid. Off: the client is as fast with solid files.
let nszBlock = envBool("COOK_NSZ_BLOCK", false);
// .xci to .xcz as well. Off: the client's .xcz install is not verified on a device yet.
let nszXci = envBool("COOK_NSZ_XCI", false);

/*
 * Settings the admin page can change while the server runs (see
 * security/server-settings.js). ENV_SETTINGS is what compose set; the values
 * above are replaced by applyServerSettings, and because ES module exports are
 * live bindings every importer reads the new value on its next request.
 */
const ENV_SETTINGS = Object.freeze({
  devicePairing,
  consolePasswords,
  deviceApproval: deviceAutoApproveAll ? "all" : deviceAutoApprove ? "signin" : "manual",
  uploadsEnabled,
  inboxEnabled,
  inboxMaxBytes,
  inboxQuotaBytes,
  publicBaseUrl,
  extractIcons,
  langPriority: [...langPriority],
  titledbAutoFetch,
  titledbRegions: [...titledbRegions],
  titledbSource,
  eshopPrices,
  eshopPopularity,
  eshopArtwork,
  ratingSync,
  retroMeta,
  welcomeMessage,
  downloadMaxConnections,
  publicDirectBaseUrl: publicDirectBaseUrl || "",
  downloadLinkTtl,
  restartRetryAfter,
  restartGrace,
  nszEnabled,
  nszAutoQueue,
  nszLevel,
  nszThreads,
  nszWorkers,
  nszMinSizeMb,
  nszDiskFloorGb,
  nszBlock,
  nszXci,
});

/** Puts saved values over the compose ones; a key left out goes back to compose. */
function applyServerSettings(saved = {}) {
  const v = { ...ENV_SETTINGS, ...saved };
  devicePairing = v.devicePairing;
  consolePasswords = v.consolePasswords;
  deviceAutoApprove = v.deviceApproval !== "manual";
  deviceAutoApproveAll = v.deviceApproval === "all";
  uploadsEnabled = v.uploadsEnabled;
  inboxEnabled = v.inboxEnabled;
  inboxMaxBytes = v.inboxMaxBytes;
  inboxQuotaBytes = v.inboxQuotaBytes;
  publicBaseUrl = v.publicBaseUrl ? normalizeBaseUrl(v.publicBaseUrl) : null;
  extractIcons = v.extractIcons;
  langPriority = [...v.langPriority];
  titledbAutoFetch = v.titledbAutoFetch;
  titledbRegions = [...v.titledbRegions];
  titledbSource = v.titledbSource;
  eshopPrices = v.eshopPrices;
  eshopPopularity = v.eshopPopularity;
  eshopArtwork = v.eshopArtwork;
  ratingSync = v.ratingSync;
  retroMeta = v.retroMeta;
  welcomeMessage = v.welcomeMessage || null;
  downloadMaxConnections = v.downloadMaxConnections;
  publicDirectBaseUrl = v.publicDirectBaseUrl ? normalizeBaseUrl(v.publicDirectBaseUrl) : null;
  downloadLinkTtl = v.downloadLinkTtl;
  restartRetryAfter = v.restartRetryAfter;
  restartGrace = v.restartGrace;
  nszEnabled = v.nszEnabled;
  nszAutoQueue = v.nszAutoQueue;
  nszLevel = v.nszLevel;
  nszThreads = v.nszThreads;
  nszWorkers = v.nszWorkers;
  nszMinSizeMb = v.nszMinSizeMb;
  nszDiskFloorGb = v.nszDiskFloorGb;
  nszBlock = v.nszBlock;
  nszXci = v.nszXci;
}

export {
  ENV_SETTINGS,
  directEdgeSecret,
  downloadMaxConnections,
  publicDirectBaseUrl,
  downloadLinkTtl,
  restartRetryAfter,
  restartGrace,
  nszEnabled,
  nszAutoQueue,
  nszLevel,
  nszThreads,
  nszWorkers,
  nszMinSizeMb,
  nszDiskFloorGb,
  nszBlock,
  nszXci,
  applyServerSettings,
  titledbAutoFetch,
  titledbRegions,
  titledbSource,
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
  extractMaxGb,
  extractMaxBytes,
  extractPaceMs,
  emitTitledb,
  publicBaseUrl,
  adminTotpSecret,
  adminSessionHours,
  adminPassword,
  adminEmail,
  customEntriesPath,
  langPriority,
  uploadsDir,
  extractedMetaDir,
  uploadMaxBytes,
  uploadsEnabled,
  inboxEnabled,
  inboxMaxBytes,
  inboxQuotaBytes,
  eshopPrices,
  eshopPopularity,
  telegramBotToken,
  telegramChatId,
  telegramEvents,
  telegramButtons,
  telegramApprovers,
  eshopAlgoliaAppId,
  eshopAlgoliaKey,
  eshopArtwork,
  patchesDir,
  retroDir,
  savesDir,
  homebrewDir,
  homebrewRepos,
  githubToken,
  homebrewCheckHours,
  ratingsUrl,
  ratingSync,
  retroMeta,
  dropboxAppKey,
  dropboxRedirectBase,
  googleClientId,
  googleClientSecret,
  googleRedirectBase,
  igdbClientId,
  igdbClientSecret,
  steamGridDbKey,
  firstRunSetup,
  devicePairing,
  consolePasswords,
  deviceAutoApprove,
  deviceAutoApproveAll,
};
