import { networkInterfaces } from "node:os";
import debug from "./debug.js";
import { romsDirPath } from "./helpers/envs.js";
import buildJsonContent from "./create-index-content.js";
import app from "./app-info.js";

/** The first non-loopback IPv4 address of this machine, or null. */
export function firstLanAddress(interfaces = networkInterfaces()) {
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs ?? []) {
      // Older Node versions report the family as the number 4.
      if ((a.family === "IPv4" || a.family === 4) && !a.internal) return a.address;
    }
  }
  return null;
}

/** Returns the listen callback: logs where the server is reachable, then builds the first catalog. */
export function onListening(port) {
  return async () => {
    debug.log(`------------------ CookingFoil Started v${app.version} ------------------`);
    const lan = firstLanAddress();
    if (lan) debug.log("CookingFoil listening at local-ip:", `http://${lan}:${port}`);
    else debug.error("Error getting local-ip");
    try {
      await buildJsonContent();
    } catch (err) {
      debug.error("error games data");
      debug.error(err);
    }
    debug.log("Folder path served: %s", romsDirPath);
  };
}
