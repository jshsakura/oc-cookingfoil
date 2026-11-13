// The Switch library's addresses answer a Switch console, the web and the admin; a console of another platform
// is told they are not for it, so it never takes a Switch file by mistake.
import * as store from "../security/store.js";
import { DEFAULT_PLATFORM } from "./index.js";

export const SWITCH_ONLY_PATHS = [
  "/api/library", "/api/homebrew", "/api/patches", "/api/saves", "/api/title", "/api/device/sends", "/api/firmware",
  "/api/retro/achievements", "/games.json",
];

/** The platform of the console a request came from, or null for the web, the admin and tokens without a console. */
export function requestPlatform(req) {
  const deviceKey = req.pairedDevice ?? req.sessionDevice;
  return deviceKey ? store.devicePlatform(deviceKey) ?? DEFAULT_PLATFORM : null;
}

export default function switchOnly() {
  return (req, res, next) => {
    const platform = requestPlatform(req);
    if (!platform || platform === DEFAULT_PLATFORM) return next();
    res.status(404).json({ error: "not for this platform", code: "platform" });
  };
}
