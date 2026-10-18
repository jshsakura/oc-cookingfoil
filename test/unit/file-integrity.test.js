import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// What the file check found reaches the sections items (feature "item-integrity")
// and the title detail, only for files with something to say.

const PROBE = `
  import { composeSections } from "../../src/create-index-content.js";
  import * as fileIntegrity from "../../src/meta/file-integrity.js";
  import { integrityFor } from "../../src/routes/title-detail.js";
  const verdicts = { "Mario [0100000000010000][v0].nsp": "modified", "Mario Update [0100000000010800][v65536].nsp": "damaged" };
  fileIntegrity.provide((rel) => verdicts[rel] ?? null);
  const filesMap = new Map([
    ["Mario [0100000000010000][v0].nsp", { url: "../Mario.nsp", name: "Mario [0100000000010000][v0]", size: 1 }],
    ["Mario Update [0100000000010800][v65536].nsp", { url: "../MarioU.nsp", name: "Mario [0100000000010800][v65536]", size: 1 }],
    ["Zelda [0100000000020000][v0].nsp", { url: "../Zelda.nsp", name: "Zelda [0100000000020000][v0]", size: 1 }],
  ]);
  const items = composeSections(filesMap, []).sections[0].items.map((i) => [i.title_id, i.integrity ?? null]);
  const detail = integrityFor("0100000000010000", [
    { rel: "Mario [0100000000010000][v0].nsp", kind: "base", titleId: "0100000000010000", baseTitleId: "0100000000010000" },
    { rel: "sub/Mario Update [0100000000010800][v65536].nsp", kind: "update", titleId: "0100000000010800", baseTitleId: "0100000000010000" },
    { rel: "Zelda [0100000000020000][v0].nsp", kind: "base", titleId: "0100000000020000", baseTitleId: "0100000000020000" },
  ]);
  process.stdout.write(JSON.stringify({ items, detail }));
`;

function run() {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_EXTRACT_ICONS: "off" },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("sections items carry integrity only when the file was found modified or damaged", () => {
  const { items } = run();
  assert.deepEqual(Object.fromEntries(items), { "0100000000010000": "modified", "0100000000010800": "damaged", "0100000000020000": null });
});

test("the title detail lists the flagged files of that title by name and kind", () => {
  const { detail } = run();
  assert.deepEqual(detail, [{ file: "Mario [0100000000010000][v0].nsp", kind: "base", titleId: "0100000000010000", verdict: "modified" }]);
});
