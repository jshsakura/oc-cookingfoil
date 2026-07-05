import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// getSectionsEncodedForOrigin() must return the full catalog even when called
// before any explicit build(). This is the warm-restart hazard:
// tryHydrateFromDisk() restores `cached` (so /shop.tfl serves at once) but
// leaves filesMap null, and get() short-circuits on `cached`. Without the
// build-when-null guard, /api/shop/sections would report an EMPTY library
// right after a restart while /shop.tfl serves the full snapshot — exactly
// when CyberFoil clients reconnect. Runs in a child process so env + module
// state are isolated.

const PROBE = `
  import * as shopCache from "../../src/meta/shop-cache.js";
  // Called first — filesMap starts null. Identity encoding + no origin so we
  // can parse the body directly.
  const payload = await shopCache.getSectionsEncodedForOrigin([], "");
  const body = JSON.parse(payload.body.toString("utf-8"));
  const items = body.sections?.[0]?.items ?? [];
  process.stdout.write(JSON.stringify({ count: items.length, name: items[0]?.name }));
`;

test("getSectionsEncodedForOrigin builds when filesMap is null (warm-restart safety)", () => {
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
  const { count, name } = JSON.parse(out);
  assert.equal(count, 1); // full catalog, not an empty/null library
  assert.equal(name, "Mario"); // clean name (no titledb → filename)
});
