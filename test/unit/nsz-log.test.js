import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNszLog } from "../../src/meta/nsz-log.js";

// The conversion log: appended, capped by writing the newest lines again, read newest first.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-nsz-log-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("lines past the cap are dropped oldest first, and pages come newest first with a name search", () => {
  const log = createNszLog(path.join(root, "a.jsonl"), { max: 5 });
  for (let n = 0; n < 8; n++) log.append({ at: n, id: `id${n}`, rel: `G${n}.nsp`, name: n === 7 ? "Zelda" : null, event: "converted" });
  assert.equal(fs.readFileSync(log.file, "utf8").trim().split("\n").length, 5);
  const p = log.page({ limit: 2 });
  assert.deepEqual([p.total, p.items.map((e) => e.rel)], [5, ["G7.nsp", "G6.nsp"]]);
  assert.deepEqual(log.page({ offset: 4, limit: 2 }).items.map((e) => e.rel), ["G3.nsp"]);
  assert.deepEqual(log.page({ q: "zel" }).items.map((e) => e.id), ["id7"]);
  assert.deepEqual(log.page({ q: "g4" }).items.map((e) => e.id), ["id4"]);
});

test("no file yet reads as empty", () => {
  assert.deepEqual(createNszLog(path.join(root, "none.jsonl")).page(), { items: [], total: 0, offset: 0, limit: 50 });
});
