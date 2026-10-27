import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The owner asked twice for no accent-coloured border on a button that is on (a switch, a pressed
// filter, a selected choice): the switch or the fill already shows the state.
const ROOTS = ["src/routes", "src/views"];
const ACTIVE = /\[aria-(?:checked|pressed|selected)="?true"?\]/;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.(js|html)$/.test(d.name) ? [p] : [];
  });
}

test("no on, pressed or selected state paints an accent border", () => {
  const found = [];
  for (const file of ROOTS.flatMap(files)) {
    for (const [, selector, body] of fs.readFileSync(file, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (ACTIVE.test(selector) && /border(?:-color)?:[^;}]*var\(--accent\)/.test(body)) found.push(`${file}: ${selector.trim().slice(-80)}`);
    }
  }
  assert.deepEqual(found, []);
});
