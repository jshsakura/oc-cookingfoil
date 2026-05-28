import express from "express";
import serveIndex from "serve-index";
import expressBasicAuth from "express-basic-auth";

import shopFileBuilder from "./shop-file-builder.js";
import iconRoute from "./routes/icon.js";
import bannerRoute from "./routes/banner.js";
import screenshotRoute from "./routes/screenshot.js";
import landingRoute from "./routes/landing.js";
import { bootstrap as bootstrapTitledb } from "./meta/titledb-bootstrap.js";
import * as shopCache from "./meta/shop-cache.js";
import debug from "./debug.js";
import { romsDirPath, appPort, unauthorizedMessage } from "./helpers/envs.js";
import { afterStartFunction } from "./afterStartFunction.js";
import { getUsersFromEnv } from "./authUsersParser.js";
import staticIndexHTML from "./staticIndexHTML.js";

const expressApp = express();

// Basic auth covers everything below it — shop responses, file downloads,
// AND the icon endpoint. No anonymous leak (FINDINGS §6).
const basicAuthUsers = getUsersFromEnv();
if (basicAuthUsers) {
  expressApp.use(
    expressBasicAuth({
      users: basicAuthUsers,
      unauthorizedResponse: unauthorizedMessage,
      challenge: true,
    })
  );
}

// Locally-cached artwork. First request fetches from Nintendo's eShop CDN
// via the URL stored in titledb; subsequent requests serve from disk. The
// Switch client (Tinfoil/CyberFoil) hits these auto-derived URLs.
expressApp.get("/api/shop/icon/:titleId", iconRoute);
expressApp.get("/api/shop/banner/:titleId", bannerRoute);
expressApp.get("/api/shop/screenshot/:titleId/:idx", screenshotRoute);

// Friendly dashboard for human visitors hitting the root in a browser.
// Goes BEFORE the shop builder + static so that exactly `/` returns the
// landing page; everything else (`/shop.json`, file downloads, dir listings)
// is unaffected.
expressApp.get("/", landingRoute);

// Dynamic shop index for Tinfoil/CookingFoil-compatible clients.
expressApp.use(shopFileBuilder());

// Static file serving + a browser-friendly listing of the games folder.
expressApp.use(express.static(romsDirPath));
expressApp.use(
  serveIndex(romsDirPath, {
    icons: true,
    hidden: false,
    template: staticIndexHTML,
  })
);

const server = expressApp.listen(appPort, afterStartFunction(appPort));

// Load cached titledb synchronously and, if the cache is cold, kick off a
// background fetch. Never blocks listen — see meta/titledb-bootstrap.js.
bootstrapTitledb().catch((err) =>
  debug.error("titledb bootstrap failed:", err.message)
);

// Build the shop response once and keep it warm via chokidar — no more
// fast-glob scan on every request.
shopCache.init().catch((err) =>
  debug.error("shop cache init failed:", err.message)
);

export default server;
