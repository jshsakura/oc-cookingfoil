import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Requests for one origin that arrive together share one compressed variant instead of each
// compressing the whole catalog, and a rebuild serves the new catalog on the next request.
const PROBE = `
  import fs from "node:fs";
  import path from "node:path";
  import * as libraryCache from "../../src/meta/library-cache.js";
  const origin = "https://example.org";
  const first = await Promise.all(Array.from({ length: 20 }, () => libraryCache.getEncodedForOrigin(["br"], origin)));
  const shared = first.every((p) => p.body === first[0].body);
  // The rebuild timer does not hold the process open by itself.
  const alive = setInterval(() => {}, 1000);
  const rebuilt = new Promise((resolve) => libraryCache.onUpdate(resolve));
  fs.writeFileSync(path.join(process.env.COOK_GAMES_DIR, "Zelda [0100000000020000][v0].nsp"), "x");
  libraryCache.invalidate({ rescan: true });
  await rebuilt;
  clearInterval(alive);
  const after = await libraryCache.getEncodedForOrigin([], origin);
  process.stdout.write(JSON.stringify({ shared, fresh: after.body.toString("utf-8").includes("0100000000020000") }));
  await libraryCache.stop();
`;

test("concurrent requests for one origin share one variant, and a rebuild serves the new catalog", () => {
  const games = mkdtempSync(path.join(tmpdir(), "cook-games-"));
  const data = mkdtempSync(path.join(tmpdir(), "cook-data-"));
  writeFileSync(path.join(games, "Mario [0100000000010000][v0].nsp"), "x");
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_GAMES_DIR: games, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off" },
    encoding: "utf-8",
    timeout: 30_000,
  });
  assert.deepEqual(JSON.parse(out), { shared: true, fresh: true });
});
