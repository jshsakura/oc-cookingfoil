import localIpAddress from "local-ip-address";
import debug from "./debug.js";
import { romsDirPath } from "./helpers/envs.js";
import buildJsonContent from "./create-index-content.js";
import pkg from "./package.js";

function afterStartFunction(appPort) {
  return async function () {
    debug.log(`------------------ CookingFoil Started v${pkg.version} ------------------`)
    try {
      debug.log(
        "CookingFoil listening at local-ip:",
        `http://${localIpAddress()}:${appPort}`
      );
    } catch (err) {
      debug.error("Error getting local-ip");
      debug.error(err);
    }
    try {
      await buildJsonContent();
    } catch (err) {
      debug.error("error games data");
      debug.error(err);
    }
    debug.log("Folder path served: %s", romsDirPath);
  };
}
export { afterStartFunction };
