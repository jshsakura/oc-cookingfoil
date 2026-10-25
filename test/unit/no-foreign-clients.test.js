import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The repository names no other shop client. LICENSE keeps the MIT copyright line of the
// project this started from, and THIRD_PARTY_NOTICES.md records that origin; both are required.
const ROOT = path.resolve(import.meta.dirname, "../..");
const KEEP = new Set(["LICENSE", "THIRD_PARTY_NOTICES.md", "test/unit/no-foreign-clients.test.js"]);
const NAMES = /tinfoil|cyberfoil/i;

test("no tracked file names another shop client", (t) => {
  let files;
  try {
    files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf-8" }).split("\0").filter(Boolean);
  } catch {
    t.skip("git is not available here");
    return;
  }
  const hits = [];
  for (const f of files) {
    if (KEEP.has(f) || /\.(png|jpe?g|webp|gif|ico|nro|npdm|zip|gz|ttf|woff2?)$/i.test(f) || path.basename(f) === "main") continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), "utf-8"); } catch { continue; }
    text.split("\n").forEach((line, i) => { if (NAMES.test(line)) hits.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(hits, [], "remove these mentions");
});
