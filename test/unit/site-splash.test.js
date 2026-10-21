import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../site/site.js", import.meta.url), "utf8");
const splash = source.slice(source.indexOf("function startSplash("));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function preview({ seen = false, blockedStorage = false, still = false, play = () => Promise.resolve() } = {}) {
  const butter = new EventTarget();
  const stage = new EventTarget();
  const gestures = new EventTarget();
  const attributes = new Map();
  const storage = new Map(seen ? [["chimed", "1"]] : []);
  const listeners = [];
  let attempts = 0;
  let audioCount = 0;
  stage.querySelector = () => butter;
  stage.setAttribute = (key, value) => attributes.set(key, value);
  const document = { documentElement: { dataset: { lang: "en" } }, getElementById: () => stage };
  vm.runInNewContext(`${splash}; startSplash(listeners);`, {
    document, listeners,
    matchMedia: () => ({ matches: still }),
    addEventListener: gestures.addEventListener.bind(gestures),
    removeEventListener: gestures.removeEventListener.bind(gestures),
    sessionStorage: {
      getItem: (key) => { if (blockedStorage) throw Error("blocked"); return storage.get(key); },
      setItem: (key, value) => { if (blockedStorage) throw Error("blocked"); storage.set(key, value); },
    },
    Audio: class {
      constructor() { ++audioCount; }
      canPlayType() { return "probably"; }
      play() { ++attempts; return play(attempts); }
    },
  });
  return {
    stage, document, storage, attributes, listeners,
    land: () => butter.dispatchEvent(new Event("animationiteration")),
    click: () => stage.dispatchEvent(new Event("click")),
    gesture: (type = "pointerdown") => gestures.dispatchEvent(new Event(type)),
    attempts: () => attempts, audioCount: () => audioCount,
  };
}

test("the public site's chime plays once despite later landings and logo clicks", async () => {
  const page = preview();
  page.land();
  await tick();
  page.click(); page.land(); page.gesture();
  await tick();
  assert.equal(page.attempts(), 1);
  assert.equal(page.storage.get("chimed"), "1");
  assert.equal(page.stage.disabled, true);
  page.document.documentElement.dataset.lang = "ko";
  for (const update of page.listeners) update();
  assert.equal(page.attributes.get("aria-label"), "시작 소리를 재생했습니다");
});

test("a play in flight cannot be queued again", async () => {
  let finish;
  const page = preview({ play: () => new Promise((resolve) => { finish = resolve; }) });
  page.land(); page.click(); page.land(); page.gesture();
  assert.equal(page.attempts(), 1);
  finish();
  await tick();
  page.click();
  assert.equal(page.attempts(), 1);
});

test("blocked autoplay retries on a gesture and then stays played", async () => {
  const page = preview({ play: (n) => n === 1 ? Promise.reject({ name: "NotAllowedError" }) : Promise.resolve() });
  page.land();
  await tick();
  assert.equal(page.storage.has("chimed"), false);
  page.gesture();
  await tick();
  page.gesture("keydown"); page.gesture("touchstart"); page.click(); page.land();
  assert.equal(page.attempts(), 2);
  assert.equal(page.storage.get("chimed"), "1");
});

test("a later page visit in the same tab creates no new audio", () => {
  const page = preview({ seen: true });
  page.land(); page.click(); page.gesture();
  assert.equal(page.audioCount(), 0);
  assert.equal(page.stage.disabled, true);
});

test("denied session storage still permits only one successful chime", async () => {
  const page = preview({ blockedStorage: true });
  page.land();
  await tick();
  page.click(); page.land(); page.gesture();
  assert.equal(page.attempts(), 1);
  assert.equal(page.stage.disabled, true);
});

test("reduced motion plays without waiting for a CSS animation", async () => {
  const page = preview({ still: true });
  await tick();
  page.click(); page.land();
  assert.equal(page.attempts(), 1);
  assert.equal(page.stage.disabled, true);
});
