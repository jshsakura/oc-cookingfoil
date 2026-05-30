import express from "express";
import serveIndex from "serve-index";

import shopFileBuilder from "./shop-file-builder.js";
import iconRoute from "./routes/icon.js";
import bannerRoute from "./routes/banner.js";
import screenshotRoute from "./routes/screenshot.js";
import extrasRoute from "./routes/extras.js";
import connectUrlRoute from "./routes/connect-url.js";
import landingRoute from "./routes/landing.js";
import adminRouter, { adminEnabled } from "./routes/admin.js";
import uploadsRouter from "./routes/uploads.js";
import artRouter from "./routes/art.js";
import adminPageRouter from "./routes/admin-page.js";
import {
  adminTotpEnabled,
  provisioningUri,
  selfTest as adminSelfTest,
} from "./security/admin-session.js";

import defensiveHeaders from "./security/headers.js";
import accessGuard from "./security/access-guard.js";
import rateLimit from "./security/rate-limit.js";
import authGuard from "./security/auth-guard.js";
import * as securityStore from "./security/store.js";

import { bootstrap as bootstrapTitledb } from "./meta/titledb-bootstrap.js";
import * as shopCache from "./meta/shop-cache.js";
import * as customArt from "./meta/custom-art.js";
import * as extractedMeta from "./meta/extracted-meta-store.js";
import { attach as attachWs } from "./realtime/ws-server.js";
import debug from "./debug.js";
import { romsDirPath, appPort } from "./helpers/envs.js";
import { afterStartFunction } from "./afterStartFunction.js";
import staticIndexHTML from "./staticIndexHTML.js";

const expressApp = express();
expressApp.disable("x-powered-by");
if (process.env.COOK_TRUST_PROXY === "true") {
  // Required when running behind nginx/caddy/etc., so req.ip reflects the
  // real client instead of the proxy and rate-limit/lockout per-IP works.
  expressApp.set("trust proxy", true);
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
//   5. auth guard        (basic-auth + 5-strike lockout)
expressApp.use(defensiveHeaders());

// /healthz must answer WITHOUT basic-auth so Docker / Portainer / k8s
// healthchecks don't have to embed credentials. Mounted before the rest
// of the perimeter so it also bypasses rate-limit + access-guard +
// auth-guard. Returns 200 once the shop cache has produced a snapshot
// (cold boot returns 503 — that's the period during which orchestrators
// SHOULD keep the container in "starting" state, not declare it healthy).
expressApp.get("/healthz", async (_req, res) => {
  const s = shopCache.stats();
  // titledb diagnostics live here too — a quick at-a-glance of WHICH
  // region files actually landed (US.en presence / size matters for the
  // English-alias decoration on CJK display names). Lazy-imported to
  // keep the top of the file clean.
  let tdb = null;
  try {
    const store = await import("./meta/titledb-store.js");
    tdb = store.status();
  } catch { /* ignore */ }

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
      }));
    return;
  }
  res
    .status(503)
    .type("application/json")
    .send(JSON.stringify({ ok: false, reason: "shop cache initializing", titledb: tdb }));
});

expressApp.use(rateLimit());

if (adminEnabled) {
  expressApp.use("/api/admin", adminRouter());
}

expressApp.use(accessGuard());
expressApp.use(authGuard());

// ── routes ──────────────────────────────────────────────────────────────
// Authenticated upload tray (disabled by default — flip COOK_UPLOADS_ENABLED).
expressApp.use("/api/uploads", uploadsRouter());
// Authenticated title-artwork overrides (same opt-in flag as the upload tray).
expressApp.use("/api/art", artRouter());

// Locally-cached artwork. First request fetches from Nintendo's eShop CDN
// via the URL stored in titledb; subsequent requests serve from disk.
expressApp.get("/api/shop/icon/:titleId", iconRoute);
expressApp.get("/api/shop/banner/:titleId", bannerRoute);
expressApp.get("/api/shop/screenshot/:titleId/:idx", screenshotRoute);

// Web-only: auxiliary files (mods/patches/zips) in a title's folder that the
// Tinfoil shop can't install but the dashboard can list + download.
expressApp.get("/api/title/:baseTitleId/extras", extrasRoute);

// Copy-paste-ready shop URL for the authenticated visitor (weaves their own
// basic-auth credentials into the live origin).
expressApp.get("/api/connect-url", connectUrlRoute);

// 2FA-gated operator dashboard (inside the basic-auth perimeter). 404s when
// COOK_ADMIN_TOTP_SECRET is unset.
expressApp.use("/admin", adminPageRouter());

// Browser dashboard for the literal `/` path. Other GETs fall through to
// the shop builder, static files, and the serve-index listing.
expressApp.get("/", landingRoute);

// Dynamic shop index for Tinfoil/CookingFoil-compatible clients.
expressApp.use(shopFileBuilder());

// File downloads + a directory listing for the games folder.
expressApp.use(express.static(romsDirPath));
expressApp.use(
  serveIndex(romsDirPath, {
    icons: true,
    hidden: false,
    template: staticIndexHTML,
  })
);

// ── lifecycle ───────────────────────────────────────────────────────────
const server = expressApp.listen(appPort, afterStartFunction(appPort));

// Disable Nagle on accepted sockets. Our hot responses are single Buffers
// (pre-built shop body, encoded landing HTML, single small image variants);
// Nagle's 40 ms coalescing delay only delays the inevitable last segment.
// At LAN distances this is the difference between a snappy dashboard and
// a perceptibly laggy one.
server.on("connection", (socket) => socket.setNoDelay(true));

securityStore
  .load()
  .catch((err) => debug.error("security store load failed:", err.message));

// Hydrate any previously-extracted NACP metadata before the shop cache
// runs its first compose, so the fallback layer is already populated.
extractedMeta
  .load()
  .catch((err) => debug.error("extracted-meta load failed:", err.message));

bootstrapTitledb().catch((err) =>
  debug.error("titledb bootstrap failed:", err.message)
);

shopCache.init().catch((err) =>
  debug.error("shop cache init failed:", err.message)
);

// Seed the custom-art override index from disk so the icon/banner/screenshot
// routes can do a zero-syscall "is there an override?" check on the hot path.
customArt.init().catch((err) =>
  debug.error("custom-art init failed:", err.message)
);

// Admin 2FA: validate the configured secret and surface the enrollment URI in
// the logs (never over HTTP) so the operator can add it to an authenticator.
if (adminTotpEnabled()) {
  adminSelfTest().then(async (ok) => {
    if (!ok) {
      debug.error("admin 2fa: COOK_ADMIN_TOTP_SECRET is not a valid base32 secret — /admin disabled in practice");
      return;
    }
    const uri = await provisioningUri();
    // Print unconditionally (not via DEBUG) — the operator needs this URI to
    // enroll the secret in their authenticator app on first boot.
    process.stdout.write(
      `[oc-cookingfoil] /admin 2FA enabled. Enroll in your authenticator:\n` +
      `[oc-cookingfoil] ${uri}\n`
    );
  });
} else {
  debug.log("admin 2fa: /admin disabled (set COOK_ADMIN_TOTP_SECRET to enable)");
}

// Realtime push channel for the dashboard. Mounted on the same HTTP
// server so it shares port + auth context with the rest of the API.
const wsHandle = attachWs(server);

// Flush security state on graceful shutdown.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    debug.log("received %s — flushing security state", sig);
    try { wsHandle.close(); } catch {}
    securityStore
      .shutdown()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

export default server;
