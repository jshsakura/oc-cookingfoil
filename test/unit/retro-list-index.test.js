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

test("an unchanged library is not rebuilt per request: only a moved stamp, at most per window, or its age", () => {
  let builds = 0;
  let revision = 0;
  const cache = createIndexCache((src) => { builds++; return [{ id: "a", v: src.v, r: revision }]; }, { stamp: () => revision, freshMs: 1000, maxAgeMs: 60_000 });
  const src = { v: 1 };
  cache.get(src, "en", 0);
  for (const at of [1500, 5000, 30_000]) cache.get(src, "en", at);
  assert.equal(builds, 1, "nothing moved: the first build serves");
  revision++;
  assert.equal(cache.get(src, "en", 30_500).snap.games[0].r, 1, "a moved stamp rebuilds");
  revision++;
  cache.get(src, "en", 31_000);
  assert.equal(builds, 2, "but at most once per window");
  assert.equal(cache.get(src, "en", 31_600).snap.games[0].r, 2, "and after it");
  cache.get(src, "en", 92_000);
  assert.equal(builds, 4, "past its age it is rebuilt even with nothing moved");
});

test("each language, traditional Chinese included, keeps its own snapshot and version", () => {
  const cache = createIndexCache((src, lang) => [{ id: "a", name: src.names[lang] ?? src.names.en }]);
  const src = { names: { en: "Name", zh: "名称", "zh-Hant": "名稱", de: "Name" } };
  const v = Object.fromEntries(["en", "zh", "zh-Hant", "de"].map((l) => [l, cache.get(src, l, 0).snap.version]));
  assert.notEqual(v.zh, v["zh-Hant"], "simplified and traditional never share a version, so never an ETag");
  assert.notEqual(v.zh, v.en);
  assert.equal(v.de, v.en, "the same body is the same version");
  assert.ok(cache.hashesOf("zh-Hant", v["zh-Hant"]));
  assert.equal(cache.hashesOf("zh", v["zh-Hant"]), null);
});
