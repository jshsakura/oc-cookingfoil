import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// getState() must populate filesMap even when called before any explicit
// build(). This is the warm-restart hazard: tryHydrateFromDisk() restores
// `cached` (so /shop.tfl serves at once) but leaves filesMap null, and get()
// short-circuits on `cached`. Without getState() forcing a build,
// /api/shop/sections would report an empty library right after a restart while
// /shop.tfl serves the full snapshot. Runs in a child process so env + module
// state are isolated.

const PROBE = `
  import * as shopCache from "../../src/meta/shop-cache.js";
  const { filesMap } = await shopCache.getState();   // called first — filesMap starts null
  process.stdout.write(JSON.stringify({ size: filesMap ? filesMap.size : null }));
`;

test("getState() builds filesMap when it is still null (warm-restart safety)", () => {
  const games = mkdtempSync(path.join(tmpdir(), "cook-games-"));
  const data = mkdtempSync(path.join(tmpdir(), "cook-data-"));
  writeFileSync(path.join(games, "Mario [0100000000010000][v0].nsp"), "x");

  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      COOK_GAMES_DIR: games,
      COOK_DATA_DIR: data,
      COOK_EXTRACT_ICONS: "off",
    },
    encoding: "utf-8",
  });
  const { size } = JSON.parse(out);
  assert.equal(size, 1); // built + populated, not an empty/null library
});
