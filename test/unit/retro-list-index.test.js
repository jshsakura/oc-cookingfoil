import { test } from "node:test";
import assert from "node:assert/strict";
import { createIndexCache, delta, snapshot } from "../../src/retro/list-index.js";

test("a snapshot orders by id and its version follows the content, not the order it came in", () => {
  const a = snapshot([{ id: "snes-b", name: "B" }, { id: "nes-a", name: "A" }]);
  const b = snapshot([{ id: "nes-a", name: "A" }, { id: "snes-b", name: "B" }]);
  assert.deepEqual(a.games.map((g) => g.id), ["nes-a", "snes-b"]);
  assert.equal(a.version, b.version);
  assert.match(a.version, /^[0-9a-f]{16}$/);
  assert.notEqual(snapshot([{ id: "nes-a", name: "A2" }, { id: "snes-b", name: "B" }]).version, a.version);
});

test("a delta names what was added or changed and the ids gone, nothing else", () => {
  const before = snapshot([{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }]);
  const after = snapshot([{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "d", v: 1 }]);
  const { changed, removed } = delta(before.hashes, after);
  assert.deepEqual(changed, [{ id: "b", v: 2 }, { id: "d", v: 1 }]);
  assert.deepEqual(removed, ["c"]);
  assert.deepEqual(delta(after.hashes, after), { changed: [], removed: [] });
});

test("the cache rebuilds after its window or a new source, and remembers a bounded history", () => {
  let n = 0;
  const cache = createIndexCache((src) => [{ id: "a", v: src.v }, { id: `n${n++}`, v: 0 }].slice(0, 1), { freshMs: 1000, history: 2 });
  const src1 = { v: 1 };
  const e1 = cache.get(src1, "en", 0);
  assert.equal(cache.get(src1, "en", 500), e1, "within the window, the same entry");
  const e1b = cache.get(src1, "en", 1500);
  assert.equal(e1b.snap.version, e1.snap.version);
  assert.equal(e1b.pages, e1.pages, "an unchanged list keeps its pages");
  const e2 = cache.get({ v: 2 }, "en", 1600);
  assert.notEqual(e2.snap.version, e1.snap.version, "a new catalog rebuilds at once");
  assert.ok(cache.hashesOf("en", e1.snap.version));
  cache.get({ v: 3 }, "en", 1700);
  assert.equal(cache.hashesOf("en", e1.snap.version), null, "the oldest is forgotten past the history");
  assert.equal(cache.hashesOf("ko", e2.snap.version), null, "per language");
});
