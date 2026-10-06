import pkg from "../package.js";
import { revision } from "./custom-art.js";
const version = pkg.version.split(".").slice(0, 2).join(".");
export function versionedArtwork(path) {
  const base = /\/(?:icon|banner|screenshot)\/([A-F0-9]{16})(?:\/|$)/.exec(path)?.[1];
  const changed = base ? revision(base) : 0;
  return `${path}?v=${version}${changed ? "&art=" + changed : ""}`;
}
