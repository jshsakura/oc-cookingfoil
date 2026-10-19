// First: the server does not run without the key its secrets are sealed with.
import "./security/require-secret-key.js";
import { SHARE_LANGS, shareImagePath } from "./views/share-meta.js";
import express from "express";
import net from "net";
import http from "http";
import { fileURLToPath } from "node:url";
// Settings saved on the admin page go over the compose ones before anything reads them.
import "./security/server-settings.js";

import iconRoute from "./routes/icon.js";
import sectionsRoute from "./routes/sections.js";
import bannerRoute from "./routes/banner.js";
import screenshotRoute from "./routes/screenshot.js";
import extrasRoute from "./routes/extras.js";
import shopInfoRoute from "./routes/shop-info.js";
import titleDetailRoute from "./routes/title-detail.js";
import clientConfigRoute from "./routes/client-config.js";
import shopJsonRoute from "./routes/shop-json.js";
import landingRoute from "./routes/landing.js";
import activityRouter from "./routes/activity.js";
import webAssets from "./routes/web-assets.js";
import adminRouter, { adminEnabled } from "./routes/admin.js";
import uploadsRouter from "./routes/uploads.js";
import inboxRouter from "./routes/inbox.js";
import artRouter from "./routes/art.js";
import adminPageRouter from "./routes/admin-page.js";
import {
  adminTotpEnabled,
  hasValidSession,
  selfTest as adminSelfTest,
} from "./security/admin-session.js";
import { isPrivateCaller } from "./security/net.js";
import {
  isEnrolled as adminEnrolled,
  secretSource as adminSecretSource,
  rotateUnenrolledSecret,
} from "./security/admin-secret.js";
import { logConfigHealth } from "./security/config-health.js";

import defensiveHeaders from "./security/headers.js";
import accessGuard from "./security/access-guard.js";
import rateLimit from "./security/rate-limit.js";
import noCrawl from "./security/no-crawl.js";
import { largeFiles, hiddenPaths, GAME_FILE_RE } from "./helpers/file-send.js";
import connectionHint from "./helpers/connection-hint.js";
import directLane, { looksProxied, laneOf } from "./security/direct-lane.js";
import transferLog from "./helpers/transfer-log.js";
import { trackTransfers } from "./helpers/transfer-track.js";
import * as directHealth from "./security/direct-health.js";
import { tokenHeader as downloadTokenHeader } from "./security/download-links.js";
import busyGuard from "./security/busy-guard.js";
import drainer, { RESTART_EXIT_CODE } from "./security/drain.js";
import authGuard, { ignoreBasic } from "./security/auth-guard.js";
import pairingGate from "./security/pairing-gate.js";
import sessionGate from "./security/session-gate.js";
import adminOnly from "./security/admin-only.js";
import { sameOriginWrites } from "./security/same-origin.js";
import sessionRoute from "./routes/session.js";
import deviceContentGuard from "./security/device-content-guard.js";
import pairRouter from "./routes/pair.js";
import webLoginRouter from "./routes/web-login.js";
import setupRouter from "./routes/setup.js";
import { needsSetup, setupCode } from "./security/setup.js";
import devicePairRouter from "./routes/device-pair.js";
import raLinkRouter from "./routes/ra-link.js";
import retroRouter from "./routes/retro.js";
import savesRouter, { savesCatalog, savesEnabled, watchSaves } from "./routes/saves.js";
import clientUpdateRouter from "./routes/client-update.js";
import { dropboxSessionsRouter, dropboxCallback, BRIDGE_PATH } from "./routes/dropbox-bridge.js";
import patchesRouter from "./routes/patches.js";
import { homebrewRouter, start as startHomebrew } from "./routes/homebrew.js";
import * as folderSync from "./meta/folder-sync.js";
import * as backups from "./db/backup.js";
import * as userPatches from "./meta/user-patches.js";
import nszQueue, { start as startNszQueue } from "./meta/nsz-service.js";
import verifyQueue, { start as startVerifyQueue } from "./meta/verify-service.js";
import { loadPrices } from "./meta/eshop-price.js";
import * as ratingSync from "./meta/rating-sync.js";
import * as securityStore from "./security/store.js";

import { bootstrap as bootstrapTitledb } from "./meta/titledb-bootstrap.js";
import * as shopCache from "./meta/shop-cache.js";
import * as customArt from "./meta/custom-art.js";
import * as extractedMeta from "./meta/extracted-meta-store.js";
import { attach as attachWs } from "./realtime/ws-server.js";
import debug from "./debug.js";
import { romsDirPath, appPort, dataDir, retroDir } from "./helpers/envs.js";
import { oldRetroLeftBehind } from "./helpers/folder-hints.js";
import { trustProxy } from "./helpers/trust-proxy.js";
import { afterStartFunction } from "./afterStartFunction.js";
import { alert } from "./helpers/alerts.js";
import * as telegramUpdates from "./security/telegram-updates.js";

// Node gives each address of a host 250 ms before trying the next. Telegram,
// GitHub and the CDNs sit far enough away on this line that every address
// timed out in turn and the whole request failed after a second.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const expressApp = express();
expressApp.disable("x-powered-by");
if (trustProxy) {
  // Required when running behind nginx/caddy/cloudflared, so req.ip reflects
  // the real client instead of the proxy and rate-limit/lockout per-IP works.
  expressApp.set("trust proxy", trustProxy);
}

// ── security perimeter ──────────────────────────────────────────────────
// Order matters. Admin endpoints are mounted BEFORE the IP-lockout gate
// so the legitimate admin can always recover — otherwise locking your own
// IP from anywhere on the world would brick the box until restart.
//   1. defensive headers (every response, including errors)
//   2. rate limit        (per-IP token bucket — applies to admin too,
//                          so the admin token still can't be brute-forced)
//   3. admin router      (bearer-protected internally; bypasses lockout)
//   4. access guard      (block probes / traversal / locked IPs)
//   5. auth guard        (device keys, sessions, web sign-in; 5-strike lockout)
expressApp.use(defensiveHeaders());
// Safe restart: while the server drains, new requests get 503 + Retry-After and
// running ones finish (security/drain.js). First, so nothing below starts new work.
expressApp.use(drainer.middleware());
// The direct address carries downloads only: the health page below is mounted
// ahead of the token lane, so a request from that address's proxy never sees it.
expressApp.use("/healthz", (req, res, next) => (looksProxied(req) ? res.status(404).end() : next()));

// /healthz must answer WITHOUT credentials so Docker / Portainer / k8s
// healthchecks don't have to embed credentials. Mounted before the rest
// of the perimeter so it also bypasses rate-limit + access-guard +
// auth-guard. Returns 200 once the shop cache has produced a snapshot
// (cold boot returns 503 — that's the period during which orchestrators
// SHOULD keep the container in "starting" state, not declare it healthy).
// Callers from outside (through a tunnel, a public address) learn only whether it is up:
// the counts, titledb regions, keys and the direct address's state stay on the
// home network and the admin page (its session cookie).
expressApp.get("/healthz", async (req, res) => {
  const s = shopCache.stats();
  const outside = Boolean(req.get("cf-connecting-ip")) || !isPrivateCaller(req);
  if (outside && !hasValidSession(req)) {
    res.status(s.cached ? 200 : 503).set("Cache-Control", "no-store").json({ ok: Boolean(s.cached) });
    return;
  }
  // titledb diagnostics live here too — a quick at-a-glance of WHICH
  // region files actually landed (US.en presence / size matters for the
  // English-alias decoration on CJK display names). Lazy-imported to
  // keep the top of the file clean.
  let tdb = null;
  try {
    const store = await import("./meta/titledb-store.js");
    tdb = store.status();
  } catch { /* ignore */ }

  // name-source health — WHY names resolve (titledb) or collapse to filenames
  // (no titledb + no keys). Machine-readable so Docker/k8s/curl can alert on it.
  // Lazy-imported + best-effort: a probe failure must never take /healthz down.
  let nameHealth = null;
  try {
    const nh = await import("./meta/name-health.js");
    nameHealth = await nh.getNameHealth();
  } catch { /* ignore — /healthz stays up without the field */ }

  if (s.cached) {
    res
      .status(200)
      .type("application/json")
      .send(JSON.stringify({
        ok: true,
        files: s.files,
        buildCount: s.buildCount,
        uptime: Math.round(process.uptime()),
        titledb: tdb && {
          titles: tdb.titles,
          regions: tdb.regions, // [{region, file, count, format}]
          loadedAt: tdb.loadedAt,
        },
        nameHealth,
        directDownload: directHealth.status(),
        ...drainer.healthFields(),
      }));
    return;
  }
  res
    .status(503)
    .type("application/json")
    .send(JSON.stringify({ ok: false, reason: "shop cache initializing", titledb: tdb, nameHealth, ...drainer.healthFields() }));
});

// A server that has fallen behind says so at once (503 + Retry-After) instead of holding connections.
expressApp.use(busyGuard());
expressApp.use(rateLimit());
// The direct address is watched while requests come in (at most once a minute; it only alerts).
expressApp.use((_req, _res, next) => {
  directHealth.touch();
  next();
});
// The download routers, made once: the shop mounts them below and the token lane shares them.
const downloadRouters = {
  "/api/patches": patchesRouter(),
  "/api/homebrew": homebrewRouter(),
  "/api/saves": savesRouter(),
  "/api/client": clientUpdateRouter(),
  "/api/retro": retroRouter(),
};
// Downloads on the direct address (through its proxy, with a download token) are
// answered here, without the sign-in; every other request goes on through the stack below.
expressApp.use(directLane(romsDirPath, { routes: downloadRouters }));

if (adminEnabled) {
  expressApp.use("/api/admin", adminRouter());
}

expressApp.use(accessGuard());
// Crawlers ask for this first; answering before sign-in keeps them out of the
// failure log and tells them there is nothing to index.
expressApp.get("/robots.txt", (_req, res) => res.type("text/plain").set("Cache-Control", "public, max-age=86400").send("User-agent: *\nDisallow: /\n"));
// Crawlers that say who they are get nothing past robots.txt, not even the sign-in page.
expressApp.use(noCrawl());
// The share images, one per language: link previews fetch them without signing in.
for (const lang of SHARE_LANGS) {
  const where = shareImagePath(lang);
  const file = fileURLToPath(new URL(`./views${where}`, import.meta.url));
  expressApp.get(where, (_req, res) => res.sendFile(file, { maxAge: "1d" }));
}
// First run: until an admin account exists, browsers are sent to /setup.
expressApp.use(setupRouter());

// Public device-pairing endpoints. Deliberately OUTSIDE the sign-in wall, a
// console asking to pair has nothing to sign in with yet, but still inside
// rate-limiting + the probe access-guard. 404s unless COOK_DEVICE_PAIRING=true.
// The only routes where a console's ID and password (Basic) count, once, to approve it.
expressApp.use("/api/pair", pairRouter());
// The phone page a console's RetroAchievements QR opens: the one-time code in the link is its only key.
expressApp.use(raLinkRouter());
// Past this point a Basic header is no credential: dropped, so the request is
// judged by its keys, session token or cookie alone.
expressApp.use(ignoreBasic);
// Dropbox sign-in callback: opened by the phone's browser, so outside the
// shop's sign-in like pairing. The session endpoints are inside it (below).
expressApp.get(`${BRIDGE_PATH}/oauth/dropbox/callback`, dropboxCallback);
// The sign-in page (ID and password, or Google) and the phone's device approval.
expressApp.use(webLoginRouter());

// Device auth lane: an approved (deviceKey + accessKey) authenticates here and
// tags the request so authGuard lets it through below. No-op when
// COOK_DEVICE_PAIRING is off.
expressApp.use(pairingGate());
// Session lane: a console that traded its access key for a session token (GET /api/session) sends only that.
expressApp.use(sessionGate());
expressApp.use(authGuard());
expressApp.get("/api/session", sessionRoute);
// Signed-in clients that declare direct-token get their download token on every response.
expressApp.use(downloadTokenHeader());
// Lists and downloads tell the client how many connections a download may use.
expressApp.use(connectionHint());
expressApp.use("/api/activity", activityRouter());
expressApp.use("/assets", webAssets);

// Pairing-only shops must guard API content as well as the legacy shop/files.
// Keep admin approval and clean configuration export reachable for onboarding.
expressApp.use(["/api/shop", "/api/title", "/api/uploads", "/api/art", "/api/patches", "/api/homebrew", "/api/retro", "/api/saves", "/api/client", BRIDGE_PATH], deviceContentGuard());

// ── routes ──────────────────────────────────────────────────────────────
// Authenticated upload tray (disabled by default — flip COOK_UPLOADS_ENABLED).
// Uploads and artwork change what everyone sees: admin accounts only (the upload list too).
// The sign-in cookie rides along on a sibling site's POST (SameSite=Lax), so another site's Origin is refused first.
expressApp.use("/api/uploads", sameOriginWrites(), adminOnly({ reads: true }), uploadsRouter());
// The temporary share inbox: files, a memo and links from people signed in on the web page.
expressApp.use("/api/inbox", inboxRouter());
// Authenticated title-artwork overrides (same opt-in flag as the upload tray).
expressApp.use("/api/art", sameOriginWrites(), adminOnly(), artRouter());

// Locally-cached artwork. First request fetches from the eShop CDN
// via the URL stored in titledb; subsequent requests serve from disk.
expressApp.get("/api/shop/icon/:titleId", iconRoute);
expressApp.get("/api/shop/banner/:titleId", bannerRoute);
expressApp.get("/api/shop/screenshot/:titleId/:idx", screenshotRoute);

// The catalog the CookingFoil client and the web page read, and the server's features.
expressApp.get("/api/shop/sections", sectionsRoute);
expressApp.get("/api/shop/info", shopInfoRoute);
// The flat file list for automation holding an admin-issued API token.
expressApp.get("/shop.json", shopJsonRoute);

// Web-only: auxiliary files (mods/patches/zips) in a title's folder, which a
// console does not install but the web page can list + download.
expressApp.get("/api/title/:baseTitleId/extras", extrasRoute);

// Download records (helpers/transfer-log.js): the download routes and, below, the games folder.
expressApp.use(Object.keys(downloadRouters), trackTransfers({ match: (p) => laneOf(p) === "route" }));

// User patches (mods, cheats) a client installs onto the SD card itself.
expressApp.use("/api/patches", downloadRouters["/api/patches"]);
// Homebrew (.nro apps): hand-placed ones and the latest GitHub releases.
expressApp.use("/api/homebrew", downloadRouters["/api/homebrew"]);

// Save files the shop hands out (off until COOK_SAVES_DIR exists).
expressApp.use("/api/saves", downloadRouters["/api/saves"]);
expressApp.use("/api/client", downloadRouters["/api/client"]);

// Retro games, bezels and the RetroArch base pack (off until COOK_RETRO_DIR exists).
expressApp.use("/api/retro", downloadRouters["/api/retro"]);

// Dropbox save sync: sign-in sessions for the client app (COOK_DROPBOX_APP_KEY).
expressApp.use(BRIDGE_PATH, dropboxSessionsRouter());

// On-demand rich metadata (description, publisher, screenshots, …) for one
// title. Surfaces titledb detail the shop response intentionally omits — the
// dashboard modal and the remote client's detail panel both read this.
expressApp.get("/api/title/:baseTitleId", titleDetailRoute);

expressApp.get("/api/client-config", clientConfigRoute);

// Device approval for signed-in users: the console's QR opens here (COOK_DEVICE_PAIRING).
expressApp.use("/pair", devicePairRouter());

// 2FA-gated operator dashboard (behind the web sign-in). 404s when
// COOK_ADMIN_TOTP_SECRET is unset.
expressApp.use("/admin", adminPageRouter());

// The web page.
expressApp.get("/", landingRoute);

// Lock game downloads to approved devices when pairing is the SOLE lane
// (COOK_DEVICE_PAIRING on + no accounts). No-op otherwise: authGuard already
// gates this when accounts exist.
expressApp.use(deviceContentGuard());

// File downloads from the games folder. Game files are read in large pieces (helpers/file-send.js).
// Nothing inside a dot-folder (the NSZ work folder, .git, ...) is served, encoded or not.
expressApp.use(hiddenPaths());
expressApp.use(trackTransfers({ match: (p) => !p.endsWith("/") }));
expressApp.use(largeFiles(romsDirPath, GAME_FILE_RE));
expressApp.use(express.static(romsDirPath, { dotfiles: "ignore" }));

// Errors any handler passed on: their status, a short reason, and the details in
// the server log only. Express's own page shows the stack and this machine's
// paths whenever NODE_ENV is not production (anything run outside Docker).
expressApp.use((err, req, res, next) => {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) debug.error("request %s %s failed: %s", req.method, req.originalUrl, err?.stack ?? err);
  if (res.headersSent) return res.destroy();
  res.status(status).type("text/plain").send(status >= 500 ? "Internal Server Error\n" : `${http.STATUS_CODES[status] ?? "Error"}\n`);
});

// ── lifecycle ───────────────────────────────────────────────────────────
const server = expressApp.listen(appPort, afterStartFunction(appPort));
// Presses on the approval alerts' buttons, while Telegram is set up and buttons are on.
telegramUpdates.watch();

// Disable Nagle on accepted sockets. Our hot responses are single Buffers
// (pre-built shop body, encoded landing HTML, single small image variants);
// Nagle's 40 ms coalescing delay only delays the inevitable last segment.
// At LAN distances this is the difference between a snappy dashboard and
// a perceptibly laggy one.
server.on("connection", (socket) => socket.setNoDelay(true));

transferLog
  .load()
  .catch((err) => debug.error("transfers load failed:", err.message));

// Without its state (approved consoles, lockouts) the server must not serve: it would let
// the next save write an empty state over the one it could not read.
securityStore.load().catch((err) => {
  debug.error("security store load failed, stopping: %s", err.message);
  process.exit(1);
});

// Hydrate any previously-extracted NACP metadata before the shop cache
// runs its first compose, so the fallback layer is already populated.
extractedMeta
  .load()
  .catch((err) => debug.error("extracted-meta load failed:", err.message));

bootstrapTitledb()
  .catch((err) => debug.error("titledb bootstrap failed:", err.message))
  // Once the titledb store has (re)loaded, surface the name-source verdict in
  // the boot log so a deployment with no titledb + no keys screams instead of
  // silently serving filename garbage. WARN (err namespace) when filename-only.
  .finally(() => {
    import("./meta/name-health.js")
      .then((nh) => nh.logNameHealth())
      .catch((err) => debug.error("name-health boot log failed:", err.message));
  });

// Saved eShop prices first, so the first sections build already has them.
loadPrices();
shopCache.init().catch((err) =>
  debug.error("shop cache init failed:", err.message)
);

// User patches: scanned now and every minute; a change recomposes the patch counts.
userPatches.start({ onChange: () => shopCache.invalidate() });
// Homebrew repositories: checked now, then each at most once per COOK_HOMEBREW_CHECK_HOURS.
startHomebrew();
// The direct address: checked now, then while requests come in; a change is only told (log, Telegram).
// The start alert waits for that first check (at most CHECK_TIMEOUT_MS) and says how it went.
directHealth
  .start()
  .catch(() => {})
  .then(() => alert("server", ["서버가 켜졌습니다.", directHealth.startLine()].filter(Boolean).join(" ")));
// Review scores from Steam (and IGDB with keys), collected in paced batches; new ones recompose the list.
ratingSync.start({ onChange: () => shopCache.invalidate() });

// The NSZ conversion queue: empties its work folder, resumes a run left going, follows the library.
startNszQueue();
// The file check: signatures of every game file, the whole-file hash of new ones; it only informs.
startVerifyQueue();

// The saves folder holds tens of thousands of files: read it once now, not on the first request.
if (savesEnabled()) {
  savesCatalog().warm();
  watchSaves();
  folderSync.start();
  backups.start();
}

// Seed the custom-art override index from disk so the icon/banner/screenshot
// routes can do a zero-syscall "is there an override?" check on the hot path.
customArt.init().then(() => shopCache.invalidate()).catch((err) =>
  debug.error("custom-art init failed:", err.message)
);

// Which auth lanes are live, and does that combination lock out a client the
// operator expects to work? Printed unconditionally — a silent misconfiguration
// here is exactly what makes downloads "fail with no error".
logConfigHealth();

// The compose file used to keep retro ROMs in data/retro; it now mounts its own folder.
const oldRetro = oldRetroLeftBehind(dataDir, retroDir);
if (oldRetro) debug.error("retro: %s has files but %s is empty; move them over (compose now mounts its own retro folder)", oldRetro, retroDir);

// Admin 2FA: validate the secret and surface the enrollment URI in the logs so
// the operator can add it to an authenticator without shell-diving.
if (needsSetup()) {
  // Printed unconditionally: only someone who can read this log may claim the server.
  process.stdout.write(
    `[oc-cookingfoil] No accounts yet. Open /setup in a browser and enter this setup code: ${setupCode()}\n` +
    `[oc-cookingfoil] (it changes on every start)\n`
  );
}
if (adminTotpEnabled()) {
  adminSelfTest().then(async (ok) => {
    if (!ok) {
      debug.error("admin 2fa: the TOTP secret is not valid base32 — /admin cannot verify codes");
      return;
    }
    if (adminEnrolled()) {
      debug.log("admin 2fa: enrolled (%s secret)", adminSecretSource());
      return;
    }
    // /setup registers a fresh secret; this one would only confuse.
    if (needsSetup()) return;
    // Older versions printed the otpauth:// URI here; a secret that may sit in a log is replaced.
    if (rotateUnenrolledSecret()) debug.log("admin 2fa: replaced the unenrolled secret that older versions logged");
    // The secret itself never goes to the log: it is shown only on the admin page.
    process.stdout.write(
      `[oc-cookingfoil] /admin 2FA not enrolled yet. Register an authenticator in the admin page's settings tab\n` +
      `[oc-cookingfoil] (or open /admin from your local network before the first sign-in)\n`
    );
  });
}

// Realtime push channel for the dashboard. Mounted on the same HTTP
// server so it shares port + auth context with the rest of the API.
const wsHandle = attachWs(server);

// Safe restart on SIGTERM/SIGINT (docker stop, compose up) and from the admin
// page: stop taking new requests, tell the dashboards, let running downloads
// finish up to the grace limit, then flush the security state and exit. The
// container's restart policy starts it again. A second signal exits at once;
// a signal during a drain the admin page started joins that drain instead.
const restartOptions = (exitCode) => ({
  server,
  exitCode,
  announce: (notice) => wsHandle.broadcast({ type: "restarting", ...notice }),
  cleanup: async () => {
    try { wsHandle.close(); } catch {}
    // A running conversion is stopped and waits again after the restart.
    await nszQueue.shutdown().catch(() => {});
    await verifyQueue.shutdown().catch(() => {});
    telegramUpdates.stop().catch(() => {});
    await transferLog.shutdown().catch(() => {});
    await securityStore.shutdown().catch(() => {});
  },
  log: debug.log,
});
// From the admin page: exit non-zero (75) so Restart=on-failure supervisors start it again too.
drainer.onRestartRequest(() => drainer.shutdown(restartOptions(RESTART_EXIT_CODE)));
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => drainer.signal(sig, {
    ...restartOptions(0),
    force: () => (nszQueue.killNow(), securityStore.shutdown()).catch(() => {}).finally(() => process.exit(0)),
  }));
}

export default server;
