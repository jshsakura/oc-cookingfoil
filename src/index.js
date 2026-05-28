import express from "express";
import serveIndex from "serve-index";
import expressBasicAuth from "express-basic-auth";

import shopFileBuilder from "./shop-file-builder.js";
import iconRoute from "./routes/icon.js";
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

// Locally-extracted (or placeholder) icons. CyberFoil/AeroFoil auto-derive
// this URL from titleId when `icon_url` is omitted from a shop entry.
expressApp.get("/api/shop/icon/:titleId", iconRoute);

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

export default server;
