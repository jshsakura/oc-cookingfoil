import express from "express";
import serveIndex from "serve-index";

import shopFileBuilder from "./shop-file-builder.js";
import iconRoute from "./routes/icon.js";
import bannerRoute from "./routes/banner.js";
import screenshotRoute from "./routes/screenshot.js";
import landingRoute from "./routes/landing.js";
import adminRouter, { adminEnabled } from "./routes/admin.js";

import defensiveHeaders from "./security/headers.js";
import accessGuard from "./security/access-guard.js";
import rateLimit from "./security/rate-limit.js";
import authGuard from "./security/auth-guard.js";
import * as securityStore from "./security/store.js";

import { bootstrap as bootstrapTitledb } from "./meta/titledb-bootstrap.js";
import * as shopCache from "./meta/shop-cache.js";
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
expressApp.use(rateLimit());

if (adminEnabled) {
  expressApp.use("/api/admin", adminRouter());
}

expressApp.use(accessGuard());
expressApp.use(authGuard());

// ── routes ──────────────────────────────────────────────────────────────
// Locally-cached artwork. First request fetches from Nintendo's eShop CDN
// via the URL stored in titledb; subsequent requests serve from disk.
expressApp.get("/api/shop/icon/:titleId", iconRoute);
expressApp.get("/api/shop/banner/:titleId", bannerRoute);
expressApp.get("/api/shop/screenshot/:titleId/:idx", screenshotRoute);

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

securityStore
  .load()
  .catch((err) => debug.error("security store load failed:", err.message));

bootstrapTitledb().catch((err) =>
  debug.error("titledb bootstrap failed:", err.message)
);

shopCache.init().catch((err) =>
  debug.error("shop cache init failed:", err.message)
);

// Flush security state on graceful shutdown.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    debug.log("received %s — flushing security state", sig);
    securityStore
      .shutdown()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

export default server;
