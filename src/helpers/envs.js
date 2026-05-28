import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import path from "path";
import fileDirName from "./helpers.js";

const { __dirname } = fileDirName(import.meta);

const gamesPath = process.env.COOK_GAMES_DIR ?? path.join(__dirname, "/../../games/");
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

export {
  romsDirPath,
  jsonTemplatePath,
  appPort,
  authUsers,
  unauthorizedMessage,
  welcomeMessage,
};
