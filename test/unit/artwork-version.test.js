import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
test("uploaded artwork changes native cache URLs and preserves other titles", () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-art-version-"));
  try {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import sharp from "sharp";
      import * as art from "../../src/meta/custom-art.js";
      import { versionedArtwork } from "../../src/meta/artwork-version.js";
      import { composeSections } from "../../src/create-index-content.js";
      await art.init();
      const base = "0100000000ABC000";
      const image = await sharp({create:{width:2,height:2,channels:3,background:"#FFC23D"}}).jpeg().toBuffer();
      const icon = "/api/shop/icon/" + base;
      const other = "/api/shop/icon/0100000000DEF000";
      const before = versionedArtwork(icon), untouched = versionedArtwork(other);
      await art.put(base, "icon", null, image);
      const first = versionedArtwork(icon);
      await art.put(base, "icon", null, image);
      const second = versionedArtwork(icon);
      const sections = composeSections(new Map([["Game ["+base+"][v0].nsp", {size:10}]]), []);
      const sectionIcon = sections.sections[0].items[0].icon_url;
      await art.init();
      const restarted = versionedArtwork(icon);
      await art.remove(base, "icon", null);
      process.stdout.write(JSON.stringify({before,first,second,sectionIcon,restarted,removed:versionedArtwork(icon),untouched,other:versionedArtwork(other)}));
    `], { cwd: import.meta.dirname, env: { ...process.env, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off" }, encoding: "utf8" });
    const result = JSON.parse(output);
    assert.notEqual(result.first, result.before);
    assert.notEqual(result.second, result.first);
    assert.equal(result.sectionIcon, result.second);
    assert.match(result.restarted, /&art=\d+$/);
    assert.equal(result.removed, result.before);
    assert.equal(result.other, result.untouched);
  } finally { rmSync(data, { recursive: true, force: true }); }
});
