import { test } from "node:test";
import assert from "node:assert/strict";
import { over, readCeilings, scanSource, scanTree } from "../../scripts/design-scan.mjs";
import { rewrite } from "../../scripts/design-codemod.mjs";

// Admin CSS goes through the tokens in src/routes/admin/styles.js (the client's scale): no hex
// colour, no px font size or corner radius, no weight besides 400 and 700. The ceilings in
// test/fixtures/design-ceilings.json only go down; a panel that needs a new value adds a token.

test("raw colours, px sizes and radii and in-between weights are counted; tokens are not", () => {
  const c = scanSource(".a{color:#fff;font-size:13px;border-radius:12px;font-weight:600}\n.b{color:var(--text);font-size:var(--fs-sm);border-top-left-radius:var(--r-lg);font-weight:700}");
  assert.deepEqual(c, { hex: 1, fontSize: 1, radius: 1, weight: 1 });
});

test("the token definitions themselves are not counted", () => {
  assert.deepEqual(scanSource("const LIGHT = `--bg:#f2f1ee;--panel:#ffffff;\n--r-lg:12px`;"), { hex: 0, fontSize: 0, radius: 0, weight: 0 });
});

test("the codemod snaps sizes, radii and weights to the nearest step", () => {
  const { out } = rewrite(".a{font-size:12.5px;border-radius:100px;font-weight:600}.b{font-size:15px;border-radius:9px;font-weight:500}.c{border-radius:0px}");
  assert.equal(out, ".a{font-size:var(--fs-xs);border-radius:var(--r-pill);font-weight:var(--fw-bold)}.b{font-size:var(--fs-md);border-radius:var(--r-md);font-weight:var(--fw)}.c{border-radius:0px}");
});

test("no admin file has more raw values than its ceiling", () => {
  const bad = over(scanTree(), readCeilings());
  assert.deepEqual(bad, [], bad.map((b) => `${b.file} ${b.rule}: ${b.count} > ${b.ceiling} (use a token from styles.js SCALE)`).join("\n"));
});
