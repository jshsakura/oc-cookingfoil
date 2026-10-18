import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// The /shop.json body: only `files`, each base, update and DLC named with its
// "[TITLEID][vVERSION]" tail, and nothing the internal item keeps for itself.
const PROBE = `
  import { composeResponse } from "../../src/create-index-content.js";
  const filesMap = new Map([
    ["Game.nsp", { url: "../Game.nsp", name: "Game", size: 1, mtime: 5,
      titleId: "0100000000010000", baseTitleId: "0100000000010000", kind: "base", version: 0, icon_url: "/api/shop/icon/0100000000010000" }],
    ["Game Update.nsp", { url: "../Game%20Update.nsp", name: "Game", size: 2,
      titleId: "0100000000010800", baseTitleId: "0100000000010000", kind: "update", version: 65536 }],
    ["tool.nro", { url: "../tool.nro", name: "tool", size: 3 }],
  ]);
  process.stdout.write(JSON.stringify(composeResponse(filesMap, [])));
`;

function compose() {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_EXTRACT_ICONS: "off" },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("the flat catalog carries files only, named with their title id and version", () => {
  const r = compose();
  assert.deepEqual(Object.keys(r), ["files"]);
  assert.deepEqual(r.files[0], {
    url: "../Game.nsp", name: "Game [0100000000010000][v0]", size: 1, mtime: 5,
    titleId: "0100000000010000", baseTitleId: "0100000000010000", kind: "base", icon_url: "/api/shop/icon/0100000000010000",
  });
  assert.equal(r.files[1].name, "Game [0100000000010800][v65536]");
  assert.equal(r.files[2].name, "tool", "a file with no title id keeps its name");
  assert.ok(r.files.every((f) => !("version" in f)), "the version rides in the name, as it always has");
});
