import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A base title absent from titledb must still surface a real name from the
// NACP data extracted out of the container (COOK_EXTRACT_ICONS), instead of
// collapsing to its filename — which, for token-only filenames, is the bare
// "[TITLEID][vVER]" string. Fallback order: titledb → extracted NACP →
// filename. The id below is synthetic but WELL-FORMED (a real base id ends in
// "000", so groupTitleId == titleId and the extracted-meta lookup key matches).
// extracted-meta is read at module load, so the probe runs in a child process
// with COOK_DATA_DIR pinned to a fixture dir.
const BASE_ID = "0100000000ABC000";

const PROBE = `
  import * as extractedMeta from "../../src/meta/extracted-meta-store.js";
  import { composeSections } from "../../src/create-index-content.js";
  await extractedMeta.load();
  const fm = new Map([
    ["[${BASE_ID}][v0].nsp",       { url: "../hb.nsp", name: "", size: 1 }], // NACP-covered
    ["[0100000000FFF000][v0].nsp", { url: "../un.nsp", name: "", size: 1 }], // neither source
  ]);
  const items = composeSections(fm, []).sections[0].items;
  process.stdout.write(JSON.stringify(items.map((i) => ({ t: i.title_id, n: i.name }))));
`;

test("composeSections: NACP-extracted name fills in when titledb lacks the title", () => {
  const dd = mkdtempSync(path.join(tmpdir(), "cook-nacp-"));
  try {
    mkdirSync(path.join(dd, "extracted-meta"), { recursive: true });
    writeFileSync(
      path.join(dd, "extracted-meta", `${BASE_ID}.json`),
      JSON.stringify({ name: "Cool Homebrew", publisher: "IndieDev" })
    );

    const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
      cwd: import.meta.dirname,
      env: { ...process.env, COOK_DATA_DIR: dd, COOK_EXTRACT_ICONS: "off" },
      encoding: "utf-8",
    });
    const items = JSON.parse(out);
    const covered = items.find((i) => i.t === BASE_ID);
    const uncovered = items.find((i) => i.t === "0100000000FFF000");

    // titledb absent → extracted NACP name wins over the filename.
    assert.equal(covered.n, "Cool Homebrew");
    // No titledb AND no extraction → last-resort filename (bare tokens here).
    assert.equal(uncovered.n, "[0100000000FFF000][v0]");
  } finally {
    rmSync(dd, { recursive: true, force: true });
  }
});
