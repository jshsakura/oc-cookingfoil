// The kinds of console the server knows. A console says which it is when it pairs (none said is a Switch),
// and keeps it: one device key never serves two platforms.
import switchPlatform from "./switch.js";
import vita from "./vita.js";

export const PLATFORMS = Object.freeze({ switch: switchPlatform, vita });
export const DEFAULT_PLATFORM = "switch";

/** A platform a console sent: undefined when it sent none, null when it is not one the server knows. */
export function parsePlatform(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && Object.hasOwn(PLATFORMS, value) ? value : null;
}
