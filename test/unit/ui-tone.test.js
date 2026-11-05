import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// UI words end in 합니다체. The chat's example lines are what a person types, so they stay as a person says them.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /[.](js|html)$/.test(e.name) ? [p] : [];
});

test("no screen asks in 해요체", () => {
  const found = walk("src").flatMap((file) => fs.readFileSync(file, "utf8").split("\n")
    .map((line, i) => (line.includes("주세요") && !/"ch[.]uex\d/.test(line) ? `${file}:${i + 1}` : null))
    .filter(Boolean));
  assert.deepEqual(found, []);
});
