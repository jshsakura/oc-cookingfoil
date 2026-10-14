import { test } from "node:test";
import assert from "node:assert/strict";
import { pathProblem, pathProblems, describeProblems, MAX_PATH } from "../../src/meta/console-paths.js";

// Every path a console is told to create must be one its SD card can create.
test("printable ASCII paths pass, spaces inside a name included", () => {
  for (const p of ["switch/app/app.nro", "switch/app/Audio/SE/Battle wild.ogg", "atmosphere/contents/0100000000010000/romfs/a-b_c.d", "switch/app/Plugins/Luka's Scripting Utilities/meta.txt",
    "switch/dragonball-z-rpg/.engine/mkxp-z.nro", "switch/app/.cf-1a2b.part"]) {
    assert.equal(pathProblem(p), null, p);
  }
});

test("other scripts, FAT's reserved characters and odd segments are refused", () => {
  for (const p of ["switch/pokemon-survivor-burst/설치-스위치.md", "switch/app/café.txt", "switch/app/a:b", "switch/app/a?b", "switch/app/a\\b",
    "switch/app/a|b", "switch/app/\"q\"", "switch/app/<x>", "switch/app/a*", "/switch/app/x", "switch//x", "switch/app/ lead", "switch/app/trail ",
    "switch/app/dot.", "switch/./x", "switch/../x", "switch/app/tab\tx", "", `switch/${"a".repeat(256)}`, `switch/${"a/".repeat(MAX_PATH / 2)}x`]) {
    assert.notEqual(pathProblem(p), null, JSON.stringify(p));
  }
});

test("problems are listed per path and summarised for a message", () => {
  const problems = pathProblems(["switch/a/ok.bin", "switch/a/한.md", "switch/a/b?.bin"]);
  assert.deepEqual(problems.map((x) => x.path), ["switch/a/한.md", "switch/a/b?.bin"]);
  assert.match(describeProblems(problems, 1), /switch\/a\/한\.md \(.+\) 외 1개/);
});
