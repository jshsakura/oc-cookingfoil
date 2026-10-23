import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DIRECT_DELETES } from "../../src/library/direct-deletes.js";

// Everything that is not a database row is deleted through the trash (trash-service.js discard).
// A direct fs rm/unlink needs an entry in src/library/direct-deletes.js saying why it is not a
// person's or the library's file.
const LIST = "src/library/direct-deletes.js";
// fs.rm, fsp.unlink, a destructured rm(...), rmdir with recursive, and rm run as a program.
const DELETE_RE = /(?<![\w$])(?:rmSync|unlinkSync|rm|unlink)\s*\(|\.(?:rm|unlink|rmSync|unlinkSync)\s*\(|\brmdir(?:Sync)?\s*\([^)\n]*recursive|["']rm["']\s*,\s*\[/g;
// Only falls: a file leaves `todo` once it uses discard().
const TODO_CEILING = 3;

function sourceCounts(dir = "src", out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceCounts(p, out);
    else if (p.endsWith(".js")) {
      const n = (fs.readFileSync(p, "utf8").match(DELETE_RE) ?? []).length;
      if (n) out[p.split(path.sep).join("/")] = n;
    }
  }
  return out;
}

test("every direct delete is listed with its reason, and the list is exact", () => {
  const found = sourceCounts();
  const problems = [];
  for (const [file, n] of Object.entries(found)) {
    const listed = DIRECT_DELETES[file];
    if (!listed) problems.push(`${file} deletes directly (${n}x): use discard() from src/library/trash-service.js, or list it in ${LIST} if it only deletes what the server can make again`);
    else if (listed.count !== n) problems.push(`${file} has ${n} direct deletes, ${LIST} says ${listed.count}: ${n > listed.count ? "a new one must use discard() or be explained there" : "lower the count there"}`);
  }
  for (const file of Object.keys(DIRECT_DELETES)) if (!found[file]) problems.push(`${file} no longer deletes directly: remove it from ${LIST}`);
  assert.deepEqual(problems, []);
});

test("files still deleting what a person owns only get fewer", () => {
  const todo = Object.entries(DIRECT_DELETES).filter(([, v]) => v.todo).map(([k]) => k);
  assert.ok(todo.length <= TODO_CEILING, `${todo.length} todo entries in ${LIST}, ceiling ${TODO_CEILING}: move the new one to discard()`);
  if (todo.length < TODO_CEILING) assert.fail(`only ${todo.length} todo entries left: lower TODO_CEILING to ${todo.length}`);
});
