import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createTidy, keptFolders } = await import("../../src/library/tidy.js");
const { recordMove, undoMove } = await import("../../src/library/journal.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;

function setup(names = {}) {
  const dir = path.join(tmp, String(n++));
  fs.mkdirSync(dir, { recursive: true });
  const root = { key: "games", dir };
  const put = (rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), rel);
  };
  const list = (d = dir, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) list(abs, out);
      else out.push(path.relative(dir, abs).split(path.sep).join("/"));
    }
    return out.sort();
  };
  const collect = async (rels) => {
    const out = [];
    for (const rel of rels) {
      const abs = path.join(dir, rel);
      const files = fs.statSync(abs).isDirectory() ? list(abs).map((r) => path.join(dir, r)) : [abs];
      for (const f of files) { const st = fs.statSync(f); out.push({ name: path.basename(f), real: f, size: st.size, mtime: st.mtime }); }
    }
    return out;
  };
  const { identityFromName } = { identityFromName: (rel) => {
    const m = /\[([0-9A-F]{16})\](?:\[v(\d+)\])?/i.exec(rel);
    if (!m) return null;
    const id = m[1].toUpperCase();
    const kind = id.endsWith("000") ? "base" : id.endsWith("800") ? "update" : "dlc";
    return { titleId: id, version: m[2] ? Number(m[2]) : null, kind, baseTitleId: kind === "update" ? id.slice(0, 13) + "000" : id };
  } };
  const tidy = createTidy({
    root: () => root,
    collect,
    identify: async ({ rel }) => ({ id: identityFromName(rel), source: "name" }),
    romsRels: async () => list(),
    adminName: () => null,
    titledbName: (tid) => names[tid] ?? null,
    journal: recordMove,
  });
  return { dir, root, put, list, tidy };
}

test("a messy folder becomes one folder per game with update/, after a preview, and goes back on undo", async () => {
  const { root, put, list, tidy } = setup({ "0100000000010000": "Alpha Quest" });
  put("dump/alpha [0100000000010000][v0].nsp");
  put("dump/alpha patch [0100000000010800][v65536].nsp");
  put("loose [0100000000010800][v131072].nsp");
  const plan = await tidy.plan(["dump", "loose [0100000000010800][v131072].nsp"], "ko");
  assert.deepEqual(plan.moves.map((m) => m.to).sort(), [
    "dump/Alpha Quest [0100000000010000][v0].nsp",
    "dump/update/Alpha Quest [0100000000010800][v131072].nsp",
    "dump/update/Alpha Quest [0100000000010800][v65536].nsp",
  ]);
  assert.deepEqual(list(), ["dump/alpha [0100000000010000][v0].nsp", "dump/alpha patch [0100000000010800][v65536].nsp", "loose [0100000000010800][v131072].nsp"], "a plan moves nothing");

  const out = await tidy.apply(["dump", "loose [0100000000010800][v131072].nsp"], plan.moves);
  assert.equal(out.moved.length, 3);
  assert.deepEqual(list(), plan.moves.map((m) => m.to).sort());
  assert.deepEqual((await tidy.plan(["dump"])).moves, [], "a tidy folder stays as it is");

  for (const m of out.moved) await undoMove([root], m.undo);
  assert.deepEqual(list(), ["dump/alpha [0100000000010000][v0].nsp", "dump/alpha patch [0100000000010800][v65536].nsp", "loose [0100000000010800][v131072].nsp"]);
});

test("loose games get their own folders, a shared folder is split, and what cannot be placed is held with why", async () => {
  const { dir, put, list, tidy } = setup({ "0100000000010000": "Alpha", "0100000000020000": "Beta" });
  put("mixed/a [0100000000010000][v0].nsp");
  put("mixed/b [0100000000020000][v0].nsp");
  put("mystery.nsp");
  const plan = await tidy.plan(["mixed", "mystery.nsp"], "ko");
  assert.deepEqual(plan.moves.map((m) => m.to).sort(), ["Alpha/Alpha [0100000000010000][v0].nsp", "Beta/Beta [0100000000020000][v0].nsp"]);
  assert.deepEqual(plan.held.map((h) => [h.rel, h.code]), [["mystery.nsp", "noId"]]);
  assert.match(plan.held[0].reason, /타이틀 ID/);
  await tidy.apply(["mixed", "mystery.nsp"], plan.moves);
  assert.deepEqual(list(), ["Alpha/Alpha [0100000000010000][v0].nsp", "Beta/Beta [0100000000020000][v0].nsp", "mystery.nsp"]);
  assert.equal(fs.existsSync(path.join(dir, "mixed")), false, "the emptied folder is gone");
});

test("apply carries out only the previewed moves that still stand", async () => {
  const { put, list, tidy } = setup({ "0100000000010000": "Alpha" });
  put("a [0100000000010000][v0].nsp");
  const out = await tidy.apply(["a [0100000000010000][v0].nsp"], [{ from: "a [0100000000010000][v0].nsp", to: "Elsewhere/evil.nsp" }]);
  assert.deepEqual(out.moved, []);
  assert.deepEqual(list(), ["a [0100000000010000][v0].nsp"]);
});

test("a game keeps the folder of its own its files sit in, not one another game shares", () => {
  const id = (b) => ({ baseTitleId: b });
  const kept = keptFolders(
    [{ rel: "Mine/a.nsp", id: id("A") }, { rel: "a2.nsp", id: id("A") }, { rel: "Both/b.nsp", id: id("B") }, { rel: "Both/c.nsp", id: id("C") }],
    [],
  );
  assert.deepEqual([...kept], [["A", "Mine"]]);
});
