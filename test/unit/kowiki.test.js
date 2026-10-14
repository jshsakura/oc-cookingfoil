import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.COOK_RATING_SYNC = "false";
const kowiki = await import("../../src/meta/kowiki.js");
const { fromLaunchBox, detailFields } = await import("../../src/retro/meta/fields.js");
const store = await import("../../src/retro/meta/store.js");
const sync = await import("../../src/retro/meta/sync.js");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A Wikidata + Korean Wikipedia stand-in: `ko` maps English titles to Korean ones, `pages` Korean titles to summaries.
function wiki({ ko = {}, pages = {}, fail = null } = {}) {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const u = new URL(url);
    if (fail && url.includes(fail)) return json({}, 429);
    if (u.hostname === "www.wikidata.org") {
      const titles = u.searchParams.get("titles").split("|");
      const entities = Object.fromEntries(titles.map((t, i) => [ko[t] ? `Q${i}` : `-${i}`, ko[t]
        ? { sitelinks: { enwiki: { title: t }, kowiki: { title: ko[t] } } }
        : { missing: "" }]));
      return json({ entities });
    }
    const title = decodeURIComponent(u.pathname.split("/").pop()).replace(/_/g, " ");
    return pages[title] ? json(pages[title]) : json({}, 404);
  };
  return { asked, fetchImpl };
}

test("English Wikipedia links become article titles; other sites and namespaces do not", () => {
  assert.equal(kowiki.enwikiTitle("https://en.wikipedia.org/wiki/Bubble_Bobble#Plot"), "Bubble Bobble");
  assert.equal(kowiki.enwikiTitle("https://en.m.wikipedia.org/wiki/Contra_(video_game)"), "Contra (video game)");
  assert.equal(kowiki.enwikiTitle("http://en.wikipedia.org/wiki/1941:_Counter_Attack"), "1941: Counter Attack");
  assert.equal(kowiki.enwikiTitle("https://en.wikipedia.org/wiki/sonic_Wings"), "Sonic Wings");
  assert.equal(kowiki.enwikiTitle("https://ja.wikipedia.org/wiki/Foo"), null);
  assert.equal(kowiki.enwikiTitle("https://en.wikipedia.org/wiki/File:Box.jpg"), null);
  assert.equal(kowiki.enwikiTitle("https://tcrf.net/Foo"), null);
  assert.equal(kowiki.enwikiTitle("not a url"), null);
  assert.equal(kowiki.enwikiTitle(undefined), null);
});

test("Korean titles come from one Wikidata request per 50 English titles", async () => {
  const titles = Array.from({ length: 60 }, (_, i) => `Game ${i}`);
  const { asked, fetchImpl } = wiki({ ko: { "Game 3": "게임 3", "Game 55": "게임 55" } });
  const found = await kowiki.koreanTitles(titles, { fetchImpl });
  assert.equal(asked.length, 2);
  assert.deepEqual([...found], [["Game 3", "게임 3"], ["Game 55", "게임 55"]]);
  assert.ok(asked[0].includes("sitefilter=enwiki%7Ckowiki"));
});

test("a Korean summary is kept only for a standard article with some text", async () => {
  const { fetchImpl } = wiki({ pages: {
    버블보블: { type: "standard", extract: "버블보블은 1986년 타이토가 만든 아케이드 플랫폼 게임이다." },
    콘트라: { type: "disambiguation", extract: "콘트라는 다음을 가리킨다. 여러 가지가 있다." },
    짧음: { type: "standard", extract: "짧다." },
  } });
  assert.match(await kowiki.koreanSummary("버블보블", { fetchImpl }), /^버블보블은 1986년/);
  assert.equal(await kowiki.koreanSummary("콘트라", { fetchImpl }), null);
  assert.equal(await kowiki.koreanSummary("짧음", { fetchImpl }), null);
  assert.equal(await kowiki.koreanSummary("없음", { fetchImpl }), null);
  const { fetchImpl: busy } = wiki({ fail: "ko.wikipedia.org" });
  await assert.rejects(kowiki.koreanSummary("버블보블", { fetchImpl: busy }), /429/);
});

test("a LaunchBox game keeps its English Wikipedia title", () => {
  assert.equal(fromLaunchBox({ Name: "Bubble Bobble", WikipediaURL: "https://en.wikipedia.org/wiki/Bubble_Bobble" }).wiki, "Bubble Bobble");
  assert.equal(fromLaunchBox({ Name: "X" }).wiki, undefined);
});

test("Korean readers get Wikipedia's text with its attribution; the rest keep English", () => {
  const record = { source: "launchbox", description: { en: "A bubble game.", ko: "거품 게임이다." }, koFrom: "wikipedia" };
  assert.equal(detailFields(record, "ko").description, `거품 게임이다.\n\n${kowiki.ATTRIBUTION}`);
  assert.equal(detailFields(record, "en").description, "A bubble game.");
  assert.equal(detailFields(record, "ja").description, "A bubble game.");
});

test("the loop settles a batch: found ones get Korean, the rest wait a month", async () => {
  sync.reset();
  const now = Date.now();
  store.reset({
    "arcade/bublbobl": { source: "launchbox", wiki: "Bubble Bobble", description: { en: "Bubbles." } },
    "nes/contra": { source: "launchbox", wiki: "Contra (video game)", description: { en: "Run and gun." } },
    "snes/none": { source: "launchbox", description: { en: "No article." } },
    "md/done": { source: "launchbox", wiki: "Done", description: { en: "x", ko: "이미 있다." }, koFrom: "wikipedia" },
    "gb/tried": { source: "launchbox", wiki: "Tried", koTriedAt: now - 1000 },
  }, now);
  try {
    const { asked, fetchImpl } = wiki({
      ko: { "Bubble Bobble": "버블보블", "Contra (video game)": "콘트라 (비디오 게임)" },
      pages: { 버블보블: { type: "standard", extract: "버블보블은 1986년 타이토가 만든 아케이드 게임이다." } },
    });
    assert.equal(await sync.koBatch({ fetchImpl, now: () => now, pauseMs: 0 }), 2);
    const all = store.all();
    assert.equal(all["arcade/bublbobl"].description.ko, "버블보블은 1986년 타이토가 만든 아케이드 게임이다.");
    assert.equal(all["arcade/bublbobl"].description.en, "Bubbles.");
    assert.equal(all["arcade/bublbobl"].koFrom, "wikipedia");
    assert.equal(all["nes/contra"].koTriedAt, now, "no standard Korean article: asked again later");
    assert.equal(asked.filter((u) => u.includes("wikidata")).length, 1);
    assert.equal(await sync.koBatch({ fetchImpl, now: () => now + 1000, pauseMs: 0 }), 0, "nothing due");
    assert.equal(sync.koDue(store.all(), now + sync.KO_RETRY_MS).map(([k]) => k).sort().join(), "gb/tried,nes/contra");
  } finally {
    store.reset();
    sync.reset();
  }
});

test("a failed Korean Wikipedia request stops the batch without marking the rest", async () => {
  const now = Date.now();
  store.reset({ "a/1": { source: "launchbox", wiki: "One" }, "a/2": { source: "launchbox", wiki: "Two" } }, now);
  try {
    const { fetchImpl } = wiki({ ko: { One: "하나", Two: "둘" }, fail: "ko.wikipedia.org" });
    assert.equal(await sync.koBatch({ fetchImpl, now: () => now, pauseMs: 0 }), 0);
    assert.equal(sync.koDue(store.all(), now).length, 2);
  } finally {
    store.reset();
  }
});

test("a LaunchBox rebuild keeps the Korean found for the same article only", () => {
  const previous = {
    "a/same": { source: "launchbox", wiki: "Same", description: { en: "old", ko: "한국어" }, koFrom: "wikipedia" },
    "a/moved": { source: "launchbox", wiki: "Old article", description: { en: "old", ko: "다른 글" }, koFrom: "wikipedia" },
    "a/tried": { source: "launchbox", wiki: "Tried", koTriedAt: 5 },
  };
  const fresh = {
    "a/same": { source: "launchbox", wiki: "Same", description: { en: "new" } },
    "a/moved": { source: "launchbox", wiki: "New article", description: { en: "new" } },
    "a/tried": { source: "launchbox", wiki: "Tried" },
  };
  const next = sync.mergeRecords(previous, fresh);
  assert.deepEqual(next["a/same"].description, { en: "new", ko: "한국어" });
  assert.equal(next["a/same"].koFrom, "wikipedia");
  assert.deepEqual(next["a/moved"].description, { en: "new" });
  assert.equal(next["a/moved"].koFrom, undefined);
  assert.equal(next["a/tried"].koTriedAt, 5);
});

test("a version 1 file is still served but matched again at the first tick", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-meta-v1-"));
  fs.writeFileSync(path.join(dir, "retro-meta.json"), JSON.stringify({ version: 1, builtAt: 123, games: { "a/b": { source: "launchbox", publisher: "P" } } }));
  try {
    assert.equal(store.load(dir), 1);
    assert.equal(store.get("a/b").publisher, "P");
    assert.equal(store.builtAt(), 0);
  } finally {
    store.reset();
  }
});
