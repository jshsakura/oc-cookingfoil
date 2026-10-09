import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The store reads its file at module load, so each scenario runs in a child.
function run(script, dataDir = mkdtempSync(path.join(tmpdir(), "cf-featured-"))) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import * as featured from "../../src/meta/featured.js";
    const out = await (async () => { ${script} })();
    process.stdout.write(JSON.stringify(out ?? null));
  `], { cwd: import.meta.dirname, env: { ...process.env, COOK_DATA_DIR: dataDir } });
  return { out: JSON.parse(out.toString()), dataDir };
}

const ZELDA = "01007EF00011E000";
const MARIO = "0100000000010000";

test("saved collections survive a restart and reach the sections by base id", () => {
  const { dataDir } = run(`featured.replace([{ title: " 이번 주 추천 ", bannerTitleId: "${MARIO.toLowerCase()}",
    titleIds: ["${ZELDA}", "${MARIO.toLowerCase()}", "${ZELDA}"] }]);`);
  const { out } = run(`return featured.forSections();`, dataDir);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "이번 주 추천");
  assert.deepEqual(out[0].title_ids, [ZELDA, MARIO], "ids are upper-cased and deduplicated, order kept");
  assert.equal(out[0].banner_url, `/api/shop/banner/${MARIO}`);
  assert.match(out[0].id, /^[a-z0-9-]+$/);
  assert.ok(readFileSync(path.join(dataDir, "featured.json"), "utf8").includes(ZELDA));
});

test("an empty collection is kept for the admin but not sent to clients", () => {
  const { out } = run(`featured.replace([{ title: "준비 중", titleIds: [] }]);
    return { admin: featured.list().length, wire: featured.forSections().length };`);
  assert.deepEqual(out, { admin: 1, wire: 0 });
});

test("updates, DLC, missing titles and a banner outside the row are refused or dropped", () => {
  const { out } = run(`
    const errors = [];
    for (const list of [
      [{ title: "x", titleIds: ["0100000000010800"] }],
      [{ title: "x", titleIds: ["0100000000011001"] }],
      [{ title: "", titleIds: [] }],
      "not a list",
    ]) { try { featured.replace(list); errors.push(null); } catch (e) { errors.push(e.code); } }
    featured.replace([{ title: "ok", bannerTitleId: "${ZELDA}", titleIds: ["${MARIO}"] }]);
    return { errors, banner: featured.list()[0].bannerTitleId };`);
  assert.deepEqual(out.errors, ["invalid-featured", "invalid-featured", "invalid-featured", "invalid-featured"]);
  assert.equal(out.banner, null);
});

test("sections carry the featured rows only when there are any", () => {
  const { out } = run(`
    const { composeSections } = await import("../../src/create-index-content.js");
    const before = "featured" in composeSections(new Map(), []);
    featured.replace([{ title: "추천", titleIds: ["${ZELDA}"] }]);
    return { before, after: composeSections(new Map(), []).featured };`);
  assert.equal(out.before, false);
  assert.deepEqual(out.after.map((f) => f.title_ids), [[ZELDA]]);
});
