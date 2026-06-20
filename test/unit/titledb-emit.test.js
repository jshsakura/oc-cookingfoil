import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// COOK_EMIT_TITLEDB gates whether the shop response carries the top-level
// `titledb` map. It is read once at module load (helpers/envs.js), so each
// case runs in its own child process with the env pinned up front.
//
// Why this matters: emitting titledb makes CyberFoil/AeroFoil render a
// url-less, unselectable "ghost" row per title. Default OFF keeps the catalog
// selectable on the priority clients. See helpers/envs.js for the full note.

// A single base-title file is enough to force a titledb entry to be built.
const PROBE = `
  import { composeResponse } from "../../src/create-index-content.js";
  const filesMap = new Map([[
    "Game.nsp",
    { url: "../Game.nsp", name: "Game", size: 1,
      titleId: "0100000000010000", baseTitleId: "0100000000010000", kind: "base" },
  ]]);
  const r = composeResponse(filesMap, []);
  process.stdout.write(JSON.stringify({
    hasTitledb: Object.prototype.hasOwnProperty.call(r, "titledb"),
    files: r.files.length,
  }));
`;

function runProbe(env) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_EXTRACT_ICONS: "off", ...env },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("composeResponse: omits top-level titledb by default (CyberFoil-safe)", () => {
  const r = runProbe({ COOK_EMIT_TITLEDB: "" });
  assert.equal(r.hasTitledb, false);
  assert.equal(r.files, 1);
});

test("composeResponse: emits titledb when COOK_EMIT_TITLEDB=true (stock Tinfoil)", () => {
  const r = runProbe({ COOK_EMIT_TITLEDB: "true" });
  assert.equal(r.hasTitledb, true);
  assert.equal(r.files, 1);
});
