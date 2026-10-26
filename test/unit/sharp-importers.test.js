import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// A picture from outside becomes a kept picture in src/meta/art-ingest.js and nowhere else. A module that
// imports sharp is either that, or one of these, each for a reason that is not "ingest". A new one needs
// the same: say here why it only draws from, measures or serves pictures the server already keeps.
const ALLOWED = {
  "src/meta/art-ingest.js": "the one place a picture from outside is shrunk and kept",
  "src/meta/art-crop.js": "measures and cuts an area of the admin's own upload; the kept copy is shrunk by art-ingest",
  "src/meta/custom-art.js": "asks whether a file is a picture sharp can read; writes nothing",
  "src/meta/icon-banner.js": "draws a banner from an icon already kept",
  "src/meta/icon-variant.js": "serves a sized copy of a kept icon",
  "src/meta/image-cache.js": "makes the sized copies served to clients from a kept picture",
  "src/retro/art/sync.js": "measures a cover (the shrinking itself is art-ingest's)",
  "src/meta/homebrew-nro-icon.js": "draws the 256-px JPEG icon put into an app's .nro from a kept picture",
  "src/retro/square-art.js": "draws square art from a kept picture",
};

function importers(dir = "src", out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) importers(p, out);
    else if (p.endsWith(".js") && /from "sharp"|require\("sharp"\)|import\("sharp"\)/.test(fs.readFileSync(p, "utf8"))) out.push(p.split(path.sep).join("/"));
  }
  return out;
}

test("only the listed modules import sharp", () => {
  assert.deepEqual(importers().sort(), Object.keys(ALLOWED).sort(), "a module that takes pictures from outside must use shrink() from src/meta/art-ingest.js; one that only draws or measures is listed here with its reason");
});
