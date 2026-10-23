import { test } from "node:test";
import assert from "node:assert/strict";
import { leanCores, leanKoNames, leanRequirements, leanTrash, windowOf } from "../../src/capabilities/lean.js";
import { BUDGET_BYTES, fitJson } from "../../src/mcp/envelope.js";

const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

const koRow = (i) => ({ id: `gba-${i}`, system: "gba", systemName: "게임보이 어드밴스", name: `이름 ${i}`, file: `파일 이름이 길다 ${i}.gba`, ko: `한글 ${i}`, en: `English ${i}`, by: "sha256" });
const review = { index: { files: 9, read: 9, skipped: 0, busy: false }, confirmedTotal: 300, confirmed: Array.from({ length: 300 }, (_, i) => koRow(i)), guessesTotal: 3, guesses: [koRow(900), koRow(901), koRow(902)] };

test("retro_ko_names answers a page of the guesses by default, with the file names left out", () => {
  const out = leanKoNames(review);
  assert.equal(out.list, "guesses");
  assert.equal(out.total, 3);
  assert.deepEqual(Object.keys(out.items[0]), ["id", "system", "ko", "en", "by"]);
  assert.equal(out.confirmedTotal, 300);
});

test("retro_ko_names pages the confirmed list and filters it by any of its names", () => {
  const page = leanKoNames(review, { list: "confirmed", limit: 10, offset: 290 });
  assert.equal(page.total, 300);
  assert.deepEqual(page.items.map((r) => r.id), Array.from({ length: 10 }, (_, i) => `gba-${290 + i}`));
  const found = leanKoNames(review, { list: "confirmed", q: "english 42" });
  assert.deepEqual(found.items.map((r) => r.id), ["gba-42"]);
  assert.ok(bytes(leanKoNames(review, { list: "confirmed" })) < 4000, "a default page is small");
  assert.equal(windowOf({ limit: 5000 }).limit, 100, "limit is capped");
});

const cores = [
  { core: "mgba", file: "mgba_libretro_libnx.nro", name: "mGBA", extensions: "gba|gb", size: 1000, sha256: "a".repeat(64), modifiedAt: 1, origin: "official", systems: [{ id: "gba", name: "GBA", games: 9 }] },
  { core: "snes9x", file: "snes9x_libretro_libnx.nro", name: "Snes9x", extensions: "sfc", size: 2000, sha256: "b".repeat(64), modifiedAt: 2, origin: "extra", off: true, systems: [] },
];
const coresView = {
  official: "1.20", retroarch: { size: 5 }, auto: { enabled: true, hidden: [{ core: "x" }], last: { big: "y".repeat(500) } },
  sources: { repo: null, cores: { mgba: "upload" } },
  cores,
  systems: [{ id: "gba", name: "GBA", games: 9, core: "mgba", tableCore: "mgba", installed: true, fits: "z".repeat(50), others: "o".repeat(300), coreState: { state: "ok", message: "m".repeat(90) } }],
};

test("retro_cores answers one short line a core and a console, and one core whole on request", () => {
  const out = leanCores(coresView);
  assert.deepEqual(out.cores[0], { core: "mgba", size: 1000, origin: "official", systems: ["gba"] });
  assert.equal(out.cores[1].off, true);
  assert.deepEqual(out.systems[0], { id: "gba", games: 9, core: "mgba", installed: true, state: "ok" });
  assert.deepEqual(out.sources, { repo: null, custom: ["mgba"] });
  assert.deepEqual(out.auto, { enabled: true, hidden: 1 });
  assert.ok(bytes(out) < bytes(coresView) / 2);
  const one = leanCores(coresView, "mgba");
  assert.equal(one.core.sha256.length, 64);
  assert.equal(one.systems[0].others.length, 300, "the console rows come whole");
  assert.equal(one.cores, undefined);
  assert.throws(() => leanCores(coresView, "nope"), (err) => err.status === 404 && /mgba, snes9x/.test(err.message));
});

const sys = (id, missing = 0, check = 0) => ({ id, names: { en: id }, games: 3, missing, check, cores: [{ core: "c", file: "f", state: "present", games: 3 }], firmware: [] });
const reqView = { note: "n".repeat(260), retroarch: "installed", complete: false, systems: [sys("gb"), sys("gba", 2), sys("nes"), sys("snes", 0, 1)] };

test("retro_requirements gives the systems with a problem whole and only the ids of the rest", () => {
  const out = leanRequirements(reqView);
  assert.deepEqual(out.systems.map((s) => s.id), ["gba", "snes"]);
  assert.deepEqual(out.ok, ["gb", "nes"]);
  assert.equal(out.note, undefined);
  const one = leanRequirements(reqView, "nes");
  assert.deepEqual([one.systems.length, one.systems[0].id, one.ok], [1, "nes", []]);
  assert.throws(() => leanRequirements(reqView, "zz"), (err) => err.status === 404);
});

const entry = (i) => ({ version: 1, id: `games|.t|e${i}`, root: "games", kind: "game", action: "remove", by: "admin", name: `Game ${i}`, size: 10, trashedAt: i, ageDays: 0, home: ".t", entry: `e${i}`, restoreKeys: [], items: Array.from({ length: 30 }, (_, k) => ({ rel: `Game ${i}/very/long/path/file-${k}.nsp`, type: "file", size: 1 })), missing: 0, incomplete: i === 2 ? 1 : 0 });
const trashList = { items: Array.from({ length: 45 }, (_, i) => entry(i)), total: { bytes: 450, count: 45 }, roots: { games: { bytes: 450, count: 45 } }, noticeDays: 30, old: { count: 0, bytes: 0 }, version: "v", listedAt: 5, unavailable: [] };

test("trash_list answers a page of one-line entries, the file paths left out", () => {
  const out = leanTrash(trashList);
  assert.equal(out.items.length, 20);
  assert.deepEqual(Object.keys(out.items[0]), ["id", "root", "kind", "name", "size", "trashedAt", "ageDays", "files"]);
  assert.equal(out.items[0].files, 30);
  assert.equal(out.items[2].incomplete, 1);
  assert.equal(out.total.count, 45);
  assert.equal(out.unavailable, undefined, "an empty list is not sent");
  assert.deepEqual(leanTrash(trashList, { limit: 20, offset: 40 }).items.map((e) => e.name), ["Game 40", "Game 41", "Game 42", "Game 43", "Game 44"]);
  assert.ok(bytes(out) < 4000);
});

test("a result over the budget loses rows from its longest list and says so, at about 3,000 tokens", () => {
  assert.equal(BUDGET_BYTES, 12_000);
  const big = { total: 900, items: Array.from({ length: 900 }, (_, i) => ({ i, pad: "x".repeat(60) })) };
  const text = fitJson(big);
  assert.ok(Buffer.byteLength(text) <= BUDGET_BYTES);
  assert.ok(JSON.parse(text).truncated.dropped > 0);
});
