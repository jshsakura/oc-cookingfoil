import { readFileSync } from "node:fs";

// The manifest sits one level above src/.
const manifestUrl = new URL("../package.json", import.meta.url);

export default JSON.parse(readFileSync(manifestUrl, "utf8"));
