import express from "express";
import serveIndex from "serve-index";
import expressBasicAuth from "express-basic-auth";

import shopFileBuilder from "./shop-file-builder.js";
import { romsDirPath, appPort, unauthorizedMessage } from "./helpers/envs.js";
import { afterStartFunction } from "./afterStartFunction.js";
import { getUsersFromEnv } from "./authUsersParser.js";
import staticIndexHTML from "./staticIndexHTML.js";

const expressApp = express();

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

// Dynamic shop index for Tinfoil/CookingFoil-compatible clients.
expressApp.use(shopFileBuilder());

// Serve actual game files + a browser-friendly index of the games folder.
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
