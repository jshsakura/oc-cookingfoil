import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Kept originals and work files sit in dot folders the library scan never lists.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-nsz-scan-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_GAMES_DIR = path.join(root, "games");
const { scanLibrary } = await import("../../src/create-index-content.js");
const { KEEP_DIR_NAME, WORK_DIR_NAME } = await import("../../src/meta/nsz-queue.js");
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("the library scan skips the keep and work folders", async () => {
  const games = process.env.COOK_GAMES_DIR;
  for (const rel of ["Game [0100000000010000][v0].nsz", `${KEEP_DIR_NAME}/abcdefabcdef/Game [0100000000010000][v0].nsp`, `${WORK_DIR_NAME}/abcdefabcdef/Other [0100000000020000][v0].nsz`]) {
    fs.mkdirSync(path.dirname(path.join(games, rel)), { recursive: true });
    fs.writeFileSync(path.join(games, rel), "x");
  }
  const { filesMap } = await scanLibrary();
  assert.deepEqual([...filesMap.keys()], ["Game [0100000000010000][v0].nsz"]);
});
