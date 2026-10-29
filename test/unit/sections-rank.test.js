import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// The sections items carry a rank for every base game, so a client sorting by popularity never falls back
// to name order: a game consoles finished downloading comes before one nobody did, newest release after that.

const BUSY = "0100000000020000";
const NEW = "0100000000030000";
const OLD = "0100000000040000";

const PROBE = `
  import { appDb } from "../../src/db/database.js";
  import { recordCompleted } from "../../src/meta/own-popularity.js";
  import { composeSections } from "../../src/create-index-content.js";
  for (const id of ["aaaa0000", "bbbb1111"]) {
    recordCompleted({ complete: true, endedAt: Date.now(), who: { kind: "device", id }, file: { path: "/g/Game [${BUSY}][v0].nsp" } });
  }
  appDb();
  const file = (tid) => ["Game [" + tid + "][v0].nsp", { url: "../" + tid + ".nsp", name: "Game [" + tid + "][v0]", size: 1 }];
  const body = composeSections(new Map([file("${OLD}"), file("${NEW}"), file("${BUSY}")]), []);
  process.stdout.write(JSON.stringify(body.sections[0].items.map((i) => [i.title_id, i.rank ?? null])));
`;

test("every base game gets a rank: the most finished first, the rest in a fixed order after it", () => {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_EXTRACT_ICONS: "off", COOK_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "sections-rank-")) },
    encoding: "utf-8",
  });
  const rank = Object.fromEntries(JSON.parse(out));
  assert.equal(Object.values(rank).filter((r) => r > 0).length, 3);
  assert.equal(rank[BUSY], 1);
  assert.deepEqual([rank[NEW], rank[OLD]].sort(), [2, 3]);
});
